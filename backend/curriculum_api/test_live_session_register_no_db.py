"""Direct register persistence tests: no Django setup, database or network."""
import ast
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import Mock


ROOT = Path(__file__).parent


def load_functions(names):
    path = ROOT / 'live_session_register.py'
    tree = ast.parse(path.read_text(encoding='utf-8-sig'))
    nodes = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names]
    namespace = {'REGISTER_TABLE': 'curriculum.live_session_learner_attendance'}
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(path), 'exec'), namespace)
    return namespace


class LiveSessionRegisterTests(unittest.TestCase):
    def setUp(self):
        self.ns = load_functions({
            '_basis', 'load_qr_evidence', 'merge_qr_evidence', 'register_params',
            'upsert_live_session_register', 'upsert_qr_attendance_register',
        })
        self.now = datetime(2026, 9, 23, 9, tzinfo=timezone.utc)
        self.row = {
            'occurrence_id': 'OCC-1', 'live_session_id': 'SERIES-1',
            'module_catalogue_id': 'MOD-1', 'learner_profile_id': 42,
            'learner_email': ' Learner@Example.Test ', 'learner_name': 'Learner',
            'attendance_status': 'absent', 'attended_seconds': 0,
            'attendance_report_id': 'REPORT-1', 'first_join_at': None,
            'last_leave_at': None, 'calculated_at': self.now,
        }

    def test_upsert_is_keyed_by_occurrence_and_module_learner(self):
        cursor = Mock()
        cursor.fetchall.return_value = []

        count = self.ns['upsert_live_session_register'](cursor, [self.row])

        self.assertEqual(count, 1)
        sql, params = cursor.executemany.call_args.args
        self.assertIn('ON CONFLICT ON CONSTRAINT curriculum_live_learner_attendance_uniq DO UPDATE', sql)
        self.assertNotIn('DELETE', sql.upper())
        self.assertEqual(params[0][4], 'learner@example.test')
        self.assertEqual(params[0][6], 'absent')
        self.assertEqual(params[0][7], 'none')
        self.assertEqual(params[0][13:16], ('teams', 'absent', 'OCC-1'))

    def test_qr_presence_wins_over_teams_absence_and_keeps_teams_status(self):
        evidence = {(42, 'OCC-1', 'MOD-1'): {'id': 9, 'confirmed_at': self.now}}
        merged, = self.ns['merge_qr_evidence']([self.row], evidence)
        self.assertEqual(merged['attendance_status'], 'present')
        self.assertEqual(merged['teams_attendance_status'], 'absent')
        self.assertEqual(merged['attendance_basis'], 'qr')
        self.assertEqual((merged['qr_attendance_id'], merged['qr_confirmed_at']), (9, self.now))

    def test_teams_and_qr_presence_is_recorded_as_both(self):
        evidence = {(42, 'OCC-1', 'MOD-1'): {'id': 9, 'confirmed_at': self.now}}
        merged, = self.ns['merge_qr_evidence'](
            [{**self.row, 'attendance_status': 'present', 'attended_seconds': 900}], evidence,
        )
        self.assertEqual((merged['attendance_status'], merged['attendance_basis']), ('present', 'teams_qr'))
        self.assertEqual(merged['attended_seconds'], 900)

    def test_qr_for_another_delivery_does_not_change_this_module(self):
        evidence = {(42, 'OCC-1', 'MOD-2'): {'id': 9, 'confirmed_at': self.now}}
        merged, = self.ns['merge_qr_evidence']([self.row], evidence)
        self.assertEqual((merged['attendance_status'], merged['attendance_basis']), ('absent', 'teams'))

    def test_staff_decision_is_not_replaced_by_source_merge(self):
        staff = {**self.row, 'attendance_basis': 'staff'}
        evidence = {(42, 'OCC-1', 'MOD-1'): {'id': 9, 'confirmed_at': self.now}}
        merged, = self.ns['merge_qr_evidence']([staff], evidence)
        self.assertEqual((merged['attendance_status'], merged['attendance_basis']), ('absent', 'staff'))

    def test_empty_sync_does_not_write(self):
        cursor = Mock()
        self.assertEqual(self.ns['upsert_live_session_register'](cursor, []), 0)
        cursor.executemany.assert_not_called()

    def test_qr_upsert_preserves_teams_columns_on_conflict(self):
        cursor = Mock()
        row = {
            **self.row, 'qr_attendance_id': 9, 'qr_confirmed_at': self.now,
            'attendance_status': 'present',
        }
        self.ns['upsert_qr_attendance_register'](cursor, row)
        sql = cursor.execute.call_args.args[0]
        update_sql = sql.split('DO UPDATE SET', 1)[1]
        self.assertNotIn('attended_seconds =', update_sql)
        self.assertNotIn('attendance_report_id =', update_sql)
        self.assertIn("current_register.attendance_basis='staff'", update_sql)

    def test_owner_sql_does_not_change_raw_teams_attendance(self):
        sql = (ROOT.parent / 'sql' / 'live_session_learner_attendance.sql').read_text().lower()
        self.assertIn('create table if not exists curriculum.live_session_learner_attendance', sql)
        self.assertNotIn('delete from curriculum.live_session_attendance', sql)
        self.assertNotIn('update curriculum.live_session_attendance', sql)
        self.assertNotIn('truncate', sql)

    def test_reporting_sync_publishes_the_learner_register(self):
        source = (ROOT.parent / 'learner_api' / 'teams_attendance.py').read_text()
        self.assertIn('upsert_live_session_register(cursor, [*rows, *shared_rows])', source)


if __name__ == '__main__':
    unittest.main(verbosity=2)
