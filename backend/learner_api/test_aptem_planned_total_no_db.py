"""Exercise the actual reader without Django startup or database access."""
import ast
from pathlib import Path
import unittest
from unittest.mock import Mock, MagicMock
from types import SimpleNamespace


class AptemPlannedTotalTests(unittest.TestCase):
    def test_scoped_read_preserves_zero_and_unavailable_values(self):
        tree = ast.parse(Path(__file__).with_name('dashboard_metrics.py').read_text(encoding='utf-8'))
        tree.body = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'read_aptem_planned_total']
        namespace = {'number': lambda value: float(value) if value is not None else None}
        exec(compile(tree, '<planned-total>', 'exec'), namespace)
        for records, expected in [([(410,)], 410), ([(0,)], 0), ([(None,)], None), ([], None), ([(10,), (20,)], None)]:
            with self.subTest(records=records):
                cursor = Mock()
                cursor.fetchall.return_value = records
                self.assertEqual(namespace['read_aptem_planned_total'](cursor, 42), expected)
                sql, parameters = cursor.execute.call_args.args
                self.assertIn('planned_hours_total FROM "Last_audit".learners WHERE aptem_id=%s', sql)
                self.assertEqual(parameters, [42])

    def test_metrics_adds_retained_total_without_replacing_other_fields(self):
        tree = ast.parse(Path(__file__).with_name('dashboard_metrics.py').read_text(encoding='utf-8'))
        tree.body = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in {'read_aptem_planned_total', 'metrics_from_loaded'}]
        connections = MagicMock()
        cursor = connections.__getitem__.return_value.cursor.return_value.__enter__.return_value
        cursor.fetchall.return_value = [(410,)]
        cursor.fetchone.return_value = (12, [])
        namespace = {
            'read_accepted_ksb_rows': lambda *args: [], 'connections': connections, 'number': lambda value: value,
            'read_planned_hours': lambda *args: 999, 'rows': lambda cursor: [],
            'completed_otjh': lambda *args: 12, 'completed_actual_otjh': lambda *args: 12, 'programme_totals': lambda *args: {},
            'ksb_totals': lambda *args: {}, '_direct_progress_otjh': lambda value: 0,
        }
        exec(compile(tree, '<metrics>', 'exec'), namespace)
        result = namespace['metrics_from_loaded'](SimpleNamespace(pk=7, aptem_id='42'), 'commercial',
            migrated=True, native=[], progress=[], direct_progress=[], historical=[], attempts={}, links={}, history_ready=True)
        self.assertEqual(result['aptem_planned_total'], 410)
        self.assertEqual(result['otjh'], {'historical': 12, 'actual': 12, 'completed_actual': 12, 'new': 0, 'planned': 999})


if __name__ == '__main__':
    unittest.main()
