"""Persisted legacy completions count without inventing OTJ evidence or hours."""
from copy import deepcopy
import unittest
from unittest.mock import Mock

from .test_canonical_learning_no_db import adapter as canonical_adapter
from .test_current_learning_no_db import adapter as current_adapter


class UntimedCourseCompletionTests(unittest.TestCase):
    def setUp(self):
        self.canonical = canonical_adapter(Mock(return_value=[]))
        self.current = current_adapter()

    def attempt(self, kind='material', **changes):
        return dict(group_id=50, activity_id=10, catalogue_kind=kind,
                    completed=True, best_percent=100 if kind == 'quiz' else None,
                    submitted_at='2026-10-19T12:00:00Z', title='Synthetic activity', **changes)

    def project(self, stored, attempts):
        current = self.current['merge_attempts'](stored, attempts)
        return self.canonical['progress_records_with_completion'](stored, current)

    def catalogue(self, records, kind='material'):
        return self.canonical['recorded_course_items'](
            [{'source_course_ref': '50', 'source_course_title': 'Synthetic course'}],
            [{'source_course_ref': '50', 'source_activity_id': f'{kind}:10',
              'source_activity_title': 'Synthetic activity', 'source_course_title': 'Synthetic course'}],
            records, include_catalogue=True)[0]

    def test_material_and_quiz_completion_survive_without_a_previous_ledger_row(self):
        for kind in ('material', 'quiz'):
            with self.subTest(kind=kind):
                records = self.project([], [self.attempt(kind)])
                items = self.catalogue(records, kind)
                self.assertEqual(len(items), 1)
                self.assertTrue(items[0]['completed'])
                self.assertEqual(items[0]['actual'], 0)
                self.assertFalse(items[0]['historical_completed'])
                self.assertFalse(items[0]['hours_mapped'])
                self.assertEqual(self.canonical['rows_for']({'id': 7}, records), [])
                self.assertEqual(self.canonical['otjh_activities'](records), [])
                metrics = self.canonical['metrics_from_records'](records, {'2026-10': 10})
                self.assertEqual(metrics['programme']['completed'], 1)
                self.assertEqual(metrics['otjh']['actual'], 0)
                self.assertEqual(metrics['otjh']['planned'], 10)

    def test_existing_history_is_enriched_without_duplicate_time_or_changed_dates(self):
        stored = [{'id': 1, 'accepted': False, 'actual_seconds': 1800, 'ksbs': [],
                   'reporting_month': '2026-09', 'reporting_started_at': '2026-09-01T12:00:00Z',
                   'source_payload': {'original_source_ref': 'la:50:10'}}]
        before = deepcopy(stored)
        records = self.project(stored, [self.attempt()])
        self.assertEqual(stored, before)
        self.assertEqual(len(records), 1)
        self.assertTrue(records[0]['completed'])
        for field in ('accepted', 'actual_seconds', 'reporting_month', 'reporting_started_at'):
            self.assertEqual(records[0][field], before[0][field])
        self.assertEqual(self.canonical['rows_for']({'id': 7}, records),
                         self.canonical['rows_for']({'id': 7}, before))

    def test_failed_and_other_course_attempts_cannot_complete_an_activity(self):
        failed = {**self.attempt(), 'completed': False}
        other = {**self.attempt(), 'group_id': 51}
        self.assertFalse(self.catalogue(self.project([], [failed, other]))[0]['completed'])
        self.assertFalse(self.catalogue(self.project([], [self.attempt('quiz')]))[0]['completed'])
        self.assertEqual(self.project([], [failed]), [])

    def test_timed_completion_counts_once_and_keeps_only_its_measured_hours(self):
        saved = self.attempt(timed_attempts=[{'id': 1, 'completed': True, 'timing': {
            'version': 1, 'verifiedSeconds': 120, 'submittedAt': '2026-10-19T12:00:00Z'}}])
        records = self.project([], [saved])
        items = self.catalogue(records)
        self.assertEqual(len(items), 1)
        self.assertTrue(items[0]['completed'])
        self.assertAlmostEqual(items[0]['actual'], 120 / 3600)
        metrics = self.canonical['metrics_from_records'](records, {})
        self.assertEqual(metrics['programme']['total'], 1)
        self.assertEqual(metrics['programme']['completed'], 1)
        self.assertEqual(metrics['otjh']['actual'], round(120 / 3600, 4))

    def test_repeated_projection_deduplicates_completion_and_excludes_unrelated_submissions(self):
        completed = self.current['merge_attempts']([], [self.attempt()])
        unrelated = {'id': 'reflection:1', 'completed': True, 'accepted': False, 'actual_seconds': None}
        project = self.canonical['progress_records_with_completion']
        once = project([], completed + completed + [unrelated])
        self.assertEqual(len(once), 1)
        self.assertEqual(project(once, completed), once)


if __name__ == '__main__':
    unittest.main()
