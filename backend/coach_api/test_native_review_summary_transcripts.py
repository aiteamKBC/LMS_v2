"""Native review summaries use all transcripts from the linked event."""
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase

from .views import native_review_summary_transcript_ids, stored_coach_meeting_transcript_for_summary


class NativeReviewSummaryTranscriptsTests(SimpleTestCase):
    def setUp(self):
        self.record = SimpleNamespace(
            review_instance_id='review-1', event_key='review:learner:template:1',
            event_type='progress-review', graph_event_id='event-1',
        )

    def artifact(self, artifact_id, call, event='event-1', created='2026-10-29T11:45:00Z'):
        return {'artifact_type': 'transcript', 'graph_artifact_id': artifact_id,
                'call_id': call, 'created_datetime': created,
                'end_datetime': created, 'metadata': {'_lms_graph_event_id': event}}

    def select(self, artifacts, *, reconciliation=None):
        with patch('coach_api.reconciliation_links.for_calendar', return_value=reconciliation), \
             patch('coach_api.views.stored_coach_meeting_snapshot', return_value={'artifacts': artifacts}):
            return native_review_summary_transcript_ids(self.record)

    def test_includes_both_calls_regardless_of_booking_time_and_excludes_other_event(self):
        rows = [self.artifact('first', 'call-1'),
                self.artifact('second', 'call-2', created='2027-01-22T11:00:00Z'),
                self.artifact('other', 'call-3', event='other-event')]
        self.assertEqual(self.select(rows), ['first', 'second'])

    def test_conflicting_duplicate_does_not_produce_partial_summary(self):
        self.assertEqual(self.select([self.artifact('same', 'call-1'),
                                      self.artifact('same', 'call-2')]), [])

    def test_reconciled_or_imported_review_keeps_existing_selection(self):
        self.assertIsNone(self.select([], reconciliation=object()))
        self.record.event_key = 'imported-review:1'
        self.assertIsNone(self.select([]))

    def test_summary_reads_both_transcripts_and_rejects_missing_content(self):
        with patch('coach_api.views.native_review_summary_transcript_ids', return_value=['first', 'second']), \
             patch('coach_api.views.coach_meeting_snapshot_tables_ready', return_value=True), \
             patch('coach_api.views.coach_meeting_artifact_transcript_columns_ready', return_value=True), \
             patch('coach_api.views.connections') as connections:
            cursor = connections.__getitem__.return_value.cursor.return_value.__enter__.return_value
            cursor.fetchall.return_value = [('first', 'First call'), ('second', 'Second call')]
            result = stored_coach_meeting_transcript_for_summary(self.record)
            self.assertEqual(result['text'], 'First call\n\nSecond call')
            cursor.fetchall.return_value = [('first', 'First call')]
            self.assertIsNone(stored_coach_meeting_transcript_for_summary(self.record))
