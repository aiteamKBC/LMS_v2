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
        self.ns = load_functions({'register_params', 'upsert_live_session_register'})
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

        count = self.ns['upsert_live_session_register'](cursor, [self.row])

        self.assertEqual(count, 1)
        sql, params = cursor.executemany.call_args.args
        self.assertIn('ON CONFLICT (occurrence_id, learner_profile_id) DO UPDATE', sql)
        self.assertNotIn('DELETE', sql.upper())
        self.assertEqual(params[0][4], 'learner@example.test')
        self.assertEqual(params[0][6], 'absent')
        self.assertEqual(params[0][7], 'none')

    def test_empty_sync_does_not_write(self):
        cursor = Mock()
        self.assertEqual(self.ns['upsert_live_session_register'](cursor, []), 0)
        cursor.executemany.assert_not_called()

    def test_owner_sql_does_not_change_raw_teams_attendance(self):
        sql = (ROOT.parent / 'sql' / 'live_session_learner_attendance.sql').read_text().lower()
        self.assertIn('create table if not exists curriculum.live_session_learner_attendance', sql)
        self.assertNotIn('delete from curriculum.live_session_attendance', sql)
        self.assertNotIn('update curriculum.live_session_attendance', sql)
        self.assertNotIn('truncate', sql)

    def test_reporting_sync_publishes_the_learner_register(self):
        source = (ROOT.parent / 'learner_api' / 'teams_attendance.py').read_text()
        self.assertIn('upsert_live_session_register(cursor, rows)', source)


if __name__ == '__main__':
    unittest.main(verbosity=2)
