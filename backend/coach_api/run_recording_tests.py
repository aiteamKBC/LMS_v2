"""Isolated coaching/Quality regressions. No application databases or provider I/O.

From backend: python -m coach_api.run_recording_tests
"""
import os
import socket
import sys
import unittest
from unittest.mock import patch


def main():
    os.environ.update(DJANGO_SETTINGS_MODULE='config.settings_coaching_recordings_test', CURRICULUM_WARM='0')
    sys.argv = ['manage.py', 'test']
    connect = socket.socket.connect
    def local_only(sock, address):
        # Windows asyncio builds its private wakeup socket on loopback.
        if isinstance(address, tuple) and address[0] in ('127.0.0.1', '::1'):
            return connect(sock, address)
        raise AssertionError('External network forbidden')
    with patch.object(socket.socket, 'connect', local_only), \
            patch.object(socket.socket, 'connect_ex', side_effect=AssertionError('External network forbidden')):
        from django.conf import settings
        assert all(value['ENGINE'] == 'django.db.backends.sqlite3' for value in settings.DATABASES.values())
        settings.DATABASES = {key: {'ENGINE': 'django.db.backends.sqlite3', 'NAME': ':memory:'} for key in settings.DATABASES}
        # One test inspects the actual migration graph without applying it.
        settings.MIGRATION_MODULES = {}
        import django
        django.setup()
        from django.db import connection, connections
        assert all(conn.vendor == 'sqlite' and conn.settings_dict['NAME'] == ':memory:' for conn in connections.all())
        from curriculum_api.models import CurriculumVideoImport, CurriculumVideoChange
        with connection.schema_editor() as editor:
            editor.create_model(CurriculumVideoImport)
            editor.create_model(CurriculumVideoChange)
        from django.test.utils import setup_test_environment, teardown_test_environment
        setup_test_environment()
        try:
            suite = unittest.defaultTestLoader.loadTestsFromNames([
                'coach_api.test_recordings_jobs', 'coach_api.test_recordings_api',
                'coach_api.test_recordings_calendar_media', 'coach_api.test_recordings_parts',
                'coach_api.test_recordings_transcripts', 'coach_api.test_recordings_quality',
                'coach_api.test_recordings_transport', 'coach_api.test_recordings_evidence_api',
                'coach_api.test_recordings_saved_evidence', 'coach_api.test_recordings_index',
                'curriculum_api.test_recording_direct_fetch',
            ])
            result = unittest.TextTestRunner(verbosity=1).run(suite)
        finally:
            teardown_test_environment()
    return 0 if result.wasSuccessful() else 1


if __name__ == '__main__':
    sys.exit(main())
