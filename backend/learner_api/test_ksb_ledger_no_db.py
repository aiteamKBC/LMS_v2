"""Exercise production KSB functions without Django startup or database access."""
import ast
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

ROOT = Path(__file__).parent
ns = {'json': json, 'GRADED_PROGRESS_KINDS': {'quiz'}}

def load(path, names):
    tree = ast.parse(path.read_text(encoding='utf-8'))
    tree.body = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names]
    exec(compile(tree, str(path), 'exec'), ns)

load(ROOT / 'progress_rules.py', {'_kind', 'progress_counts_as_achieved'})
load(ROOT.parent / 'audit_api/last_audit_ledger_views.py', {'_json_list', '_has_quiz', '_has_reading', '_is_completed'})
load(ROOT / 'dashboard_metrics.py', {'as_json', 'ratio', 'unavailable', 'point_codes', 'ksb_totals', 'read_accepted_ksb_rows'})
calculate = ns['ksb_totals']

def ledger(activity=1, codes=None, **extra):
    return {'id': activity, 'group_id': 7, 'activity_id': activity,
            'ksb_mappings': codes if codes is not None else ['K1', 'S1'], **extra}

class LedgerKsbTests(unittest.TestCase):
    def test_journal_restores_missing_historical_mapping(self):
        result = calculate([], [], [{'group_id': 7, 'activity_id': 1, 'ksb_mappings': None}], ledger=[ledger()])
        self.assertEqual((result['completed'], result['total'], result['percent']), (2, 2, 100))

    def test_completed_new_activity_adds_points_even_for_same_code(self):
        native = [{'id': 'new', 'ksb_mappings': ['K1']}]
        before = calculate(native, [], ledger=[ledger()])
        after = calculate(native, [{'componentId': 'new', 'kind': 'quiz', 'passed': True}], ledger=[ledger()])
        self.assertEqual((before['completed'], before['total']), (2, 3))
        self.assertEqual((after['completed'], after['total']), (3, 3))

    def test_same_activity_in_three_sources_counts_once(self):
        native = [{'id': 'same', 'ksb_mappings': ['K1', 'S1']}]
        old = [{'group_id': 7, 'activity_id': 1, 'status': 'completed', 'ksb_mappings': ['K1', 'S1']}]
        result = calculate(native, [{'componentId': 'same'}] * 2, old,
                           links={'same': ('7', '1')}, ledger=[ledger(), ledger()])
        self.assertEqual((result['completed'], result['total']), (2, 2))

    def test_progress_reference_matches_native_without_export(self):
        result = calculate([{'id': 'same', 'ksb_mappings': ['K1']}], [{'componentId': 'same'}],
                           ledger=[ledger(codes=['K1'], component_ref='same')])
        self.assertEqual((result['completed'], result['total']), (1, 1))

    def test_assignment_evidence_reference_matches_the_same_native_activity(self):
        result = calculate([{'id': 'assignment', 'ksb_mappings': ['K1']}], [{'componentId': 'assignment'}],
                           ledger=[ledger(codes=['K1'], source_ref='asg:assignment:evidence:91')])
        self.assertEqual((result['completed'], result['total']), (1, 1))

    def test_different_group_is_different_placement(self):
        result = calculate([], [], ledger=[ledger(), ledger(group_id=8)])
        self.assertEqual((result['completed'], result['total']), (4, 4))

    def test_partial_journal_does_not_shrink_known_target(self):
        result = calculate([], [], [{'group_id': 7, 'activity_id': 1, 'ksb_mappings': ['K1', 'S1']}],
                           ledger=[ledger(codes=['K1'])])
        self.assertEqual((result['completed'], result['total']), (1, 2))

    def test_failed_or_unfinished_quiz_does_not_increase_points(self):
        for passed in (False, None):
            result = calculate([{'id': 'new', 'ksb_mappings': ['K1']}],
                               [{'componentId': 'new', 'kind': 'quiz', 'passed': passed}], ledger=[ledger()])
            self.assertEqual(result['completed'], 2)

    def test_unknown_mapping_preserves_known_count_without_percentage(self):
        result = calculate([], [], [{'group_id': 7, 'activity_id': 99, 'ksb_mappings': None}], ledger=[ledger()])
        self.assertIsNone(result['percent'])
        self.assertIsNone(result['total'])
        self.assertEqual(result['mappedCompleted'], 2)
        self.assertEqual(result['unmappedActivities'], 1)

    def test_reader_scopes_learner_and_only_accepted_undeleted_rows(self):
        cursor = Mock()
        ns['rows'] = lambda value: [{'id': 1}]
        for learner_id, aptem_id in ((10, 42), (11, 43)):
            self.assertEqual(ns['read_accepted_ksb_rows'](cursor, SimpleNamespace(pk=learner_id, aptem_id=aptem_id), 'commercial'), [{'id': 1}])
            sql, parameters = cursor.execute.call_args.args
            self.assertEqual(parameters, [learner_id, str(learner_id), 'commercial', aptem_id])
            self.assertIn('r.accepted=true AND r.deleted_at IS NULL', sql)
            self.assertIn('j.row_id=r.id AND j.aptem_id=r.aptem_id', sql)

if __name__ == '__main__':
    unittest.main()
