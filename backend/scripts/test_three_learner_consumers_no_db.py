"""Attendance/journal regressions with Django and external connections denied.

The existing 40 attendance/OTJH unit cases use their own private in-memory
SQLite fixtures. PostgreSQL integration is run separately by the sibling runner.
The database-backed coach review-transition suite is not a no-database suite
and does not consume any of the three tables audited here.
"""
import logging.config
import os
from pathlib import Path
import socket
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ['DJANGO_SETTINGS_MODULE'] = 'config.settings_sqlite_test'
os.environ['CURRICULUM_WARM'] = '0'

SUITES = [
    'learner_api.tests.TeamsAttendanceEligibilityTests',
    'learner_api.tests.TeamsAttendanceSyncTests',
    'learner_api.tests.LearnerAttendanceEndpointTests',
    'learner_api.tests_attendance_lectures',
    'learner_api.tests_attendance_otjh',
    'learner_api.tests_monthly_log_attendance',
    'learner_api.tests_monthly_logs',
    'learner_api.tests_otjh_totals',
    'learner_api.test_teams_attendance_alias_no_db',
    'learner_api.test_sync_teams_attendance_command_no_db',
    'learner_api.test_teams_attendance_module_roster_no_db',
    'learner_api.test_attendance_canonical_identity_no_db',
    'coach_api.tests.DashboardAttendanceTests',
    'coach_api.tests.AttendanceDetailRowsTests',
    'coach_api.tests.ApplyAttendanceSummaryTests',
    'coach_api.tests_attendance_detail',
    'coach_api.tests_attendance_projection',
    'curriculum_api.tests.TeamsAttendanceRosterTests',
    'old_otjh.tests',
]


def main():
    from django.db.backends.base.base import BaseDatabaseWrapper
    from django.test import override_settings
    with patch.object(BaseDatabaseWrapper, 'ensure_connection',
                      side_effect=AssertionError('Database forbidden')), \
         patch.object(logging.config, 'dictConfig'):
        import django
        django.setup()
        with override_settings(CACHES={'default': {
                'BACKEND': 'django.core.cache.backends.locmem.LocMemCache',
                'LOCATION': 'three-table-closure'}}), \
             patch.object(socket.socket, 'connect', side_effect=AssertionError('Network forbidden')):
            result = unittest.TextTestRunner(verbosity=2).run(
                unittest.defaultTestLoader.loadTestsFromNames(sys.argv[1:] or SUITES))
    print(f'COUNTS run={result.testsRun} failed={len(result.failures)} '
          f'errors={len(result.errors)} skipped={len(result.skipped)}')
    return int(not result.wasSuccessful())


if __name__ == '__main__':
    raise SystemExit(main())
