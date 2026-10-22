"""Run ticket contracts with database connections and external network blocked."""
import http.client
import os
from pathlib import Path
import socket
import sys
import unittest
import urllib.request
from unittest.mock import patch

os.environ['DJANGO_SETTINGS_MODULE'] = 'config.settings_sqlite_test'
# Activate the application's existing test guard for direct Inclusion DB access.
sys.argv.append('test')
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
    # Daphne creates an asyncio loop using a local socketpair on Windows during
    # app loading. As in the other no-I/O runners, block raw sockets afterwards,
    # before importing or executing any test; HTTP and DB are already blocked.
    with patch.object(socket.socket, 'connect', side_effect=AssertionError('Network forbidden')), \
         patch.object(socket, 'create_connection', side_effect=AssertionError('Network forbidden')):
        suite = unittest.defaultTestLoader.loadTestsFromNames([
            'learner_api.test_support_tickets_no_db',
            'coach_api.test_lms_support_tickets_no_db',
            'coach_api.test_support_tickets_no_db',
        ])
        result = unittest.TextTestRunner(verbosity=1).run(suite)
        raise SystemExit(not result.wasSuccessful())
