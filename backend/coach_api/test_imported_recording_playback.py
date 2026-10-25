"""Offline tests for protected imported recording playback; no Graph calls."""
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import patch

from django.test import RequestFactory, SimpleTestCase

from .actual_session_resolution import VerifiedMeetingTarget
from . import views
from .imported_recording_playback import _SafeGraphRedirect, graph_playback_candidate, stream_imported_recording


class GraphPlaybackTests(SimpleTestCase):
    def setUp(self):
        self.record = SimpleNamespace(pk=12, event_key='imported-review:42', graph_event_id='event-1')
        self.artifact = {'artifact_type': 'recording', 'graph_artifact_id': 'recording-1',
                         'metadata': {'_lms_graph_event_id': 'event-1',
                                      '_lms_verified_online_meeting_id': 'meeting-1',
                                      'meetingId': 'meeting-1'}}
        self.snapshot = {'storage': {'stored': True}, 'partial': False,
                         'selectionError': None, 'artifacts': [self.artifact]}
        self.target = VerifiedMeetingTarget('users/synthetic/onlineMeetings/meeting-1',
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'meeting-1', 12,
            'event-1', 'synthetic-fingerprint')

    def test_metadata_candidate_is_scoped_and_never_claims_playable_bytes(self):
        with patch('coach_api.views.has_graph_credentials', return_value=True):
            self.assertTrue(graph_playback_candidate(self.record, self.snapshot, self.artifact))
            for change in ({'partial': True}, {'selectionError': 'MEETING_ARTIFACT_CONFLICT'},
                           {'storage': {'stored': False}}):
                self.assertFalse(graph_playback_candidate(self.record,
                    {**self.snapshot, **change}, self.artifact))
            for field, bad in (('_lms_graph_event_id', 'other-event'),
                               ('_lms_verified_online_meeting_id', ''), ('meetingId', 'other-meeting')):
                row = {**self.artifact, 'metadata': {**self.artifact['metadata'], field: bad}}
                self.assertFalse(graph_playback_candidate(self.record, self.snapshot, row))
        with patch('coach_api.views.has_graph_credentials', return_value=False):
            self.assertFalse(graph_playback_candidate(self.record, self.snapshot, self.artifact))

    def test_range_streams_only_verified_recording_and_closes_upstream(self):
        upstream = BytesIO(b'video bytes')
        upstream.headers = {'Content-Type': 'video/mp4', 'Content-Range': 'bytes 0-10/11',
                            'Content-Length': '11'}
        upstream.status = 206
        def resolve(_record, *, identity_out):
            identity_out['target'] = self.target
            return self.target.base_path, None
        request = RequestFactory().get('/content/?preview=1', HTTP_RANGE='bytes=0-10')
        with patch('coach_api.views.has_graph_credentials', return_value=True), \
             patch('coach_api.actual_session_resolution.review_meeting_target', side_effect=resolve), \
             patch('coach_api.views.get_graph_settings', return_value={'base_url': 'https://graph.microsoft.test/v1.0'}), \
             patch('coach_api.views.microsoft_graph_token', return_value='synthetic-token'), \
             patch('coach_api.imported_recording_playback._open_graph', return_value=upstream) as fetch:
            response = stream_imported_recording(request, self.record, self.snapshot, self.artifact)
            self.assertEqual(response.status_code, 206)
            self.assertEqual(response['Content-Range'], 'bytes 0-10/11')
            self.assertEqual(response['Cache-Control'], 'private, no-store')
            self.assertEqual(b''.join(response.streaming_content), b'video bytes')
            self.assertTrue(upstream.closed)
        graph_request = fetch.call_args.args[0]
        self.assertEqual(graph_request.get_header('Range'), 'bytes=0-10')
        self.assertIn('/meeting-1/recordings/recording-1/content', graph_request.full_url)
        self.assertNotIn('synthetic-token', str(response.items()))

    def test_changed_provider_meeting_never_fetches_content(self):
        other = SimpleNamespace(**{**vars(self.target), 'online_meeting_id': 'other-meeting'})
        def resolve(_record, *, identity_out):
            identity_out['target'] = other
            return self.target.base_path, None
        with patch('coach_api.views.has_graph_credentials', return_value=True), \
             patch('coach_api.actual_session_resolution.review_meeting_target', side_effect=resolve), \
             patch('coach_api.imported_recording_playback._open_graph') as fetch:
            response = stream_imported_recording(RequestFactory().get('/content/'),
                self.record, self.snapshot, self.artifact)
        self.assertEqual(response.status_code, 409)
        fetch.assert_not_called()

    def test_graph_absence_is_explicit_and_no_bytes_are_exposed(self):
        from urllib.error import HTTPError
        def resolve(_record, *, identity_out):
            identity_out['target'] = self.target
            return self.target.base_path, None
        with patch('coach_api.views.has_graph_credentials', return_value=True), \
             patch('coach_api.actual_session_resolution.review_meeting_target', side_effect=resolve), \
             patch('coach_api.views.get_graph_settings', return_value={'base_url': 'https://graph.microsoft.test/v1.0'}), \
             patch('coach_api.views.microsoft_graph_token', return_value='synthetic-token'), \
             patch('coach_api.imported_recording_playback._open_graph',
                   side_effect=HTTPError('synthetic', 404, 'missing', {}, None)):
            response = stream_imported_recording(RequestFactory().get('/content/'),
                self.record, self.snapshot, self.artifact)
        self.assertEqual(response.status_code, 404)
        self.assertNotIn(b'synthetic-token', response.content)

    def test_coach_content_route_keeps_source_and_calendar_authorization(self):
        from inspect import unwrap

        definition = {'template': {'reviewTypeCode': 'aptem_progress_review'}}
        overlay = SimpleNamespace(meeting_intelligence={'transcriptStatus': 'available'})
        saved = {**self.snapshot, 'attendanceReports': [], 'attendance': {'expectedAttendees': []}}
        upstream = BytesIO(b'coach video')
        upstream.headers = {'Content-Type': 'video/mp4'}
        upstream.status = 200
        def resolve(_record, *, identity_out):
            identity_out['target'] = self.target
            return self.target.base_path, None
        with patch.object(views, 'is_coach_view_as', return_value=False), \
             patch.object(views, 'authenticated_coach_email', return_value='coach@example.test'), \
             patch.object(views, 'coach_meeting_artifact_record', return_value=self.record), \
             patch.object(views, '_imported_review_definition', return_value=definition), \
             patch('coach_api.migrated_intelligence_views._association',
                   return_value=(overlay, self.record, definition)) as association, \
             patch('coach_api.bound_actual_session.bound_session', return_value=None), \
             patch.object(views, 'stored_coach_meeting_snapshot', return_value=saved), \
             patch.object(views, 'has_graph_credentials', return_value=True), \
             patch('coach_api.recording_archive.archived_recording_url', return_value=''), \
             patch('coach_api.actual_session_resolution.review_meeting_target', side_effect=resolve), \
             patch.object(views, 'get_graph_settings', return_value={'base_url': 'https://graph.microsoft.test/v1.0'}), \
             patch.object(views, 'microsoft_graph_token', return_value='synthetic-token'), \
             patch('coach_api.imported_recording_playback._open_graph', return_value=upstream) as fetch:
            route = unwrap(views.coach_timetable_event_artifact_content)
            response = route(RequestFactory().get('/content/?preview=1'),
                self.record.event_key, 'recording', 'recording-1')
            self.assertEqual(response.status_code, 200)
            self.assertEqual(b''.join(response.streaming_content), b'coach video')
            fetch.assert_called_once()
            association.return_value = (overlay, SimpleNamespace(pk=13), definition)
            denied = route(RequestFactory().get('/content/'),
                self.record.event_key, 'recording', 'recording-1')
            self.assertEqual(denied.status_code, 404)
            fetch.assert_called_once()

    def test_cross_host_redirect_drops_graph_bearer_token(self):
        from urllib.request import Request
        original = Request('https://graph.microsoft.test/v1.0/recording',
                           headers={'Authorization': 'Bearer synthetic-token', 'Range': 'bytes=0-10'})
        redirected = _SafeGraphRedirect().redirect_request(original, None, 302, 'Found', {},
            'https://video.microsoft.test/saved-copy')
        self.assertIsNotNone(redirected)
        self.assertIsNone(redirected.get_header('Authorization'))
        self.assertEqual(redirected.get_header('Range'), 'bytes=0-10')
