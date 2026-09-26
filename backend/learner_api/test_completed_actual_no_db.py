"""Run production calculation functions without Django imports or DB setup."""
import ast
from math import isfinite
from pathlib import Path
import re
import unittest


def functions(filename, names, namespace):
    tree = ast.parse(Path(__file__).with_name(filename).read_text(encoding='utf-8'))
    tree.body = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names]
    exec(compile(tree, filename, 'exec'), namespace)


namespace = {'re': re, 'isfinite': isfinite,
             'GRADED_PROGRESS_KINDS': {'quiz'}, 'ACCEPTED_ASSIGNMENT_STATUSES': {'accepted', 'partial'}}
functions('active_users.py', {'_s', '_number', '_reported_minutes', '_progress_text',
    'otjh_progress_dedupe_key', '_manual_claimed_seconds', '_progress_record_minutes',
    'dedupe_otjh_progress_records', '_component_expected_hours_lookup',
    'completed_hours_value_from_progress'}, namespace)
functions('progress_rules.py', {'_kind', 'progress_counts_as_achieved', 'progress_record_counts_as_achieved'}, namespace)
functions('otjh_totals.py', {'_hours', 'completed_actual_otjh'}, namespace)
calculate = namespace['completed_actual_otjh']


def entry(component='reading', **overrides):
    return {'componentId': component, 'kind': 'component', 'submittedAt': '2026-09-21T10:00:00Z',
            'verifiedSeconds': 1800, 'expectedOtjh': 8, **overrides}


class CompletedActualTests(unittest.TestCase):
    def test_retained_hours_plus_actual_completion(self):
        self.assertEqual(calculate([], [entry()], [], 474.3783), 474.8783)

    def test_no_timestamp_failed_or_unresolved_quiz_does_not_add(self):
        for override in ({'submittedAt': ''}, {'passed': False}, {'kind': 'quiz'},
                         {'kind': 'activity_event'}):
            with self.subTest(override=override):
                self.assertEqual(calculate([], [entry(**override)], [], 12), 12)
        self.assertEqual(calculate([], [entry(kind='quiz', passed=True)], [], 12), 12.5)

    def test_missing_actual_never_uses_planned(self):
        self.assertEqual(calculate([], [entry(verifiedSeconds=None, expected_otjh=9)], [], 12), 12)
        self.assertEqual(calculate([], [entry(verifiedSeconds=0)], [], 12), 12)

    def test_actual_input_and_reported_time_keep_existing_precedence(self):
        self.assertEqual(calculate([], [entry(claimedSeconds=3600, timeTrackingSource='reading:input')], [], 12), 13)
        self.assertEqual(calculate([], [entry(reportedTime='45 minutes')], [], 12), 12.75)

    def test_quiz_reflection_minutes_are_not_read_as_hours(self):
        # The quiz reflection submits its minutes field with an explicit unit.
        quiz = entry(kind='quiz', passed=True, verifiedSeconds=3)
        self.assertAlmostEqual(calculate([], [{**quiz, 'reportedTime': '14 minutes'}], [], 12), 12 + 14 / 60, places=4)
        # A bare number is still the hours convention used by other reflections.
        self.assertEqual(calculate([], [{**quiz, 'reportedTime': '14'}], [], 12), 26)

    def test_same_activity_is_not_added_twice(self):
        self.assertEqual(calculate([], [entry(), entry()], [], 12), 12.5)
        self.assertEqual(calculate([], [entry(sourceRef='progress:1'), entry(sourceRef='progress:2')],
                                   [], 12, ['progress:1']), 12)
        self.assertEqual(calculate([], [entry(sourceRef='progress:2')], [], 12, ['progress:1']), 12.5)

    def test_assignment_uses_latest_marking_and_actual_only(self):
        native = [{'id': 'assignment', 'type': 'assignment'}]
        progress = [entry('assignment')]
        submission = {'id': 2, 'activity_id': 'assignment', 'submitted_at': '2026-09-21',
                      'status': 'accepted', 'actual_time_hours': 2}
        self.assertEqual(calculate(native, progress, [submission], 12), 14)
        for override in ({'status': 'rejected'}, {'status': 'submitted'}, {'imported': True}, {'submitted_at': None}):
            self.assertEqual(calculate(native, progress, [{**submission, **override}], 12), 12)
        self.assertEqual(calculate(native, progress, [submission, {**submission, 'status': 'rejected'}], 12), 12)
        self.assertEqual(calculate(native, progress, [submission], 12, ['reflection:2']), 12)
        self.assertEqual(calculate(native, progress, [submission, {**submission, 'id': 3}],
                                   12, ['reflection:2']), 12)
        self.assertEqual(calculate(native, [entry('assignment', verifiedSeconds=None)],
                                   [{**submission, 'actual_time_hours': None}], 12), 12)

    def test_unknown_sources_stay_unknown(self):
        self.assertIsNone(calculate([], [entry()], [], None))
        self.assertIsNone(calculate([], [entry()], None, 12))


if __name__ == '__main__':
    unittest.main()
