"""Canonical preference identity on disposable in-memory SQL fixtures.

Run with login/run_phase1_db_free_tests.py; application DB/network access is denied.
"""
from contextlib import contextmanager
from datetime import datetime
import json
import sqlite3
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import UUID

from django.test import RequestFactory, SimpleTestCase
from django.utils import timezone

from curriculum_api import bulk_attendance_learners as directory
from curriculum_api import bulk_attendance_kbc_source as directory_source
from . import attendance_mode as mode


class FixtureCursor:
    """Execute application SQL, adapting only driver bindings and row types."""

    def __init__(self, cursor):
        self.cursor = cursor

    def execute(self, sql, params=()):
        sql = sql.replace('%s', '?').replace(' FOR UPDATE', '')
        self.cursor.execute(sql, [str(value) if isinstance(value, UUID) else value for value in params])

    @property
    def description(self):
        return self.cursor.description

    def fetchall(self):
        return [tuple(datetime.fromisoformat(value) if name[0] == 'updated_at' and value else value
                      for name, value in zip(self.description, row)) for row in self.cursor.fetchall()]


class AttendancePreferenceLinkTests(SimpleTestCase):
    def setUp(self):
        self.database = sqlite3.connect(':memory:')
        self.addCleanup(self.database.close)
        self.database.execute('PRAGMA foreign_keys=ON')
        self.database.execute("ATTACH DATABASE ':memory:' AS Learner")
        self.database.execute("ATTACH DATABASE ':memory:' AS curriculum")
        self.database.create_function('now', 0, lambda: timezone.now().isoformat())
        self.database.executescript('''
            CREATE TABLE "Learner".attendance_preferences (
                learner_id INTEGER PRIMARY KEY, mode TEXT NOT NULL DEFAULT 'live', requested_mode TEXT,
                status TEXT NOT NULL DEFAULT 'active', request_id TEXT, manager_email TEXT DEFAULT '',
                email_sent BOOLEAN DEFAULT false, updated_at TEXT
            );
            CREATE TABLE "Learner".learners (
                id INTEGER PRIMARY KEY, enrolment_id INTEGER, aptem_id INTEGER,
                full_name TEXT DEFAULT 'Synthetic learner', email TEXT DEFAULT 'learner@example.invalid',
                programme_status TEXT DEFAULT 'Active', programme_id TEXT, cohort_id TEXT, group_id TEXT,
                end_date TEXT, learner_end_date TEXT
            );
            CREATE TABLE curriculum.programmes (programme_id TEXT, name TEXT);
            CREATE TABLE curriculum.groups (group_id TEXT, group_name TEXT);
            INSERT INTO "Learner".attendance_preferences (learner_id) VALUES (93);
            INSERT INTO "Learner".learners (id,enrolment_id,aptem_id) VALUES
                (91,12,301), (12,13,302), (93,14,303);
        ''')
        self.source_model = MagicMock()
        self.source_model.all_learners.filter.return_value.first.return_value = SimpleNamespace(
            id=12, username='Synthetic learner', email='learner@example.invalid',
        )
        self.connection = SimpleNamespace(cursor=self.cursor)
        profiles = self.enterContext(patch.object(mode.LearnerProfile, 'objects'))
        def lookup(**kwargs):
            query = MagicMock()
            query.values_list.return_value = [row[0] for row in self.database.execute(
                'SELECT id FROM "Learner".learners WHERE enrolment_id=?', [kwargs['enrolment_id']])]
            return query
        profiles.filter.side_effect = lookup

    @contextmanager
    def cursor(self, **kwargs):
        cursor = self.database.cursor()
        try:
            yield FixtureCursor(cursor)
        finally:
            cursor.close()

    def atomic(self, *, using):
        self.assertEqual(using, 'enrolment')
        return self.database

    def post(self, *, kind='apprenticeship', saved_mode='lazy', role='admin', direct=True):
        request = RequestFactory().post('/', json.dumps({'mode': saved_mode, 'direct': direct}),
                                        content_type='application/json', HTTP_X_REQUESTED_WITH='XMLHttpRequest')
        request.login_account = SimpleNamespace(role=role, subject_id=12)
        with patch('login.permissions._auth_gate_enabled', return_value=True), \
             patch('login.permissions.authenticate_request', return_value=request.login_account), \
             patch('learner_api.identity_placement.api.authorization.audit_admin_learner_action'), \
             patch('learner_api.identity_placement.api.authorization.staff_owns_learner', return_value=role == 'staff'), \
             patch.object(mode, 'SOURCE_MODELS', {kind: self.source_model}), \
             patch.object(mode, 'connections', {'enrolment': self.connection}), \
             patch.object(mode.transaction, 'atomic', side_effect=self.atomic), \
             patch.object(mode, '_ready', return_value=True), \
             patch.object(mode, '_manager', return_value='manager@example.invalid'), \
             patch.object(mode, 'is_configured', return_value=True), \
             patch.object(mode, '_send_request', return_value=True) as send:
            response = mode.attendance_mode(request, kind=kind, learner_id=12)
        return response, send

    def links(self):
        return self.database.execute(
            'SELECT id, enrolment_id FROM "Learner".learners ORDER BY id',
        ).fetchall()

    def assert_direct_creation(self, kind):
        response, send = self.post(kind=kind)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.links(), [(12, 13), (91, 12), (93, 14)])
        send.assert_not_called()
        with patch.object(directory_source, 'new_database_cursor', self.cursor):
            modes = {row['id']: row['attendanceMode'] for row in directory.read_lms_directory()}
        self.assertEqual(modes, {'301': 'lazy', '302': 'live', '303': 'live'})

    def test_apprenticeship_creation_uses_canonical_id_and_bulk_register_reads_it(self):
        self.assert_direct_creation('apprenticeship')

    def test_commercial_creation_uses_canonical_id_and_bulk_register_reads_it(self):
        self.assert_direct_creation('commercial')

    def test_pending_approval_uses_canonical_id_but_does_not_activate_recorded_mode(self):
        response, send = self.post(role='staff', direct=False)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.links(), [(12, 13), (91, 12), (93, 14)])
        self.assertEqual(json.loads(response.content)['mode'], 'live')
        self.assertEqual(json.loads(response.content)['requestedMode'], 'lazy')
        send.assert_called_once()

    def test_existing_recorded_preference_is_idempotent(self):
        self.database.execute('INSERT INTO "Learner".attendance_preferences (learner_id,mode) VALUES (91,?)', ['lazy'])
        self.database.commit()
        for _ in range(2):
            response, send = self.post()
            self.assertEqual(response.status_code, 200)
            send.assert_not_called()
        self.assertEqual(self.links(), [(12, 13), (91, 12), (93, 14)])
        self.assertEqual(self.database.execute('SELECT count(*) FROM "Learner".attendance_preferences').fetchone()[0], 2)

    def test_ambiguous_identity_is_rejected_without_creating_preference(self):
        self.database.execute('INSERT INTO "Learner".learners (id,enrolment_id) VALUES (94,12)')
        self.database.commit()
        response, send = self.post()
        self.assertEqual(response.status_code, 409)
        self.assertEqual(self.database.execute('SELECT learner_id FROM "Learner".attendance_preferences').fetchall(), [(93,)])
        send.assert_not_called()

    def test_missing_identity_is_rejected_without_using_coincident_primary_key(self):
        self.database.execute('UPDATE "Learner".learners SET enrolment_id=NULL WHERE id=91')
        self.database.commit()
        response, send = self.post()
        self.assertEqual(response.status_code, 409)
        send.assert_not_called()

    def test_failure_saving_mode_rolls_back_new_preference(self):
        self.database.executescript('''CREATE TRIGGER "Learner".reject_mode
            BEFORE UPDATE OF mode ON attendance_preferences
            BEGIN SELECT RAISE(ABORT, 'synthetic save failure'); END;''')
        with self.assertLogs('learner_api.attendance_mode', level='ERROR'):
            response, send = self.post()
        self.assertEqual(response.status_code, 502)
        self.assertEqual(self.links(), [(12, 13), (91, 12), (93, 14)])
        self.assertEqual(self.database.execute('SELECT learner_id FROM "Learner".attendance_preferences').fetchall(), [(93,)])
        send.assert_not_called()

    def test_learner_cannot_create_preference(self):
        response, send = self.post(role='learner')
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.links(), [(12, 13), (91, 12), (93, 14)])
        self.assertEqual(self.database.execute('SELECT learner_id FROM "Learner".attendance_preferences').fetchall(), [(93,)])
        send.assert_not_called()
