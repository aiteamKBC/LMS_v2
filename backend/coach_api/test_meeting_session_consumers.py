"""D03 regression tests: persisted evidence, never Graph/AI/live databases."""
from contextlib import ExitStack
from datetime import date, time
import hashlib
import inspect
import json
from contextlib import nullcontext
from unittest.mock import patch

from django.test import SimpleTestCase, RequestFactory, override_settings

from . import views
from .models import CoachCalendarEvent


@override_settings(TIME_ZONE='UTC')
class SessionConsumerTests(SimpleTestCase):
    def setUp(self):
        self.record = CoachCalendarEvent(id=7, event_key='review:42:template:1', owner_email='coach@example.invalid',
            learner_id=42, event_type='mcr', graph_event_id='graph-current',
            scheduled_date=date(2026, 10, 24), scheduled_time=time(10), duration_minutes=60)
        self.current = self.artifact('current', '2026-10-24T10:05:00Z', 'call-current')
        self.old = self.artifact('old', '2026-10-23T10:05:00Z', 'call-old')
        self.snapshot = {'artifacts': [self.old, self.current], 'attendanceReports': []}
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        for name in ('coach_meeting_snapshot_tables_ready', 'coach_meeting_artifact_transcript_columns_ready', 'coach_meeting_summaries_table_ready'):
            self.stack.enter_context(patch.object(views, name, return_value=True))
        self.stack.enter_context(patch.object(views, 'stored_coach_meeting_snapshot', side_effect=lambda record: self.snapshot))
        self.connections = self.stack.enter_context(patch.object(views, 'connections'))
        self.cursor = self.connections.__getitem__.return_value.cursor.return_value.__enter__.return_value
        self.cursor.fetchall.return_value = [('current', 'Current session only')]

    def artifact(self, key, at, call):
        return dict(artifact_type='transcript', graph_artifact_id=key, call_id=call,
                    created_datetime=at, end_datetime=at, metadata={'_lms_graph_event_id': 'graph-current'})

    def test_default_reader_selects_current_session_before_reading_text(self):
        self.assertEqual(views.stored_coach_meeting_transcript_for_summary(self.record)['text'], 'Current session only')
        sql, params = self.cursor.execute.call_args.args
        self.assertIn('graph_artifact_id IN', sql)
        self.assertIn('current', params)
        self.assertNotIn('old', params)

    def test_ambiguous_or_undated_or_rescheduled_selection_reads_no_text(self):
        for artifacts in ([self.current, self.artifact('other', '2026-10-24T10:10:00Z', 'call-other')],
                          [self.artifact('unknown', '', '')], [self.old]):
            with self.subTest(artifacts=artifacts):
                self.snapshot['artifacts'] = artifacts
                self.assertIsNone(views.stored_coach_meeting_transcript_for_summary(self.record))
                self.cursor.execute.assert_not_called()

    def test_graph_event_change_cannot_reuse_stored_artifacts(self):
        self.current['metadata']['_lms_graph_event_id'] = 'graph-replaced'
        self.assertIsNone(views.stored_coach_meeting_transcript_for_summary(self.record))
        self.cursor.execute.assert_not_called()

    def test_segments_of_the_selected_call_remain_available(self):
        self.snapshot['artifacts'].append(self.artifact('segment', '2026-10-24T11:10:00Z', 'call-current'))
        self.cursor.fetchall.return_value = [('current', 'First'), ('segment', 'Second')]
        result = views.stored_coach_meeting_transcript_for_summary(self.record)
        self.assertIn('First', result['text'])
        self.assertIn('Second', result['text'])
        params = self.cursor.execute.call_args.args[1]
        self.assertIn('segment', params)
        self.assertNotIn('old', params)

    def test_combined_download_fails_closed_for_two_calls(self):
        self.snapshot['artifacts'] = [self.current, self.artifact('other', '2026-10-24T10:10:00Z', 'other')]
        response = views.coach_meeting_artifact_content_response(RequestFactory().get('/'), self.record,
            self.record.event_key, 'transcript', 'combined')
        self.assertEqual(response.status_code, 409)
        self.cursor.execute.assert_not_called()

    def test_individual_download_rejects_other_call_before_storage_or_graph(self):
        with patch.object(views, 'stored_coach_meeting_transcript') as read, patch.object(views, 'coach_meeting_graph_target') as graph:
            response = views.coach_meeting_artifact_content_response(RequestFactory().get('/'), self.record,
                self.record.event_key, 'transcript', 'old')
            self.assertEqual(response.status_code, 404)
            read.assert_not_called()
            graph.assert_not_called()

    def test_summary_cache_requires_selected_artifact_hash_and_graph_identity(self):
        content_hash = hashlib.sha256(b'Current session only').hexdigest()
        for graph, artifact, digest in [('graph-old', 'current', content_hash),
                                        ('graph-current', 'old', content_hash),
                                        ('graph-current', 'current', 'wrong-hash')]:
            self.cursor.fetchone.return_value = ({'overview': 'Cached'}, 'ready', None, None, '', 'model', '', graph, artifact, digest)
            self.assertIsNone(views.stored_coach_meeting_summary(self.record))

    def test_summary_with_verified_single_artifact_provenance_is_reused(self):
        self.cursor.fetchone.return_value = ({'overview': 'Cached'}, 'edited', None, None, '', 'model', '',
            'graph-current', 'current', hashlib.sha256(b'Current session only').hexdigest())
        self.assertEqual(views.stored_coach_meeting_summary(self.record)['status'], 'edited')

    def test_imported_cache_rejects_changed_call_without_touching_answers(self):
        from .migrated_session_scope import summary_matches_session
        state = {'source': 'teams', 'eventKey': self.record.event_key, 'graphEventId': 'graph-current',
                 'transcriptArtifactId': 'current', 'transcriptHash': hashlib.sha256(b'Current session only').hexdigest()}
        transcript = {'artifactId': 'current', 'text': 'Current session only'}
        self.assertTrue(summary_matches_session(state, self.record, transcript))
        for key, value in [('graphEventId', 'old'), ('transcriptArtifactId', 'old'), ('transcriptHash', 'wrong')]:
            self.assertFalse(summary_matches_session({**state, key: value}, self.record, transcript))
        self.assertFalse(summary_matches_session(state, self.record, None))

    def test_edited_cache_from_another_session_never_triggers_ai_or_update(self):
        self.cursor.fetchone.return_value = ('old-hash', 'edited', {'overview': 'Historical manual edit'})
        with patch.object(views, 'stored_coach_meeting_summary', return_value=None), patch.object(views, 'openai_meeting_summary') as ai:
            self.assertIsNone(views.ensure_coach_meeting_summary(self.record))
        ai.assert_not_called()
        self.assertFalse(any('INSERT' in call.args[0] for call in self.cursor.execute.call_args_list))

    def test_native_generation_sends_only_selected_session_to_ai(self):
        self.cursor.fetchone.return_value = None
        with patch.object(views, 'stored_coach_meeting_summary', return_value=None), \
                patch.object(views.transaction, 'atomic', return_value=nullcontext()), \
                patch.object(views, 'openai_meeting_summary', return_value=({'overview': 'Current recap'}, 'mock-model')) as ai:
            views.ensure_coach_meeting_summary(self.record)
        ai.assert_called_once_with(self.record, 'Current session only')
        text_queries = [call.args[1] for call in self.cursor.execute.call_args_list if 'SELECT graph_artifact_id' in call.args[0]]
        self.assertEqual(text_queries, [[self.record.event_key, 'graph-current', 'current']])

    def test_native_previous_uses_selected_previous_call_without_live_services(self):
        current = dict(id='current-review', review_template_id='template', learner_id=42,
                       occurrence_number=2, coach_email=self.record.owner_email)
        previous = {**current, 'id': 'previous-review', 'occurrence_number': 1, 'status': 'completed'}
        with patch.object(views, '_authorized_review_instance', return_value=(current, None)), \
                patch.object(views.curriculum_review_instances, 'find_review_instance', return_value=previous), \
                patch.object(views.curriculum_review_instances, 'review_instance_form_definition', return_value={'sections': [], 'template': {}}), \
                patch.object(views, '_review_instance_calendar_record', return_value=self.record), \
                patch.object(views, 'stored_coach_meeting_summary', return_value=None), \
                patch.object(views, 'fetch_coach_meeting_graph_snapshot') as graph, patch.object(views, 'openai_meeting_summary') as ai:
            response = inspect.unwrap(views.coach_review_instance_previous)(RequestFactory().get('/'), 'current-review')
        self.assertEqual(json.loads(response.content)['transcriptText'], 'Current session only')
        self.assertNotIn('old', self.cursor.execute.call_args.args[1])
        graph.assert_not_called()
        ai.assert_not_called()
