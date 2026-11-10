"""Original lecture downloads: scope, permissions, preflight and bounded delivery."""
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import patch
from urllib.error import HTTPError

from django.http import HttpResponse
from django.test import SimpleTestCase, RequestFactory, AsyncRequestFactory

from login import permissions
from . import session_results, session_downloads
from .bunny_stream import VideoImportError


class OriginalRecordingDownloadTests(SimpleTestCase):
    def setUp(self):
        self.saved = {'artifact_id': 'R', 'occurrence_id': 'O', 'artifact_type': 'recording', 'status': 'ready',
            'metadata': {'lmsBunnyRecording': {'state': 'ready', 'libraryId': '798153', 'videoId': 'V'}}}
        self.source = {'artifact_id': 'R', 'occurrence_id': 'O', 'series_id': 'S', 'graph_artifact_id': 'G/1',
            'occurrence_join_url': 'https://teams.microsoft.com/recreated', 'occurrence_meeting_id': 'NEW',
            'organizer_email': 'tutor@example.invalid', 'join_url': 'https://teams.microsoft.com/series',
            'online_meeting_id': 'OLD'}
        self.read = self.enterContext(patch.object(session_results, 'read', return_value=[self.source]))
        self.owner = self.enterContext(patch('curriculum_api.views.teams_online_meeting_owner_id', return_value='owner'))
        self.probe = self.enterContext(patch('coach_api.recordings_transport.recording_accessible', return_value=True))
        self.delivery = self.enterContext(patch('coach_api.recordings_transport.recording_response', return_value=HttpResponse()))
        self.player = self.enterContext(patch('curriculum_api.session_bunny.recording_player'))

    def load(self, request=None):
        return session_downloads.original_recording_download(request or RequestFactory().get('/saved/R/', {'download': '1'}),
            'S', self.saved, filename='Lecture-session-1.mp4')

    def test_resolve_probes_only_header_and_returns_same_origin_attachment_endpoint(self):
        response = self.load(RequestFactory().get('/saved/R/', {'download': '1', 'resolve': '1'}))
        self.assertEqual(response.status_code, 200)
        self.assertJSONEqual(response.content, {'url': '/saved/R/?download=1', 'provider': 'microsoft'})
        self.assertEqual(response['Cache-Control'], 'private, no-store')
        self.probe.assert_called_once_with('users/owner/onlineMeetings/NEW', 'G/1')
        self.delivery.assert_not_called()
        self.assertEqual(self.read.call_args.args[1], ['R', 'O', 'S'])
        self.owner.assert_called_once_with('tutor@example.invalid', 'https://teams.microsoft.com/recreated')

    def test_download_forwards_resume_headers_and_attaches_the_lecture_filename(self):
        response = self.load(RequestFactory().get('/saved/R/', HTTP_RANGE='bytes=100-', HTTP_IF_RANGE='"saved"'))
        self.delivery.assert_called_once_with('users/owner/onlineMeetings/NEW', 'G/1',
            byte_range='bytes=100-', if_range='"saved"', asynchronous=False)
        self.assertEqual(response['Content-Disposition'], 'attachment; filename="Lecture-session-1.mp4"')
        self.probe.assert_not_called()

    def test_asgi_download_uses_an_async_iterator_instead_of_buffering_the_file(self):
        self.load(AsyncRequestFactory().get('/saved/R/'))
        self.assertTrue(self.delivery.call_args.kwargs['asynchronous'])

    def test_invalid_ranges_are_rejected_before_database_or_external_reads(self):
        response = self.load(RequestFactory().get('/saved/R/', HTTP_RANGE='bytes=1-2,4-5'))
        self.assertEqual(response.status_code, 416)
        self.assertEqual(response['Cache-Control'], 'private, no-store')
        self.read.assert_not_called()
        self.delivery.assert_not_called()

    def test_missing_original_identity_cannot_download_another_recording(self):
        self.read.return_value = []
        with self.assertRaisesRegex(VideoImportError, 'linked to this lecture'):
            self.load()
        self.probe.assert_not_called()
        self.delivery.assert_not_called()

    def test_expired_microsoft_access_is_reported_without_exposing_private_details(self):
        self.probe.side_effect = HTTPError('https://private.invalid/secret', 403, 'Sensitive detail', {}, BytesIO())
        with self.assertRaises(VideoImportError) as failure:
            self.load(RequestFactory().get('/saved/R/', {'resolve': '1'}))
        self.assertNotIn('private.invalid', str(failure.exception))
        self.assertNotIn('Sensitive', str(failure.exception))
        self.delivery.assert_not_called()

    def test_staff_endpoint_downloads_original_without_requesting_a_bunny_mp4(self):
        self.read.side_effect = [[self.saved], [{'module_title': 'Lecture', 'session_number': 1}], [self.source]]
        with patch.object(permissions, 'authenticate_request', return_value=SimpleNamespace(role='staff')):
            result = session_results.admin_content(RequestFactory().get('/saved/R/', {'download': '1', 'resolve': '1'}), 'S', 'R')
        self.assertEqual(result.status_code, 200)
        self.player.assert_not_called()
        self.probe.assert_called_once()

    def test_token_failure_is_a_safe_retryable_response_for_the_download_button(self):
        self.read.side_effect = [[self.saved], [], [self.source]]
        self.probe.side_effect = RuntimeError('Private token response must not escape')
        with patch.object(permissions, 'authenticate_request', return_value=SimpleNamespace(role='staff')):
            result = session_results.admin_content(RequestFactory().get('/saved/R/', {'download': '1', 'resolve': '1'}), 'S', 'R')
        self.assertEqual(result.status_code, 503)
        self.assertNotIn(b'Private token', result.content)
        self.delivery.assert_not_called()

    def test_learner_cannot_use_the_staff_download_endpoint(self):
        with patch.object(permissions, 'authenticate_request', return_value=SimpleNamespace(role='learner')):
            response = session_results.admin_content(RequestFactory().get('/saved/R/', {'download': '1'}), 'S', 'R')
        self.assertEqual(response.status_code, 403)
        self.read.assert_not_called()
        self.delivery.assert_not_called()

    def test_learner_download_query_does_not_enable_original_file_access(self):
        self.read.side_effect = [[{'id': 'R', 'occurrence_id': 'O', 'artifact_type': 'recording', 'metadata': {}}], [self.saved]]
        self.player.return_value = 'https://player.mediadelivery.net/embed/synthetic'
        response = session_results.stored_content(RequestFactory().get('/saved/R/', {'download': '1'}), 'S', 'R', learner_view=True)
        self.assertEqual(response.status_code, 302)
        self.player.assert_called_once_with(self.saved)
        self.probe.assert_not_called()
        self.delivery.assert_not_called()

    def test_old_azure_recording_still_resolves_its_saved_download(self):
        self.read.side_effect = [[{**self.saved, 'metadata': {}, 'container': 'old', 'blob_name': 'lecture.mp4'}], []]
        with patch('learner_api.evidence_storage.get_read_sas', return_value='https://saved.invalid/attachment') as sas:
            response = session_results.stored_content(RequestFactory().get('/saved/R/', {'download': '1', 'resolve': '1'}), 'S', 'R')
        self.assertJSONEqual(response.content, {'url': 'https://saved.invalid/attachment'})
        self.assertTrue(sas.call_args.kwargs['content_disposition'].startswith('attachment'))
        self.probe.assert_not_called()
