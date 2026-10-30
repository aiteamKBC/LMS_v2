"""Exercise the attendance writer on both installed register key definitions.

Run with backend/.venv/Scripts/python.exe -I on this file. Uses only the existing
synthetic PostgreSQL cluster on 127.0.0.1:58347, never application settings.
Start that cluster with pg_ctl -D outputs/feedback-guard-20261027/cluster
-o "-h 127.0.0.1 -p 58347" start. Every test rolls back its schema and rows.
"""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import runpy
import unittest

import psycopg

ROOT = Path(__file__).resolve().parents[2]
CLUSTER = ROOT / 'outputs/feedback-guard-20261027/cluster'
DATABASE = 'feedback_guard_synthetic'
CONNECT = dict(host='127.0.0.1', port=58347, user='feedback_guard_test',
               dbname=DATABASE, connect_timeout=5)
writer = runpy.run_path(str(ROOT / 'backend/curriculum_api/live_session_register.py'))
upsert = writer['upsert_live_session_register']
owner_sql = (ROOT / 'backend/sql/live_session_learner_attendance.sql').read_text()
# Use the actual owner-defined table, without running its recovery backfill.
TABLE_SQL = owner_sql[owner_sql.index('CREATE TABLE'):owner_sql.index('\nALTER TABLE')]


class RegisterPostgresTests(unittest.TestCase):
    def setUp(self):
        self.connection = psycopg.connect(**CONNECT)
        self.addCleanup(self.connection.close)
        self.addCleanup(self.connection.rollback)
        database, directory, role, address = self.connection.execute(
            "SELECT current_database(), current_setting('data_directory'), current_user, host(inet_server_addr())"
        ).fetchone()
        if (database != DATABASE or Path(directory).resolve() != CLUSTER.resolve()
                or role != 'feedback_guard_test' or address != '127.0.0.1'):
            raise RuntimeError('Refusing writes outside the dedicated local synthetic test cluster.')
        self.connection.execute('CREATE SCHEMA curriculum')
        self.connection.execute(TABLE_SQL)
        self.now = datetime(2026, 10, 28, 14, tzinfo=timezone.utc)

    def module_key(self):
        self.connection.execute('''ALTER TABLE curriculum.live_session_learner_attendance
            DROP CONSTRAINT curriculum_live_learner_attendance_uniq,
            ADD CONSTRAINT curriculum_live_learner_attendance_uniq
                UNIQUE (occurrence_id, learner_profile_id, module_catalogue_id)''')

    def row(self, **overrides):
        return {
            'occurrence_id': 'OCC-1', 'live_session_id': 'SERIES-1',
            'module_catalogue_id': 'MOD-1', 'learner_profile_id': 42,
            'learner_email': ' Learner@Example.Test ', 'learner_name': 'Synthetic learner',
            'attendance_status': 'present', 'recovery_status': 'none',
            'attended_seconds': 7200, 'attendance_report_id': 'REPORT-1',
            'first_join_at': self.now - timedelta(hours=2), 'last_leave_at': self.now,
            'calculated_at': self.now, **overrides,
        }

    def write(self, rows):
        with self.connection.cursor() as cursor:
            return upsert(cursor, rows)

    def read(self):
        return self.connection.execute('''SELECT id, occurrence_id, learner_profile_id,
            module_catalogue_id, attendance_status, attended_seconds
            FROM curriculum.live_session_learner_attendance ORDER BY id''').fetchall()

    def test_legacy_key_retry_updates_same_row_and_keeps_other_learners_and_sessions(self):
        self.assertEqual(self.write([self.row(), self.row(learner_profile_id=43),
                                    self.row(occurrence_id='OCC-2')]), 3)
        before = self.read()
        self.assertEqual(self.write([self.row(attended_seconds=7300)]), 1)
        after = self.read()
        self.assertEqual(after[0], (*before[0][:-1], 7300))
        self.assertEqual(after[1:], before[1:])

    def test_module_key_keeps_same_learner_in_shared_occurrence_separate(self):
        self.module_key()
        self.assertEqual(self.write([self.row(), self.row(module_catalogue_id='MOD-2')]), 2)
        before = self.read()
        self.write([self.row(attendance_status='absent', attended_seconds=0)])
        after = self.read()
        self.assertEqual(after[0], (*before[0][:4], 'absent', 0))
        self.assertEqual(after[1], before[1])
        self.assertEqual(len(after), 2)

    def test_module_key_late_attendee_is_inserted_without_duplicating_existing_result(self):
        self.module_key()
        self.write([self.row()])
        first = self.read()[0]
        for _ in range(2):
            self.write([self.row(), self.row(learner_profile_id=43)])
        self.assertEqual(self.read()[0], first)
        self.assertEqual(len(self.read()), 2)

    def test_saved_evidence_and_recovery_values_keep_their_contract(self):
        self.module_key()
        self.write([self.row(recovery_status='completed')])
        record = self.connection.execute('''SELECT learner_email, recovery_status, attendance_report_id,
            first_join_at, last_leave_at, calculated_at
            FROM curriculum.live_session_learner_attendance''').fetchone()
        self.assertEqual(record, ('learner@example.test', 'completed', 'REPORT-1',
                                 self.now - timedelta(hours=2), self.now, self.now))

    def test_invalid_batch_rolls_back_and_can_retry_without_partial_results(self):
        self.module_key()
        self.write([self.row()])
        before = self.read()
        with self.assertRaises(psycopg.errors.CheckViolation):
            with self.connection.transaction():
                self.write([self.row(learner_profile_id=43),
                            self.row(learner_profile_id=44, attendance_status='invalid')])
        self.assertEqual(self.read(), before)
        self.write([self.row(learner_profile_id=43)])
        self.assertEqual(len(self.read()), 2)

    def test_empty_batch_preserves_existing_rows(self):
        self.write([self.row()])
        before = self.read()
        self.assertEqual(self.write([]), 0)
        self.assertEqual(self.read(), before)


if __name__ == '__main__':
    unittest.main(verbosity=2)
