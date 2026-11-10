"""Monthly journal date selection without a database or Django setup."""
import ast
from pathlib import Path
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import Mock, patch


class MonthlyLogLearnerStartTests(unittest.TestCase):
    def test_uses_recorded_learner_date_for_each_scoped_report(self):
        path = Path(__file__).with_name('monthly_logs.py')
        tree = ast.parse(path.read_text(encoding='utf-8'))
        function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'detail_data')
        namespace = {
            '__package__': 'learner_api',
            'canonical': SimpleNamespace(enabled=lambda _: True, targets=lambda _: {'2026-10': 5}),
            'old_repo': SimpleNamespace(CUTOFF='2026-08', query=Mock()),
            'valid_month': Mock(), 'valid_month_key': Mock(), 'require_closed_month': Mock(),
            'signatures': Mock(return_value=[]), 'current_months': Mock(return_value={'2026-10': []}),
            'month_state': Mock(return_value={'snapshot_digest': 'unchanged', 'student_signature': {'saved': True}}),
            'journal_sources': SimpleNamespace(enabled=lambda: False),
        }
        exec(compile(ast.Module(body=[function], type_ignores=[]), str(path), 'exec'), namespace)
        corrections = ModuleType('learner_api.manual_time_corrections')
        corrections.annotate = lambda _learner, report: report
        owner = {'start_date': '2026-10-01', 'end_date': '2028-10-31'}
        with patch.dict('sys.modules', {'learner_api.manual_time_corrections': corrections}):
            for learner_id, stored, expected in ((7, '2026-02-28', '2026-02-28'), (8, None, None)):
                with self.subTest(learner_id=learner_id):
                    namespace['old_repo'].query.return_value = [{'learner_start_date': stored}]
                    learner = {'id': learner_id, 'aptem_id': None, '_profile': owner}
                    report = namespace['detail_data'](learner, '2026-10', include_open=True)
                    self.assertEqual(report['profile']['start_date'], expected)
                    self.assertEqual(report['profile']['planned_end_date'], '2028-10-31')
                    self.assertEqual(report['snapshot_digest'], 'unchanged')
                    self.assertEqual(report['student_signature'], {'saved': True})
                    self.assertEqual(owner['start_date'], '2026-10-01')
                    self.assertEqual(namespace['old_repo'].query.call_args.args[1], [learner_id])
                    sql = namespace['old_repo'].query.call_args.args[0]
                    self.assertIn('SELECT learner_start_date AS learner_start_date', sql)
                    self.assertNotIn('"Learner_start_date"', sql)


if __name__ == '__main__':
    unittest.main()
