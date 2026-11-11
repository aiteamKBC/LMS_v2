"""Synthetic repair regressions; no database, Django setup or network."""
from copy import deepcopy
import unittest

from .activity_hours_repair import approved_seconds, build_plan, plan_row


class ActivityHoursRepairTests(unittest.TestCase):
    def row(self, **changes):
        return {'id': 1, 'learner_id': 101, 'identity_valid': True, 'accepted': True,
                'source_system': 'new_lms', 'source_activity_id': 'activity:1', 'source_attempt_key': 'attempt:1',
                'kind': 'component', 'component_ref': 'assignment:1', 'component_type': 'assignment',
                'actual_seconds': None, 'actual_basis': '', 'reporting_month': '',
                'reporting_started_at': None, 'reporting_ended_at': None,
                'submitted_at': '2026-09-20T12:00:00Z', 'protected_months': [],
                'marking': {'id': 10, 'status': 'accepted', 'actual_time_hours': '0.5'}, **changes}

    def source(self, **changes):
        return {'id': 20, 'learner_id': 101, 'canonical_progress_id': 1,
                'source_system': 'new_lms', 'source_activity_id': 'activity:1', 'source_attempt_key': 'attempt:1',
                'reporting_month': '2026-08', 'reporting_started_at': '2026-08-10T09:00:00Z',
                'reporting_ended_at': '2026-08-10T09:30:00Z', **changes}

    def test_approved_import_gets_real_duration_and_completion_month(self):
        row = self.row()
        before = deepcopy(row)
        change, reason = plan_row(row)
        self.assertIsNone(reason)
        self.assertEqual(change['after']['actual_seconds'], 1800)
        self.assertEqual(change['after']['reporting_month'], '2026-09')
        self.assertNotIn('accepted', change['after'])
        self.assertNotIn('claimed_seconds', change['after'])
        self.assertEqual(row, before)

    def test_approved_total_is_allocated_to_the_single_dated_month(self):
        row = self.row(marking={'id': 10, 'status': 'partial', 'actual_time_hours': '0.5',
            'dated_entries': [{'date': '2026-08-20', 'hours': '5'}, {'date': '2026-08-21', 'hours': '3'}]})
        change, reason = plan_row(row)
        self.assertIsNone(reason)
        self.assertEqual(change['after']['actual_seconds'], 1800)
        self.assertEqual(change['after']['reporting_month'], '2026-08')
        self.assertNotIn('reporting_started_at', change['after'])

    def test_cross_month_or_future_assignment_claims_require_review(self):
        for entries, expected in [
            ([{'date': '2026-08-31'}, {'date': '2026-09-01'}], 'assignment_spans_multiple_months'),
            ([{'date': '2027-05-01'}], 'assignment_dates_after_completion'),
            ([{'date': '2026-02-30'}], 'invalid_assignment_dates'),
        ]:
            row = self.row(marking={'status': 'accepted', 'actual_time_hours': '1', 'dated_entries': entries})
            self.assertEqual(plan_row(row), (None, expected))

    def test_existing_hours_are_assigned_without_changing_their_value(self):
        change, reason = plan_row(self.row(actual_seconds=1800, sources=[self.source()]))
        self.assertIsNone(reason)
        self.assertEqual(change['after']['reporting_month'], '2026-08')
        self.assertNotIn('actual_seconds', change['after'])
        self.assertEqual(change['after']['reporting_started_at'].isoformat(), '2026-08-10T10:00:00+01:00')

    def test_exact_source_attempt_wins_over_another_merged_source(self):
        sources = [self.source(), self.source(id=21, source_system='old_lms', source_activity_id='other',
                                             source_attempt_key='other', reporting_month='2025-11')]
        change, _ = plan_row(self.row(actual_seconds=1800, sources=sources))
        self.assertEqual(change['month'], '2026-08')

    def test_conflicting_equally_owned_sources_are_not_guessed(self):
        sources = [self.source(), self.source(id=21, reporting_month='2026-09')]
        self.assertEqual(plan_row(self.row(actual_seconds=1800, sources=sources)),
                         (None, 'conflicting_source_months'))

    def test_other_learner_source_cannot_supply_the_month(self):
        self.assertEqual(plan_row(self.row(actual_seconds=1800, submitted_at=None,
                                          sources=[self.source(learner_id=102)])), (None, 'date_unavailable'))

    def test_business_timezone_and_declared_completion_choose_the_month(self):
        change, _ = plan_row(self.row(submitted_at='2026-08-31T23:30:00Z'))
        self.assertEqual(change['month'], '2026-09')
        change, _ = plan_row(self.row(submitted_at='2026-10-01T10:00:00Z',
                                      declared_completed_at='2026-09-30T13:00:00+01:00'))
        self.assertEqual(change['month'], '2026-09')

    def test_no_naive_or_missing_date_is_assigned_a_machine_timezone(self):
        for value in (None, '2026-09-30T12:00:00', 'invalid'):
            self.assertEqual(plan_row(self.row(submitted_at=value)), (None, 'date_unavailable'))

    def test_locks_identity_transfer_segments_and_retake_decisions_are_preserved(self):
        for updates in ({'identity_valid': False}, {'accepted': False}, {'transfer_active': True},
                        {'has_segments': True}, {'has_retake_choices': True}, {'protected_months': ['2026-09']},
                        {'other_credit': True}, {'actual_basis': 'staff:module-progress'}):
            with self.subTest(updates=updates):
                self.assertIsNone(plan_row(self.row(**updates))[0])

    def test_zero_is_not_missing_and_an_unapproved_assignment_is_not_awarded(self):
        self.assertEqual(plan_row(self.row(actual_seconds=0)), (None, 'preserve_recorded_zero'))
        for status in ('draft', 'submitted_for_tutor_review', 'returned', 'rejected'):
            self.assertEqual(plan_row(self.row(marking={'status': status, 'actual_time_hours': 5})),
                             (None, 'assignment_not_approved'))

    def test_verified_study_time_respects_timer_input_and_quiz_success(self):
        row = self.row(kind='quiz', component_type='', passed=True, verified_seconds=90, claimed_seconds=300,
                       time_tracking_source='signed_session_capped_active_quiz')
        self.assertEqual(plan_row(row)[0]['after']['actual_seconds'], 90)
        row['time_tracking_source'] += ':timer'
        self.assertEqual(plan_row(row)[0]['after']['actual_seconds'], 300)
        row['passed'] = False
        self.assertIsNone(plan_row(row)[0])
        row.update(passed=True, time_tracking_source='mba_import_bounded_by_authored_otjh')
        self.assertIsNone(plan_row(row)[0])

    def test_duplicate_incomplete_attempts_are_not_added_together(self):
        plan = build_plan([self.row(), self.row(id=2)])
        self.assertEqual(plan['changes'], [])
        self.assertEqual(plan['skipped'], {'multiple_incomplete_attempts': 2})

    def test_same_activity_reference_for_another_learner_is_independent(self):
        plan = build_plan([self.row(), self.row(id=2, learner_id=102)])
        self.assertEqual(len(plan['changes']), 2)

    def test_quiz_and_component_references_use_distinct_namespaces(self):
        plan = build_plan([self.row(component_ref='1'), self.row(id=2, component_ref=None, quiz_ref='1')])
        self.assertEqual(len(plan['changes']), 2)

    def test_plan_is_idempotent_and_fingerprint_detects_evidence_changes(self):
        row = self.row()
        plan = build_plan([row])
        applied = {**row, **plan['changes'][0]['after']}
        self.assertEqual(build_plan([applied])['changes'], [])
        changed = self.row(marking={'id': 10, 'status': 'accepted', 'actual_time_hours': '1'})
        self.assertNotEqual(plan['fingerprint'], build_plan([changed])['fingerprint'])

    def test_duration_units_and_invalid_values(self):
        for value, expected in [('0.5', 1800), ('30:00', 1800), ('01:30:00', 5400)]:
            self.assertEqual(approved_seconds(value), expected)
        for value in (None, '', True, '-1', 'NaN', 'Infinity', '1:90:00', '10:90', 'unknown'):
            self.assertIsNone(approved_seconds(value))


if __name__ == '__main__':
    unittest.main()
