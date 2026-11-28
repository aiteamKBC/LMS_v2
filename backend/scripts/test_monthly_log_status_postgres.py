"""Run Monthly Log status regressions in a fresh loopback-only PostgreSQL."""
import os
import socket
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import psycopg

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
SUITES = [
    'learner_api.test_monthly_log_status_postgres.MonthlyLogStatusPostgresTests',
    'learner_api.tests_monthly_logs',
    'learner_api.tests_manual_time_corrections.ManualTimeCorrectionTests.test_canonical_partial_and_locked_statuses_reject_without_changes',
    'learner_api.tests_manual_time_corrections.ManualTimeCorrectionTests.test_signed_finalized_and_audit_signed_months_reject_without_changes',
    'learner_api.tests_manual_time_corrections.ManualTimeCorrectionTests.test_corrects_same_manual_row_and_keeps_timer_evidence_and_other_learner',
    'learner_api.tests_manual_time_corrections.ManualTimeCorrectionTests.test_correction_recalculates_learner_month_and_coach_totals_without_changing_plan_or_timer',
    'coach_api.tests_monthly_logs',
    'curriculum_api.tests_learner_activity_status',
    'curriculum_api.tests_module_attendance_register',
    'learner_api.tests_attendance_otjh',
    'learner_api.tests_signed_activity_time_months',
    'learner_api.tests_monthly_log_attendance',
    'scripts.test_repair_assignment_submitted_hours',
    'learner_api.test_activity_hours_repair_write',
]


def main():
    configured = os.environ.get('LMS_TEST_PG_BIN', '').strip()
    binaries = Path(configured) if configured else Path(tempfile.gettempdir()) / 'lms-ksb-pg16/portable-tar/pgsql/bin'
    for name in ('initdb.exe', 'pg_ctl.exe'):
        if not (binaries / name).is_file():
            raise RuntimeError(f'Local PostgreSQL binary is unavailable: {binaries / name}')
    root = Path(tempfile.mkdtemp(prefix='lms_month_status_')).resolve()
    directory = root / 'data'
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0)); port = listener.getsockname()[1]
    def control(*args):
        with (root / 'control.log').open('a') as log:
            return subprocess.run([str(binaries / 'pg_ctl.exe'), '-D', str(directory), *args],
                check=False, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, timeout=30).returncode
    started = False
    try:
        subprocess.run([str(binaries / 'initdb.exe'), '-D', str(directory), '-U', 'postgres',
                        '--auth=trust', '--encoding=UTF8', '--no-locale'], check=True,
                       capture_output=True, timeout=45)
        started = True
        if control('-l', str(root / 'postgres.log'), '-o', f'-h 127.0.0.1 -p {port}', '-w', '-t', '20', 'start'):
            raise RuntimeError('Isolated PostgreSQL startup failed.')
        dsn = f'postgresql://postgres@127.0.0.1:{port}/postgres'
        with psycopg.connect(dsn) as db:
            host, actual_port, data, branch = db.execute(
                "SELECT host(inet_server_addr()),inet_server_port(),current_setting('data_directory'),"
                "current_setting('neon.branch_id',true)"
            ).fetchone()
            if host != '127.0.0.1' or actual_port != port or branch or Path(data).resolve() != directory:
                raise RuntimeError('PostgreSQL isolation proof failed.')
        os.environ['LMS_ISOLATED_PG_DSN'] = dsn
        os.environ['DJANGO_SETTINGS_MODULE'] = 'config.settings_sqlite_test'
        os.environ['AZURE_MAIL_ENABLED'] = 'false'
        import django
        django.setup()
        from django.conf import settings
        config = {'ENGINE': 'django.db.backends.postgresql', 'NAME': 'postgres', 'USER': 'postgres',
                  'PASSWORD': '', 'HOST': '127.0.0.1', 'PORT': str(port), 'CONN_MAX_AGE': 0}
        aliases = set(settings.DATABASES) | {'default', 'enrolment'}
        settings.DATABASES = {alias: dict(config) for alias in aliases}
        if any(value['HOST'] != '127.0.0.1' or str(value['PORT']) != str(port)
               for value in settings.DATABASES.values()):
            raise RuntimeError('A Django database alias escaped the isolated cluster.')
        print('ISOLATION aliases=', ','.join(sorted(settings.DATABASES)), 'host=127.0.0.1', 'port=', port)
        suite = unittest.defaultTestLoader.loadTestsFromNames(SUITES)
        result = unittest.TextTestRunner(verbosity=2).run(suite)
        print(f'COUNTS run={result.testsRun} failures={len(result.failures)} errors={len(result.errors)} skipped={len(result.skipped)}')
        return int(not result.wasSuccessful())
    finally:
        os.environ.pop('LMS_ISOLATED_PG_DSN', None)
        if started and control('-m', 'fast', '-w', '-t', '20', 'stop'):
            raise RuntimeError(f'Could not stop disposable cluster: {root}')
        print('Stopped isolated test artifacts:', root)


if __name__ == '__main__':
    raise SystemExit(main())
