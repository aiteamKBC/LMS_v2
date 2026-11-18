"""Certificate and course regressions with SQLite settings and all I/O denied.

Run: backend/.venv/Scripts/python.exe -B backend/scripts/validate_certificates_no_io.py
"""
import http.client
import os
from pathlib import Path
import socket
import sys
import unittest
import urllib.request
from unittest.mock import patch

os.environ['DJANGO_SETTINGS_MODULE'] = 'config.settings_sqlite_test'
os.environ['CURRICULUM_WARM'] = '0'
sys.argv.append('test')
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from django.db.backends.base.base import BaseDatabaseWrapper
import requests

with patch.object(BaseDatabaseWrapper, 'ensure_connection', side_effect=AssertionError('Database forbidden')), \
     patch.object(requests.sessions.Session, 'request', side_effect=AssertionError('HTTP forbidden')), \
     patch.object(urllib.request, 'urlopen', side_effect=AssertionError('HTTP forbidden')), \
     patch.object(http.client.HTTPConnection, 'connect', side_effect=AssertionError('HTTP forbidden')):
    import django
    from django.conf import settings

    assert all(config['ENGINE'] == 'django.db.backends.sqlite3' for config in settings.DATABASES.values())
    django.setup()
    with patch.object(socket.socket, 'connect', side_effect=AssertionError('Network forbidden')), \
         patch.object(socket, 'create_connection', side_effect=AssertionError('Network forbidden')):
        suite = unittest.defaultTestLoader.loadTestsFromNames([
            'login.test_admin_certificates_no_db',
            'learner_api.tests_certificates',
            'learner_api.tests_certificate_eligibility',
            'learner_api.tests_free_courses',
            'learner_api.tests_free_course_assignments_no_db',
            'learner_api.tests_my_learning_no_db',
            'learner_api.test_personal_learning_no_db',
        ])
        result = unittest.TextTestRunner(verbosity=1).run(suite)
        raise SystemExit(not result.wasSuccessful())
