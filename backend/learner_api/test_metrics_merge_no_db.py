"""Verify merged bulk/single metrics contracts without Django or database access."""
import ast
from pathlib import Path
import runpy
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, Mock

ROOT = Path(__file__).parent
actual = runpy.run_path(str(ROOT / 'test_completed_actual_no_db.py'))['calculate']

class ReadError(Exception):
    pass

def extract(names, namespace):
    tree = ast.parse((ROOT / 'dashboard_metrics.py').read_text(encoding='utf-8'))
    tree.body = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names]
    exec(compile(tree, '<merged-metrics>', 'exec'), namespace)

class MetricsMergeTests(unittest.TestCase):
    def setup_metrics(self):
        connections = MagicMock()
        cursor = connections.__getitem__.return_value.cursor.return_value.__enter__.return_value
        cursor.fetchone.return_value = (12, ['progress:1'])
        sentinel = object()
        ns = {'_MISSING': sentinel, 'connections': connections, 'number': float,
              'read_planned_hours': Mock(return_value=99), 'read_aptem_planned_total': Mock(return_value=410),
              'rows': Mock(return_value=[]), 'DatabaseError': ReadError, 'psycopg': SimpleNamespace(Error=ReadError),
              'read_accepted_ksb_rows': Mock(return_value=[{'source_ref': 'progress:1'}]),
              'completed_otjh': lambda *args: 13, 'completed_actual_otjh': actual,
              '_direct_progress_otjh': lambda progress: 1, 'ksb_totals': lambda *args: {'completed': 2},
              'programme_totals': lambda *args: {'total': 4}}
        extract({'metrics_from_loaded'}, ns)
        arguments = dict(source=SimpleNamespace(pk=7, aptem_id='42'), kind='commercial', migrated=True,
                         native=[], progress=[], historical=[], attempts=set(), links={}, history_ready=True,
                         direct_progress=[{'componentId': 'old', 'sourceRef': 'progress:1', 'kind': 'video',
                                           'submittedAt': '2026-09-21', 'verifiedSeconds': 1800},
                                          {'componentId': 'new', 'sourceRef': 'progress:2', 'kind': 'video',
                                           'submittedAt': '2026-09-21', 'verifiedSeconds': 1800}])
        return ns, cursor, arguments

    def test_single_and_preloaded_paths_have_identical_metrics(self):
        ns, cursor, arguments = self.setup_metrics()
        single = ns['metrics_from_loaded'](**arguments)
        cursor.execute.reset_mock()
        ns['rows'].reset_mock()
        cached = ns['metrics_from_loaded'](**arguments, manual_hours=12,
                  preloaded={'planned_hours_document': {'otjh': {}}, 'reflection_submissions': []})
        self.assertEqual(single, cached)
        self.assertEqual(cached['aptem_planned_total'], 410)
        self.assertEqual(cached['otjh']['completed_actual'], 12.5)
        self.assertEqual(cached['ksb']['completed'], 2)
        cursor.execute.assert_not_called()
        ns['rows'].assert_not_called()
        self.assertEqual(ns['read_planned_hours'].call_args.args[-1], {'otjh': {}})

    def test_preloaded_unknown_or_zero_hours_are_not_treated_as_absent(self):
        for hours, expected in [(None, None), (0, 0.5)]:
            ns, cursor, arguments = self.setup_metrics()
            result = ns['metrics_from_loaded'](**arguments, manual_hours=hours,
                        preloaded={'reflection_submissions': []})
            self.assertEqual(result['otjh']['completed_actual'], expected)
            cursor.execute.assert_not_called()

    def test_missing_submissions_remain_unknown_in_both_paths(self):
        ns, _, arguments = self.setup_metrics()
        ns['rows'].side_effect = ReadError()
        single = ns['metrics_from_loaded'](**arguments)
        cached = ns['metrics_from_loaded'](**arguments, manual_hours=12,
                                          preloaded={'reflection_submissions': None})
        self.assertIsNone(single['otjh']['completed_actual'])
        self.assertEqual(single, cached)

    def test_bulk_reflections_retain_time_and_identity_and_failure_state(self):
        connections = MagicMock()
        cursor = connections.__getitem__.return_value.cursor.return_value.__enter__.return_value
        cursor.fetchall.return_value = [('commercial', '7', 11, 22, '2026-09-21', 'a', 'a', 'accepted', 2, False)]
        ns = {'connections': connections, 'DatabaseError': ReadError, 'psycopg': SimpleNamespace(Error=ReadError)}
        extract({'load_reflection_submissions_bulk'}, ns)
        result = ns['load_reflection_submissions_bulk']([('commercial', 7), ('commercial', 8)])
        row = result[('commercial', '7')][0]
        self.assertEqual((row['id'], row['progress_entry_id'], row['submitted_at']), (11, 22, '2026-09-21'))
        self.assertEqual(result[('commercial', '8')], [])
        cursor.execute.side_effect = ReadError()
        self.assertIsNone(ns['load_reflection_submissions_bulk']([('commercial', 7)])[('commercial', '7')])

if __name__ == '__main__':
    unittest.main()
