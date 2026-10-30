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

    def test_component_retries_use_latest_time_in_actual_hours_and_monthly_logs(self):
        for component_type in ('video', 'reading', 'slides', 'audio', 'live_session', 'quiz'):
            for seconds in (600, 2400, 0):
                with self.subTest(component_type=component_type, seconds=seconds):
                    saved = [
                        {**attempt(ident, duration), 'component_ref': 'C1',
                         'component_type': component_type, 'component_link_source': 'direct',
                         'quiz_ref': 'Q1' if component_type == 'quiz' else None,
                         'kind': 'quiz' if component_type == 'quiz' else 'component'}
                        for ident, duration in ((1, 1800), (2, seconds))
                    ]
                    # Database/reporting order is not necessarily submission order.
                    rows = self.records(list(reversed(saved)))
                    metrics = self.reporting['metrics_from_records'](rows, {})
                    self.assertEqual(metrics['otjh']['actual'], round(seconds / 3600, 4))
                    logs = self.reporting['rows_for']({'id': 1}, rows)
                    self.assertAlmostEqual(sum(row['actual_hours'] for row in logs), seconds / 3600)
                    if seconds:
                        self.assertEqual([row['activity_date'] for row in logs if row['actual_hours']], ['2026-10-02'])
                    selected = self.current['project_current'](saved, {})
                    self.assertEqual([row['id'] for row in selected], [2])
                    self.assertEqual(selected[0]['actual_seconds'], seconds)

    def test_default_quiz_retake_ignores_later_failed_attempt(self):
        rows = self.records([attempt(1, 1800), attempt(2, 600), attempt(3, 60, passed=False)])
        metrics = self.reporting['metrics_from_records'](rows, {})
        self.assertEqual(metrics['otjh']['actual'], round(600 / 3600, 4))

    def test_quiz_and_remedial_reading_both_reach_hours_and_monthly_log(self):
        for reverse in (False, True):
            with self.subTest(reverse=reverse):
                saved = [attempt(1, 300), {**attempt(2, 120), 'kind': 'quiz_reading',
                         'passed': None, 'component_type': 'reading', 'attempt': 1}]
                rows = self.records(list(reversed(saved)) if reverse else saved)
                self.assertEqual(self.reporting['metrics_from_records'](rows, {})['otjh']['actual'],
                                 round(420 / 3600, 4))
                logs = self.reporting['rows_for']({'id': 1}, rows)
                self.assertAlmostEqual(sum(row['actual_hours'] for row in logs), 420 / 3600)
                self.assertEqual({row['id']: row['actual_seconds'] for row in rows}, {1: 300, 2: 120})

    def test_quiz_time_choice_does_not_replace_or_absorb_reading_time(self):
        for mode, quiz_seconds in (('keep', 300), ('new', 60)):
            with self.subTest(mode=mode):
                saved = [attempt(1, 300),
                         {**attempt(2, 120), 'kind': 'quiz_reading', 'passed': None, 'attempt': 1},
                         attempt(3, 60, mode),
                         {**attempt(4, 90), 'kind': 'quiz_reading', 'passed': None, 'attempt': 2}]
                rows = self.records(saved)
                self.assertEqual({row['id']: row['actual_seconds'] for row in rows},
                                 {2: 120, 3: quiz_seconds, 4: 90})
                self.assertAlmostEqual(sum(row['actual_hours'] for row in
                                           self.reporting['rows_for']({'id': 1}, rows)),
                                       (quiz_seconds + 210) / 3600)

    def test_readings_remain_separate_without_attempt_numbers_in_compact_reads(self):
        readings = [{**attempt(ident, seconds, learner=learner), 'kind': 'quiz_reading',
                     'passed': None} for ident, seconds, learner in (
                         (1, 120, 1), (2, 90, 1), (3, 60, 2))]
        current = self.current['project_current']([*readings, readings[0]], {})
        self.assertEqual({row['id']: row['actual_seconds'] for row in current},
                         {1: 120, 2: 90, 3: 60})
        self.assertEqual(len(current), 3)

    def test_unsubmitted_or_zero_reading_cannot_erase_quiz_hours(self):
        for submitted_at in (None, '2026-11-02T12:00:00Z'):
            with self.subTest(submitted_at=submitted_at):
                rows = self.records([attempt(1, 300), {**attempt(2, 0), 'kind': 'quiz_reading',
                                     'passed': None, 'submitted_at': submitted_at}])
                self.assertEqual(self.reporting['metrics_from_records'](rows, {})['otjh']['actual'],
                                 round(300 / 3600, 4))

    def test_restored_video_allocation_preserves_attempts_and_counts_once(self):
        saved = [{**attempt(ident, seconds), 'quiz_ref': None, 'kind': 'video',
                  'component_ref': 'C1', 'component_type': 'video',
                  'component_link_source': 'direct'} for ident, seconds in ((1, 600), (2, 0))]
        saved[0].update(actual_seconds=600, actual_basis='staff:module-progress', accepted=True,
                        reporting_month='2026-10')
        rows = self.records(saved)
        self.assertEqual([row['id'] for row in rows], [1, 2])
        self.assertEqual([row['verified_seconds'] for row in rows], [600, 0])
        self.assertEqual(self.reporting['metrics_from_records'](rows, {})['otjh']['actual'],
                         round(600 / 3600, 4))
        self.assertAlmostEqual(sum(row['actual_hours'] for row in
                                   self.reporting['rows_for']({'id': 1}, rows)), 600 / 3600)

    def test_retry_order_uses_submission_instant_not_duration_or_declared_date(self):
        earlier = {**attempt(9, 1800), 'submitted_at': '2026-10-02T10:00:00+01:00'}
        later = {**attempt(10, 600), 'submitted_at': '2026-10-02T09:30:00Z',
                 'declared_completed_at': '2026-10-01T10:00:00+01:00'}
        self.assertEqual(self.current['project_current']([later, earlier], {})[0]['id'], 10)
        earlier['submitted_at'] = later['submitted_at']
        self.assertEqual(self.current['project_current']([later, earlier], {})[0]['id'], 10)
        # The repeated London hour must still sort by the actual UTC instant.
        earlier['submitted_at'] = '2026-10-25T01:45:00+01:00'
        later['submitted_at'] = '2026-10-25T01:15:00Z'
        self.assertEqual(self.current['project_current']([later, earlier], {})[0]['id'], 10)

    def test_keep_after_shorter_default_retry_keeps_that_retry(self):
        rows = self.records([attempt(1, 1800), attempt(2, 600), attempt(3, 2400, 'keep')])
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['actual_seconds'], 600)
        self.assertEqual(rows[0]['completion_reporting_date'], '2026-10-02')

    def test_retry_uses_latest_marking_without_bypassing_assignment_approval(self):
        records = [{**attempt(ident, seconds), 'quiz_ref': None, 'component_ref': 'C1',
                    'kind': 'component', 'passed': None, 'component_type': 'assignment',
                    'component_link_source': 'direct'} for ident, seconds in ((1, 1800), (2, 600))]
        for status in ('accepted', 'partial', 'draft', 'rejected', 'submitted_for_tutor_review'):
            with self.subTest(status=status):
                rows = self.current['project_current'](records, {'C1': {'status': status, 'actual_time_hours': '0.1'}})
                self.assertEqual([row['id'] for row in rows], [2])
                self.assertEqual(rows[0]['actual_seconds'], 360)
                self.assertEqual(rows[0]['accepted'], status in ('accepted', 'partial'))

    def test_single_and_bulk_reads_agree_for_both_learner_types(self):
        owners = [{'id': 1, 'enrolment_id': 101, 'learner_type': 'commercial'},
                  {'id': 2, 'enrolment_id': 102, 'learner_type': 'apprenticeship'}]
        records = {owner['id']: [attempt(1, 1800, learner=owner['id']), attempt(2, 600, learner=owner['id']),
                   {**attempt(3, 120, learner=owner['id']), 'kind': 'quiz_reading', 'passed': None}]
                   for owner in owners}
        self.current['query'] = Mock(return_value=[])
        bulk = self.current['current_records_bulk'](owners, records)
        for owner in owners:
            single = self.current['current_records'](owner, records[owner['id']])
            self.assertEqual(bulk[owner['enrolment_id']], single)
            self.assertEqual([row['actual_seconds'] for row in single], [600, 120])

    def test_retries_are_scoped_to_component_and_learner(self):
        records = [{**attempt(ident, seconds, learner=learner), 'quiz_ref': None,
                    'kind': 'component', 'component_type': 'reading',
                    'component_link_source': 'direct', 'component_ref': component}
                   for ident, seconds, learner, component in (
                       (1, 1800, 1, 'C1'), (2, 600, 1, 'C1'),
                       (3, 900, 2, 'C1'), (4, 1200, 1, 'C2'))]
        rows = self.current['project_current'](records, {})
        self.assertEqual(sorted(row['actual_seconds'] for row in rows), [600, 900, 1200])

    def test_legacy_retries_use_latest_successful_measured_duration(self):
        def saved(ident, seconds, completed=True):
            return {'id': str(ident), 'completed': completed, 'timing': {
                'version': 1, 'verifiedSeconds': seconds,
                'submittedAt': f'2026-10-{ident:02d}T10:00:00Z'}}
        activity = {'group_id': 50, 'activity_id': 60, 'completed': True, 'best_percent': 100,
                    'submitted_at': '2026-10-03T10:00:00Z',
                    'timed_attempts': [saved(3, 60, False), saved(2, 600), saved(1, 1800)]}
        current = self.current['merge_attempts']([], [activity])
        rows = self.reporting['progress_records_with_completion']([], current)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['actual_seconds'], 600)
        self.assertEqual(rows[0]['reporting_ended_at'].day, 2)
        logs = self.reporting['rows_for']({'id': 1}, rows)
        self.assertAlmostEqual(sum(row['actual_hours'] for row in logs), 600 / 3600)

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

    def test_failed_first_choice_does_not_reallocate_stored_history(self):
        historical = {**attempt(1, 1800), 'source_system': 'journal',
                      'actual_seconds': 1800, 'accepted': True, 'reporting_month': '2026-09'}
        rows = self.records([historical, attempt(2, 600, 'new', passed=False)])
        retained = next(row for row in rows if row['id'] == historical['id'])
        self.assertEqual(retained, historical)

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
