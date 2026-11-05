"""Run commit-hook checks using only in-memory SQLite and mocked integrations."""
import http.client
import os
from pathlib import Path
import smtplib
import socket
import sys
import unittest
import urllib.request
from unittest.mock import patch

labels = sys.argv[1:] or ['engagement_api.tests_feedback_attendance_commit']
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ['DJANGO_SETTINGS_MODULE'] = 'config.settings_sqlite_test'
sys.argv = [sys.argv[0], 'test']
from django.db.backends.base.base import BaseDatabaseWrapper
import requests

original_ensure = BaseDatabaseWrapper.ensure_connection

def memory_only(self):
    if (self.settings_dict['ENGINE'] != 'django.db.backends.sqlite3'
            or self.settings_dict['NAME'] != ':memory:'):
        raise AssertionError('Only isolated in-memory SQLite transactions are allowed')
    return original_ensure(self)

with (
    patch.object(BaseDatabaseWrapper, 'ensure_connection', side_effect=AssertionError('Startup DB forbidden')),
    patch.object(requests.sessions.Session, 'request', side_effect=AssertionError('HTTP forbidden')),
    patch.object(urllib.request, 'urlopen', side_effect=AssertionError('HTTP forbidden')),
    patch.object(http.client.HTTPConnection, 'connect', side_effect=AssertionError('HTTP forbidden')),
    patch.object(smtplib.SMTP, 'connect', side_effect=AssertionError('Mail forbidden')),
):
    from django.conf import settings
    assert all(config['ENGINE'] == 'django.db.backends.sqlite3' for config in settings.DATABASES.values())
    for config in settings.DATABASES.values():
        config['NAME'] = ':memory:'
    import django
    django.setup()
    # Django/Daphne may initialise a local socketpair at startup; from here all
    # sockets are forbidden. No migration runner or application server is used.
    with (
        patch.object(BaseDatabaseWrapper, 'ensure_connection', memory_only),
        patch.object(socket.socket, 'connect', side_effect=AssertionError('Network forbidden')),
        patch.object(socket, 'create_connection', side_effect=AssertionError('Network forbidden')),
    ):
        suite = unittest.defaultTestLoader.loadTestsFromNames(labels)
        result = unittest.TextTestRunner(verbosity=2).run(suite)
        raise SystemExit(not result.wasSuccessful())
