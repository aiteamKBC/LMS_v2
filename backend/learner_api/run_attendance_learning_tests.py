"""Run the attendance/completion regressions without an application database.

From backend: ./.venv/Scripts/python.exe -m learner_api.run_attendance_learning_tests
Uses existing isolated settings, SQLite in memory and mocked external services.
No migrations, application .env reads, live Teams calls or database provisioning.
"""
import os
from pathlib import Path
import socket
import sys
import unittest
from unittest.mock import patch


SUITES = (
    'learner_api.tests_attendance_lectures',
    'learner_api.tests_live_session_progress',
    'learner_api.tests_recorded_session_progress',
    'learner_api.tests_attendance_completion',
    'learner_api.tests_module_progress',
    'learner_api.tests_dashboard_metrics',
    'learner_api.tests.TeamsAttendanceEligibilityTests',
    'learner_api.tests.TeamsAttendanceSyncTests',
    'coach_api.tests_weekly_learning',
    'learner_api.tests_attendance_learning',
    'learner_api.tests_monthly_log_attendance',
    'learner_api.tests_monthly_logs',
    'learner_api.tests_current_actual_hours',
    'learner_api.test_dashboard_overview_no_db',
    'learner_api.test_dashboard_monthly_no_db',
    'learner_api.test_dashboard_monthly_v2_no_db',
    'learner_api.tests_attendance_otjh',
    'learner_api.tests_canonical_hours',
    'learner_api.test_canonical_learning_no_db',
    'learner_api.test_canonical_metrics_bulk_no_db',
    'learner_api.test_hour_projection_no_db',
    'learner_api.tests_weekly_hours',
    'coach_api.tests_monthly_logs',
    'curriculum_api.directory.tests.tests_learner_activity_status',
    'curriculum_api.meetings.tests.tests_module_attendance_register',
    'curriculum_api.directory.tests.test_module_progress_metrics',
    'curriculum_api.tests.TeamsMultiDayRecurrenceTests',
    'curriculum_api.tests.TeamsAttendanceRosterTests',
    'coach_api.tests_errors',
)


def main():
    os.environ.update(DJANGO_SETTINGS_MODULE='config.settings_coaching_recordings_test',
        DJANGO_USE_SQLITE='true', RUN_APP_ON_TEST_BRANCH='false',
        USE_SECURITY_TEST_BRANCH='false', CURRICULUM_WARM='0')
    sys.argv = ['manage.py', 'test']
    original_read = Path.read_text
    original_connect = socket.socket.connect

    def without_dotenv(path, *args, **kwargs):
        return '' if path.name.startswith('.env') else original_read(path, *args, **kwargs)

    def local_only(sock, address):
        # Windows asyncio uses loopback sockets for its internal socket pair.
        if isinstance(address, tuple) and address[0] in ('127.0.0.1', '::1'):
            return original_connect(sock, address)
        raise AssertionError('External network is disabled in attendance regressions.')

    def blocked(*args, **kwargs):
        raise AssertionError('External network is disabled in attendance regressions.')

    with patch.object(Path, 'read_text', without_dotenv), \
         patch.object(socket.socket, 'connect', local_only), \
         patch.object(socket.socket, 'connect_ex', blocked):
        import django
        from django.conf import settings
        if any(db['ENGINE'] != 'django.db.backends.sqlite3' for db in settings.DATABASES.values()):
            raise RuntimeError('Attendance regressions require isolated SQLite aliases.')
        for db in settings.DATABASES.values():
            db['NAME'] = ':memory:'
        django.setup()
        suite = unittest.defaultTestLoader.loadTestsFromNames(SUITES)

        def cases(group):
            for case in group:
                if isinstance(case, unittest.TestSuite):
                    yield from cases(case)
                else:
                    yield case

        if any(getattr(case, 'databases', set()) for case in cases(suite)):
            raise RuntimeError('This runner only accepts tests without database access.')
        print('Verified SQLite :memory: for all aliases; application .env and external network disabled.', flush=True)
        result = unittest.TextTestRunner(verbosity=1).run(suite)
        return 0 if result.wasSuccessful() else 1


if __name__ == '__main__':
    sys.exit(main())
