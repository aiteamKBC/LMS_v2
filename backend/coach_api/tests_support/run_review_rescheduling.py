"""Run synthetic Review rescheduling checks without PostgreSQL or providers.

From backend: python -B coach_api/tests_support/run_review_rescheduling.py
Settings overrides live only in this process; no .env or settings file is edited.
"""
import logging
import os
from pathlib import Path
import socket
import sys
import unittest
from contextlib import ExitStack
from unittest.mock import patch


def main():
    regression = '--regression' in sys.argv
    display_only = '--display-only' in sys.argv
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    os.environ['DJANGO_SETTINGS_MODULE'] = 'config.settings_sqlite_test'
    # Avoid application startup warmers; do not use the provisioning test runner.
    sys.argv = [sys.argv[0], 'shell']
    from django.conf import settings
    if any(value['ENGINE'] != 'django.db.backends.sqlite3' for value in settings.DATABASES.values()):
        raise RuntimeError('Only in-memory SQLite is permitted by this runner.')
    for value in settings.DATABASES.values():
        value['NAME'] = ':memory:'
    settings.CACHES = {'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}}
    # ASGI's Windows wakeup sockets are unnecessary for synchronous unit tests.
    settings.INSTALLED_APPS = [app for app in settings.INSTALLED_APPS if app != 'daphne']

    def blocked(*args, **kwargs):
        raise AssertionError('External network access is forbidden in this test runner.')

    with ExitStack() as guards:
        for method in ('connect', 'connect_ex'):
            guards.enter_context(patch.object(socket.socket, method, blocked))
        guards.enter_context(patch.object(socket, 'create_connection', blocked))
        import django
        django.setup()
        logging.getLogger('coach_api.dashboard_cache').setLevel(logging.WARNING)
        suite = unittest.defaultTestLoader.loadTestsFromNames([
            'coach_api.test_review_attendance_display_no_db', 'coach_api.test_meeting_outcomes_no_db',
        ] if display_only else ['coach_api.test_review_rescheduling'])
        result = unittest.TextTestRunner(verbosity=2).run(suite)
        passed = result.wasSuccessful()
        if regression:
            # Existing SimpleTestCase suites only: no provisioning or live I/O.
            labels = [
                'coach_api.tests_calendar_reschedule',
                'coach_api.test_review_attendance_links.AttendanceLinkProjectionTests',
                'coach_api.test_review_attendance_links.AttendanceLinkAuthorizationTests',
                'coach_api.test_imported_review_start', 'coach_api.test_actual_session_resolution',
                'coach_api.test_bound_actual_session_no_db', 'coach_api.test_booking_reservations',
                'learner_api.test_imported_booking', 'learner_api.tests_booking_calendar.RescheduleEndpointTests',
                'curriculum_api.tests.TeamsMultiDayRecurrenceTests', 'curriculum_api.tests.TeamsAttendanceRosterTests',
                'coach_api.tests_errors', 'learner_api.tests.TeamsAttendanceEligibilityTests',
                'learner_api.tests.TeamsAttendanceSyncTests', 'coach_api.test_native_review_summary_transcripts',
                'coach_api.test_migrated_summary_safety.SessionSelectionTests',
                'coach_api.test_migrated_summary_safety.TransportAndLockTests',
                'coach_api.test_imported_snapshot_persistence', 'coach_api.test_imported_recording_playback',
                'coach_api.tests.CoachMeetingArtifactTests',
            ]
            from django.db.backends.base.base import BaseDatabaseWrapper
            with patch.object(BaseDatabaseWrapper, 'ensure_connection',
                              side_effect=AssertionError('Database access is forbidden in mocked regression tests.')):
                suite = unittest.defaultTestLoader.loadTestsFromNames(labels)
                result = unittest.TextTestRunner(verbosity=1).run(suite)
                passed = result.wasSuccessful() and passed
    return 0 if passed else 1


if __name__ == '__main__':
    raise SystemExit(main())
