"""Run selected SimpleTestCases without application config, databases or network."""
import importlib
import socket
import sys
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
import psycopg
from django.apps import AppConfig
from django.conf import settings
from django.db.backends.base.base import BaseDatabaseWrapper

APPS = [
    'django.contrib.auth', 'django.contrib.contenttypes', 'django.contrib.sessions',
    'quiz_api', 'coach_api', 'learner_api', 'audit_api', 'manual_audit_api',
    'curriculum_api', 'engagement_api', 'enrolment_api', 'progress_reviews_api', 'chat', 'login',
]
settings.configure(
    SECRET_KEY='synthetic-offline-tests', BASE_DIR=ROOT / 'backend',
    INSTALLED_APPS=[AppConfig(name, importlib.import_module(name)) for name in APPS],
    DATABASES={alias: {'ENGINE': 'django.db.backends.dummy'} for alias in (
        'default', 'enrolment', 'audit', 'audit_clone', 'kbc_attendance',
    )},
    CACHES={'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}},
    USE_TZ=True, TIME_ZONE='Europe/London', DEFAULT_AUTO_FIELD='django.db.models.BigAutoField',
    ALLOWED_HOSTS=['testserver', 'localhost'], MEDIA_ROOT='', MEDIA_URL='/media/',
    AZURE_QUARANTINE_CONTAINER='offline-test-quarantine',
    ROOT_URLCONF='config.urls', CURRICULUM_ALLOW_RUNTIME_SCHEMA_BOOTSTRAP=False,
)


def forbidden(*args, **kwargs):
    raise AssertionError('Offline test: database/network/background activity forbidden')


def check_suite(suite):
    from django.test import SimpleTestCase, TransactionTestCase
    for test in suite:
        if isinstance(test, unittest.TestSuite):
            check_suite(test)
        elif not isinstance(test, SimpleTestCase) or isinstance(test, TransactionTestCase):
            raise AssertionError(f'Only no-database SimpleTestCases are allowed: {test}')


with patch.object(BaseDatabaseWrapper, 'ensure_connection', forbidden), \
     patch.object(BaseDatabaseWrapper, 'cursor', forbidden), \
     patch.object(psycopg, 'connect', forbidden), \
     patch.object(psycopg.Connection, 'connect', forbidden), \
     patch.object(socket.socket, 'connect', forbidden), \
     patch.object(socket.socket, 'connect_ex', forbidden), \
     patch.object(socket, 'create_connection', forbidden), \
     patch.object(threading.Thread, 'start', forbidden):
    import django
    django.setup()
    labels = sys.argv[1:]
    if labels and labels[0] == '--before-fix':
        import ast
        import subprocess
        from learner_api import calendar
        # calendar.py was clean at task start. Restore only this function in
        # memory for comparison; never alter the shared working tree.
        source = subprocess.check_output(
            ['git', 'show', 'HEAD:backend/learner_api/calendar.py'], cwd=ROOT, encoding='utf-8-sig',
        )
        node = next(node for node in ast.parse(source).body
                    if isinstance(node, ast.FunctionDef) and node.name == 'coaching_events_for_learner')
        exec(compile(ast.Module(body=[node], type_ignores=[]), '<before-fix-calendar>', 'exec'), calendar.__dict__)
        labels = labels[1:]
    suite = unittest.defaultTestLoader.loadTestsFromNames(labels)
    check_suite(suite)
    result = unittest.TextTestRunner(verbosity=1).run(suite)
    sys.exit(not result.wasSuccessful())
