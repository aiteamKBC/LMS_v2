"""Execute the approved Development reconciliation, one verified transaction at a time.

Explicit --execute-development opt-in. No server, scheduler, fixture, snapshot,
legacy storage cutover, or post_migrate provisioning. Stop on the first error.
"""
import argparse
import hashlib
import importlib
import io
import json
import logging.config
import os
from pathlib import Path
import re
import subprocess
import sys
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
HOST = 'ep-odd-grass-ab4t9q2o-pooler.eu-west-2.aws.neon.tech'
BRANCH = 'br-raspy-sky-abvs8lq9'
REPORT = ROOT / 'specs/free-course-state-alignment/execution-2026-11-23-persistent.json'
VALIDATORS = (
    '0092_reconcile_development_video_capture', '0093_baseline_independent_free_course_storage',
    '0094_baseline_completed_free_course_cutover', '0095_baseline_attendance_provenance',
    '0096_preserve_qr_delete_restrict', '0097_baseline_free_course_metadata',
)


def query(connection, sql, params=None):
    with connection.cursor() as cursor:
        cursor.execute(sql, params)
        return cursor.fetchall()


def history(connection):
    return query(connection, 'SELECT app,name,applied::text FROM public.django_migrations ORDER BY app,name')


def blockers(connection):
    # Active AccessShareLock readers are deliberately NOT a preflight blocker.
    idle = query(connection, """SELECT pid,state,
        round(extract(epoch FROM clock_timestamp()-state_change))::bigint
        FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()
        AND state LIKE 'idle in transaction%%'
        AND clock_timestamp()-state_change > interval '30 seconds'""")
    ddl = query(connection, """SELECT l.pid,l.relation::regclass::text,l.mode,l.granted
        FROM pg_locks l JOIN pg_class t ON t.oid=l.relation JOIN pg_namespace n ON n.oid=t.relnamespace
        WHERE l.database=(SELECT oid FROM pg_database WHERE datname=current_database())
        AND l.pid<>pg_backend_pid() AND n.nspname IN ('Learner','curriculum','public')
        AND l.mode IN ('AccessExclusiveLock','ShareRowExclusiveLock')""")
    if idle or ddl:
        raise RuntimeError('Unsafe concurrency: ' + repr({'long_idle': idle, 'ddl_locks': ddl}))


def schema_hash(connection):
    values = []
    for sql in (
        """SELECT n.nspname,c.relname,a.attname,format_type(a.atttypid,a.atttypmod),
        a.attnotnull,a.attgenerated,a.attidentity,pg_get_expr(d.adbin,d.adrelid)
        FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
        WHERE n.nspname IN ('Learner','curriculum','public') AND a.attnum>0 AND NOT a.attisdropped ORDER BY 1,2,3""",
        """SELECT conrelid::regclass::text,conname,pg_get_constraintdef(oid),convalidated
        FROM pg_constraint WHERE connamespace IN ('"Learner"'::regnamespace,'curriculum'::regnamespace,'public'::regnamespace)
        ORDER BY 1,2""",
    ):
        values.append(query(connection, sql))
    return hashlib.sha256(repr(values).encode()).hexdigest()


def validate_all(connection):
    adapter = SimpleNamespace(vendor='postgresql', alias='default', cursor=connection.cursor)
    for name in VALIDATORS:
        importlib.import_module('curriculum_api.migrations.' + name).validate(None, SimpleNamespace(connection=adapter))


def postcondition(connection, name):
    if name == '0025_legacy_quiz_retake_grants':
        assert query(connection, 'SELECT count(*) FROM "Learner".legacy_quiz_retake_grants') == [(0,)]
        keys = query(connection, """SELECT contype,convalidated FROM pg_constraint
            WHERE conrelid='"Learner".legacy_quiz_retake_grants'::regclass AND contype<>'n'""")
        assert sorted(k for k, _ in keys) == ['c', 'f', 'f', 'p', 'u'] and all(v for _, v in keys)
    elif name == '0072_module_scoped_live_attendance':
        assert query(connection, """SELECT pg_get_constraintdef(oid),convalidated FROM pg_constraint
            WHERE conrelid='curriculum.live_session_learner_attendance'::regclass
            AND conname='curriculum_live_learner_attendance_uniq'""") == [(
                'UNIQUE (occurrence_id, learner_profile_id, module_catalogue_id)', True)]
    elif name == '0073_live_register_session_date':
        assert query(connection, """SELECT count(*) FROM curriculum.live_session_learner_attendance r
            JOIN curriculum.live_session_occurrences o ON o.id=r.occurrence_id WHERE r.session_date IS DISTINCT FROM
            ((o.scheduled_start AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/London')::date""") == [(0,)]
        assert query(connection, """SELECT count(*) FROM pg_trigger WHERE tgname IN
            ('live_register_set_session_date','live_register_refresh_session_dates') AND tgenabled='O'""") == [(2,)]
    elif name == '0079_course_pricing':
        assert query(connection, "SELECT count(*) FROM curriculum.modules WHERE is_for_sale OR price IS NOT NULL OR currency<>'GBP'") == [(0,)]
    elif name == '0030_canonical_free_course_attempts':
        assert query(connection, """SELECT count(*) FROM information_schema.columns WHERE table_schema='Learner'
            AND table_name='subject_activity_attempts' AND column_name IN ('enrolment_id','aptem_id','group_id','activity_id')
            AND is_nullable='YES'""") == [(4,)]
        assert query(connection, """SELECT convalidated FROM pg_constraint
            WHERE conrelid='"Learner".subject_activity_attempts'::regclass
            AND conname='subject_attempt_legacy_identity_required'""") == [(True,)]
        assert query(connection, """SELECT indisvalid,indisready FROM pg_index
            WHERE indexrelid=to_regclass('"Learner".subject_attempt_free_learner_component_idx')""") == [(True, True)]


def enforce_timeouts(execute, sql, params, many, context):
    # 0030 contains its historical 5s lock setting. Honor the newly authorized
    # 15s execution policy without modifying that migration's source/schema SQL.
    if re.fullmatch(r"\s*SET\s+LOCAL\s+lock_timeout\s*=\s*'\d+s'\s*;?\s*", sql, re.I):
        sql = "SET LOCAL lock_timeout='15s'"
    return execute(sql, params, many, context)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--execute-development', action='store_true', required=True)
    parser.parse_args()
    assert subprocess.check_output(['git', 'branch', '--show-current'], cwd=ROOT, text=True).strip() == 'dev'
    assert not REPORT.exists(), 'Existing execution report: inspect recorded completion before any retry'
    sys.path[:0] = [str(ROOT / 'backend'), str(ROOT / 'backend/scripts')]
    os.environ.update(DJANGO_SETTINGS_MODULE='config.settings', DJANGO_USE_SQLITE='false', DB_POOL='false',
                      CURRICULUM_WARM='0', MONTHLY_ACTUAL_CACHE_SCHEDULE='false',
                      COACH_DASHBOARD_SNAPSHOT_SCHEDULE='false', SESSION_RESULTS_AUTOMATIC='false')
    from django.db.backends.base.base import BaseDatabaseWrapper
    with patch.object(BaseDatabaseWrapper, 'ensure_connection', side_effect=RuntimeError('Startup DB access forbidden')), \
         patch.object(logging.config, 'dictConfig'):
        import django
        django.setup()
    original = BaseDatabaseWrapper.connect

    def guarded_ensure(db):
        config = db.settings_dict
        if db.alias not in ('default', 'enrolment') or db.vendor != 'postgresql' or config.get('HOST') != HOST or config.get('NAME') != 'neondb':
            raise RuntimeError('Unapproved database connection blocked')
        original(db)
        if not getattr(db, '_verified_development', False):
            with db.connection.cursor() as cursor:
                cursor.execute("SELECT current_database(),current_setting('neon.branch_id',true)")
                assert cursor.fetchone() == ('neondb', BRANCH)
            db._verified_development = True

    with patch.object(BaseDatabaseWrapper, 'connect', guarded_ensure):
        execute_plan()


def execute_plan():
    from django.db import connections, transaction
    from django.core.management import call_command
    from django.db.migrations.executor import MigrationExecutor
    from verify_inclusion_canonical_targets import connect_development
    from verify_free_course_my_learning import verify

    rows = []
    for line in (ROOT / 'backend/curriculum_api/migrations/reconciliation_preexecution_2026-11-23.md').read_text(encoding='utf-8').splitlines():
        cells = [s.strip() for s in line.split('|')[1:-1]]
        if len(cells) == 6 and cells[0].isdigit():
            rows.append((int(cells[0]), cells[1], cells[2].strip('`'), cells[3]))
    assert len(rows) == 26
    paths = [ROOT / 'backend' / app / 'migrations' / (name + '.py') for _, app, name, _ in rows]
    paths += [ROOT / 'backend/curriculum_api/course_pricing_schema.py']
    hashes = {p: hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
    report = {'branch': BRANCH, 'status': 'preflight', 'completed': [], 'lock_timeout': '15s',
              'statement_timeout': '120s', 'long_idle_threshold': '30s',
              'executor': 'Django migrate --plan followed by MigrationExecutor; no unrelated post_migrate provisioning'}

    def save():
        REPORT.write_text(json.dumps(report, indent=2, default=str), encoding='utf-8')

    try:
        connection = connect_development()
        try:
            blockers(connection)
            validate_all(connection)
            before, old_history = verify(connection), history(connection)
            assert before['historical_records'] == 790 and before['accepted_seconds'] == 205737
            assert query(connection, "SELECT to_regclass('\"Learner\".legacy_quiz_retake_grants'),to_regprocedure('curriculum.live_register_set_session_date()'),to_regprocedure('curriculum.live_register_refresh_session_dates()')") == [(None, None, None)]
            assert query(connection, "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='curriculum.live_session_learner_attendance'::regclass AND conname='curriculum_live_learner_attendance_uniq'") == [('UNIQUE (occurrence_id, learner_profile_id)',)]
            assert query(connection, "SELECT count(*) FROM information_schema.columns WHERE table_schema='curriculum' AND ((table_name='modules' AND column_name IN ('is_for_sale','price','currency')) OR (table_name='live_session_learner_attendance' AND column_name='session_date'))") == [(0,)]
            assert query(connection, "SELECT count(*) FROM information_schema.columns WHERE table_schema='Learner' AND table_name='subject_activity_attempts' AND column_name IN ('enrolment_id','aptem_id','group_id','activity_id') AND is_nullable='NO'") == [(4,)]
            report.update(before=before, history_before_count=len(old_history))
        finally:
            connection.rollback()
            connection.close()
        db = connections['default']
        executor = MigrationExecutor(db)
        executor.loader.check_consistent_history(db)
        targets = [(app, name) for _, app, name, _ in rows]
        assert [(m.app_label, m.name, reverse) for m, reverse in executor.migration_plan([targets[-1]])] == [(*key, False) for key in targets]
        assert not executor.loader.detect_conflicts()
        expected_history = {(a, n) for a, n, _ in old_history}
        report['status'] = 'executing'
        save()
        print('PREFLIGHT PASS: exact 26-step plan, baseline preserved, no long-idle/DDL blockers', flush=True)
        for step, app, name, mode in rows:
            assert all(hashlib.sha256(p.read_bytes()).hexdigest() == digest for p, digest in hashes.items()), 'Migration source changed'
            blockers(db)
            preview = io.StringIO()
            call_command('migrate', app, name, database='default', plan=True, interactive=False,
                         skip_checks=True, verbosity=1, stdout=preview, no_color=True)
            executor = MigrationExecutor(db)
            planned = executor.migration_plan([(app, name)])
            assert [(m.app_label, m.name, reverse) for m, reverse in planned] == [(app, name, False)], 'Unexpected migration plan'
            print('PLAN', step, mode, app + '.' + name, flush=True)
            prior_schema = schema_hash(db) if mode == 'R' else None
            with db.execute_wrapper(enforce_timeouts), transaction.atomic(using='default'):
                with db.cursor() as cursor:
                    cursor.execute("SET LOCAL lock_timeout='15s'")
                    cursor.execute("SET LOCAL statement_timeout='120s'")
                    cursor.execute("SELECT current_database(),current_setting('neon.branch_id',true)")
                    assert cursor.fetchone() == ('neondb', BRANCH)
                blockers(db)
                executor.migrate([(app, name)], plan=planned, fake=(mode == 'R'), fake_initial=False)
                added = {(app, name), *executor.loader.disk_migrations[(app, name)].replaces}
                expected_now = expected_history | added
                assert {(a, n) for a, n, _ in history(db)} == expected_now, 'Unexpected recorder changes'
                if mode == 'R':
                    assert schema_hash(db) == prior_schema, 'History-only operation changed schema'
                if mode == 'E':
                    postcondition(db, name)
                validate_all(db)
                assert query(db, "SELECT current_setting('lock_timeout'),current_setting('statement_timeout')") == [('15s', '2min')]
            expected_history = expected_now
            assert {(a, n) for a, n, _ in history(db)} == expected_history, 'Commit history mismatch'
            report['completed'].append({'step': step, 'app': app, 'name': name, 'mode': mode,
                                        'plan': preview.getvalue().strip(), 'added_history': sorted(added)})
            save()
            print('COMMITTED', step, app + '.' + name, flush=True)
        executor = MigrationExecutor(db)
        assert executor.migration_plan([targets[-1]]) == []
        executor.loader.check_consistent_history(db)
        connections.close_all()
        connection = connect_development()
        try:
            validate_all(connection)
            after, new_history = verify(connection), history(connection)
            assert after['preservation_fingerprints'] == before['preservation_fingerprints'], 'Protected data changed'
            assert after['historical_records'] == 790 and after['accepted_seconds'] == 205737
            assert after['canonical_attempt_write_migration_required'] is False
            assert len(new_history) == len(old_history) + 32
            assert {(a, n) for a, n, _ in new_history} == expected_history
            report.update(status='complete', after=after, history_after_count=len(new_history),
                          added_history=sorted(expected_history - {(a, n) for a, n, _ in old_history}))
            save()
            print('COMPLETE: 26 committed steps; 32 exact history additions; protected data fingerprints unchanged', flush=True)
        finally:
            connection.rollback()
            connection.close()
    except BaseException as error:
        report.update(status='stopped', error_type=type(error).__name__,
                      error=str(error) if isinstance(error, (AssertionError, RuntimeError)) else 'Database/command error; inspect diagnostics',
                      sqlstate=getattr(error, 'sqlstate', None))
        save()
        print('STOPPED', len(report['completed']), type(error).__name__, report['error'], flush=True)
        raise
    finally:
        connections.close_all()


if __name__ == '__main__':
    main()
