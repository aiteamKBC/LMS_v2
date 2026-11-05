"""Synthetic recordings only; Microsoft, Bunny and archive writes are mocked."""
import io
import os
import sqlite3
from contextlib import nullcontext
from datetime import datetime, timezone
from unittest.mock import Mock, patch

from django.test import TestCase

from . import session_bunny, video_imports
from .bunny_stream import VideoImportError
from .models import CurriculumVideoImport
from .session_bunny_policy import bunny_recording, recording_uses_bunny, signed_embed
from .session_recording_source import RecordingRedirect, download_recording, resolve_recording_download

VIDEO = 'c1c2c3c4-1234-5678-abcd-123456789abc'
MP4 = b'\x00\x00\x00\x20ftypisom' + b'x' * 64


class SessionBunnyTests(TestCase):
    def setUp(self):
        self.series = {'id': 'S', 'module_catalogue_id': 'M', 'module_title': 'Example module',
                       'online_meeting_id': 'MEETING', 'organizer_email': 'owner@example.invalid', 'join_url': ''}
        self.occurrence = {'id': 'O', 'scheduled_start': '2026-11-05T10:00:00Z', 'session_number': 3}
        self.artifact = {'id': 'A', 'occurrence_id': 'O', 'artifact_type': 'recording', 'graph_artifact_id': 'REC'}
        self.module = {'programme_id': 'P', 'programme_name': 'Example programme', 'group_id': 'G',
                       'group_name': 'Example group', 'cohort_id': 'C', 'cohort_name': 'Example cohort'}
        self.components = patch('curriculum_api.session_results.read', return_value=[{'id': 'COMP', 'week_id': 'WEEK'}])
        self.read = self.components.start(); self.addCleanup(self.components.stop)
        self.owner = patch('curriculum_api.views.teams_online_meeting_owner_id', return_value='OWNER')
        self.owner.start(); self.addCleanup(self.owner.stop)
        self.environment = patch.dict(os.environ, BUNNY_STREAM_ENABLED='true')
        self.environment.start(); self.addCleanup(self.environment.stop)

    def asset(self):
        return session_bunny.enqueue_recording(self.series, self.occurrence, self.artifact, self.module)

    def test_queue_reuses_recording_identity_and_keeps_component_week_scope(self):
        one, two = self.asset(), self.asset()
        self.assertEqual(one.pk, two.pk)
        self.assertEqual(CurriculumVideoImport.objects.count(), 1)
        self.assertEqual(one.scope['component_ids'], 'COMP')
        self.assertEqual(one.scope['week_ids'], 'WEEK')
        self.assertEqual(one.target_kind, 'live_session')
        self.assertTrue(one.source_url.startswith('https://graph.microsoft.com/'))
        other = session_bunny.enqueue_recording(self.series, {**self.occurrence, 'id': 'OTHER'},
                                                {**self.artifact, 'id': 'B', 'occurrence_id': 'OTHER'}, self.module)
        self.assertNotEqual(one.pk, other.pk)

    def test_disabled_bunny_refuses_instead_of_silently_using_azure(self):
        with patch.dict(os.environ, BUNNY_STREAM_ENABLED='false'):
            with self.assertRaisesRegex(VideoImportError, 'no Azure fallback'):
                self.asset()
        self.assertEqual(CurriculumVideoImport.objects.count(), 0)

    def test_two_graph_ids_for_same_call_and_content_share_one_import(self):
        self.artifact.update(content_correlation_id='CONTENT', call_id='CALL')
        first = self.asset()
        second = session_bunny.enqueue_recording(self.series, self.occurrence,
            {**self.artifact, 'id': 'ALIAS', 'graph_artifact_id': 'OTHER_GRAPH_ID'}, self.module)
        self.assertEqual(first.pk, second.pk)
        other_call = session_bunny.enqueue_recording(self.series, self.occurrence,
            {**self.artifact, 'id': 'OTHER', 'call_id': 'DIFFERENT_CALL'}, self.module)
        self.assertNotEqual(first.pk, other_call.pk)

    def test_cutover_is_lecture_date_not_late_discovery_date(self):
        self.assertTrue(recording_uses_bunny(self.occurrence, self.artifact))
        self.assertFalse(recording_uses_bunny({'scheduled_start': '2026-11-04T23:59:59Z'}, self.artifact))
        self.assertFalse(recording_uses_bunny(self.occurrence, {**self.artifact, 'artifact_type': 'transcript'}))

    def test_existing_session_worker_routes_new_recording_to_bunny_even_when_azure_copy_exists(self):
        from .session_archive import archive_series
        with patch('curriculum_api.session_archive.read', side_effect=[
                [self.series], [self.module], [self.occurrence], [{**self.artifact, 'saved_status': 'ready'}]]), \
             patch('curriculum_api.session_archive.storage_client', side_effect=AssertionError('Azure forbidden')), \
             patch.object(session_bunny, 'enqueue_recording', return_value=Mock(pk='IMPORT')) as enqueue, \
             patch.object(video_imports, 'process', return_value=Mock(status='ready')) as process:
            self.assertEqual(archive_series('S', artifact_ids=['A']), [])
        enqueue.assert_called_once()
        process.assert_called_once_with('IMPORT', session_lease_id=None)

    def test_queue_failure_remains_visible_without_using_azure(self):
        from .session_archive import archive_series
        with patch('curriculum_api.session_archive.read', side_effect=[
                [self.series], [self.module], [self.occurrence], [{**self.artifact, 'saved_status': 'ready'}]]), \
             patch('curriculum_api.session_archive.storage_client', side_effect=AssertionError('Azure forbidden')), \
             patch.object(session_bunny, 'enqueue_recording', side_effect=VideoImportError('Bunny is disabled.')):
            self.assertEqual(archive_series('S', artifact_ids=['A']), ['Bunny is disabled.'])

    def test_separate_occurrence_join_cannot_borrow_series_meeting(self):
        with self.assertRaisesRegex(VideoImportError, 'incomplete'):
            session_bunny.source_identity(self.series, {'join_url': 'https://teams.microsoft.com/meet/different'}, self.artifact)

    def transfer(self, client, *, download_error=None, fetch_url=None):
        row = {**self.series, **self.artifact, 'occurrence_join_url': '', 'occurrence_meeting_id': ''}
        self.read.return_value = [row]
        with patch.object(session_bunny, 'BunnyStream', return_value=client), \
             patch('coach_api.views.microsoft_graph_token', return_value='synthetic'), \
             patch.object(session_bunny, 'resolve_recording_download', return_value=fetch_url), \
             patch.object(session_bunny, 'download_recording',
                   side_effect=download_error or (lambda *args: nullcontext(io.BytesIO(MP4)))) as download, \
             patch.object(session_bunny, 'publish_outcome') as publish, \
             patch('learner_api.evidence_storage._service_client', side_effect=AssertionError('Azure forbidden')):
            result = video_imports.process(self.pending.pk)
        return result, download, publish

    def bunny_client(self, statuses):
        client = Mock()
        client.collection.return_value = 'COLLECTION'
        client.find_import.return_value = None
        client.create.return_value = {'guid': VIDEO}
        client.video.side_effect = [{'guid': VIDEO, 'status': status} for status in statuses]
        return client

    def test_worker_downloads_microsoft_uploads_bunny_and_publishes_ready_without_azure(self):
        self.pending = self.asset()
        client = self.bunny_client([4])
        result, download, publish = self.transfer(client)
        self.assertEqual(result.status, 'ready')
        self.assertEqual(result.video_id, VIDEO)
        download.assert_called_once()
        client.upload.assert_called_once()
        self.assertEqual(client.upload.call_args.args[0], VIDEO)
        publish.assert_called_once()

    def test_source_403_never_creates_empty_bunny_video_and_remains_retryable(self):
        self.pending = self.asset()
        client = self.bunny_client([])
        result, _, publish = self.transfer(client, download_error=VideoImportError('Microsoft recording download failed (HTTP 403).'))
        self.assertEqual(result.status, 'failed')
        self.assertIn('403', result.error)
        client.create.assert_not_called(); client.upload.assert_not_called()
        publish.assert_called_once()

    def test_encoding_poll_reuses_guid_without_another_download_or_upload(self):
        self.pending = self.asset()
        self.pending.video_id, self.pending.status = VIDEO, 'processing'
        self.pending.save()
        client = self.bunny_client([4])
        result, download, _ = self.transfer(client)
        self.assertEqual(result.status, 'ready')
        download.assert_not_called(); client.create.assert_not_called(); client.upload.assert_not_called()

    def test_bunny_fetch_reads_sharepoint_directly_without_downloading_video_in_worker(self):
        self.pending = self.asset()
        client = self.bunny_client([0])
        client.find_import.side_effect = [None, {'guid': VIDEO}]
        result, download, _ = self.transfer(client, fetch_url='https://tenant.sharepoint.com/short-lived-video')
        self.assertEqual((result.status, result.video_id), ('processing', VIDEO))
        download.assert_not_called(); client.create.assert_not_called(); client.upload.assert_not_called()
        args = client.request.call_args
        self.assertEqual(args.args, ('POST', '/videos/fetch'))
        self.assertEqual(args.kwargs['json']['headers'], {})
        self.assertNotIn('synthetic', str(args.kwargs))
        self.assertNotIn('sharepoint', str(result.scope))
        self.pending = result
        client.reset_mock()
        client.video.return_value = {'status': 0}
        client.video.side_effect = None
        result, download, _ = self.transfer(client)
        self.assertEqual(result.status, 'processing')
        client.request.assert_not_called(); download.assert_not_called()

    def test_uncertain_fetch_response_is_polled_without_a_second_post(self):
        self.pending = self.asset()
        client = self.bunny_client([])
        client.find_import.return_value = None
        client.request.side_effect = VideoImportError('Bunny could not be reached. Retry using the existing import.')
        result, download, _ = self.transfer(client, fetch_url='https://tenant.sharepoint.com/short-lived-video')
        self.assertEqual(result.status, 'processing')
        self.pending = result
        result, _, _ = self.transfer(client)
        self.assertEqual(result.status, 'processing')
        client.request.assert_called_once(); download.assert_not_called()

    def test_confirmed_failed_fetch_reuses_guid_for_microsoft_upload(self):
        self.pending = self.asset()
        self.pending.video_id = VIDEO
        self.pending.scope['bunny_fetch_requested_at'] = 1
        self.pending.save()
        client = self.bunny_client([6, 4])
        result, download, _ = self.transfer(client)
        self.assertEqual(result.status, 'ready')
        self.assertNotIn('bunny_fetch_requested_at', result.scope)
        download.assert_called_once(); client.create.assert_not_called(); client.upload.assert_called_once()

    def test_upload_timeout_retry_recovers_existing_remote_identity(self):
        self.pending = self.asset()
        client = self.bunny_client([4])
        client.find_import.return_value = {'guid': VIDEO}
        result, download, _ = self.transfer(client)
        self.assertEqual(result.status, 'ready')
        client.create.assert_not_called(); client.upload.assert_not_called(); download.assert_not_called()

    def test_transient_bunny_create_failure_reuses_download_and_recovers_guid(self):
        self.pending = self.asset()
        client = self.bunny_client([0, 4])
        client.find_import.side_effect = [None, {'guid': VIDEO}]
        client.create.side_effect = VideoImportError('Bunny could not be reached. Retry using the existing import.')
        with patch.object(session_bunny, 'sleep'):
            result, download, _ = self.transfer(client)
        self.assertEqual(result.status, 'ready')
        download.assert_called_once()
        client.create.assert_called_once()
        client.upload.assert_called_once()

    def test_changed_recording_identity_never_uploads_to_another_session(self):
        self.pending = self.asset()
        self.read.return_value = [{**self.series, **self.artifact, 'graph_artifact_id': 'CHANGED'}]
        with patch.object(session_bunny, 'BunnyStream') as client:
            with self.assertRaisesRegex(VideoImportError, 'identity changed'):
                session_bunny.transfer_recording(self.pending)
        client.assert_not_called()

    def test_signed_player_uses_separate_security_key_and_expiry(self):
        with patch.dict(os.environ, BUNNY_STREAM_TOKEN_KEY='synthetic-playback-key'):
            url = signed_embed('798153', VIDEO, now=100)
        self.assertIn('expires=14500', url)
        self.assertNotIn('synthetic-playback-key', url)
        with patch.dict(os.environ, BUNNY_STREAM_TOKEN_KEY=''):
            with self.assertRaisesRegex(VideoImportError, 'security key'):
                signed_embed('798153', VIDEO)

    def test_bunny_metadata_accepts_postgres_json_text_without_exposing_secrets(self):
        self.assertEqual(bunny_recording('{"lmsBunnyRecording":{"state":"ready"}}'), {'state': 'ready'})
        self.assertEqual(bunny_recording('not-json'), {})

    def test_staff_download_respects_bunny_domain_restrictions(self):
        row = {'metadata': {'lmsBunnyRecording': {'state': 'ready', 'libraryId': '798153', 'videoId': VIDEO}}}
        with patch.dict(os.environ, BUNNY_STREAM_TOKEN_KEY='synthetic-playback-key'), \
             patch.object(session_bunny, 'BunnyStream') as client:
            client.return_value.request.return_value = {'originalUrl': 'https://example.b-cdn.net/video/original'}
            result = session_bunny.recording_player(row, download=True, referrer='https://lms.example.invalid/')
        self.assertEqual(result, 'https://example.b-cdn.net/video/original')
        self.assertEqual(client.return_value.request.call_args.kwargs['headers'],
                         {'Referer': 'https://lms.example.invalid/'})

    def test_staff_download_expands_bunny_mp4_prefix_and_preserves_signed_query(self):
        row = {'metadata': {'lmsBunnyRecording': {'state': 'ready', 'libraryId': '798153', 'videoId': VIDEO}}}
        with patch.dict(os.environ, BUNNY_STREAM_TOKEN_KEY='synthetic-playback-key'), \
             patch.object(session_bunny, 'BunnyStream') as client:
            client.return_value.request.return_value = {
                'fallbackUrl': 'https://example.b-cdn.net/video/play_?token=synthetic&expires=99999',
                'video': {'hasMP4Fallback': True, 'availableResolutions': '480p,720p,1080p,2160p'}}
            result = session_bunny.recording_player(row, download=True)
        self.assertEqual(result, 'https://example.b-cdn.net/video/play_1080p.mp4?token=synthetic&expires=99999')

    def test_unavailable_mp4_prefix_is_not_returned_as_a_broken_download(self):
        row = {'metadata': {'lmsBunnyRecording': {'state': 'ready', 'libraryId': '798153', 'videoId': VIDEO}}}
        with patch.dict(os.environ, BUNNY_STREAM_TOKEN_KEY='synthetic-playback-key'), \
             patch.object(session_bunny, 'BunnyStream') as client:
            client.return_value.request.return_value = {'fallbackUrl': 'https://example.b-cdn.net/video/play_',
                'video': {'hasMP4Fallback': False, 'availableResolutions': '1080p'}}
            with self.assertRaisesRegex(VideoImportError, 'not available'):
                session_bunny.recording_player(row, download=True)

    def test_projection_refuses_an_import_whose_original_artifact_no_longer_matches(self):
        asset = self.asset()
        cursor = Mock()
        cursor.fetchall.return_value = [('UNRELATED',)]
        connection = Mock(); connection.cursor.return_value = nullcontext(cursor)
        with patch.object(session_bunny, 'connections', {'default': connection}):
            with self.assertRaisesRegex(VideoImportError, 'changed while Bunny'):
                session_bunny.publish_outcome(asset)

    def test_bunny_review_does_not_invalidate_ready_media_on_transient_failure(self):
        with patch.object(session_bunny, 'BunnyStream') as client:
            client.return_value.video.side_effect = VideoImportError('Bunny returned HTTP 503. The original video is unchanged.')
            with self.assertRaises(VideoImportError):
                session_bunny.check_saved_recording('A', {'libraryId': '798153', 'videoId': VIDEO})
        self.assertEqual(CurriculumVideoImport.objects.count(), 0)


class RecordingSourceTests(TestCase):
    def test_sharepoint_resolution_reads_only_header_and_keeps_url_out_of_durable_state(self):
        response = Mock(status=206, headers={'Content-Type': 'video/mp4'})
        response.geturl.return_value = 'https://tenant.sharepoint.com/short-lived-video'
        response.read.return_value = MP4[:32]
        opener = Mock(); opener.open.return_value = nullcontext(response)
        with patch('curriculum_api.session_recording_source.build_opener', return_value=opener):
            self.assertEqual(resolve_recording_download('https://graph.microsoft.com/content', 'synthetic'),
                             'https://tenant.sharepoint.com/short-lived-video')
        response.read.assert_called_once_with(32)

    def test_legacy_azure_selector_excludes_new_lectures_with_real_sql(self):
        from coach_api.recording_archive import pending_live_session_recordings
        database = sqlite3.connect(':memory:')
        self.addCleanup(database.close)
        database.execute("ATTACH DATABASE ':memory:' AS curriculum")
        database.execute('CREATE TABLE curriculum.live_session_occurrences(id text,scheduled_start text)')
        database.execute('CREATE TABLE curriculum.live_session_artifacts(occurrence_id text,graph_artifact_id text,artifact_type text,blob_name text,blob_upload_error text,created_datetime text)')
        database.executemany('INSERT INTO curriculum.live_session_occurrences VALUES (?,?)',
                            [('OLD', '2026-11-04 10:00:00'), ('NEW', '2026-11-05 10:00:00')])
        database.executemany('INSERT INTO curriculum.live_session_artifacts VALUES (?,?,\'recording\',\'\',\'\',?)',
                            [('OLD', 'REC-OLD', '2026-11-04'), ('NEW', 'REC-NEW', '2026-11-05')])
        cursor = Mock()
        active = [None]
        def execute(sql, params):
            active[0] = database.execute(sql.replace('%s', '?'), params)
        cursor.execute.side_effect = execute
        cursor.fetchall.side_effect = lambda: active[0].fetchall()
        connection = Mock(); connection.cursor.return_value = nullcontext(cursor)
        with patch('coach_api.recording_archive.live_session_blob_columns_ready', return_value=True), \
             patch('coach_api.recording_archive.connections', {'synthetic': connection}):
            selected = pending_live_session_recordings('synthetic')
        self.assertEqual(selected, [{'occurrence_id': 'OLD', 'graph_artifact_id': 'REC-OLD'}])

    def test_complete_range_is_downloaded_without_loading_azure_or_a_300mb_content_limit(self):
        response = Mock(status=206, headers={'Content-Type': 'video/mp4', 'Content-Range': f'bytes 0-{len(MP4)-1}/{len(MP4)}'})
        response.geturl.return_value = 'https://graph.microsoft.com/v1.0/content'
        response.read.side_effect = [MP4, b'']
        opener = Mock()
        opener.open.return_value = nullcontext(response)
        with patch('curriculum_api.session_recording_source.build_opener', return_value=opener):
            with download_recording('https://graph.microsoft.com/v1.0/content', 'synthetic') as stream:
                self.assertEqual(stream.read(), MP4)
        self.assertTrue(stream.closed)

    def test_redirect_drops_graph_authorization_before_sharepoint(self):
        from urllib.request import Request
        req = Request('https://graph.microsoft.com/content', headers={'Authorization': 'Bearer synthetic', 'Range': 'bytes=0-0'})
        redirected = RecordingRedirect().redirect_request(req, None, 302, '', {}, 'https://tenant.sharepoint.com/media')
        self.assertNotIn('Authorization', redirected.headers)
        self.assertEqual(redirected.headers['Range'], 'bytes=0-0')
        with self.assertRaises(VideoImportError):
            RecordingRedirect().redirect_request(req, None, 302, '', {}, 'https://evil.invalid/media')
