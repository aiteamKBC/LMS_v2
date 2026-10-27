"""Verify reporting and unchanged feedback access/timing with all DB/network I/O blocked."""
import http.client
import os
from pathlib import Path
import smtplib
import socket
import sys
import unittest
import urllib.request
from unittest.mock import patch

os.environ['DJANGO_SETTINGS_MODULE'] = 'config.settings_sqlite_test'
sys.argv.append('test')
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from django.db.backends.base.base import BaseDatabaseWrapper
import requests

with (
    patch.object(BaseDatabaseWrapper, 'ensure_connection', side_effect=AssertionError('Database forbidden')),
    patch.object(requests.sessions.Session, 'request', side_effect=AssertionError('HTTP forbidden')),
    patch.object(urllib.request, 'urlopen', side_effect=AssertionError('HTTP forbidden')),
    patch.object(http.client.HTTPConnection, 'connect', side_effect=AssertionError('HTTP forbidden')),
    patch.object(smtplib.SMTP, 'connect', side_effect=AssertionError('Mail forbidden')),
):
    import django
    django.setup()
    from django.conf import settings
    assert all(config['ENGINE'] == 'django.db.backends.sqlite3' for config in settings.DATABASES.values())
    # Allow only Django/Daphne's local socketpair initialization, then deny sockets too.
    with (
        patch.object(socket.socket, 'connect', side_effect=AssertionError('Network forbidden')),
        patch.object(socket, 'create_connection', side_effect=AssertionError('Network forbidden')),
    ):
        suite = unittest.defaultTestLoader.loadTestsFromNames([
            'engagement_api.tests_feedback_analytics',
            'engagement_api.tests_feedback_question_scoring',
            'engagement_api.tests_post_lecture_bank',
            'engagement_api.tests_module_feedback',
            'engagement_api.tests_feedback_visibility',
            'engagement_api.tests.FeedbackValidationTests',
            'engagement_api.tests_event_feedback',
        ])
        result = unittest.TextTestRunner(verbosity=1).run(suite)
        raise SystemExit(not result.wasSuccessful())
