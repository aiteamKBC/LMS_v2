"""Offline timing regression runner: in-memory SQLite only, no .env or app settings.

Run: backend/.venv/Scripts/python.exe backend/scripts/test_activity_timing.py
Only the new checkpoint table is created; existing learner/Graph calls are mocked.
"""
import sys
from pathlib import Path
from unittest.mock import patch
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from django.apps import AppConfig
from django.conf import settings


class LearnerTestsConfig(AppConfig):
    name = 'learner_api'


class LoginTestsConfig(AppConfig):
    name = 'login'


settings.configure(
    SECRET_KEY='synthetic-offline-timing-tests-only', USE_TZ=True, TIME_ZONE='Europe/London',
    DEFAULT_AUTO_FIELD='django.db.models.BigAutoField',
    INSTALLED_APPS=['django.contrib.auth', 'django.contrib.contenttypes',
                    '__main__.LearnerTestsConfig', '__main__.LoginTestsConfig',
                    'enrolment_api', 'quiz_api', 'engagement_api', 'system_audit'],
    DATABASES={name: {'ENGINE': 'django.db.backends.sqlite3', 'NAME': ':memory:'}
               for name in ('default', 'enrolment')},
    DATABASE_ROUTERS=[], KBC_SHARED_REWARDS_READY=False,
)
import django
django.setup()
from django.db import connections
from learner_api.timing_drafts import ActivityTimingDraft

for connection in connections.all():
    if connection.vendor != 'sqlite' or connection.settings_dict['NAME'] != ':memory:':
        raise RuntimeError('Only disposable in-memory test databases are permitted.')
with connections['enrolment'].schema_editor() as editor:
    editor.create_model(ActivityTimingDraft)

suite = unittest.TestSuite()
for module in ('learner_api.tests_timing_drafts', 'learner_api.tests_time_tracking'):
    suite.addTests(unittest.defaultTestLoader.loadTestsFromName(module))
with patch('socket.socket.connect', side_effect=AssertionError('Network is forbidden in timing regressions')):
    result = unittest.TextTestRunner(verbosity=2).run(suite)
raise SystemExit(not result.wasSuccessful())
