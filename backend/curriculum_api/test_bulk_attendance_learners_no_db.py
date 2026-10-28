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
        self.statuses = patch.object(directory, '_enrolment_statuses', return_value={}).start()
        self.emails = patch.object(directory, '_enrolment_emails', return_value={}).start()
        self.modes = patch.object(directory, '_enrolment_attendance_modes', return_value={}).start()

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

    def test_timeout_is_set_per_transaction_not_as_a_pooler_rejected_startup_option(self):
        connection = MagicMock()
        connection.__enter__.return_value = connection
        connection.cursor.return_value.__enter__.return_value.fetchall.return_value = []
        with patch.object(directory.psycopg, 'connect', return_value=connection) as connect:
            directory.read_learners('synthetic')
        self.assertNotIn('options', connect.call_args.kwargs)
        connection.execute.assert_called_once_with("SET LOCAL statement_timeout = '10s'")

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
        self.assertEqual(json.loads(response.content), {'learners': [], 'warnings': []})
        self.assertEqual(response['Cache-Control'], 'private, no-store')
        read.assert_called_once()

    def test_enrolment_status_wins_and_unenrolled_learners_keep_kbc_status(self):
        self.statuses.return_value = {'301': 'Completed'}
        learners = [
            {'id': '301', 'name': 'A', 'email': '', 'programme': '', 'group': '', 'endDate': '', 'kbcStatus': 'Active'},
            {'id': '302', 'name': 'B', 'email': '', 'programme': '', 'group': '', 'endDate': '', 'kbcStatus': 'EnteredEpa'},
        ]
        with patch.object(directory, 'learner_directory_dsn', return_value='synthetic'), \
             patch.object(directory, 'read_learners', return_value=learners):
            payload = json.loads(directory.bulk_attendance_learners(self.factory.get(self.path)).content)
        self.assertEqual([(l['status'], l['statusSource']) for l in payload['learners']],
                         [('Completed', 'enrolment'), ('EnteredEpa', 'kbc')])
        self.assertEqual(payload['warnings'], [])

    def test_unreadable_enrolment_statuses_fall_back_with_a_warning(self):
        from django.db import DatabaseError
        self.statuses.side_effect = DatabaseError('private-host')
        learners = [{'id': '301', 'name': 'A', 'email': '', 'programme': '', 'group': '', 'endDate': '', 'kbcStatus': 'Active'}]
        with patch.object(directory, 'learner_directory_dsn', return_value='synthetic'), \
             patch.object(directory, 'read_learners', return_value=learners):
            response = directory.bulk_attendance_learners(self.factory.get(self.path))
        payload = json.loads(response.content)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload['learners'][0]['status'], 'Active')
        self.assertEqual(payload['warnings'], [directory.ENROLMENT_STATUS_WARNING])
        self.assertNotIn('private-host', response.content.decode())

    def test_enrolment_status_ignores_merged_duplicates_and_conflicts(self):
        from curriculum_api.bulk_attendance_live_policy import enrolment_status_by_aptem
        self.assertEqual(enrolment_status_by_aptem([
            ('301', 'Completed'), ('301', 'Duplicate - merged'),
            ('302', 'Active'), ('302', 'Withdrawn'),
            (None, 'Active'), ('303', ''),
        ]), {'301': 'Completed'})

    def test_lms_email_is_added_only_when_it_differs_from_the_kbc_email(self):
        learners = [
            {'id': '301', 'email': 'personal@example.invalid'},
            {'id': '302', 'email': 'Same@Example.invalid'},
            {'id': '303', 'email': 'nobody@example.invalid'},
        ]
        result = directory.with_lms_emails(learners, {'301': 'work@example.invalid', '302': 'same@example.invalid'})
        self.assertEqual(result[0]['lmsEmail'], 'work@example.invalid')
        self.assertNotIn('lmsEmail', result[1])
        self.assertNotIn('lmsEmail', result[2])

    def test_enrolment_email_ignores_blank_ids_and_conflicting_emails(self):
        self.assertEqual(directory.enrolment_email_by_aptem([
            ('301', ' Work@Example.invalid '), ('302', 'a@example.invalid'), ('302', 'b@example.invalid'),
            (None, 'x@example.invalid'), ('303', ''), ('304', 'c@example.invalid'), ('304', 'C@example.invalid'),
        ]), {'301': 'work@example.invalid', '304': 'c@example.invalid'})

    def test_attendance_mode_ignores_conflicting_aptem_links(self):
        self.assertEqual(directory.attendance_mode_by_aptem([
            ('301', 'lazy'), ('302', 'live'), ('302', 'lazy'),
            ('303', 'unknown'), (None, 'lazy'),
        ]), {'301': 'lazy', '303': 'live'})
        self.assertEqual(directory.attendance_mode_by_email([
            ('barry@example.invalid', 'lazy'), ('other@example.invalid', 'live'),
            ('other@example.invalid', 'lazy'),
        ]), {'barry@example.invalid': 'lazy'})

    def test_directory_uses_email_when_aptem_mode_link_is_missing(self):
        learners = [{'id': '301', 'email': 'barry@example.invalid'}]
        result = directory.with_attendance_modes(learners, {
            'byAptem': {}, 'byEmail': {'barry@example.invalid': 'lazy'},
        })
        self.assertEqual(result[0]['attendanceMode'], 'lazy')

    def test_directory_defaults_missing_attendance_modes_to_live(self):
        learners = [
            {'id': '301', 'name': 'A', 'email': '', 'programme': '', 'group': '', 'endDate': '', 'kbcStatus': 'Active'},
            {'id': '302', 'name': 'B', 'email': '', 'programme': '', 'group': '', 'endDate': '', 'kbcStatus': 'Active'},
        ]
        self.modes.return_value = {'302': 'lazy'}
        with patch.object(directory, 'learner_directory_dsn', return_value='synthetic'), \
             patch.object(directory, 'read_learners', return_value=learners):
            payload = json.loads(directory.bulk_attendance_learners(self.factory.get(self.path)).content)
        self.assertEqual([row['attendanceMode'] for row in payload['learners']], ['live', 'lazy'])

    def test_unreadable_lms_emails_fall_back_to_kbc_email_with_a_warning(self):
        from django.db import DatabaseError
        self.emails.side_effect = DatabaseError('private-host')
        with patch.object(directory, 'learner_directory_dsn', return_value='synthetic'),                 patch.object(directory, 'read_learners', return_value=[{'id': '301', 'email': 'a@example.invalid'}]):
            response = directory.bulk_attendance_learners(self.factory.get(self.path))
        payload = json.loads(response.content)
        self.assertEqual(response.status_code, 200)
        self.assertNotIn('lmsEmail', payload['learners'][0])
        self.assertEqual(payload['warnings'], [directory.ENROLMENT_EMAIL_WARNING])
        self.assertNotIn('private-host', response.content.decode())

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
