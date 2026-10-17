"""Synthetic Graph and HTTP only. No Django setup, database or live network."""
import ast
import sys
import types
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import Mock, patch
from urllib.parse import quote, urlsplit
from urllib.request import HTTPRedirectHandler, Request
from urllib.error import URLError

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from curriculum_api.recordings_external_policy import event_join_url, occurrence_recordings
from curriculum_api.session_results_policy import instant

LINK = 'https://teams.microsoft.com/l/meetup-join/meeting-1?context=%7B%7D'
FIRST, LAST = '2026-10-15T08:00:00Z', '2026-10-15T10:00:00Z'


def recording(**values):
    return {'id': 'R1', 'createdDateTime': FIRST, 'endDateTime': LAST, **values}


class PolicyTests(unittest.TestCase):
    def test_attendee_body_and_direct_link_resolve_without_title_matching(self):
        self.assertEqual(event_join_url({'onlineMeeting': {'joinUrl': LINK}}), LINK)
        self.assertEqual(event_join_url({'body': {'content': f'<a href="{LINK}">Join</a>'}}), LINK)
        self.assertIsNone(event_join_url({'body': {'content': LINK + ' ' + LINK.replace('meeting-1', 'meeting-2')}}))

    def test_recurring_series_is_scoped_to_this_occurrence_interval(self):
        rows = [recording(), recording(id='PREV', createdDateTime='2026-10-14T08:00:00Z', endDateTime='2026-10-14T10:00:00Z'),
                recording(id='NEXT', createdDateTime=LAST, endDateTime='2026-10-15T11:00:00Z'),
                recording(id='EARLY', createdDateTime='2026-10-15T07:50:00Z', endDateTime='2026-10-15T08:20:00Z')]
        self.assertEqual([row['id'] for row in occurrence_recordings(rows, FIRST, LAST)], ['EARLY', 'R1'])

    def test_bad_times_and_duplicate_content_are_not_download_choices(self):
        rows = [recording(contentCorrelationId='SAME'), recording(id='COPY', contentCorrelationId='SAME'),
                recording(id='BAD', endDateTime='invalid'), recording(id='REVERSE', endDateTime='2026-10-15T07:00:00Z')]
        self.assertEqual(len(occurrence_recordings(rows, FIRST, LAST)), 1)
        with self.assertRaises(ValueError):
            occurrence_recordings(rows, LAST, FIRST)


class EndpointTests(unittest.TestCase):
    def setUp(self):
        tree = ast.parse(Path(__file__).with_name('recordings_external.py').read_text())
        self.tree = tree
        class BadSignature(Exception):
            pass
        self.signing = types.SimpleNamespace(BadSignature=BadSignature, loads=Mock(return_value={
            'mailbox': 'own@example.invalid', 'event': 'EVENT', 'start': FIRST, 'end': LAST}))
        self.ns = {'__package__': 'curriculum_api', 'signing': self.signing, 'SALT': 'test',
            'read': Mock(return_value=[{'organizer_email': 'own@example.invalid'}]), 'quote': quote, 'urlsplit': urlsplit,
            'instant': instant, 'event_join_url': event_join_url, 'occurrence_recordings': occurrence_recordings,
            'DatabaseError': type('DatabaseError', (Exception,), {}), 'unavailable': lambda: {'status': 503},
            'JsonResponse': lambda data, status=200: {'data': data, 'status': status}, 'URLError': URLError,
            'HTTPRedirectHandler': HTTPRedirectHandler, 'Request': Request, 'build_opener': Mock(),
            'StreamingHttpResponse': Mock()}
        for name in ['resolve_recordings', 'RecordingRedirect', 'recording_stream', 'external_recordings']:
            node = next(item for item in tree.body if isinstance(item, (ast.FunctionDef, ast.ClassDef)) and item.name == name)
            node.decorator_list = []
            exec(compile(ast.Module(body=[node], type_ignores=[]), 'external-recordings', 'exec'), self.ns)
        self.graph = types.ModuleType('coach_api.views')
        self.graph.microsoft_graph_request = Mock(return_value={'id': 'EVENT', 'subject': 'Unlinked Portfolio',
            'organizer': {'emailAddress': {'address': 'teacher@example.invalid'}}, 'onlineMeeting': {'joinUrl': LINK},
            'start': {'dateTime': FIRST}, 'end': {'dateTime': LAST}})
        self.graph.get_graph_settings = lambda: {'base_url': 'https://graph.microsoft.com/v1.0'}
        self.graph.microsoft_graph_token = lambda: 'synthetic-token'
        normalize = types.ModuleType('curriculum_api.teams_weekly_calendar')
        normalize.graph_event_utc = lambda item: item
        views = types.ModuleType('curriculum_api.views')
        views.teams_online_meeting_from_join_url = Mock(return_value={'id': 'MEETING'})
        views.teams_online_meeting_owner_id = Mock(return_value='OWNER')
        collection = types.ModuleType('curriculum_api.session_graph')
        collection.collection = Mock(return_value=[recording()])
        self.collection, self.views = collection, views
        self.modules = {'coach_api.views': self.graph, 'curriculum_api.teams_weekly_calendar': normalize,
                        'curriculum_api.views': views, 'curriculum_api.session_graph': collection}

    def request(self, role='staff', email='own@example.invalid', **params):
        return types.SimpleNamespace(GET={'reference': 'signed-reference', **params}, login_account=types.SimpleNamespace(role=role, email=email))

    def call(self, request=None):
        with patch.dict(sys.modules, self.modules):
            return self.ns['external_recordings'](request or self.request())

    def test_get_staff_admin_gate_is_preserved(self):
        tree = ast.parse(Path(__file__).with_name('recordings_external.py').read_text())
        node = next(item for item in tree.body if isinstance(item, ast.FunctionDef) and item.name == 'external_recordings')
        self.assertEqual([ast.unparse(item) for item in node.decorator_list], ['require_GET', "require_role('admin', 'staff')"])

    def test_list_is_private_and_never_contains_graph_content_or_join_urls(self):
        result = self.call()
        self.assertEqual(result['data']['recordings'], [{'id': 'R1', 'startsAt': FIRST, 'endsAt': LAST}])
        self.assertFalse(result['data']['linkedToLms'])
        self.assertEqual(result['Cache-Control'], 'private, no-store')
        self.assertNotIn(LINK, str(result))
        self.signing.loads.assert_called_once_with('signed-reference', salt='test', max_age=3600)
        self.assertEqual(self.graph.microsoft_graph_request.call_args.args[0], 'GET')

    def test_other_staff_mailbox_and_removed_mailbox_are_forbidden_before_graph(self):
        self.assertEqual(self.call(self.request(email='other@example.invalid'))['status'], 403)
        self.ns['read'].return_value = []
        self.assertEqual(self.call()['status'], 403)
        self.graph.microsoft_graph_request.assert_not_called()

    def test_admin_can_read_known_calendar_but_does_not_change_meeting(self):
        self.assertEqual(self.call(self.request(role='admin', email='admin@example.invalid'))['status'], 200)
        self.assertTrue(self.ns['read'].call_args.args[0].startswith('SELECT'))

    def test_tampered_or_expired_reference_fails_closed(self):
        self.signing.loads.side_effect = self.signing.BadSignature()
        self.assertEqual(self.call()['status'], 400)
        self.graph.microsoft_graph_request.assert_not_called()

    def test_changed_calendar_time_and_missing_identity_do_not_guess(self):
        event = self.graph.microsoft_graph_request.return_value
        event['start'] = {'dateTime': '2026-10-16T08:00:00Z'}
        self.assertEqual(self.call()['status'], 503)
        self.views.teams_online_meeting_from_join_url.assert_not_called()
        event['start'] = {'dateTime': FIRST}; event['onlineMeeting'] = None
        self.assertEqual(self.call()['status'], 503)

    def test_graph_error_is_not_an_empty_success(self):
        self.graph.microsoft_graph_request.side_effect = RuntimeError('private graph diagnostics')
        result = self.call()
        self.assertEqual(result['status'], 503)
        self.assertNotIn('private graph diagnostics', str(result))

    def test_download_revalidates_occurrence_and_rejects_unlisted_recording(self):
        self.ns['recording_stream'] = Mock(return_value='stream')
        self.assertEqual(self.call(self.request(recording='R1')), 'stream')
        self.assertEqual(self.call(self.request(recording='OTHER'))['status'], 404)
        self.ns['recording_stream'].assert_called_once_with('users/OWNER/onlineMeetings/MEETING/recordings/R1')

    def test_cross_host_redirect_drops_bearer_and_rejects_untrusted_hosts(self):
        handler = self.ns['RecordingRedirect']()
        request = Request('https://graph.microsoft.com/v1.0/file', headers={'Authorization': 'Bearer synthetic'})
        redirected = handler.redirect_request(request, None, 302, 'Found', {}, 'https://tenant.sharepoint.com/file')
        self.assertIsNone(redirected.get_header('Authorization'))
        for url in ['http://tenant.sharepoint.com/file', 'https://evil.example/file', 'https://tenant.sharepoint.com:8443/file']:
            with self.assertRaises(URLError):
                handler.redirect_request(request, None, 302, 'Found', {}, url)

    def test_stream_keeps_memory_bounded_and_closes_source(self):
        source = Mock(status=200, headers={'Content-Length': '3', 'Content-Type': 'video/mp4'})
        source.read.side_effect = [b'abc', b'']
        self.ns['build_opener'].return_value.open.return_value = source
        response = {}; self.ns['StreamingHttpResponse'] = lambda chunks, **kwargs: types.SimpleNamespace()
        class Response(dict):
            def __init__(self, chunks, **kwargs):
                self.chunks, self._resource_closers = chunks, []
        self.ns['StreamingHttpResponse'] = Response
        with patch.dict(sys.modules, self.modules):
            response = self.ns['recording_stream']('users/OWNER/onlineMeetings/M/recordings/R')
        self.assertEqual(b''.join(response.chunks), b'abc')
        source.close.assert_called_once()
        self.assertTrue(all(call.args == (256 * 1024,) for call in source.read.call_args_list))
        self.assertEqual(response['Content-Length'], '3')


if __name__ == '__main__':
    unittest.main()
