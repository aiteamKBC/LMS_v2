"""Synthetic video journal and timed transcripts; all provider calls mocked."""
from unittest.mock import Mock, patch
import base64

from django.test import TestCase

from . import session_captions as captions
from .caption_tracks import recording_captions, webvtt
from .bunny_stream import BunnyStream, VideoImportError
from .models import CurriculumVideoImport

VIDEO = 'c1c2c3c4-1234-5678-abcd-123456789abc'


class SessionCaptionTests(TestCase):
    def setUp(self):
        self.recording = {'id': 'R', 'occurrence_id': 'O', 'artifact_type': 'recording',
            'graph_artifact_id': 'GRAPH', 'content_correlation_id': 'MATCH',
            'created_datetime': '2026-11-10T10:00:00Z', 'end_datetime': '2026-11-10T10:01:00Z'}
        self.transcript = {'id': 'T', 'occurrence_id': 'O', 'artifact_type': 'transcript',
            'content_correlation_id': 'MATCH', 'created_datetime': '2026-11-10T10:00:02Z',
            'metadata': {'lmsTranscriptTimeline': {'version': 1, 'cues': [
                {'start': 0, 'end': 5, 'text': 'Saved words', 'speaker': 'Tutor'}]}}}
        self.asset = CurriculumVideoImport.objects.create(target_kind='live_session', target_id='S',
            component_id='R', fingerprint='synthetic-captions', title='Synthetic lecture', video_id=VIDEO, status='ready',
            scope={'series_id': 'S', 'occurrence_id': 'O', 'graph_artifact_id': 'GRAPH', 'untouched': 'keep'})
        self.client = Mock()
        self.client.video.return_value = {'guid': VIDEO, 'captions': []}
        self.provider = patch.object(captions, 'BunnyStream', return_value=self.client)
        self.provider.start(); self.addCleanup(self.provider.stop)

    def sync(self, *extra):
        captions.sync_series_captions('S', [self.recording, self.transcript, *extra])
        self.asset.refresh_from_db()
        return self.asset.scope.get(captions.JOURNAL, {})

    def test_uploads_once_with_saved_timing_and_keeps_video_and_scope(self):
        self.assertEqual(self.sync()['state'], 'ready')
        self.assertEqual(self.sync()['state'], 'ready')
        self.client.caption.assert_called_once()
        self.assertIn('00:00:02.000 --> 00:00:07.000', self.client.caption.call_args.args[1])
        self.assertEqual(self.asset.video_id, VIDEO)
        self.assertEqual(self.asset.scope['untouched'], 'keep')
        self.client.create.assert_not_called()
        self.client.upload.assert_not_called()

    def test_late_transcript_can_arrive_after_ready_video(self):
        self.transcript['metadata'] = {}
        self.assertEqual(self.sync()['state'], 'waiting')
        self.client.video.assert_not_called()
        self.transcript['metadata'] = {'lmsTranscriptTimeline': {'version': 1, 'cues': [
            {'start': 0, 'end': 1, 'text': 'Late words'}]}}
        self.assertEqual(self.sync()['state'], 'ready')

    def test_pending_matching_part_does_not_publish_partial_caption(self):
        pending = {**self.transcript, 'id': 'PENDING', 'metadata': {}}
        self.assertEqual(self.sync(pending)['state'], 'waiting')
        self.client.caption.assert_not_called()

    def test_other_occurrence_and_unrelated_transcripts_are_not_attached(self):
        self.transcript['occurrence_id'] = 'OTHER'
        self.assertEqual(self.sync()['state'], 'waiting')
        self.transcript['occurrence_id'] = 'O'
        self.transcript['content_correlation_id'] = 'OTHER'
        self.assertEqual(self.sync()['state'], 'waiting')
        self.client.caption.assert_not_called()

    def test_ready_recording_is_checked_even_when_no_graph_sync_is_due(self):
        with patch('curriculum_api.session_results.read', return_value=[self.recording, self.transcript]) as read:
            self.assertEqual(captions.sync_pending_captions(limit=1), 1)
            self.asset.refresh_from_db()
            self.assertEqual(self.asset.scope[captions.JOURNAL]['state'], 'ready')
            self.assertEqual(captions.sync_pending_captions(limit=1), 0)
        self.assertEqual(read.call_count, 1)
        self.client.caption.assert_called_once()

    def test_pending_scan_keeps_explicit_series_scope_and_waits_for_timing(self):
        with patch('curriculum_api.session_results.read') as read:
            self.assertEqual(captions.sync_pending_captions(limit=0), 0)
            self.assertEqual(captions.sync_pending_captions(series_ids=['OTHER']), 0)
            read.assert_not_called()
            read.return_value = [self.recording, {**self.transcript, 'metadata': {}}]
            self.assertEqual(captions.sync_pending_captions(series_ids=['S']), 1)
            self.asset.refresh_from_db()
            self.assertEqual(self.asset.scope[captions.JOURNAL]['state'], 'waiting')
            self.assertEqual(captions.sync_pending_captions(series_ids=['S']), 0)
        self.client.caption.assert_not_called()

    def test_existing_idle_worker_drains_caption_jobs_with_its_original_scope(self):
        from .management.commands import process_session_results as worker
        from contextlib import nullcontext
        cursor = Mock()
        cursor.__enter__ = Mock(return_value=cursor)
        cursor.__exit__ = Mock(return_value=False)
        cursor.fetchone.return_value = None
        connection = Mock()
        connection.cursor.return_value = cursor
        command = worker.Command()
        command.stdout = Mock()
        with patch.object(worker, 'connections', {'default': connection}), \
                patch.object(worker.transaction, 'atomic', return_value=nullcontext()), \
                patch.object(captions, 'sync_pending_captions') as pending:
            command.handle(provision_container=False, scheduled=False, live_session_ids=['S'], limit=2)
        pending.assert_called_once_with(limit=2, series_ids=['S'])
        command.stdout.write.assert_called_once_with('Processed 0 session jobs; 0 need retry.')

    def test_missing_transcript_does_not_starve_the_next_video_in_a_bounded_pass(self):
        other = CurriculumVideoImport.objects.create(target_kind='live_session', target_id='S',
            component_id='OTHER', fingerprint='synthetic-next-caption', title='Second lecture', video_id=VIDEO, status='ready',
            scope={'series_id': 'S', 'occurrence_id': 'O2', 'graph_artifact_id': 'GRAPH2'})
        with patch('curriculum_api.session_results.read', return_value=[self.recording]) as read:
            self.assertEqual(captions.sync_pending_captions(limit=1), 1)
            self.assertEqual(captions.sync_pending_captions(limit=1), 1)
        self.assertEqual([call.args[1][1] for call in read.call_args_list], ['O', 'O2'])
        other.refresh_from_db()
        self.assertEqual(other.scope[captions.JOURNAL]['state'], 'waiting')
        self.client.caption.assert_not_called()

    def test_source_identity_change_cannot_upload_captions(self):
        self.recording['graph_artifact_id'] = 'OTHER'
        self.assertEqual(self.sync(), {})
        self.client.caption.assert_not_called()

    def test_provider_failure_keeps_ready_video_and_schedules_retry(self):
        self.client.caption.side_effect = VideoImportError('Synthetic failure')
        self.assertEqual(self.sync()['state'], 'failed')
        self.assertEqual(self.asset.status, 'ready')
        self.sync()
        self.client.caption.assert_called_once()
        state = self.asset.scope[captions.JOURNAL]
        self.asset.scope[captions.JOURNAL] = {**state, 'retryAfter': 0}
        self.asset.save()
        self.client.caption.side_effect = None
        self.assertEqual(self.sync()['state'], 'ready')
        self.assertEqual(self.client.caption.call_count, 2)

    def test_changed_transcript_updates_track_without_uploading_video(self):
        self.sync()
        self.transcript['metadata']['lmsTranscriptTimeline']['cues'][0]['text'] = 'Corrected words'
        self.assertEqual(self.sync()['state'], 'ready')
        self.assertEqual(self.client.caption.call_count, 2)
        self.client.upload.assert_not_called()

    def test_existing_manual_english_captions_are_retained(self):
        self.client.video.return_value = {'guid': VIDEO, 'captions': [{'srclang': 'en', 'label': 'Reviewed English'}]}
        self.assertEqual(self.sync()['state'], 'retained')
        self.client.caption.assert_not_called()

    def test_live_lease_prevents_second_claim_and_stale_receipt_cannot_win(self):
        first = captions._claim(self.asset.pk, 'one', VIDEO)
        self.assertIsNotNone(first)
        self.assertIsNone(captions._claim(self.asset.pk, 'two', VIDEO))
        captions._finish(self.asset.pk, {**first[1], 'lease': 'stale'}, 'ready')
        self.asset.refresh_from_db()
        self.assertEqual(self.asset.scope[captions.JOURNAL]['state'], 'processing')

    def test_negative_offset_is_clipped_and_html_cannot_become_markup(self):
        self.transcript['created_datetime'] = '2026-11-10T09:59:58Z'
        self.transcript['metadata']['lmsTranscriptTimeline']['cues'][0]['text'] = '<script>bad</script>'
        result = recording_captions(self.recording, [self.recording, self.transcript])
        self.assertIn('00:00:00.000 --> 00:00:03.000', result)
        self.assertNotIn('<script>', result)
        self.assertIsNone(webvtt([{'start': 0, 'end': 0, 'text': 'Invalid'}]))

    def test_caption_transport_sends_base64_vtt_to_same_video_and_checks_validation(self):
        http = Mock()
        http.request.return_value = Mock(status_code=200)
        http.request.return_value.json.return_value = {'success': True, 'data': {'valid': True}}
        client = BunnyStream('798153', 'synthetic', http)
        client.caption(VIDEO, 'WEBVTT\n', label=captions.LABEL)
        call = http.request.call_args
        self.assertTrue(call.args[1].endswith(f'/videos/{VIDEO}/captions/en'))
        self.assertEqual(base64.b64decode(call.kwargs['json']['captionsFile']), b'WEBVTT\n')
        http.request.return_value.json.return_value = {'success': True, 'data': {'valid': False}}
        with self.assertRaises(VideoImportError):
            client.caption(VIDEO, 'WEBVTT\n', label=captions.LABEL)
