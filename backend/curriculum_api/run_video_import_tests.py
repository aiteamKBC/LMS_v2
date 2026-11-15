"""Run video regression tests against a fresh in-memory SQLite database.

Usage (from backend): python -m curriculum_api.run_video_import_tests
The production migration is applied to the empty database before testing. No
application database, fixture reset, external HTTP call or deployment is used.
"""
import importlib
import os
import sys
import unittest
from unittest.mock import patch


def main():
    os.environ['DJANGO_SETTINGS_MODULE'] = 'config.settings_sqlite_test'
    os.environ['CURRICULUM_WARM'] = '0'
    os.environ['BUNNY_STREAM_ENABLED'] = 'false'
    # The existing app startup hooks recognise test mode and do not start warmers.
    sys.argv = ['manage.py', 'test']
    from django.conf import settings
    settings.DATABASES = {name: {'ENGINE': 'django.db.backends.sqlite3', 'NAME': ':memory:'}
                          for name in ('default', 'enrolment')}
    import django
    django.setup()
    from django.db import connection, connections
    from django.db.migrations.state import ProjectState
    assert all(c.settings_dict['ENGINE'] == 'django.db.backends.sqlite3'
               and c.settings_dict['NAME'] == ':memory:' for c in connections.all())
    with patch('socket.socket.connect', side_effect=AssertionError('External network disabled in regression tests')):
        state = ProjectState()
        with connection.schema_editor() as editor:
            for name in ('0077_curriculum_video_import', '0078_curriculum_video_changes'):
                migration = importlib.import_module('curriculum_api.migrations.' + name).Migration(name, 'curriculum_api')
                state = migration.apply(state, editor)
        suite = unittest.defaultTestLoader.loadTestsFromNames([
            'curriculum_api.test_bunny_stream', 'curriculum_api.test_video_imports',
            'curriculum_api.test_video_uploads',
            'curriculum_api.test_session_bunny',
            'curriculum_api.test_session_captions',
            'curriculum_api.test_youtube_download',
            'curriculum_api.test_video_changes',
            'curriculum_api.tests_upload_storage.LocalBackendTests',
            'curriculum_api.tests_upload_storage.AzureBackendTests',
            'curriculum_api.tests_upload_storage.RangeServingTests',
        ])
        from django.test.utils import setup_test_environment, teardown_test_environment
        setup_test_environment()
        try:
            result = unittest.TextTestRunner(verbosity=1).run(suite)
        finally:
            teardown_test_environment()
    return 0 if result.wasSuccessful() else 1


if __name__ == '__main__':
    sys.exit(main())
