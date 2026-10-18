"""Run unified Weekly unit contracts without database or external network access.

Uses unittest directly: never invokes the project's schema-provisioning runner.
"""
import os
import sys
import socket
import unittest
import logging
import urllib.request
import http.client
from pathlib import Path
from unittest.mock import patch

os.environ['DJANGO_SETTINGS_MODULE'] = 'config.settings_sqlite_test'
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from django.db.backends.base.base import BaseDatabaseWrapper
import requests

with patch.object(BaseDatabaseWrapper, 'ensure_connection', side_effect=AssertionError('Database forbidden')), \
     patch.object(requests.sessions.Session, 'request', side_effect=AssertionError('HTTP forbidden')), \
     patch.object(urllib.request, 'urlopen', side_effect=AssertionError('HTTP forbidden')), \
     patch.object(http.client.HTTPConnection, 'connect', side_effect=AssertionError('HTTP forbidden')):
    import django
    django.setup()
    from django.conf import settings
    assert all(c['ENGINE'] == 'django.db.backends.sqlite3' for c in settings.DATABASES.values())
    logging.disable(logging.CRITICAL)
    with patch.object(socket.socket, 'connect', side_effect=AssertionError('Network forbidden')), \
         patch.object(socket, 'create_connection', side_effect=AssertionError('Network forbidden')):
        modules = ['coach_api.tests_weekly_learning', 'coach_api.tests_weekly_live_attendance',
                   'learner_api.test_dashboard_weekly_no_db', 'learner_api.test_weekly_optimization_no_db',
                   'learner_api.tests_weekly_learning', 'learner_api.test_weekly_json_null_no_db', 'learner_api.test_canonical_learning_no_db']
        result = unittest.TextTestRunner(verbosity=1).run(unittest.defaultTestLoader.loadTestsFromNames(modules))
        raise SystemExit(not result.wasSuccessful())
