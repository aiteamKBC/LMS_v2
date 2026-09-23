"""Direct stdlib regression tests: no Django setup, database or network."""
import ast
import types
import unittest
from datetime import datetime, timezone as dt_timezone
from pathlib import Path
from unittest.mock import Mock


ROOT = Path(__file__).parent


def load_functions(names, namespace):
    path = ROOT / 'live_session_absences.py'
    tree = ast.parse(path.read_text(encoding='utf-8-sig'))
    nodes = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names]
    assert len(nodes) == len(names)
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(path), 'exec'), namespace)


class LiveSessionAbsenceLedgerTests(unittest.TestCase):
    def setUp(self):
        self.occurrence_query = Mock()
        self.absence_query = Mock()
        self.absence_model = types.SimpleNamespace(
            RECOVERY_NONE='none', RECOVERY_REQUESTED='requested',
            RECOVERY_CATCHUP_BOOKED='catchup_booked',
            objects=self.absence_query,
        )
        self.register_query = Mock()
        self.register_model = types.SimpleNamespace(
            STATUS_ABSENT='absent', objects=self.register_query,
        )
        self.occurrence_model = types.SimpleNamespace(objects=self.occurrence_query)
        self.instant = datetime(2026, 9, 23, 9, tzinfo=dt_timezone.utc)
        self.ns = {
            'LiveSessionAbsence': self.absence_model,
            'LiveSessionLearnerAttendance': self.register_model,
            'LiveSessionOccurrence': self.occurrence_model,
            'timezone': types.SimpleNamespace(now=lambda: self.instant),
        }
        load_functions({'recovery_status_for', 'record_reported_absence'}, self.ns)

    def test_recovery_status_is_simple_and_does_not_approve_attendance(self):
        status = self.ns['recovery_status_for']
        self.assertEqual(status(''), 'none')
        self.assertEqual(status('recorded'), 'requested')
        self.assertEqual(status('alternative'), 'requested')
        self.assertEqual(status('catch-up'), 'catchup_booked')

    def test_report_is_upserted_by_learner_and_occurrence(self):
        self.occurrence_query.using.return_value.only.return_value.get.return_value = types.SimpleNamespace(id='OCC-8')

        self.ns['record_reported_absence'](
            database='default', occurrence_id='OCC-8', learner_profile_id=42,
            source_kind='apprenticeship', source_learner_id=12,
            learner_email=' LEARNER@Example.Test ', learner_name='Learner',
            recovery_method='catch-up', recovery_reference='catch-up:42:1',
        )

        self.absence_query.using.return_value.update_or_create.assert_called_once_with(
            occurrence_id='OCC-8', learner_profile_id=42,
            defaults={
                'source_kind': 'apprenticeship', 'source_learner_id': 12,
                'learner_email': 'learner@example.test', 'learner_name': 'Learner',
                'recovery_status': 'catchup_booked',
                'recovery_method': 'catch-up', 'recovery_reference': 'catch-up:42:1',
                'reported_at': self.instant,
            },
        )
        self.register_query.using.return_value.filter.assert_called_once_with(
            occurrence_id='OCC-8', learner_profile_id=42, attendance_status='absent',
        )
        self.register_query.using.return_value.filter.return_value.update.assert_called_once_with(
            recovery_status='catchup_booked', updated_at=self.instant,
        )

    def test_owner_sql_only_creates_the_new_absence_table(self):
        sql = (ROOT.parent / 'sql' / 'live_session_absences.sql').read_text().lower()
        self.assertIn('create table if not exists curriculum.live_session_absences', sql)
        self.assertNotIn('delete from curriculum.live_session_attendance', sql)
        self.assertNotIn('truncate', sql)
        self.assertNotIn('update curriculum.live_session_attendance', sql)


if __name__ == '__main__':
    unittest.main(verbosity=2)
