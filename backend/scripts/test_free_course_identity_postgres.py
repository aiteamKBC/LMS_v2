"""Guarded identity service against disposable PostgreSQL and captured triggers.

Development supplies read-only schema metadata only. All fixtures are synthetic.
Run with Python from the repository root; requires local initdb/pg_ctl binaries.
"""
import json
from pathlib import Path
import shutil
import subprocess
import sys
import unittest
from uuid import uuid4

import psycopg
from psycopg import sql

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'backend'))
from scripts.verify_inclusion_canonical_targets import connect_development


def metadata():
    with connect_development() as c:
        columns = c.execute('''SELECT attname,format_type(atttypid,atttypmod)
            FROM pg_attribute WHERE attrelid='"Learner".learner_progress_entries'::regclass
            AND attnum>0 AND NOT attisdropped ORDER BY attnum''').fetchall()
        triggers = c.execute('''SELECT pg_get_triggerdef(oid),pg_get_functiondef(tgfoid)
            FROM pg_trigger WHERE tgrelid='"Learner".learner_progress_entries'::regclass
            AND NOT tgisinternal ORDER BY tgname''').fetchall()
        invalidator = c.execute('SELECT pg_get_functiondef(\'"Learner".invalidate_monthly_actuals(bigint[])\'::regprocedure)').fetchone()[0]
        constraints = c.execute('''SELECT conname,pg_get_constraintdef(oid),convalidated
            FROM pg_constraint WHERE conrelid='"Learner".learner_progress_entries'::regclass
            AND conname LIKE 'lpe_free_%%' ORDER BY conname''').fetchall()
        assert len(constraints) == 3 and all(r[2] for r in constraints)
        return columns, triggers, invalidator, constraints


class IdentityTests(unittest.TestCase):
    def state(self):
        with db.cursor() as c:
            c.execute('''SELECT to_jsonb(p)-'free_course_ref'-'free_component_ref'
                FROM "Learner".learner_progress_entries p ORDER BY id''')
            progress = c.fetchall()
            c.execute('SELECT to_jsonb(t),xmin::text FROM "Learner".learner_monthly_targets t ORDER BY id')
            cache = c.fetchall()
            c.execute('SELECT to_jsonb(l),xmin::text FROM "Learner".learners l ORDER BY id')
            return progress, cache, c.fetchall()

    def setUp(self):
        # Raw identity reset is test preparation only; service never clears a mapping.
        with db.cursor() as c:
            c.execute('UPDATE "Learner".learner_progress_entries SET free_course_ref=NULL,free_component_ref=NULL WHERE id<>13')
        self.before = self.state()

    def tearDown(self):
        self.assertEqual(self.state(), self.before)
        self.assertEqual(list(listener.notifies(timeout=0.1)), [])

    def test_valid_owner_membership_and_idempotent_retry(self):
        self.assertTrue(assign(1, 10, 'FREE', 'COMP'))
        with db.cursor() as c:
            c.execute('SELECT xmin::text FROM "Learner".learner_progress_entries WHERE id=10')
            version = c.fetchone()
        self.assertFalse(assign(1, 10, 'FREE', 'COMP'))
        with db.cursor() as c:
            c.execute('SELECT xmin::text FROM "Learner".learner_progress_entries WHERE id=10')
            self.assertEqual(c.fetchone(), version)

    def test_other_learner_and_missing_progress_rejected(self):
        for owner, ident in [(2, 10), (1, -1)]:
            with self.subTest(owner=owner, ident=ident), self.assertRaises(LookupError):
                assign(owner, ident, 'FREE', 'COMP')

    def test_membership_and_missing_foreign_targets_rejected(self):
        for course, component in [('OTHER', 'COMP'), ('missing', 'COMP'), ('FREE', 'missing')]:
            with self.subTest(course=course, component=component), self.assertRaises(ValueError):
                assign(1, 10, course, component)

    def test_partial_blank_and_oversized_references_rejected(self):
        for course, component in [(None, 'COMP'), ('FREE', None), (' ', 'COMP'), ('FREE', 'x'*129)]:
            with self.subTest(course=course), self.assertRaises(ValueError):
                assign(1, 10, course, component)

    def test_conflict_preserves_existing_identity(self):
        assign(1, 10, 'FREE', 'COMP')
        with self.assertRaises(ValueError):
            assign(1, 10, 'OTHER', 'OTHER-COMP')
        with db.cursor() as c:
            c.execute('SELECT free_course_ref,free_component_ref FROM "Learner".learner_progress_entries WHERE id=10')
            self.assertEqual(c.fetchone(), ('FREE', 'COMP'))

    def test_soft_deleted_unenrolled_and_repeated_component_identities_supported(self):
        self.assertTrue(assign(1, 10, 'FREE', 'COMP'))
        self.assertTrue(assign(1, 11, 'FREE', 'COMP'))
        with db.cursor() as c:
            c.execute('SELECT count(*) FROM "Learner".learner_progress_entries WHERE free_component_ref=%s', ['COMP'])
            self.assertEqual(c.fetchone()[0], 2)

    def test_caller_transaction_rolls_back_assignment(self):
        from django.db import transaction
        with self.assertRaises(ValueError), transaction.atomic(using='enrolment'):
            assign(1, 10, 'FREE', 'COMP')
            raise ValueError('rollback probe')
        with db.cursor() as c:
            c.execute('SELECT free_component_ref FROM "Learner".learner_progress_entries WHERE id=10')
            self.assertIsNone(c.fetchone()[0])

    def test_membership_locked_until_commit(self):
        from django.db import transaction
        with transaction.atomic(using='enrolment'):
            assign(1, 10, 'FREE', 'COMP')
            with psycopg.connect(**config, autocommit=True) as other:
                other.execute("SET lock_timeout='100ms'")
                with self.assertRaises(psycopg.errors.LockNotAvailable):
                    other.execute("UPDATE curriculum.free_course_weeks SET course_id='OTHER' WHERE id='WEEK'")

    def test_attendance_trigger_candidates_are_rejected_before_update(self):
        # Fixture row 13 was inserted before existing triggers were installed.
        with self.assertRaises(ValueError):
            assign(1, 13, 'FREE', 'COMP')


def main():
    global db, assign, listener, config
    columns, triggers, invalidator, constraints = metadata()
    parent = ROOT / '.local' / 'free-course-backend-integration-20261124'
    parent.mkdir(parents=True, exist_ok=True)
    directory = parent / ('cluster_' + uuid4().hex[:10])
    directory.mkdir()
    data = directory / 'data'
    initdb, pgctl = shutil.which('initdb'), shutil.which('pg_ctl')
    assert initdb and pgctl, 'Local PostgreSQL binaries required; no remote fallback'
    subprocess.run([initdb, '-D', str(data), '-U', 'postgres', '-A', 'trust', '--no-locale', '-E', 'UTF8'], check=True, capture_output=True)
    with (directory / 'startup.log').open('wb') as output:
        subprocess.run([pgctl, '-D', str(data), '-l', str(directory / 'server.log'), '-o', '-h 127.0.0.1 -p 55494', '-w', 'start'], check=True, stdout=output, stderr=output, timeout=60)
    config = dict(host='127.0.0.1', port=55494, user='postgres', dbname='postgres')
    try:
        with psycopg.connect(**config, autocommit=True) as c:
            actual, branch = c.execute("SELECT current_setting('data_directory'),current_setting('neon.branch_id',true)").fetchone()
            assert Path(actual).resolve() == data.resolve() and not branch
            c.execute('''CREATE SCHEMA "Learner"; CREATE SCHEMA curriculum; CREATE SCHEMA "Engagement";
                CREATE TABLE "Learner".learners(id bigint PRIMARY KEY,completed_hours numeric);
                CREATE TABLE "Learner".learner_monthly_targets(id bigint PRIMARY KEY,learner_id bigint,actual_seconds_total bigint,actual_updated_at timestamptz,actual_summary jsonb);
                CREATE TABLE curriculum.free_courses(id varchar(128) PRIMARY KEY);
                CREATE TABLE curriculum.free_course_weeks(id varchar(128) PRIMARY KEY,course_id varchar(128),status text,deleted_at timestamptz);
                CREATE TABLE curriculum.free_programme_components(id varchar(128) PRIMARY KEY,free_module_id varchar(128),deleted_at timestamptz);
                INSERT INTO "Learner".learners VALUES(1,42),(2,84);
                INSERT INTO "Learner".learner_monthly_targets VALUES(1,1,3600,now(),'{"preserve":true}');
                INSERT INTO curriculum.free_courses VALUES('FREE'),('OTHER');
                INSERT INTO curriculum.free_course_weeks VALUES('WEEK','FREE','active',NULL),('OTHER-WEEK','OTHER','active',NULL);
                INSERT INTO curriculum.free_programme_components VALUES('COMP','WEEK',NULL),('OTHER-COMP','OTHER-WEEK',NULL);''')
            fields = [sql.SQL('{} {}').format(sql.Identifier(n), sql.SQL(t)) for n, t in columns]
            c.execute(sql.SQL('CREATE TABLE "Learner".learner_progress_entries ({},PRIMARY KEY(id))').format(sql.SQL(',').join(fields)))
            for name, definition, _ in constraints:
                c.execute(sql.SQL('ALTER TABLE "Learner".learner_progress_entries ADD CONSTRAINT {} {}').format(sql.Identifier(name), sql.SQL(definition)))
            c.execute('''INSERT INTO "Learner".learner_progress_entries(id,learner_id,source_payload,actual_seconds,accepted,deleted_at)
                VALUES(10,1,'{}',100,true,NULL),(11,1,'{}',200,true,now()),(12,2,'{}',300,false,NULL),
                (13,1,'{"original_source_ref":"att:synthetic"}',100,true,NULL)''')
            c.execute(invalidator)
            for function in {r[1] for r in triggers}:
                c.execute(function)
            for definition, _ in triggers:
                c.execute(definition)
        from django.conf import settings
        settings.configure(SECRET_KEY='isolated', DATABASES={alias:{'ENGINE':'django.db.backends.postgresql','HOST':'127.0.0.1','PORT':55494,'USER':'postgres','NAME':'postgres'} for alias in ['default','enrolment']})
        from django.apps import apps
        apps.populate([])
        from django.db import connections
        from learner_api.free_course_identity import assign_identity
        assign, db = assign_identity, connections['enrolment']
        with psycopg.connect(**config, autocommit=True) as listener:
            listener.execute('LISTEN lms_monthly_actuals_changed')
            result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(IdentityTests))
        connections.close_all()
        (parent / 'writer-tests.json').write_text(json.dumps(dict(run=result.testsRun,failed=len(result.failures),errors=len(result.errors),skipped=len(result.skipped)), indent=2))
        return result.wasSuccessful()
    finally:
        subprocess.run([pgctl, '-D', str(data), '-m', 'fast', '-w', 'stop'], check=True, capture_output=True)


if __name__ == '__main__':
    raise SystemExit(not main())
