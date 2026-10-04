"""Synthetic reconciliation regressions; no database/network/application startup."""
from datetime import date, datetime, time, timezone
import unittest

from reconcile_aptem_evidence import make_plan, plan_evidence, summary


def evidence(**updates):
    return dict({'evidence_id': 7, 'component_id': 10, 'evidence_status': 'Accepted',
                 'spent_time': 150, 'hours_type': 'OffTheJobTraining',
                 'spent_time_type': 'PaidWorkingHours',
                 'completed_date': datetime(2026, 6, 11, 23, tzinfo=timezone.utc)}, **updates)


def journal(**updates):
    return dict({'id': 2, 'category': 'attendance', 'activity_date': date(2026, 6, 12),
                 'progress_id': 3, 'source_ref': 'att:synthetic-session',
                 'actual_hours': 2.5, 'accepted': True, 'deleted_at': None}, **updates)


class ReconciliationTests(unittest.TestCase):
    def test_bst_midnight_matches_correct_calendar_date_and_does_not_add_hours(self):
        result = plan_evidence(evidence(), [journal()], set(), {10})
        self.assertEqual((result['progress_id'], result['added_seconds']), (3, 0))
        self.assertEqual((result['end_at'] - result['at']).total_seconds(), 9000)

    def test_zero_audit_hours_remain_authoritative(self):
        result = plan_evidence(evidence(), [journal(actual_hours=0)], set(), {10})
        self.assertEqual(result['journal_seconds'], 0)
        self.assertEqual(result['source_seconds'], 9000)
        self.assertEqual(result['added_seconds'], 0)

    def test_evidence_reference_matches_assignment_despite_changed_reporting_date(self):
        result = plan_evidence(evidence(), [journal(category='assignment',
            source_ref='asg:10:evidence:7', activity_date=date(2026, 5, 20))], {10}, set())
        self.assertEqual(result['resolution'], 'existing_journal')
        self.assertEqual(result['added_seconds'], 0)

    def test_assignment_without_exact_reference_is_not_created_by_title(self):
        with self.assertRaisesRegex(ValueError, 'exact journal'):
            plan_evidence(evidence(), [journal(category='assignment')], {10}, set())

    def test_nearby_attendance_dates_require_review_without_new_hours(self):
        result = plan_evidence(evidence(), [journal(activity_date=date(2026, 6, 10))], set(), {10})
        self.assertEqual(result['resolution'], 'date_review_required')
        self.assertIsNone(result['progress_id'])
        self.assertEqual(result['added_seconds'], 0)

    def test_new_independent_attendance_uses_recorded_minutes(self):
        result = plan_evidence(evidence(), [journal(activity_date=date(2026, 6, 5))], set(), {10})
        self.assertEqual(result['resolution'], 'new_attendance')
        self.assertEqual(result['added_seconds'], 9000)
        self.assertEqual((result['end_at'] - result['at']).total_seconds(), 9000)

    def test_attendance_can_be_anchored_to_the_london_session_start(self):
        result = plan_evidence(evidence(), [journal(activity_date=date(2026, 6, 5))], set(), {10}, time(12, 0))
        self.assertEqual(result['at'].hour, 12)
        self.assertEqual(result['at'].minute, 0)
        self.assertEqual((result['end_at'] - result['at']).total_seconds(), 9000)

    def test_deleted_journal_is_not_revived(self):
        with self.assertRaisesRegex(ValueError, 'deleted'):
            plan_evidence(evidence(), [journal(deleted_at='deleted')], set(), {10})

    def test_active_replacement_wins_over_historical_deleted_duplicate(self):
        result = plan_evidence(evidence(), [journal(deleted_at='deleted'), journal(id=4)], set(), {10})
        self.assertEqual(result['journal_id'], 4)

    def test_multiple_active_date_matches_are_not_guessed(self):
        with self.assertRaisesRegex(ValueError, 'Multiple'):
            plan_evidence(evidence(), [journal(), journal(id=4)], set(), {10})

    def test_unknown_pending_or_unpaid_sources_cannot_add_completed_hours(self):
        for item in (evidence(component_id=99), evidence(evidence_status='PendingAssessment'),
                     evidence(hours_type='None'), evidence(spent_time_type='OwnTimeBeingPaid'),
                     evidence(spent_time=-1)):
            with self.subTest(item=item), self.assertRaises(ValueError):
                plan_evidence(item, [], set(), {10})

    def test_rerun_does_not_create_more_progress_or_hours(self):
        state = {'evidence': [evidence()], 'journals': [], 'progress': [], 'sources': [
            {'source_system': 'aptem', 'source_activity_id': 'evidence:7',
             'source_payload': {'Id': 7}, 'deleted_at': None}]}
        result = make_plan(state, set(), {10})
        self.assertEqual(result, [{'evidence_id': 7, 'resolution': 'already_present', 'added_seconds': 0}])

    def test_foreign_or_deleted_progress_is_rejected(self):
        state = {'evidence': [evidence()], 'journals': [journal()], 'progress': [], 'sources': []}
        with self.assertRaisesRegex(ValueError, 'owner/deletion'):
            make_plan(state, set(), {10})

    def test_rerun_keeps_unresolved_source_visible_in_review_report(self):
        state = {'evidence': [evidence()], 'journals': [], 'progress': [], 'segments': [], 'sources': [
            {'source_system': 'aptem', 'source_activity_id': 'evidence:7', 'canonical_progress_id': None,
             'source_payload': {'Id': 7, 'reconciliation': {'resolution': 'date_review_required'}},
             'deleted_at': None}]}
        result = summary(state, make_plan(state, set(), {10}))
        self.assertEqual(result['added_seconds'], 0)
        self.assertEqual(result['review_evidence_ids'], [7])

    def test_existing_non_journal_date_is_not_double_counted(self):
        state = {'evidence': [evidence()], 'journals': [], 'progress': [], 'sources': [
            {'source_system': 'aptem', 'source_activity_id': 'evidence:99',
             'source_payload': {'Id': 99, 'ComponentId': 10}, 'deleted_at': None,
             'reporting_started_at': evidence()['completed_date']}]}
        with self.assertRaisesRegex(ValueError, 'already covers'):
            make_plan(state, set(), {10})

    def test_attendance_window_rejects_an_overlapping_activity(self):
        state = {'evidence': [evidence()], 'journals': [], 'progress': [], 'sources': [
            {'source_system': 'old_lms', 'source_activity_id': 'material:99',
             'source_payload': {'ComponentId': 99}, 'deleted_at': None,
             'reporting_started_at': datetime(2026, 6, 12, 12, 30, tzinfo=timezone.utc),
             'reporting_ended_at': datetime(2026, 6, 12, 13, 0, tzinfo=timezone.utc)}]}
        with self.assertRaisesRegex(ValueError, 'overlaps this attendance window'):
            make_plan(state, set(), {10}, time(12, 0))

    def test_segments_replace_parent_hours_in_before_after_summary(self):
        state = {'evidence': [], 'journals': [], 'progress': [
            {'id': 1, 'accepted': True, 'deleted_at': None, 'actual_seconds': 9000},
            {'id': 2, 'accepted': False, 'deleted_at': None, 'actual_seconds': 8000}],
            'segments': [{'progress_id': 1, 'actual_seconds': 3000},
                         {'progress_id': 1, 'actual_seconds': 4000}]}
        result = summary(state, [{'evidence_id': 7, 'resolution': 'new_attendance', 'added_seconds': 9000}])
        self.assertEqual(result['accepted_seconds_before'], 7000)
        self.assertEqual(result['accepted_seconds_after'], 16000)


if __name__ == '__main__':
    unittest.main()
