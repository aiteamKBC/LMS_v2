"""Run Monthly Logs contracts with database connections and network forbidden.

From the repository root:
    backend/venv/Scripts/python.exe -B backend/scripts/validate_monthly_logs_no_io.py
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
sys.argv.append('test')
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from django.db.backends.base.base import BaseDatabaseWrapper
import psycopg
import requests


with patch.object(BaseDatabaseWrapper, 'ensure_connection', side_effect=AssertionError('Database forbidden')), \
     patch.object(psycopg, 'connect', side_effect=AssertionError('PostgreSQL forbidden')), \
     patch.object(requests.sessions.Session, 'request', side_effect=AssertionError('HTTP forbidden')), \
     patch.object(urllib.request, 'urlopen', side_effect=AssertionError('HTTP forbidden')), \
     patch.object(http.client.HTTPConnection, 'connect', side_effect=AssertionError('HTTP forbidden')):
    import django
    from django.conf import settings

    assert all(config['ENGINE'] == 'django.db.backends.sqlite3' for config in settings.DATABASES.values())
    # No application database, including the local sqlite file, may be opened.
    for config in settings.DATABASES.values():
        config['NAME'] = ':memory:'
    django.setup()
    with patch.object(socket.socket, 'connect', side_effect=AssertionError('Network forbidden')), \
         patch.object(socket, 'create_connection', side_effect=AssertionError('Network forbidden')):
        suite = unittest.defaultTestLoader.loadTestsFromNames([
            'coach_api.tests_monthly_logs',
            'learner_api.tests_monthly_logs',
            'learner_api.tests_canonical_hours',
        ])
        result = unittest.TextTestRunner(verbosity=1).run(suite)
        raise SystemExit(not result.wasSuccessful())
