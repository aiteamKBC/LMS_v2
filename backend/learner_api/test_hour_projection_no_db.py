"""Stored-hour shortcuts must retain the learner's timing and frozen history."""
from copy import deepcopy
from unittest import TestCase
from unittest.mock import patch

from coach_api.otjh_ksb import read_hour_totals
from learner_api import canonical_learning as canonical
from learner_api.canonical_hours import full_hour_projection_ids
from learner_api.current_learning import merge_attempts


class HourProjectionTests(TestCase):
    owner = {'id': 101, 'enrolment_id': 201, 'aptem_id': 301,
             'learner_type': 'commercial', 'email': 'synthetic@example.test',
             'account_record_id': 201, 'account_email': 'synthetic@example.test',
             'account_aptem_id': 301}

    def timed_records(self, *, mode=None, seconds=900):
        stored = {'id': 1, 'accepted': True, 'actual_seconds': 3600,
                  'reporting_month': '2026-09', 'source_system': 'old_lms',
                  'source_payload': {'original_source_ref': 'la:10:20'}}
        timing = {'version': 1, 'verifiedSeconds': seconds, 'countedSeconds': seconds,
                  'timeTrackingSource': 'signed_session_capped_visible_page',
                  'submittedAt': '2026-11-01T10:00:00Z',
                  'declaredCompletedAt': '2026-10-31T23:30:00Z'}
        if mode:
            timing['retakeTimeChoice'] = mode
        attempts = [{'group_id': 10, 'activity_id': 20, 'catalogue_kind': 'material',
                     'completed': True, 'submitted_at': timing['submittedAt'],
                     'timed_attempts': [{'id': 2, 'completed': True, 'timing': timing}]}]
        return canonical.progress_records_with_completion([stored], merge_attempts([stored], attempts))

    def test_completed_local_timing_selects_only_its_owner_without_retake_flag(self):
        owners = [self.owner, {**self.owner, 'id': 102, 'enrolment_id': 202}]
        with patch.object(canonical, 'query', side_effect=[
            [], [{'name': 'Learner.subject_activity_attempts'}], [{'enrolment_id': 201}],
        ]) as query:
            self.assertEqual(full_hour_projection_ids(owners), {101})
        sql, params = query.call_args.args
        self.assertIn('completed IS TRUE', sql)
        self.assertIn('submitted_at IS NOT NULL', sql)
        self.assertIn("jsonb_typeof(definition->'studyTime')='object'", sql)
        self.assertEqual(params, [[201, 202]])

    def test_transfer_requires_reconciliation_even_without_any_timed_attempt(self):
        with patch.object(canonical, 'query', side_effect=[[], [{'name': None}]]):
            self.assertEqual(full_hour_projection_ids([
                {**self.owner, 'progress_transfer_active': True},
            ]), {101})

    def test_compact_actual_includes_local_timing_without_recrediting_history(self):
        records = self.timed_records()
        before = deepcopy(records)
        with patch.object(canonical, 'query', side_effect=[
            [self.owner], [], [{'name': 'Learner.subject_activity_attempts'}],
            [{'enrolment_id': 201}], [{'learner_id': 101, 'actual_seconds': 3600}],
            [], [], [],
        ]), patch.object(canonical, 'entries_for', return_value=records) as entries, \
             patch('coach_api.migrated_otjh.planned_hours_bulk', return_value={}):
            result = canonical.otjh_summary_bulk([201])[201]
        self.assertEqual(result['actual'], 1.25)
        self.assertEqual(records, before)
        entries.assert_called_once_with(self.owner, lineage_only=True)

    def test_monthly_totals_preserve_history_and_the_declared_completion_month(self):
        records = self.timed_records()
        with patch.object(canonical, 'query', side_effect=[
            [], [{'name': 'Learner.subject_activity_attempts'}], [{'enrolment_id': 201}],
        ]), patch.object(canonical, 'entries_for', return_value=records):
            months = {row['month']: row for row in read_hour_totals(self.owner)}
        self.assertEqual(months['2026-09']['completed'], 1)
        self.assertEqual(months['2026-10']['completed'], .25)
        self.assertNotIn('2026-11', months)

    def test_selected_retake_replaces_history_and_frozen_transfers_are_not_readded(self):
        for records, expected in ((self.timed_records(mode='new'), .25),
                                  ([{'id': 1, 'actual_seconds': 1800, 'accepted': True,
                                     'reporting_month': '2026-09'}], .5)):
            with self.subTest(expected=expected), \
                 patch.object(canonical, 'query', side_effect=[[], [{'name': None}]]), \
                 patch.object(canonical, 'entries_for', return_value=records):
                months = read_hour_totals({**self.owner, 'progress_transfer_active': True})
            self.assertEqual(sum(row['completed'] for row in months), expected)

    def test_empty_owners_do_not_query(self):
        with patch.object(canonical, 'query') as query:
            self.assertEqual(full_hour_projection_ids([]), set())
        query.assert_not_called()
