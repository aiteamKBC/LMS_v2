"""Assignment links preserve the canonical month and hour decisions."""
from copy import deepcopy
from unittest import TestCase
from unittest.mock import patch

from .assignment_monthly_targets import submission_links
from . import canonical_learning as canonical, current_learning


class AssignmentMonthlyTargetTests(TestCase):
    owner = {'id': 1, 'learner_type': 'commercial'}
    targets = [{'id': 10, 'report_month': '2026-10'}, {'id': 11, 'report_month': '2026-11'}]

    def submission(self, **values):
        return dict(id='s1', learner_kind='commercial', activity_type='assignment',
                    status='accepted', progress_entry_id=None, component_ref=None, **values)

    def link(self, submission, records):
        return submission_links([submission], records, self.owner, self.targets)[0]['target_id']

    def test_pending_and_accepted_submissions_link_without_changing_the_hour_verdict(self):
        for status, accepted in [('submitted_for_tutor_review', False), ('accepted', True), ('partial', True)]:
            submission = {**self.submission(), 'status': status, 'submitted_at': '2026-09-30T23:30:00Z',
                          'activity_month': '2026-11', 'actual_time_hours': '1.5'}
            records = current_learning.merge_submissions([], [submission])
            before = deepcopy(records)
            self.assertEqual(self.link(submission, records), 10)  # UK October; preserve current allocation.
            self.assertEqual(records[0]['accepted'], accepted)
            self.assertEqual(records[0]['actual_seconds'], 5400)
            self.assertEqual(records, before)

    def test_progress_and_imported_lineage_use_canonical_month_not_submission_date(self):
        record = {'id': 17, 'reporting_month': '2026-10', 'actual_seconds': 7200,
                  'source_payload': {'original_source_ref': 'reflection:s1'}}
        submission = {**self.submission(), 'progress_entry_id': 17, 'submitted_at': '2026-11-02T00:00:00Z'}
        self.assertEqual(self.link(submission, [record]), 10)
        record['source_payload'] = {}
        self.assertEqual(self.link(submission, [record]), 10)

    def test_completion_reallocation_relinks_the_existing_contribution(self):
        record = {'id': 17, 'reporting_month': '2026-10', 'submitted_at': '2026-11-02T12:00:00Z',
                  'declared_completed_at': '2026-11-01T00:30:00Z'}
        self.assertEqual(self.link({**self.submission(), 'progress_entry_id': 17}, [record]), 11)

    def test_component_dedup_links_multiple_topics_without_adding_hour_records(self):
        record = {'id': 17, 'component_ref': 'assignment:A', 'reporting_month': '2026-10', 'actual_seconds': 3600}
        submissions = [{**self.submission(), 'id': ident, 'component_ref': 'assignment:A'} for ident in ('s1', 's2')]
        self.assertEqual(submission_links(submissions, [record], self.owner, self.targets),
                         [{'id': 's1', 'target_id': 10}, {'id': 's2', 'target_id': 10}])
        self.assertEqual(record['actual_seconds'], 3600)

    def test_draft_other_kind_changed_type_missing_history_and_absent_targets_stay_unlinked(self):
        record = {'id': 'reflection:s1', 'reporting_month': '2026-10'}
        for override in ({'status': 'draft'}, {'learner_kind': 'apprenticeship'}, {'activity_type': 'extra_activity'}):
            self.assertIsNone(self.link({**self.submission(), **override}, [record]))
        self.assertIsNone(self.link(self.submission(), []))
        self.assertIsNone(self.link(self.submission(), [{**record, 'reporting_month': '2026-12'}]))
        self.assertIsNone(self.link(self.submission(), [{**record, 'completion_only': True}]))

    def test_ambiguous_component_or_multiple_allocations_do_not_guess_a_month(self):
        records = [{'id': ident, 'component_ref': 'A', 'reporting_month': month}
                   for ident, month in ((17, '2026-10'), (18, '2026-11'))]
        self.assertIsNone(self.link({**self.submission(), 'component_ref': 'A'}, records))
        with patch.object(canonical, 'allocations', return_value=records):
            self.assertIsNone(self.link({**self.submission(), 'progress_entry_id': 17}, records))
