"""Real attempt INSERTs against a schema copy in an empty local PostgreSQL cluster.

Run with --port PORT --data-directory PATH after starting a disposable cluster.
Development is accessed only through the allowlisted read-only helper: schema
metadata and a preservation digest, never copied learner records. All writes
go to a new kbc_attempts_test_* database with synthetic parent/attempt records.
No migrations, application startup hooks, or live services are invoked.
"""
import argparse
import importlib
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
from uuid import uuid4

import psycopg
from psycopg import sql

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from verify_inclusion_canonical_targets import connect_development


def development_schema():
    connection = connect_development()
    try:
        columns = connection.execute('''SELECT a.attname,format_type(a.atttypid,a.atttypmod),
            a.attnotnull,pg_get_expr(d.adbin,d.adrelid)
            FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
            WHERE a.attrelid='"Learner".subject_activity_attempts'::regclass
              AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum''').fetchall()
        constraints = connection.execute('''SELECT conname,contype,pg_get_constraintdef(oid),convalidated
            FROM pg_constraint WHERE conrelid='"Learner".subject_activity_attempts'::regclass
              AND contype<>'n' ORDER BY conname''').fetchall()
        indexes = connection.execute('''SELECT indexname,indexdef FROM pg_indexes
            WHERE schemaname='Learner' AND tablename='subject_activity_attempts' ORDER BY indexname''').fetchall()
        triggers = connection.execute('''SELECT pg_get_triggerdef(oid) FROM pg_trigger
            WHERE tgrelid='"Learner".subject_activity_attempts'::regclass AND NOT tgisinternal ORDER BY tgname''').fetchall()
        functions = [connection.execute('SELECT pg_get_functiondef(%s::regprocedure)', [name]).fetchone()[0]
                     for name in ('"Learner".invalidate_monthly_actuals(bigint[])',
                                  '"Learner".monthly_actual_event_11()')]
        digest = connection.execute('''SELECT count(*),md5(string_agg(md5(to_jsonb(a)::text),'' ORDER BY id))
            FROM "Learner".subject_activity_attempts a''').fetchone()
        assert len(columns) == 19 and sum(row[1] == 'f' for row in constraints) == 6
        assert all(row[3] for row in constraints) and len(indexes) == 4 and len(triggers) == 3
        return columns, constraints, indexes, triggers, functions, digest
    finally:
        connection.rollback()
        connection.close()


def prepare(port, directory, schema):
    config = dict(host='127.0.0.1', port=port, user='postgres', dbname='postgres', connect_timeout=5)
    with psycopg.connect(**config, autocommit=True) as admin:
        host, actual_port, actual_directory, branch = admin.execute('''SELECT host(inet_server_addr()),
            inet_server_port(),current_setting('data_directory'),current_setting('neon.branch_id',true)''').fetchone()
        if (host != '127.0.0.1' or actual_port != port or branch
                or Path(actual_directory).resolve() != directory.resolve()
                or not directory.name.startswith('kbc_attempts_')):
            raise RuntimeError('Not the explicitly selected disposable local cluster.')
        other = admin.execute("SELECT datname FROM pg_database WHERE NOT datistemplate AND datname<>'postgres'").fetchall()
        if any(not name.startswith('kbc_attempts_test_') for (name,) in other):
            raise RuntimeError('Cluster contains a non-test database; refusing writes.')
        config['dbname'] = 'kbc_attempts_test_' + uuid4().hex
        admin.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(config['dbname'])))
    columns, constraints, indexes, triggers, functions, _ = schema
    with psycopg.connect(**config) as connection:
        # Minimal synthetic parents; the attempts table itself is reproduced
        # from live metadata, including all six FKs, checks, indexes and triggers.
        connection.execute('''CREATE SCHEMA "Learner"; CREATE SCHEMA curriculum; CREATE SCHEMA enrolment;
            CREATE TABLE enrolment."Created_users" (id integer PRIMARY KEY);
            CREATE TABLE "Learner".learners (id bigint PRIMARY KEY,enrolment_id integer,aptem_id bigint);
            CREATE TABLE curriculum.source_lms_groups (group_id bigint PRIMARY KEY);
            CREATE TABLE curriculum.source_courses (id bigint PRIMARY KEY,source_course_ref text,source_system text,deleted_at timestamptz);
            CREATE TABLE curriculum.source_activities (id bigint PRIMARY KEY,source_course_id bigint,source_activity_id text,
                source_activity_kind text,source_system text,deleted_at timestamptz);
            CREATE TABLE "Learner".learner_source_course_memberships (id bigint PRIMARY KEY,learner_id bigint,source_course_id bigint,deleted_at timestamptz);
            CREATE TABLE curriculum.free_programme_components (id varchar PRIMARY KEY);
            CREATE TABLE "Learner".learner_monthly_targets (id bigint PRIMARY KEY,learner_id bigint,
                actual_seconds_total bigint,actual_updated_at timestamptz,actual_summary jsonb,UNIQUE(id,learner_id));
            CREATE TABLE "Learner".progress_transfer_items (enrolment_id integer,course_ref text);
            CREATE TABLE "Learner".learner_activity_sources (learner_id bigint,canonical_progress_id bigint,source_catalog_activity_id bigint);
            CREATE TABLE "Learner".free_course_hours_migration (old_progress_id bigint,learner_id bigint,free_course_id text,free_component_id text);
            CREATE TABLE "Learner".free_course_hours_migration_additional (LIKE "Learner".free_course_hours_migration);
            CREATE TABLE "Learner".free_course_hours_migration_remaining (LIKE "Learner".free_course_hours_migration);
            INSERT INTO enrolment."Created_users" VALUES (11),(12);
            INSERT INTO "Learner".learners VALUES (501,11,101),(502,12,102);
            INSERT INTO curriculum.source_lms_groups VALUES (50),(60);
            INSERT INTO curriculum.source_courses VALUES (5,'50','old_lms',NULL),(6,'60','old_lms',NULL);
            INSERT INTO curriculum.source_activities VALUES (91,5,'material:8','material','old_lms',NULL),
                (92,5,'quiz:8','quiz','old_lms',NULL),(93,6,'material:8','material','old_lms',NULL);
            INSERT INTO "Learner".learner_source_course_memberships VALUES (1,501,5,NULL),(2,502,6,NULL);
            INSERT INTO curriculum.free_programme_components VALUES ('COMP'),('OTHER');
            INSERT INTO "Learner".learner_monthly_targets VALUES (1,501,3600,now(),'{}'),(2,502,7200,now(),'{}');''')
        fields = [sql.SQL('{} {}{}{}').format(sql.Identifier(name), sql.SQL(kind),
                    sql.SQL(' NOT NULL' if required else ''), sql.SQL(' DEFAULT ' + default if default else ''))
                  for name, kind, required, default in columns]
        connection.execute(sql.SQL('CREATE TABLE "Learner".subject_activity_attempts ({})').format(sql.SQL(',').join(fields)))
        for name, _, definition, _ in constraints:
            connection.execute(sql.SQL('ALTER TABLE "Learner".subject_activity_attempts ADD CONSTRAINT {} {}')
                               .format(sql.Identifier(name), sql.SQL(definition)))
        constraint_names = {row[0] for row in constraints}
        for name, definition in indexes:
            if name not in constraint_names:
                connection.execute(definition)
        for definition in functions:
            connection.execute(definition)
        for (definition,) in triggers:
            connection.execute(definition)
    return config


def run(config):
    from django.conf import settings
    from django.apps import AppConfig
    database = dict(ENGINE='django.db.backends.postgresql', NAME=config['dbname'], HOST=config['host'],
                    PORT=config['port'], USER=config['user'], OPTIONS={'options': '-c statement_timeout=15000'})
    settings.configure(SECRET_KEY='synthetic-attempt-tests', USE_TZ=True, TIME_ZONE='Europe/London',
        DATABASES={name: dict(database) for name in ('default', 'enrolment')},
        INSTALLED_APPS=[AppConfig(p.parent.name, importlib.import_module(p.parent.name)) for p in ROOT.glob('*/models.py')])
    import django
    django.setup()
    from django.db import connections, transaction, IntegrityError
    from learner_api import subject_store, free_course_attempts

    class AttemptTests(unittest.TestCase):
        def setUp(self):
            self.atomic = transaction.atomic(using='enrolment')
            self.atomic.__enter__()
            self.addCleanup(self.rollback)
            self.definition = dict(title='Synthetic', available=True, has_reading=False, quiz=None)

        def rollback(self):
            transaction.set_rollback(True, using='enrolment')
            self.atomic.__exit__(None, None, None)

        def query(self, statement, params=()):
            with connections['enrolment'].cursor() as cursor:
                cursor.execute(statement, params)
                return cursor.fetchall() if cursor.description else None

        def test_real_source_insert_and_repeat_preserve_both_rows(self):
            first = subject_store.start(11,101,50,8,self.definition)
            second = subject_store.start(11,101,50,8,self.definition)
            self.assertNotEqual(first, second)
            self.assertEqual(self.query('SELECT learner_id,source_activity_fk FROM "Learner".subject_activity_attempts'), [(501,91),(501,91)])
            self.assertEqual(self.query('SELECT actual_seconds_total FROM "Learner".learner_monthly_targets ORDER BY id'), [(None,),(7200,)])

        def test_material_and_quiz_identity_are_distinct(self):
            subject_store.start(11,101,50,8,self.definition)
            subject_store.start(11,101,50,8,dict(self.definition,catalogue_kind='quiz',quiz={'ready':True}))
            self.assertEqual(self.query('SELECT source_activity_fk,kind FROM "Learner".subject_activity_attempts ORDER BY source_activity_fk'), [(91,'activity'),(92,'quiz')])

        def test_wrong_identity_course_type_and_deleted_membership_cannot_insert(self):
            for args in ((12,101,50,8),(11,102,50,8),(11,101,60,8),(11,101,50,999)):
                with self.subTest(args=args), self.assertRaises(LookupError):
                    subject_store.start(*args,self.definition)
            self.query('UPDATE "Learner".learner_source_course_memberships SET deleted_at=now() WHERE id=1')
            with self.assertRaises(LookupError):
                subject_store.start(11,101,50,8,self.definition)
            self.assertEqual(self.query('SELECT count(*) FROM "Learner".subject_activity_attempts'), [(0,)])

        def test_ambiguous_catalogue_does_not_choose_a_row(self):
            self.query("INSERT INTO curriculum.source_activities VALUES (94,5,'material:8','material','old_lms',NULL)")
            with self.assertRaises(LookupError):
                subject_store.start(11,101,50,8,self.definition)

        def test_old_insert_shape_is_rejected_by_real_constraints(self):
            with self.assertRaises(IntegrityError), transaction.atomic(using='enrolment'):
                self.query('''INSERT INTO "Learner".subject_activity_attempts
                    (id,enrolment_id,aptem_id,group_id,activity_id,kind,definition)
                    VALUES (%s,11,101,50,8,'activity','{}')''', [uuid4()])

        def test_foreign_key_is_enforced(self):
            with self.assertRaises(IntegrityError), transaction.atomic(using='enrolment'):
                self.query('''INSERT INTO "Learner".subject_activity_attempts
                    (id,learner_id,enrolment_id,aptem_id,group_id,activity_id,source_activity_fk,kind,definition)
                    VALUES (%s,501,11,101,50,8,999,'activity','{}')''', [uuid4()])

        def test_activity_finish_retry_is_idempotent(self):
            ident = subject_store.start(11,101,50,8,self.definition)
            result = subject_store.finish(11,101,50,8,ident,{},True)
            self.assertTrue(result['completed'])
            before = self.query('SELECT to_jsonb(a) FROM "Learner".subject_activity_attempts a')
            self.assertTrue(subject_store.finish(11,101,50,8,ident,{},True)['already_submitted'])
            self.assertEqual(before,self.query('SELECT to_jsonb(a) FROM "Learner".subject_activity_attempts a'))

        def test_failed_then_successful_quiz_preserves_both_attempts_and_scores(self):
            definition = dict(self.definition,catalogue_kind='quiz',quiz={
                'ready':True,'passing_percent':80,'questions':[{
                    'id':'Q','text':'Synthetic question','type':'single_choice',
                    'options':[{'id':'A','text':'Correct'},{'id':'B','text':'Incorrect'}],
                    'solution_ids':['A']}]})
            failed = subject_store.start(11,101,50,8,definition)
            self.assertFalse(subject_store.finish(11,101,50,8,failed,{'Q':['B']},False,
                                                  catalogue_kind='quiz')['completed'])
            passed = subject_store.start(11,101,50,8,definition)
            self.assertTrue(subject_store.finish(11,101,50,8,passed,{'Q':['A']},False,
                                                 catalogue_kind='quiz')['completed'])
            before = self.query('SELECT id,score_percent,passed,completed,answers FROM "Learner".subject_activity_attempts ORDER BY id')
            self.assertEqual(sorted((int(row[1]),row[2],row[3]) for row in before),
                             [(0,False,False),(100,True,True)])
            # Replaying the failed ID with changed answers cannot overwrite it.
            replay = subject_store.finish(11,101,50,8,failed,{'Q':['A']},False,catalogue_kind='quiz')
            self.assertTrue(replay['already_submitted'])
            self.assertFalse(replay['passed'])
            self.assertEqual(before,self.query('SELECT id,score_percent,passed,completed,answers FROM "Learner".subject_activity_attempts ORDER BY id'))

        def seed_history(self):
            imported = {'historical_import':True,'source_system':'old_lms'}
            fixtures = [
                (501,'COMP',True,True,None,imported),
                (501,'COMP',False,False,'2026-11-23T10:00:00Z',{}),
                (501,'COMP',True,True,'2026-11-23T11:00:00Z',{}),
                (501,'COMP',False,False,None,imported),
                (501,'COMP',True,True,None,{}),
                (501,'COMP',True,True,None,dict(imported,historical_import='true')),
                (502,'COMP',True,True,None,imported),
                (501,'OTHER',True,True,None,imported),
            ]
            for owner,component,passed,completed,at,definition in fixtures:
                self.query('''INSERT INTO "Learner".subject_activity_attempts
                    (id,learner_id,free_component_ref,source_activity_snapshot,kind,definition,
                     score_percent,passed,completed,started_at,submitted_at)
                    VALUES (%s,%s,%s,'{}','quiz',%s::jsonb,%s,%s,%s,'2026-11-23T09:00:00Z',%s)''',
                    [uuid4(),owner,component,json.dumps(definition),100 if passed else 0,passed,completed,at])

        def test_history_preserves_imports_failures_dates_and_ownership(self):
            self.seed_history()
            history = free_course_attempts.history(501,'COMP')
            self.assertEqual([(r['passed'],r['completed'],r['submittedAt'] is None) for r in history],
                             [(True,True,False),(False,False,False),(True,True,True)])
            self.assertEqual(free_course_attempts.history(999,'COMP'),[])
            self.assertEqual(len(free_course_attempts.history(502,'COMP')),1)

        def test_learner_and_staff_endpoints_return_undated_history_without_writes(self):
            from types import SimpleNamespace
            from django.test import RequestFactory
            from learner_api import free_courses_view as view
            from login import permissions
            self.seed_history()
            before = self.query('SELECT id,to_jsonb(a) FROM "Learner".subject_activity_attempts a ORDER BY id')
            for role,withdrawn in [('learner',False),('staff',False),('staff',True)]:
                owner = SimpleNamespace(pk=501,enrolment_id=11,learner_type='commercial',
                    lifecycle_status='withdrawn' if withdrawn else 'active',programme_status='active')
                account = SimpleNamespace(role=role,subject_id=11 if role=='learner' else 99,subject_type='learner')
                with self.subTest(role=role,withdrawn=withdrawn), \
                     patch.object(permissions,'_auth_gate_enabled',return_value=True), \
                     patch.object(permissions,'authenticate_request',return_value=account), \
                     patch.object(view,'_resolve_source',return_value=(owner,None)), \
                     patch.object(view,'_resolve_quiz_component',return_value=(7,'FREE',None)), \
                     patch.object(view,'assigned_course_ids',return_value=['FREE']), \
                     patch.object(view,'_scoped_rows',return_value=({},[],[{'id':'COMP','type':'quiz'}])), \
                     patch.object(view,'_fetch_quiz',return_value={'id':7,'questions':[],'passingGrade':80}):
                    response = view.free_course_quiz(RequestFactory().get('/'),kind='commercial',pk=11,component_id='COMP')
                    self.assertEqual(response.status_code,200)
                    rows = json.loads(response.content)['attempts']
                    self.assertEqual(len(rows),3)
                    self.assertIsNone(rows[-1]['submittedAt'])
                    self.assertTrue(rows[-1]['completed'])
            self.assertEqual(before,self.query('SELECT id,to_jsonb(a) FROM "Learner".subject_activity_attempts a ORDER BY id'))

    try:
        return unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(AttemptTests)).wasSuccessful()
    finally:
        connections.close_all()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port',type=int,required=True)
    parser.add_argument('--data-directory',type=Path,required=True)
    args = parser.parse_args()
    schema = development_schema()
    config = prepare(args.port,args.data_directory,schema)
    print('Local schema copied: 19 columns, six FKs, four indexes, three triggers; synthetic records only.',flush=True)
    try:
        passed = run(config)
    finally:
        after = development_schema()
        if schema != after:
            raise AssertionError('Development schema or attempt preservation digest changed.')
        print('Development schema and all attempt records unchanged.',flush=True)
    return 0 if passed else 1


if __name__ == '__main__':
    raise SystemExit(main())
