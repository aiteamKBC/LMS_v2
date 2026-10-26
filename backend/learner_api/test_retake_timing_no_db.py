"""Persisted timing decisions through reporting projections; no DB or network."""
import copy
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from learner_api.test_current_learning_no_db import adapter
from learner_api.test_canonical_learning_no_db import adapter as reporting_adapter
from learner_api.retake_timing import choice


def attempt(ident, seconds, mode=None, passed=True, learner=1, quiz='Q1'):
    return dict(id=ident, learner_id=learner, kind='quiz', passed=passed,
        quiz_ref=quiz, component_link_source='quiz_ref', component_type='quiz',
        submitted_at=f'2026-11-{ident:02d}T12:00:00Z',
        declared_completed_at=f'2026-10-{ident:02d}T10:00:00+01:00',
        claimed_seconds=seconds, verified_seconds=seconds, time_tracking_source='timer:input',
        source_payload={'retakeTimeChoice': mode} if mode else {}, ksbs=['K1'])


class RetakeTimingTests(unittest.TestCase):
    def setUp(self):
        self.current = adapter()
        self.reporting = reporting_adapter(Mock(return_value=[]))

    def records(self, rows):
        before = copy.deepcopy(rows)
        current = self.current['project_current'](rows, {})
        result = self.reporting['progress_records_with_completion'](rows, current)
        self.assertEqual(rows, before)
        return result

    def test_new_shorter_success_replaces_hours_and_date_once(self):
        rows = self.records([attempt(1, 600), attempt(2, 120, 'new')])
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['actual_seconds'], 120)
        self.assertEqual(rows[0]['completion_reporting_date'], '2026-10-02')
        self.assertEqual(rows[0]['submitted_at'], '2026-11-02T12:00:00Z')
        displayed = self.reporting['rows_for']({'id': 1}, rows)
        self.assertEqual(displayed[0]['actual_hours'], 120 / 3600)
        self.assertEqual(displayed[0]['activity_date'], '2026-10-02')

    def test_keep_retains_current_choice_not_first_attempt(self):
        rows = self.records([attempt(1, 600), attempt(2, 120, 'new'), attempt(3, 900, 'keep')])
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['actual_seconds'], 120)
        self.assertEqual(rows[0]['completion_reporting_date'], '2026-10-02')
        self.assertEqual(rows[0]['submitted_at'], '2026-11-03T12:00:00Z')

    def test_first_keep_preserves_previously_counted_time(self):
        rows = self.records([attempt(1, 600), attempt(2, 120, 'keep')])
        self.assertEqual(rows[0]['actual_seconds'], 600)
        self.assertEqual(rows[0]['completion_reporting_date'], '2026-10-01')

    def test_failed_new_attempt_never_replaces_successful_selected_time(self):
        rows = self.records([attempt(1, 600), attempt(2, 120, 'new'), attempt(3, 900, 'new', False)])
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['actual_seconds'], 120)
        self.assertEqual(rows[0]['completion_reporting_date'], '2026-10-02')

    def test_choices_are_scoped_by_learner_and_quiz(self):
        current = self.current['native_choices']([], [
            {**attempt(1, 600), 'accepted': True, 'actual_seconds': 600},
            {**attempt(2, 120, 'new'), 'accepted': True, 'actual_seconds': 120},
            {**attempt(3, 900, 'new', learner=2), 'accepted': True, 'actual_seconds': 900},
            {**attempt(4, 300, 'new', quiz='Q2'), 'accepted': True, 'actual_seconds': 300}])
        self.assertEqual(sorted(row['actual_seconds'] for row in current), [120, 300, 900])

    def test_legacy_success_replaces_history_instead_of_adding_hours(self):
        historical = {'id': 7, 'accepted': True, 'completed': True, 'actual_seconds': 1800,
                      'source_payload': {'original_source_ref': 'la:50:60'}, 'ksbs': ['K1'],
                      'reporting_month': '2026-09'}
        def timed(ident, seconds, mode, completed=True):
            return {'id': str(ident), 'completed': completed, 'timing': {
                'version': 1, 'verifiedSeconds': seconds, 'retakeTimeChoice': mode,
                'submittedAt': f'2026-10-{ident:02d}T10:00:00Z'}}
        attempts = {'group_id': 50, 'activity_id': 60, 'completed': True, 'best_percent': 100,
                    'submitted_at': '2026-10-03T10:00:00Z',
                    'timed_attempts': [timed(1, 120, 'new'), timed(2, 900, 'keep'), timed(3, 900, 'new', False)]}
        current = self.current['merge_attempts']([historical], [attempts])
        rows = self.reporting['progress_records_with_completion']([historical], current)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['actual_seconds'], 120)
        self.assertEqual(rows[0]['ksbs'], ['K1'])
        self.assertEqual(historical['actual_seconds'], 1800)

    def test_legacy_keep_does_not_add_new_attempt_hours(self):
        saved, replaces = self.current['measured_choice']([
            {'id': '1', 'timing': {'verifiedSeconds': 100, 'submittedAt': '2026-10-01', 'retakeTimeChoice': 'keep'}}
        ], has_accepted_history=True)
        self.assertIsNone(saved)
        self.assertFalse(replaces)

    def test_replacing_one_legacy_activity_does_not_move_another_activity_route(self):
        historical = [{'id': ident, 'accepted': True, 'actual_seconds': 1800,
            'source_payload': {'original_source_ref': f'la:50:{ident}'}} for ident in (60, 61)]
        attempts = [{'group_id': 50, 'activity_id': ident, 'completed': True, 'best_percent': 100,
            'submitted_at': '2026-10-01T10:00:00Z', 'timed_attempts': [{'id': str(ident),
                'completed': True, 'timing': {'version': 1, 'verifiedSeconds': ident,
                'submittedAt': '2026-10-01T10:00:00Z', 'retakeTimeChoice': 'new'}}]} for ident in (60, 61)]
        current = self.current['merge_attempts'](historical, attempts)
        self.assertEqual(sorted(row['actual_seconds'] for row in current), [60, 61])
        self.assertEqual(sorted(row['retake_superseded_ids'] for row in current), [['60'], ['61']])

    def test_choice_rejects_forged_timestamp_or_duration(self):
        for value in ('2026-10-01', 500, {'seconds': 9999}, ['new'], True):
            with self.subTest(value=value), self.assertRaises(ValueError):
                choice(value)


if __name__ == '__main__':
    unittest.main()
