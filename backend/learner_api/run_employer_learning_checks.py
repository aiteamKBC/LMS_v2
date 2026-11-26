"""Run employer parity and existing learner checks without a database or network.

From backend: python -B -m learner_api.run_employer_learning_checks
No Django test runner, migrations, .env edits or persisted fixtures are used.
"""
import os
import socket
import sys
import unittest
from unittest.mock import patch


def main():
    os.environ['DJANGO_SETTINGS_MODULE'] = 'config.settings_sqlite_test'
    os.environ['LEARNER_API_REQUIRE_AUTH'] = '1'
    # ready() must not launch the curriculum cache warmer.
    sys.argv = [sys.argv[0], 'test']
    from django.conf import settings
    settings.DATABASES = {alias: {'ENGINE': 'django.db.backends.sqlite3', 'NAME': ':memory:'}
                          for alias in ('default', 'enrolment', 'audit')}
    settings.CACHES = {'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}}
    original_connect = socket.socket.connect

    def local_socketpair(sock, address):
        # Windows asyncio uses loopback for its internal wakeup socket pair.
        if isinstance(address, tuple) and address[0] in ('127.0.0.1', '::1'):
            return original_connect(sock, address)
        raise AssertionError('External network access forbidden in employer parity tests')

    with patch('django.db.backends.base.base.BaseDatabaseWrapper.connect', side_effect=AssertionError('Database access forbidden')), \
            patch.object(socket.socket, 'connect', local_socketpair):
        import django
        django.setup()
        suite = unittest.defaultTestLoader.loadTestsFromNames([
            'learner_api.test_dashboard_overview_no_db', 'learner_api.test_dashboard_tabs_no_db',
            'learner_api.tests_learning_plan_group_sync', 'learner_api.tests_employer_portal_overview',
            'learner_api.test_dashboard_training_no_db', 'learner_api.tests_module_progress',
            'learner_api.test_employer_learning_no_db',
        ])
        return not unittest.TextTestRunner(verbosity=1).run(suite).wasSuccessful()


if __name__ == '__main__':
    sys.exit(main())
