"""Run directly with Python: mocked KBC reads and the real API role gate."""
import importlib
import json
import os
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from django.apps import AppConfig
from django.conf import settings

# No application .env/settings, startup warmers, migrations or remote databases.
settings.configure(
    SECRET_KEY='synthetic-test-key', DEFAULT_CHARSET='utf-8', USE_TZ=True,
    DATABASES={'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': ':memory:'}},
    INSTALLED_APPS=['login', AppConfig('learner_api', importlib.import_module('learner_api'))],
)
import django
django.setup()

from django.test import RequestFactory, SimpleTestCase
from psycopg.conninfo import conninfo_to_dict
from curriculum_api import bulk_attendance_learners as directory
from login.api_gate import ApiSessionGateMiddleware


class LearnerDirectoryTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.path = '/curriculum_api/curriculum/bulk-attendance/learners/'
        self.addCleanup(patch.stopall)
        patch.dict(os.environ, {'API_REQUIRE_AUTH': '1'}, clear=True).start()

    def test_missing_source_is_reported(self):
        with patch.object(directory.psycopg, 'connect') as connect:
            response = directory.bulk_attendance_learners(self.factory.get(self.path))
        self.assertEqual(response.status_code, 503)
        connect.assert_not_called()

    def test_legacy_server_connection_uses_aiteamkbc(self):
        with patch.dict(os.environ, {'KBCDATABASE': 'postgresql://test:fake@localhost/neondb'}):
            config = conninfo_to_dict(directory.learner_directory_dsn())
        self.assertEqual(config['dbname'], 'AiTeamKBC')

    def test_explicit_source_connection_wins(self):
        with patch.dict(os.environ, {'KBC_ATTENDANCE_DATABASE_URL': 'explicit', 'KBCDATABASE': 'legacy'}):
            self.assertEqual(directory.learner_directory_dsn(), 'explicit')

    def test_read_is_read_only_and_returns_only_directory_fields(self):
        connection = MagicMock()
        connection.__enter__.return_value = connection
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchall.return_value = [
            {'id': '301', 'name': ' Alex Example ', 'email': 'alex@example.invalid',
             'programme': 'Engineering', 'group': None, 'endDate': None},
            {'id': '302', 'name': 'Alex Example', 'email': 'second@example.invalid',
             'programme': '', 'group': '', 'endDate': ''},
        ]

        def execute(_sql):
            self.assertTrue(connection.read_only)

        cursor.execute.side_effect = execute
        with patch.object(directory.psycopg, 'connect', return_value=connection):
            learners = directory.read_learners('synthetic')
        self.assertEqual(len(learners), 2)
        self.assertEqual(learners[0]['name'], 'Alex Example')
        self.assertEqual(learners[0]['group'], '')
        sql = cursor.execute.call_args.args[0]
        self.assertIn('FROM public.kbc_users_data', sql)
        self.assertNotIn('SELECT *', sql)
        self.assertNotIn('"Attendance"', sql)

    def test_source_failure_does_not_leak_driver_details(self):
        with patch.object(directory, 'learner_directory_dsn', return_value='synthetic'), \
             patch.object(directory, 'read_learners', side_effect=directory.psycopg.OperationalError('private-host')):
            response = directory.bulk_attendance_learners(self.factory.get(self.path))
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('private-host', response.content.decode())

    def test_success_has_no_shared_cache(self):
        with patch.object(directory, 'learner_directory_dsn', return_value='synthetic'), \
             patch.object(directory, 'read_learners', return_value=[]) as read:
            response = directory.bulk_attendance_learners(self.factory.get(self.path))
        self.assertEqual(json.loads(response.content), {'learners': []})
        self.assertEqual(response['Cache-Control'], 'private, no-store')
        read.assert_called_once()

    def test_endpoint_rejects_writes(self):
        with patch.object(directory, 'read_learners') as read:
            response = directory.bulk_attendance_learners(self.factory.post(self.path))
        self.assertEqual(response.status_code, 405)
        read.assert_not_called()

    def test_api_gate_rejects_anonymous_learner_and_employer_before_read(self):
        gate = ApiSessionGateMiddleware(directory.bulk_attendance_learners)
        for role, status in [(None, 401), ('learner', 403), ('employer', 403)]:
            with self.subTest(role=role), \
                 patch.object(gate, '_account', return_value=SimpleNamespace(role=role) if role else None), \
                 patch.object(directory, 'read_learners') as read:
                response = gate(self.factory.get(self.path))
                self.assertEqual(response.status_code, status)
                read.assert_not_called()

    def test_api_gate_allows_existing_curriculum_roles(self):
        gate = ApiSessionGateMiddleware(directory.bulk_attendance_learners)
        for role in ('admin', 'staff'):
            with self.subTest(role=role), \
                 patch.object(gate, '_account', return_value=SimpleNamespace(role=role)), \
                 patch.object(directory, 'learner_directory_dsn', return_value='synthetic'), \
                 patch.object(directory, 'read_learners', return_value=[]) as read:
                self.assertEqual(gate(self.factory.get(self.path)).status_code, 200)
                read.assert_called_once()


if __name__ == '__main__':
    unittest.main()
