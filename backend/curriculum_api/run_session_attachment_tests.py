"""Attachment regression runner: in-memory DB configuration and no external network."""
import os
import sys
import unittest
from unittest.mock import patch


def main():
    os.environ['DJANGO_SETTINGS_MODULE'] = 'config.settings_sqlite_test'
    os.environ['CURRICULUM_WARM'] = '0'
    os.environ['BUNNY_STREAM_ENABLED'] = 'false'
    sys.argv = ['manage.py', 'test']
    from django.conf import settings
    settings.DATABASES = {key: {'ENGINE': 'django.db.backends.sqlite3', 'NAME': ':memory:'}
                          for key in ('default', 'enrolment')}
    import django
    django.setup()
    from django.db import connections
    assert all(c.settings_dict['ENGINE'] == 'django.db.backends.sqlite3'
               and c.settings_dict['NAME'] == ':memory:' for c in connections.all())
    with patch('socket.socket.connect', side_effect=AssertionError('External network forbidden')), \
         patch('django.db.backends.utils.CursorWrapper.execute', side_effect=AssertionError('Database must be mocked')):
        suite = unittest.defaultTestLoader.loadTestsFromName('curriculum_api.test_session_attachments')
        return 0 if unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful() else 1


if __name__ == '__main__':
    raise SystemExit(main())
