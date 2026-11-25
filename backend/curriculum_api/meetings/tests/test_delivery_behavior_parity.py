"""Replay original bodies and real public facades with synthetic storage/provider ports."""
import ast
from curriculum_api.catalogue.tests.parity.current_entry_source import current_entry_tree
import copy
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import io
import json
import logging
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch
from urllib import error, parse, request as transport
from curriculum_api.meetings.tests.policy_composition_oracle import EXPORTS, actual

ROOT = Path(__file__).resolve().parents[2]
SNAPSHOT = json.loads((Path(__file__).parent / 'fixtures/delivery_snapshot.json').read_text(encoding='utf-8'))
CURRENT = {n.name: n for n in current_entry_tree().body
           if isinstance(n, ast.FunctionDef)}


class Response(dict):
    def __init__(self, content=b'', status=200, content_type=None, **kwargs):
        super().__init__()
        self.content, self.status_code = content, status
        if content_type:
            self['Content-Type'] = content_type


class DeliveryParity(unittest.TestCase):
    def run_case(self, name, scenario, original):
        trace, writes = [], []
        series = {'id': 'SERIES', 'organizer_email': 'owner@example.invalid',
                  'online_meeting_id': 'MASTER', 'join_url': 'https://teams.microsoft.com/master'}
        occurrence = {'id': 'OCC', 'live_session_id': 'SERIES', 'session_number': 2,
                      'online_meeting_id': 'OCC-MEETING', 'join_url': 'https://teams.microsoft.com/occ'}
        artifact = {'id': 'ART', 'occurrence_id': 'OCC', 'artifact_type': 'recording',
                    'graph_artifact_id': 'GRAPH-ART', 'metadata': {}}
        http = types.SimpleNamespace(method='GET', GET={}, META={}, user=None,
                                     build_absolute_uri=lambda _: 'https://lms.example.invalid/')
        payload = {'viewer': {'id': 'SPOOF', 'email': 'spoof@example.invalid'},
                   'previewSessionId': 'PREVIEW', 'events': [{'id': 'EVENT', 'type': 'seeked',
                   'videoTime': -5, 'skipFrom': 9, 'skipTo': 4, 'volume': 2, 'durationSeconds': 'NaN'}]}
        archived = ''
        if scenario == 'missing_series':
            series = None
        if scenario == 'foreign_artifact':
            artifact['occurrence_id'] = 'OTHER'
        if scenario == 'unsupported_artifact':
            artifact['artifact_type'] = 'attendance'
        if scenario.startswith('transcript'):
            artifact['artifact_type'] = 'transcript'
        if scenario.startswith('bunny'):
            artifact['metadata'] = {'state': 'pending' if scenario == 'bunny_pending' else 'ready'}
            if scenario != 'bunny_download':
                http.GET['preview'] = '1'
        if scenario == 'archived':
            archived = 'https://archive.example.invalid/recording'
        if scenario == 'series_identity':
            occurrence['online_meeting_id'] = ''
        if scenario == 'missing_identity':
            artifact['graph_artifact_id'] = ''
        if scenario in {'range', 'range_unsatisfiable'}:
            http.META['HTTP_RANGE'] = 'bytes=10-20'
        if scenario == 'range':
            http.GET['preview'] = 'true'
        if name == 'curriculum_teams_recording_events':
            http.method = 'POST'
        if scenario == 'tracking_method':
            http.method = 'GET'
        if scenario == 'tracking_empty':
            payload['events'] = []
        if scenario == 'tracking_limit':
            payload['events'] = [{'id': str(i), 'type': 'play'} for i in range(205)]
        if scenario == 'tracking_account':
            http.login_account = types.SimpleNamespace(id='ACCOUNT', email='Account@Example.invalid',
                                                       display_name='Synthetic account', role='learner')
        if scenario == 'tracking_malformed':
            payload['events'] = [None, {}, {'type': ''}, {'type': 'pause', 'videoTime': 'bad'}]
        if scenario == 'join_cancelled':
            occurrence['status'] = 'cancelled'
        if scenario == 'join_superseded':
            occurrence['status'] = 'superseded'
        if scenario == 'join_invalid':
            occurrence['join_url'] = 'https://teams.microsoft.com.evil.invalid/'
        if scenario == 'join_authenticated':
            http.user = types.SimpleNamespace(is_authenticated=True, pk='USER', email='USER@EXAMPLE.INVALID',
                                             get_full_name=lambda: 'Synthetic user')

        def fetch(table, where, params, *args):
            trace.append(('read', table, where, copy.deepcopy(params)))
            rows = {'series': [series] if series else [], 'occurrences': [occurrence], 'artifacts': [artifact]}
            return copy.deepcopy(rows[table])

        def insert(*args):
            writes.append(copy.deepcopy(args))

        def redirect(url):
            response = Response(status=302)
            response['Location'] = url
            return response

        class VideoImportError(Exception):
            pass

        def player(*args, **kwargs):
            trace.append(('player', copy.deepcopy(args), kwargs))
            if scenario == 'bunny_error':
                raise VideoImportError('Synthetic unavailable rendition')
            return 'https://video.example.invalid/protected'

        def admin_content(req, *args):
            trace.append(('download', dict(req.GET), args))
            return Response('original-file')

        def token():
            trace.append(('token',))
            if scenario == 'token_failure':
                raise RuntimeError('Synthetic unavailable token')
            return 'synthetic-token'

        class Stream(io.BytesIO):
            headers = {'Content-Type': 'video/mp4', 'Content-Length': '11', 'Content-Range': 'bytes 10-20/100'}
            status = 206 if scenario == 'range' else 200
            def close(self):
                trace.append(('close-stream',))
                super().close()

        def open_content(opener, req, **kwargs):
            self.assertIs(opener, transport.urlopen)
            trace.append(('graph', req.full_url, dict(req.header_items()), kwargs))
            if scenario == 'range_unsatisfiable':
                raise error.HTTPError(req.full_url, 416, 'range', {'Content-Range': 'bytes */100'}, io.BytesIO())
            if scenario == 'graph_failure':
                raise error.HTTPError(req.full_url, 403, 'synthetic refused', {}, io.BytesIO(b'synthetic denied'))
            if scenario == 'network_failure':
                raise error.URLError('synthetic offline')
            return Stream(b'synthetic content')

        namespace = {
            '__package__': 'curriculum_api', 'require_GET': lambda f: f, 'csrf_exempt': lambda f: f,
            'clean_str': lambda v: str(v or '').strip(), 'parse_int': lambda v, default=0: int(v or default),
            'datetime': types.SimpleNamespace(utcnow=lambda: datetime(2026, 11, 22, 12)), 'timezone': timezone,
            'uuid': types.SimpleNamespace(uuid4=lambda: types.SimpleNamespace(hex='synthetic')),
            'json': json, 'hashlib': hashlib, 'urlparse': parse.urlparse, 'urllib_parse': parse,
            'urllib_request': transport, 'urllib_error': error, 'logger': logging.getLogger('delivery-parity'),
            'ensure_live_session_tracking_tables': lambda: trace.append(('ensure',)),
            'authoring_fetch_all': fetch, 'insert_row': insert, 'authoring_upsert': insert,
            'LIVE_SESSIONS_TABLE': 'series', 'LIVE_SESSION_OCCURRENCES_TABLE': 'occurrences',
            'LIVE_SESSION_ARTIFACTS_TABLE': 'artifacts', 'LIVE_SESSION_RECORDING_EVENTS_TABLE': 'tracking',
            'LIVE_SESSION_JOIN_LAUNCHES_TABLE': 'launches', 'json_db_value': json.dumps,
            'json_body': lambda req: copy.deepcopy(payload), 'bool_payload': bool,
            'parse_graph_datetime': lambda v: datetime.fromisoformat(v.replace('Z', '+00:00')) if v else None,
            'teams_online_meeting_owner_id': lambda organizer, join: trace.append(('owner', organizer, join)) or 'OWNER',
            'HttpResponse': Response, 'StreamingHttpResponse': Response, 'HttpResponseRedirect': redirect,
            'JsonResponse': Response, 'json_error': lambda message, status=400: Response({'error': message}, status),
        }
        dependencies = {
            'coach_api.views': {'get_graph_settings': lambda: {'base_url': 'https://graph.example.invalid/v1.0'},
                                'microsoft_graph_token': token},
            'coach_api.recording_archive': {'archived_live_session_recording_url': lambda *a: archived},
            'curriculum_api.session_bunny_policy': {'bunny_recording': lambda m: m,
                                                   'recording_uses_bunny': lambda *a: False},
            'curriculum_api.bunny_stream': {'VideoImportError': VideoImportError},
            'curriculum_api.session_bunny': {'recording_player': player},
            'curriculum_api.session_results': {'admin_content': admin_content},
            'curriculum_api.transcript_transport': {'open_transcript': open_content},
        }
        modules = {}
        for module, attrs in dependencies.items():
            modules[module] = types.ModuleType(module)
            vars(modules[module]).update(attrs)
        with patch.dict(sys.modules, modules):
            # Both sides use the actual selected source; current code imports its
            # real owner through the public wrapper, including each deferred loader.
            for symbol in ('safe_float', 'parse_client_event_time', name):
                if not original and symbol in EXPORTS:
                    namespace[symbol] = actual(symbol)
                    continue
                node = ast.parse(SNAPSHOT['functions'][symbol]['source']).body[0] if original else CURRENT[symbol]
                exec(compile(ast.Module(body=[copy.deepcopy(node)], type_ignores=[]), '<delivery-source>', 'exec'), namespace)
            args = (http, 'SERIES', 'OCC' if name.endswith('_join') else 'ART')
            response = namespace[name](*args)
            content = response.content
            if not isinstance(content, (bytes, str, dict)):
                content = b''.join(content)
            return {'status': response.status_code, 'headers': dict(response), 'content': content,
                    'trace': trace, 'writes': writes, 'request_get': dict(http.GET)}

    def parity(self, name, scenario):
        current = self.run_case(name, scenario, False)
        self.assertEqual(current, self.run_case(name, scenario, True))
        return current


def content_case(scenario, status):
    def test(self):
        result = self.parity('curriculum_teams_meeting_artifact_content', scenario)
        self.assertEqual(result['status'], status)
        graph = [t for t in result['trace'] if t[0] == 'graph']
        if scenario == 'range':
            self.assertEqual(graph[0][2]['Range'], 'bytes=10-20')
            self.assertIn('/OCC-MEETING/recordings/', graph[0][1])
            self.assertTrue(result['headers']['Content-Disposition'].startswith('inline;'))
        if scenario == 'series_identity':
            self.assertIn('/MASTER/recordings/', graph[0][1])
        if scenario == 'transcript':
            self.assertIn(('close-stream',), result['trace'])
        if scenario.startswith('bunny') or scenario in {'archived', 'foreign_artifact', 'missing_series', 'missing_identity'}:
            self.assertEqual(graph, [])
        if scenario == 'bunny_download':
            self.assertEqual(result['request_get'], {})
            self.assertEqual(next(t for t in result['trace'] if t[0] == 'download')[1], {'download': '1'})
    return test


for _scenario, _status in {
    'missing_series': 404, 'foreign_artifact': 404, 'unsupported_artifact': 400,
    'bunny_pending': 409, 'bunny_preview': 302, 'bunny_download': 200, 'bunny_error': 503,
    'archived': 302, 'missing_identity': 409, 'series_identity': 200,
    'token_failure': 502, 'range': 206, 'range_unsatisfiable': 416,
    'graph_failure': 403, 'network_failure': 502, 'transcript': 200,
}.items():
    setattr(DeliveryParity, 'test_content_' + _scenario, content_case(_scenario, _status))


def tracking_case(scenario, status, count):
    def test(self):
        result = self.parity('curriculum_teams_recording_events', scenario)
        self.assertEqual((result['status'], len(result['writes'])), (status, count))
        if scenario == 'tracking_account':
            row = result['writes'][0][1]
            self.assertEqual((row['viewer_id'], row['viewer_email']), ('ACCOUNT', 'account@example.invalid'))
            self.assertEqual((row['video_time_seconds'], row['volume'], row['skip_delta_seconds']), (0, 1, -5))
        if scenario == 'tracking_limit':
            self.assertEqual(result['content']['saved'], 200)
    return test


for _scenario, _status, _count in (
    ('tracking_account', 200, 1), ('tracking_limit', 200, 200), ('tracking_malformed', 200, 1),
    ('tracking_empty', 400, 0), ('tracking_method', 405, 0), ('foreign_artifact', 404, 0),
):
    setattr(DeliveryParity, 'test_' + _scenario, tracking_case(_scenario, _status, _count))


def join_case(scenario, status):
    def test(self):
        result = self.parity('curriculum_teams_meeting_join', scenario)
        self.assertEqual(result['status'], status)
        self.assertEqual(len(result['writes']), int(status == 302))
        if status == 302:
            self.assertEqual(result['headers']['Cache-Control'], 'no-store, private')
            self.assertEqual(result['writes'][0][2]['viewer_email'], 'user@example.invalid')
    return test


for _scenario, _status in (('join_cancelled', 410), ('join_superseded', 410),
                          ('join_invalid', 409), ('join_authenticated', 302)):
    setattr(DeliveryParity, 'test_' + _scenario, join_case(_scenario, _status))


if __name__ == '__main__':
    unittest.main()
