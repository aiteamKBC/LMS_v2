"""Run My Learning and shared-consumer regressions without DB or network access.

From the repository root:
    backend/.venv/Scripts/python.exe -B backend/scripts/validate_my_learning_no_io.py
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
    # App loading uses a local socketpair on Windows; block raw network sockets
    # after setup, while database and HTTP access remain denied throughout.
    with patch.object(socket.socket, 'connect', side_effect=AssertionError('Network forbidden')), \
         patch.object(socket, 'create_connection', side_effect=AssertionError('Network forbidden')):
        suite = unittest.defaultTestLoader.loadTestsFromNames([
            'learner_api.tests_my_learning_no_db',
            'learner_api.tests_my_learning_module_scope_no_db',
            'learner_api.tests_my_learning_performance_no_db',
            'learner_api.tests_my_learning_diagnostics_no_db',
            'learner_api.tests_progress_transfer_no_db',
            'learner_api.test_imported_course_continuation_no_db',
            'learner_api.test_replacement_learning_no_db',
            'learner_api.test_my_learning_replacement_visibility_no_db',
            'curriculum_api.test_learner_directory_details_no_db',
            'learner_api.test_personal_learning_no_db',
        ])
        result = unittest.TextTestRunner(verbosity=1).run(suite)
        raise SystemExit(not result.wasSuccessful())
