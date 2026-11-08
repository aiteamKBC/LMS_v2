"""Run Phase 1 unit tests without database setup, connections or migrations.

From the repository root:
    backend/.venv/Scripts/python.exe backend/login/run_phase1_db_free_tests.py
"""
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch


DEFAULT_LABELS = (
    'login.tests_schema_compatibility',
    'login.tests_unit.RoleMappingTests',
    'login.tests_staff_learner_actions',
    'login.tests_coach_learner_actions',
    'login.tests_api_gate',
    'login.test_workspace_access_no_db',
)


def main():
    labels = sys.argv[1:] or DEFAULT_LABELS
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    sys.dont_write_bytecode = True
    # Process-local test configuration only; no .env or application config edits.
    os.environ.update(
        DJANGO_SETTINGS_MODULE='config.settings_sqlite_test',
        USE_SECURITY_TEST_BRANCH='0', RUN_APP_ON_TEST_BRANCH='0',
    )
    sys.argv = [sys.argv[0], 'test']  # Suppress server warmers/reconciliation.

    from django.conf import settings
    from django.db.backends.base.base import BaseDatabaseWrapper

    # ASGI isn't under test. Daphne's Windows event loop opens a loopback
    # socketpair, which conflicts with the strict network prohibition below.
    settings.INSTALLED_APPS = [app for app in settings.INSTALLED_APPS if app != 'daphne']
    if any(db['ENGINE'] != 'django.db.backends.sqlite3' for db in settings.DATABASES.values()):
        raise RuntimeError('Only SQLite configuration is permitted by this DB-free runner.')

    denied = AssertionError('Database/network access is forbidden in Phase 1 unit tests.')
    with patch.object(BaseDatabaseWrapper, 'ensure_connection', side_effect=denied), \
         patch('psycopg.connect', side_effect=denied), \
         patch('psycopg.Connection.connect', side_effect=denied), \
         patch('socket.socket.connect', side_effect=denied):
        import django
        django.setup()
        from django.test import SimpleTestCase
        from django.test.utils import setup_test_environment, teardown_test_environment

        suite = unittest.defaultTestLoader.loadTestsFromNames(labels)

        def verify_db_free(tests):
            for test in tests:
                if isinstance(test, unittest.TestSuite):
                    verify_db_free(test)
                elif not isinstance(test, SimpleTestCase) or test.databases:
                    raise RuntimeError(f'Only database-free SimpleTestCase is permitted: {test.id()}')

        verify_db_free(suite)
        setup_test_environment()
        try:
            print('SQLite configuration only; all DB/network connections denied; '
                  'unittest runner; no database setup or migrations.', flush=True)
            result = unittest.TextTestRunner(verbosity=1).run(suite)
        finally:
            teardown_test_environment()
    return 0 if result.wasSuccessful() else 1


if __name__ == '__main__':
    raise SystemExit(main())
