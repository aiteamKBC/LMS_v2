"""Run directly: in-memory SQL fixtures, mocked transports and the real API role gate.

No application settings/.env, startup warmers, migrations or remote databases.
The directory now intentionally reads profiles instead of KBC/enrolment fields.
"""
import importlib
import json
import os
from contextlib import contextmanager
from pathlib import Path
import sqlite3
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from django.apps import AppConfig
from django.conf import settings

if not settings.configured:
    settings.configure(
        SECRET_KEY='synthetic-test-key', DEFAULT_CHARSET='utf-8', USE_TZ=True,
        DATABASES={'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': ':memory:'}},
        INSTALLED_APPS=['login', AppConfig('learner_api', importlib.import_module('learner_api'))],
    )
import django
django.setup()

from django.db import DatabaseError
from django.test import RequestFactory, SimpleTestCase
from psycopg.conninfo import conninfo_to_dict
from curriculum_api import bulk_attendance_learners as directory
from curriculum_api import bulk_attendance_kbc_source as source
from login.api_gate import ApiSessionGateMiddleware


class LearnerDirectoryTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.path = '/curriculum_api/curriculum/bulk-attendance/learners/'
        self.addCleanup(patch.stopall)
        patch.dict(os.environ, {'API_REQUIRE_AUTH': '1'}, clear=True).start()

    def test_legacy_history_server_connection_still_uses_aiteamkbc(self):
        with patch.dict(os.environ, {'KBCDATABASE': 'postgresql://test:fake@localhost/neondb'}):
            config = conninfo_to_dict(directory.learner_directory_dsn())
        self.assertEqual(config['dbname'], 'AiTeamKBC')

    def test_explicit_history_connection_still_wins(self):
        with patch.dict(os.environ, {'KBC_ATTENDANCE_DATABASE_URL': 'explicit', 'KBCDATABASE': 'legacy'}):
            self.assertEqual(directory.learner_directory_dsn(), 'explicit')

    def test_success_has_no_shared_cache_or_direct_kbc_dependency(self):
        with patch.object(directory, 'read_lms_directory', return_value=[]) as read, \
             patch.object(directory.psycopg, 'connect') as direct:
            response = directory.bulk_attendance_learners(self.factory.get(self.path))
        self.assertEqual(json.loads(response.content), {'learners': [], 'warnings': []})
        self.assertEqual(response['Cache-Control'], 'private, no-store')
        read.assert_called_once_with()
        direct.assert_not_called()

    def test_source_failure_does_not_leak_driver_details(self):
        with patch.object(directory, 'read_lms_directory', side_effect=DatabaseError('private-host')), \
             patch.object(directory, 'read_lms_learners', side_effect=DatabaseError('private-host')):
            response = directory.bulk_attendance_learners(self.factory.get(self.path))
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('private-host', response.content.decode())

    def test_endpoint_rejects_writes(self):
        with patch.object(directory, 'read_lms_directory') as read:
            response = directory.bulk_attendance_learners(self.factory.post(self.path))
        self.assertEqual(response.status_code, 405)
        read.assert_not_called()

    def test_api_gate_rejects_anonymous_learner_and_employer_before_read(self):
        gate = ApiSessionGateMiddleware(directory.bulk_attendance_learners)
        for role, status in [(None, 401), ('learner', 403), ('employer', 403)]:
            with self.subTest(role=role), \
                 patch.object(gate, '_account', return_value=SimpleNamespace(role=role) if role else None), \
                 patch.object(directory, 'read_lms_directory') as read:
                response = gate(self.factory.get(self.path))
                self.assertEqual(response.status_code, status)
                read.assert_not_called()

    def test_api_gate_allows_existing_curriculum_roles(self):
        gate = ApiSessionGateMiddleware(directory.bulk_attendance_learners)
        for role in ('admin', 'staff'):
            with self.subTest(role=role), \
                 patch.object(gate, '_account', return_value=SimpleNamespace(role=role)), \
                 patch.object(directory, 'read_lms_directory', return_value=[]) as read:
                self.assertEqual(gate(self.factory.get(self.path)).status_code, 200)
                read.assert_called_once()


class ProfileDirectorySQLTests(unittest.TestCase):
    """Execute the actual portable SELECT against synthetic, in-memory tables."""

    def setUp(self):
        self.database = sqlite3.connect(':memory:')
        self.addCleanup(self.database.close)
        for schema in ('Learner', 'curriculum', 'enrolment'):
            self.database.execute(f"ATTACH DATABASE ':memory:' AS {schema}")
        self.database.executescript("""
            CREATE TABLE "Learner".learners (
                id INTEGER PRIMARY KEY, enrolment_id INTEGER, aptem_id INTEGER,
                full_name TEXT, email TEXT, programme_status TEXT, learner_type TEXT,
                programme_id TEXT, cohort_id TEXT, group_id TEXT, end_date TEXT, learner_end_date TEXT
            );
            CREATE TABLE curriculum.programmes (programme_id TEXT PRIMARY KEY, name TEXT);
            CREATE TABLE curriculum.groups (group_id TEXT PRIMARY KEY, group_name TEXT);
            CREATE TABLE "Learner".attendance_preferences (learner_id INTEGER PRIMARY KEY, mode TEXT);
            CREATE TABLE enrolment.Created_users (
                id INTEGER PRIMARY KEY, aptem_id TEXT, "Email" TEXT, "Programme_status" TEXT
            );
            INSERT INTO curriculum.programmes VALUES ('P1', 'Engineering');
            INSERT INTO curriculum.groups VALUES ('G1', 'Shared group name'), ('G2', 'Shared group name');
            INSERT INTO "Learner".learners VALUES
                (11,81,301,' Alex Profile ','profile@example.invalid','Active','apprenticeship',
                 'P1','C1','G1','2026-12-31','2027-01-01'),
                (12,82,302,'Blair Profile','commercial@example.invalid','Withdrawn','commercial',
                 'P1','C2','G2',NULL,'2027-02-01'),
                (13,NULL,303,'Casey Unlinked','unlinked@example.invalid','','apprenticeship',
                 NULL,NULL,NULL,NULL,NULL),
                (14,84,NULL,'No Aptem','no-aptem@example.invalid','Active','commercial',
                 'P1','C1','G1',NULL,NULL);
            INSERT INTO enrolment.Created_users VALUES
                (81,'301','enrolment@example.invalid','Completed'),
                (82,'302','old-commercial@example.invalid','Active'),
                (84,'301','profile@example.invalid','Active');
            INSERT INTO "Learner".attendance_preferences VALUES (81,'live'),(11,'lazy'),(14,'live');
        """)
        self.calls = []

        @contextmanager
        def local_cursor(*, read_only):
            self.assertTrue(read_only)
            self.calls.append(read_only)
            # Enforce SELECT-only even on these disposable fixture databases.
            self.database.execute('PRAGMA query_only = ON')
            try:
                yield self.database.cursor()
            except sqlite3.DatabaseError as exc:
                raise DatabaseError('synthetic database read failure') from exc
            finally:
                self.database.execute('PRAGMA query_only = OFF')

        self.addCleanup(patch.stopall)
        patch.object(source, 'new_database_cursor', local_cursor).start()
        patch.object(directory.psycopg, 'connect', side_effect=AssertionError('No remote database')).start()

    def _get(self):
        return directory.bulk_attendance_learners(RequestFactory().get('/directory'))

    def test_profile_fields_win_even_when_enrolment_disagrees(self):
        response = self._get()
        self.assertEqual(response.status_code, 200)
        rows = json.loads(response.content)['learners']
        self.assertEqual([row['id'] for row in rows], ['301', '302', '303'])
        self.assertEqual(rows[0], {
            'id': '301', 'profileId': '11', 'name': 'Alex Profile',
            'email': 'profile@example.invalid', 'programme': 'Engineering', 'group': 'Shared group name',
            'programmeId': 'P1', 'cohortId': 'C1', 'groupId': 'G1', 'endDate': '2026-12-31',
            'kbcStatus': 'Active', 'status': 'Active', 'statusSource': 'learner', 'attendanceMode': 'lazy',
        })
        self.assertEqual(rows[1]['status'], 'Withdrawn')
        self.assertEqual(rows[1]['email'], 'commercial@example.invalid')
        self.assertEqual(rows[1]['cohortId'], 'C2')
        self.assertEqual(rows[1]['groupId'], 'G2')
        self.assertEqual(rows[1]['endDate'], '2027-02-01')
        self.assertEqual(self.calls, [True])

    def test_mode_follows_canonical_id_not_enrolment_aptem_or_email(self):
        rows = directory.read_lms_directory()
        self.assertEqual([row['attendanceMode'] for row in rows], ['lazy', 'live', 'live'])
        # Another enrolment with the same Aptem/email must not affect profile 11.
        self.database.execute("UPDATE \"Learner\".attendance_preferences SET mode='lazy' WHERE learner_id=14")
        self.assertEqual(directory.read_lms_directory(), rows)

    def test_canonical_preferences_win_when_enrolment_points_to_another_mode(self):
        # The saved profile relation is authoritative for both learner types.
        self.database.execute('UPDATE "Learner".attendance_preferences SET mode="live" WHERE learner_id=11')
        self.database.execute('INSERT INTO "Learner".attendance_preferences VALUES (12,"lazy")')
        rows = directory.read_lms_directory()
        self.assertEqual([row['attendanceMode'] for row in rows], ['live', 'lazy', 'live'])

    def test_missing_preference_does_not_use_enrolment_preference(self):
        self.database.execute('DELETE FROM "Learner".attendance_preferences WHERE learner_id=11')
        rows = directory.read_lms_directory()
        self.assertEqual([row['attendanceMode'] for row in rows], ['live', 'live', 'live'])

    def test_missing_placements_and_status_stay_empty_without_guessed_values(self):
        row = directory.read_lms_directory()[2]
        for key in ('programmeId', 'cohortId', 'groupId', 'programme', 'group', 'endDate', 'status'):
            self.assertEqual(row[key], '')
        self.assertEqual(row['attendanceMode'], 'live')

    def test_directory_does_not_require_created_users_or_the_kbc_link(self):
        self.database.execute('DROP TABLE enrolment.Created_users')
        with patch.object(source, 'on_new_database', side_effect=AssertionError('No KBC detection')):
            self.assertEqual(self._get().status_code, 200)

    def test_unavailable_preferences_keep_profile_values_with_a_warning(self):
        self.database.execute('DROP TABLE "Learner".attendance_preferences')
        response = self._get()
        self.assertEqual(response.status_code, 200)
        payload = json.loads(response.content)
        self.assertEqual(payload['warnings'], [directory.ATTENDANCE_MODE_WARNING])
        self.assertEqual([row['attendanceMode'] for row in payload['learners']], ['live'] * 3)
        self.assertEqual(payload['learners'][0]['email'], 'profile@example.invalid')
        self.assertEqual(payload['learners'][0]['status'], 'Active')
        self.assertEqual(self.calls, [True, True])

    def test_unavailable_profiles_fail_instead_of_switching_sources(self):
        self.database.execute('DROP TABLE "Learner".learners')
        response = self._get()
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('synthetic database read failure', response.content.decode())

    def test_duplicate_external_ids_fail_without_combining_two_profiles(self):
        self.database.execute('UPDATE "Learner".learners SET aptem_id=301 WHERE id=12')
        response = self._get()
        self.assertEqual(response.status_code, 503)
        self.assertIn('conflicting attendance identities', json.loads(response.content)['error'])
        self.assertEqual(self.calls, [True])


if __name__ == '__main__':
    unittest.main()
