"""Explicit Development-only PostgreSQL rehearsal; always ROLLBACK, never record.

Executes only the five reviewed schema functions (not a migration executor),
then verifies their effects and the six frozen validators. The optional recorder
test writes only a private temporary table. No application HTTP, external
services, persistent history writes, implicit transaction context, or commit
path. Run only with authorization for transactional Development writes.
"""
import argparse
import importlib
import json
import logging.config
import os
from pathlib import Path
import sys
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ['DJANGO_SETTINGS_MODULE'] = 'config.settings_sqlite_test'
os.environ['CURRICULUM_WARM'] = '0'

PLAN_FILE = Path(__file__).resolve().parents[1] / 'curriculum_api/migrations/migration_reconciliation.md'
SCHEMA_OPERATIONS = {
    ('learner_api', '0025_legacy_quiz_retake_grants'): 'install',
    ('curriculum_api', '0072_module_scoped_live_attendance'): 'scope_register',
    ('curriculum_api', '0073_live_register_session_date'): 'add_session_date',
    ('curriculum_api', '0079_course_pricing'): 'apply_schema',
    ('learner_api', '0030_canonical_free_course_attempts'): 'install',
}


def plan():
    rows = []
    for line in PLAN_FILE.read_text(encoding='utf-8').splitlines():
        cells = [part.strip() for part in line.split('|')[1:-1]]
        if len(cells) == 4 and cells[0].isdigit():
            rows.append((int(cells[0]), cells[1], cells[2], cells[3]))
    assert len(rows) == 26 and [r[0] for r in rows] == list(range(1, 27))
    assert {(a, n) for _, a, n, mode in rows if mode == 'E'} == set(SCHEMA_OPERATIONS)
    return rows


def fingerprint(c, table, exclude=()):
    return c.execute('SELECT count(*),md5(string_agg(md5((to_jsonb(t)-%s::text[])::text),\'\' '
                     'ORDER BY (to_jsonb(t)-%s::text[])::text)) FROM ' + table + ' t',
                     [list(exclude), list(exclude)]).fetchone()


def schema_snapshot(c):
    tables = ['"Learner".legacy_quiz_retake_grants', '"Learner".subject_activity_attempts',
              'curriculum.live_session_learner_attendance', 'curriculum.modules',
              'curriculum.free_courses', 'curriculum.free_course_weeks', 'curriculum.free_programme_components']
    result = []
    for table in tables:
        result.append(c.execute('''SELECT a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,
            a.attgenerated,a.attidentity,pg_get_expr(d.adbin,d.adrelid)
            FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
            WHERE a.attrelid=to_regclass(%s) AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attname''', [table]).fetchall())
        result.append(c.execute('''SELECT conname,pg_get_constraintdef(oid),convalidated FROM pg_constraint
            WHERE conrelid=to_regclass(%s) ORDER BY conname''', [table]).fetchall())
        result.append(c.execute('''SELECT pg_get_indexdef(indexrelid),indisvalid FROM pg_index
            WHERE indrelid=to_regclass(%s) ORDER BY 1''', [table]).fetchall())
    result.append(c.execute('''SELECT p.proname,pg_get_functiondef(p.oid) FROM pg_proc p
        JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='curriculum'
        AND p.proname IN ('capture_bunny_video_change','qr_attendance_delete_cleanup',
            'live_register_set_session_date','live_register_refresh_session_dates') ORDER BY 1''').fetchall())
    result.append(c.execute('''SELECT t.tgrelid::regclass::text,t.tgname,pg_get_triggerdef(t.oid),t.tgenabled
        FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgrelid IN
        ('curriculum.live_session_learner_attendance'::regclass,'curriculum.live_session_occurrences'::regclass)
        ORDER BY 1,2''').fetchall())
    return result


def expect_constraint(c, sql, params, name):
    import psycopg
    c.execute('SAVEPOINT constraint_probe')
    try:
        try:
            c.execute(sql, params)
        except psycopg.errors.CheckViolation as error:
            assert error.diag.constraint_name == name, 'Unexpected constraint rejected probe'
        else:
            raise AssertionError('Invalid value accepted: ' + name)
    finally:
        c.execute('ROLLBACK TO SAVEPOINT constraint_probe')
        c.execute('RELEASE SAVEPOINT constraint_probe')


def assert_operation(c, key):
    name = key[1]
    if name == '0025_legacy_quiz_retake_grants':
        assert c.execute('SELECT count(*) FROM "Learner".legacy_quiz_retake_grants').fetchone()[0] == 0
        constraints = c.execute('''SELECT contype,convalidated FROM pg_constraint
            WHERE conrelid='"Learner".legacy_quiz_retake_grants'::regclass AND contype<>'n' ''').fetchall()
        assert sorted(kind for kind, _ in constraints) == ['c', 'f', 'f', 'p', 'u']
        assert all(valid for _, valid in constraints)
    elif name == '0072_module_scoped_live_attendance':
        assert c.execute('''SELECT pg_get_constraintdef(oid),convalidated FROM pg_constraint
            WHERE conrelid='curriculum.live_session_learner_attendance'::regclass
            AND conname='curriculum_live_learner_attendance_uniq' ''').fetchone() == (
                'UNIQUE (occurrence_id, learner_profile_id, module_catalogue_id)', True)
    elif name == '0073_live_register_session_date':
        from django.conf import settings
        assert settings.TIME_ZONE == 'Europe/London'
        assert c.execute('''SELECT count(*) FROM curriculum.live_session_learner_attendance r
            JOIN curriculum.live_session_occurrences o ON o.id=r.occurrence_id
            WHERE r.session_date IS DISTINCT FROM
            ((o.scheduled_start AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/London')::date''').fetchone()[0] == 0
        c.execute('SAVEPOINT date_probe')
        try:
            # Only session_date changes; the existing audit trigger compares
            # attendance identity/status, not session_date. No sequence is used.
            result = c.execute('''UPDATE curriculum.live_session_learner_attendance SET session_date='1900-01-01'
                WHERE id=(SELECT id FROM curriculum.live_session_learner_attendance ORDER BY id LIMIT 1)
                RETURNING session_date''').fetchone()
            assert result and str(result[0]) != '1900-01-01', 'Date trigger did not restore scheduled date'
        finally:
            c.execute('ROLLBACK TO SAVEPOINT date_probe')
            c.execute('RELEASE SAVEPOINT date_probe')
        assert c.execute('''SELECT count(*) FROM pg_trigger WHERE tgname IN
            ('live_register_set_session_date','live_register_refresh_session_dates') AND tgenabled='O' ''').fetchone()[0] == 2
    elif name == '0079_course_pricing':
        assert c.execute("SELECT count(*) FROM curriculum.modules WHERE is_for_sale OR price IS NOT NULL OR currency<>'GBP'").fetchone()[0] == 0
        expect_constraint(c, '''UPDATE curriculum.modules SET is_for_sale=true,price=0
            WHERE module_catalogue_id=(SELECT module_catalogue_id FROM curriculum.modules ORDER BY 1 LIMIT 1)''',
            (), 'curriculum_modules_sale_price_check')
    elif name == '0030_canonical_free_course_attempts':
        from psycopg.types.json import Jsonb
        columns = dict(c.execute('''SELECT column_name,is_nullable FROM information_schema.columns
            WHERE table_schema='Learner' AND table_name='subject_activity_attempts' ''').fetchall())
        assert all(columns[n] == 'YES' for n in ('enrolment_id','aptem_id','group_id','activity_id'))
        assert c.execute('''SELECT indisvalid FROM pg_index
            WHERE indexrelid=to_regclass('"Learner".subject_attempt_free_learner_component_idx')''').fetchone() == (True,)
        assert not c.execute('''SELECT attname FROM pg_attribute
            WHERE attrelid='"Learner".subject_activity_attempts'::regclass AND attgenerated<>'' ''').fetchall()
        component = c.execute('SELECT id FROM curriculum.free_programme_components ORDER BY id LIMIT 1').fetchone()[0]
        fixture = {'id': str(uuid4()), 'source_activity_fk': None, 'enrolment_id': None,
                   'aptem_id': None, 'group_id': None, 'activity_id': None,
                   'free_component_ref': component, 'source_activity_snapshot': {'rollback_probe': True}}
        insert = '''INSERT INTO "Learner".subject_activity_attempts
            SELECT (jsonb_populate_record(NULL::"Learner".subject_activity_attempts,
                to_jsonb(a)||%s::jsonb)).* FROM "Learner".subject_activity_attempts a
            WHERE source_activity_fk IS NOT NULL ORDER BY id LIMIT 1'''
        c.execute('SAVEPOINT canonical_probe')
        try:
            assert c.execute(insert, [Jsonb(fixture)]).rowcount == 1
            # NULL legacy identity produces no owners for monthly invalidation;
            # UUID is explicit and no existing sequence is advanced.
        finally:
            c.execute('ROLLBACK TO SAVEPOINT canonical_probe')
            c.execute('RELEASE SAVEPOINT canonical_probe')
        fixture.pop('source_activity_fk')
        fixture['free_component_ref'] = None
        fixture['source_activity_snapshot'] = None
        expect_constraint(c, insert, [Jsonb(fixture)], 'subject_attempt_legacy_identity_required')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rollback-development', action='store_true', required=True)
    parser.add_argument('--operation', choices=[name for _, name in SCHEMA_OPERATIONS],
                        help='Rehearse one schema operation in its own rollback transaction')
    parser.add_argument('--recorder-only', action='store_true',
                        help='Exercise real Django bookkeeping in a temporary history table only')
    args = parser.parse_args()
    if args.recorder_only and args.operation:
        parser.error('--recorder-only and --operation are mutually exclusive')
    from django.db.backends.base.base import BaseDatabaseWrapper
    with patch.object(BaseDatabaseWrapper, 'ensure_connection', side_effect=AssertionError('Django connections forbidden')), \
         patch.object(logging.config, 'dictConfig'):
        import django
        django.setup()
        if args.recorder_only:
            rehearse_recorder()
        else:
            run(args.operation)


def rehearse_recorder():
    from django.db import connections
    from django.db.backends.postgresql.base import DatabaseWrapper
    from django.db.backends.postgresql.psycopg_any import register_tzloader
    from django.db.migrations.executor import MigrationExecutor
    from django.test import override_settings
    from verify_inclusion_canonical_targets import connect_development

    raw = connect_development()
    original = connections['default']
    try:
        baseline = fingerprint(raw, 'public.django_migrations')
        raw.rollback()
        raw.read_only = False
        assert not raw.autocommit
        raw.execute("SET LOCAL lock_timeout='3s'")
        raw.execute("SET LOCAL statement_timeout='30s'")
        assert raw.execute("SELECT current_database(),current_setting('neon.branch_id',true)").fetchone() == (
            'neondb', 'br-raspy-sky-abvs8lq9')
        raw.execute('''CREATE TEMP TABLE django_migrations (
            id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
            app varchar(255) NOT NULL,name varchar(255) NOT NULL,applied timestamptz NOT NULL) ON COMMIT DROP''')
        raw.execute('''INSERT INTO pg_temp.django_migrations(app,name,applied)
            SELECT app,name,applied FROM public.django_migrations''')
        # Prove all unqualified recorder queries resolve to our private TEMP
        # relation. Its identity sequence is new and temporary, not the live one.
        assert raw.execute("SELECT relpersistence FROM pg_class WHERE oid='django_migrations'::regclass").fetchone() == ('t',)
        config = dict(original.settings_dict, ENGINE='django.db.backends.postgresql',
                      NAME=raw.info.dbname, HOST=raw.info.host, USER=raw.info.user,
                      PORT=raw.info.port, OPTIONS={}, TIME_ZONE=None)
        db = DatabaseWrapper(config, alias='default')
        db.connection = raw
        db.autocommit = False
        db.in_atomic_block = True
        register_tzloader(db.timezone, raw)

        def verified_connection():
            assert db.connection is raw and not raw.closed and not raw.autocommit

        db.ensure_connection = verified_connection
        connections['default'] = db
        initial = set(raw.execute('SELECT app,name FROM pg_temp.django_migrations').fetchall())
        expected = set(initial)
        with override_settings(MIGRATION_MODULES={}):
            for _, app, name, _ in plan():
                executor = MigrationExecutor(db)
                planned = executor.migration_plan([(app, name)])
                assert [(m.app_label, m.name, reverse) for m, reverse in planned] == [(app, name, False)]
                executor.record_migration(app, name)
                expected.add((app, name))
                expected.update(executor.loader.disk_migrations[(app, name)].replaces)
            executor = MigrationExecutor(db)
            executor.check_replacements()
            assert executor.migration_plan([('learner_api', '0030_canonical_free_course_attempts')]) == []
            executor.loader.check_consistent_history(db)
            assert not executor.loader.detect_conflicts()
        actual = set(raw.execute('SELECT app,name FROM pg_temp.django_migrations').fetchall())
        assert actual == expected and len(actual - initial) == 32
        assert fingerprint(raw, 'public.django_migrations') == baseline
        print('PASS: PostgreSQL temporary recorder; 26 singleton plans, 32 exact names, final 0030 plan empty', flush=True)
    finally:
        try:
            raw.rollback()
        finally:
            raw.close()
            connections['default'] = original
    fresh = connect_development()
    try:
        assert fingerprint(fresh, 'public.django_migrations') == baseline
        print('PASS: post-ROLLBACK public migration history fingerprint unchanged', flush=True)
    finally:
        fresh.rollback()
        fresh.close()


def run(only_operation=None):
    from django.db import connections
    from curriculum_api.test_migration_reconciliation_no_db import modules, load, TARGET
    from verify_inclusion_canonical_targets import connect_development
    from verify_free_course_my_learning import verify

    rows = plan()
    results = []
    raw = connect_development()
    old_enrolment = connections['enrolment']
    try:
        before = verify(raw)
        before_schema = schema_snapshot(raw)
        before_history = fingerprint(raw, 'django_migrations')
        before_register = fingerprint(raw, 'curriculum.live_session_learner_attendance')
        before_modules = fingerprint(raw, 'curriculum.modules')
        applied = raw.execute('SELECT app,name FROM django_migrations').fetchall()
        loader = load(applied)
        pending = [key for key in loader.graph.forwards_plan(TARGET) if key not in loader.applied_migrations]
        assert pending == [(a, n) for _, a, n, _ in rows], 'Execution plan changed'
        assert before['historical_records'] == 790 and before['accepted_seconds'] == 205737
        # Inspect before first write: none of the DDL can invoke event hooks.
        assert not raw.execute("SELECT evtname FROM pg_event_trigger WHERE evtenabled<>'D'").fetchall()
        assert raw.execute('SELECT to_regclass(\'"Learner".legacy_quiz_retake_grants\')').fetchone() == (None,)
        print('PASS: Development identity, exact 26-step ancestry and preservation baseline', flush=True)
        raw.rollback()
        raw.read_only = False  # Explicit user authorization for this rollback-only transaction.
        assert not raw.autocommit
        raw.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
        raw.execute("SET LOCAL lock_timeout='3s'")
        raw.execute("SET LOCAL statement_timeout='30s'")
        raw.execute("SET LOCAL idle_in_transaction_session_timeout='60s'")
        assert raw.execute("SELECT current_database(),current_setting('neon.branch_id',true),current_setting('transaction_read_only')").fetchone() == ('neondb','br-raspy-sky-abvs8lq9','off')

        class Adapter:
            vendor = 'postgresql'
            alias = 'default'
            settings_dict = dict(ENGINE='django.db.backends.postgresql', NAME=raw.info.dbname,
                                 HOST=raw.info.host, USER=raw.info.user, PORT=raw.info.port)
            ops = SimpleNamespace(quote_name=lambda name: '"' + name.replace('"','""') + '"')
            def cursor(self):
                return raw.cursor()

        adapter = Adapter()
        connections['enrolment'] = adapter

        def execute(sql, params=None):
            # The reviewed functions contain no transaction control or history
            # writes. Fail closed if their schema-editor SQL changes to add it.
            import re
            assert not re.search(r'(^|;)\s*(COMMIT|END\s+TRANSACTION|ROLLBACK|BEGIN\s+TRANSACTION)\b', sql, re.I)
            assert 'django_migrations' not in sql.lower()
            return raw.execute(sql, params)

        editor = SimpleNamespace(connection=adapter, execute=execute)
        for step, app, name, mode in rows:
            if mode not in ('E', 'V'):
                continue
            if mode == 'E' and only_operation and name != only_operation:
                continue
            raw.execute('SAVEPOINT operation_probe')
            phase = 'schema/validation'
            try:
                module = importlib.import_module(app + '.migrations.' + name)
                if mode == 'E':
                    getattr(module, SCHEMA_OPERATIONS[(app, name)])(None, editor)
                    phase = 'constraint/trigger probe'
                    assert_operation(raw, (app, name))
                else:
                    module.validate(None, editor)
                results.append((step, app, name, 'PASS'))
                print('PASS:', app, name, flush=True)
            except Exception as error:
                raw.execute('ROLLBACK TO SAVEPOINT operation_probe')
                results.append((step, app, name, 'BLOCKED'))
                print('BLOCKED:', app, name, type(error).__name__,
                      getattr(error, 'sqlstate', None), phase, flush=True)
                # Do not expose SQL detail/learner values in diagnostics.
            finally:
                raw.execute('RELEASE SAVEPOINT operation_probe')
        assert fingerprint(raw, 'django_migrations') == before_history
        assert fingerprint(raw, 'curriculum.live_session_learner_attendance', ['session_date']) == before_register
        assert fingerprint(raw, 'curriculum.modules', ['is_for_sale','price','currency']) == before_modules
        for module in modules():
            module.validate(None, editor)
        during = verify(raw)
        assert during['preservation_fingerprints'] == before['preservation_fingerprints']
        assert during['historical_records'] == 790 and during['accepted_seconds'] == 205737
    finally:
        # Never use a connection/transaction context manager here: successful
        # context exit would commit. Every path explicitly rolls back and closes.
        try:
            raw.rollback()
        finally:
            raw.close()
            connections['enrolment'] = old_enrolment

    fresh = connect_development()
    try:
        assert schema_snapshot(fresh) == before_schema, 'Schema did not return to baseline'
        assert fingerprint(fresh, 'django_migrations') == before_history, 'Migration history changed'
        assert fingerprint(fresh, 'curriculum.live_session_learner_attendance') == before_register
        assert fingerprint(fresh, 'curriculum.modules') == before_modules
        after = verify(fresh)
        assert after == before, 'Data changed; investigate concurrent writers before proceeding'
        print('PASS: independent post-ROLLBACK schema/history/data verification', flush=True)
        print(json.dumps({'operations': results, 'rollback_verified': True,
                          'mappings': after['historical_records'], 'accepted_seconds': after['accepted_seconds'],
                          'assignments': after['assignments'], 'attempts': after['preservation_fingerprints']['subject_activity_attempts'][0]}, sort_keys=True))
    finally:
        fresh.rollback()
        fresh.close()
    if any(result[3] != 'PASS' for result in results):
        raise SystemExit(1)


if __name__ == '__main__':
    main()
