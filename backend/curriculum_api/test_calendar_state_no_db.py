"""Direct mocked cancellation regression runner: no Django setup, DB or network."""
import ast
import copy
import functools
import json
import time
import sys
import types
import unittest
from contextlib import contextmanager, nullcontext
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import Mock, patch
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).parent
package = types.ModuleType('curriculum_api')
package.__path__ = [str(ROOT)]
sys.modules['curriculum_api'] = package
from curriculum_api.teams_cancellation_checks import CalendarStateError, cancellation_plan


def functions(path, names, namespace):
    tree = ast.parse(path.read_text(encoding='utf-8-sig'))
    nodes = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names]
    assert len(nodes) == len(names)
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(path), 'exec'), namespace)


class Response(dict):
    def __init__(self, data=None, status=200):
        super().__init__(data or {})
        self.status_code = status


class CalendarFixture(unittest.TestCase):
    def setUp(self):
        network = patch('socket.socket', side_effect=AssertionError('Network forbidden'))
        network.start()
        self.addCleanup(network.stop)
        self.series = {'id': 'LIVE-1', 'status': 'active', 'organizer_email': 'organizer@example.invalid',
                       'graph_event_id': 'master-1', 'join_url': 'https://teams.microsoft.com/meet/synthetic'}
        self.rows = [{'id': f'OCC-{i}', 'session_number': i, 'graph_event_id': 'master-1',
                      'scheduled_start': f'2026-10-{day}T08:00:00Z', 'scheduled_end': f'2026-10-{day}T10:00:00Z',
                      'status': 'scheduled', 'join_url': self.series['join_url']} for i, day in [(1, '08'), (2, '15')]]
        self.master = {'id': 'master-1', 'type': 'seriesMaster', 'iCalUId': 'uid-1', 'isCancelled': False,
                       'onlineMeeting': {'joinUrl': self.series['join_url']}, 'cancelledOccurrences': []}
        self.instances = [self.instance(row) for row in self.rows]
        self.saved = {}
        self.calls = []
        self.calendars = [{'id': 'calendar-1'}]
        self.calendar_events = []

    def instance(self, row):
        return {'id': 'instance-' + row['id'], 'occurrenceId': 'OID-' + row['id'], 'type': 'occurrence',
                'seriesMasterId': row['graph_event_id'], 'isCancelled': False,
                'start': {'dateTime': row['scheduled_start'], 'timeZone': 'UTC'},
                'end': {'dateTime': row['scheduled_end'], 'timeZone': 'UTC'}}

    def read(self, path):
        self.calls.append(path)
        resource = unquote(urlparse(path).path)
        if resource.endswith('/instances'):
            return {'value': copy.deepcopy(self.instances)}
        if resource.endswith('/events/master-1'):
            return copy.deepcopy(self.master)
        if resource.endswith('/calendars'):
            return {'value': copy.deepcopy(self.calendars)}
        if resource.endswith('/calendars/calendar-1/events'):
            return {'value': copy.deepcopy(self.calendar_events)}
        raise AssertionError('Unexpected calendar read: ' + resource)

    def plan(self, read=None):
        return cancellation_plan(self.series, self.rows, self.saved, read or self.read)


class CancellationTests(CalendarFixture):
    def test_first_check_records_exact_occurrence_identities_without_cancellation(self):
        result = self.plan()
        self.assertEqual(result['cancelledIds'], [])
        self.assertEqual(result['errors'], [])
        self.assertEqual(result['snapshot']['occurrences']['OCC-2']['occurrenceId'], 'OID-OCC-2')

    def test_cancel_one_instance_preserves_its_neighbour(self):
        self.saved = self.plan()['snapshot']
        self.master['cancelledOccurrences'] = ['OID-OCC-1']
        self.instances = self.instances[1:]
        result = self.plan()
        self.assertEqual(result['cancelledIds'], ['OCC-1'])
        self.assertFalse(result['seriesCancelled'])
        self.assertEqual(result['errors'], [])

    def test_whole_series_preserves_completed_attendance(self):
        self.master['isCancelled'] = True
        self.rows[0].update(status='held', attendance_report_id='report', participant_count=3)
        result = self.plan()
        self.assertTrue(result['seriesCancelled'])
        self.assertEqual(result['cancelledIds'], ['OCC-2'])

    def test_history_is_preserved_even_if_scheduled_status_is_stale(self):
        self.master['isCancelled'] = True
        for key, value in [('actual_start', '2026-10-08T08:00:00Z'), ('attendance_report_id', 'report'), ('participant_count', 1)]:
            with self.subTest(key=key):
                self.rows[0][key] = value
                self.assertEqual(self.plan()['cancelledIds'], ['OCC-2'])
                del self.rows[0][key]

    def test_missing_root_requires_complete_calendar_search(self):
        self.master = None
        result = self.plan()
        self.assertTrue(result['seriesCancelled'])
        self.assertEqual(result['cancelledIds'], ['OCC-1', 'OCC-2'])
        self.assertTrue(any('/calendars/calendar-1/events?' in path for path in self.calls))

    def test_calendar_move_is_not_a_cancellation(self):
        self.saved = self.plan()['snapshot']
        self.master = None
        self.calendar_events = [{'id': 'new-id', 'iCalUId': 'uid-1', 'isCancelled': False}]
        with self.assertRaisesRegex(CalendarStateError, 'moved'):
            self.plan()

    def test_missing_event_with_inaccessible_calendar_is_not_cancellation(self):
        self.master = None
        self.calendars = []
        with self.assertRaises(CalendarStateError):
            self.plan()

    def test_failed_calendar_page_is_not_cancellation(self):
        self.master = None
        def read(path):
            if '/calendar-1/events?' in path:
                raise CalendarStateError('HTTP 403')
            return self.read(path)
        with self.assertRaisesRegex(CalendarStateError, '403'):
            self.plan(read)

    def test_pagination_never_follows_another_owner_or_host(self):
        self.master = None
        for next_link in ['https://example.invalid/v1.0/users/organizer/calendars',
                          'https://graph.microsoft.com/v1.0/users/other/calendars']:
            with self.subTest(next_link=next_link):
                def read(path):
                    if '/calendars?' in path:
                        return {'value': self.calendars, '@odata.nextLink': next_link}
                    return self.read(path)
                with self.assertRaisesRegex(CalendarStateError, 'unexpected'):
                    self.plan(read)

    def test_all_calendar_pages_are_checked_before_missing_is_confirmed(self):
        self.saved = self.plan()['snapshot']
        self.master = None
        def read(path):
            if 'skiptoken=' in path:
                return {'value': [{'id': 'moved', 'iCalUId': 'uid-1'}]}
            result = self.read(path)
            if '/calendar-1/events?' in path:
                result['@odata.nextLink'] = 'https://graph.microsoft.com/v1.0/' + path + '&skiptoken=next'
            return result
        with self.assertRaisesRegex(CalendarStateError, 'moved'):
            self.plan(read)

    def test_legacy_unmatched_session_is_visible_and_not_guessed_cancelled(self):
        self.instances = self.instances[1:]
        self.master['cancelledOccurrences'] = ['unknown-legacy-id']
        result = self.plan()
        self.assertEqual(result['cancelledIds'], [])
        self.assertEqual(len(result['errors']), 1)
        self.assertIn('Session 1', result['errors'][0])

    def test_graph_odata_key_syntax_and_encoding_preserve_calendar_pagination(self):
        self.master = None
        def read(path):
            if 'skiptoken=' in path:
                return {'value': []}
            result = self.read(path)
            if '/calendar-1/events?' in path:
                result['@odata.nextLink'] = "https://graph.microsoft.com/v1.0/users/organizer@example.invalid/calendars('calendar-1')/events?skiptoken=next"
            return result
        self.assertTrue(self.plan(read)['seriesCancelled'])

    def test_exception_moved_outside_window_still_matches_by_identity(self):
        self.saved = self.plan()['snapshot']
        moved = self.instances.pop(0)
        moved.update(type='exception', start={'dateTime': '2027-01-01T08:00:00Z'}, end={'dateTime': '2027-01-01T10:00:00Z'})
        self.master['exceptionOccurrences'] = [moved]
        result = self.plan()
        self.assertEqual(result['cancelledIds'], [])
        self.assertEqual(result['errors'], [])

    def test_foreign_parent_is_rejected(self):
        self.instances[0]['seriesMasterId'] = 'someone-else'
        with self.assertRaisesRegex(CalendarStateError, 'another series'):
            self.plan()

    def test_foreign_link_is_rejected(self):
        self.instances[0]['onlineMeeting'] = {'joinUrl': 'https://teams.microsoft.com/meet/other'}
        with self.assertRaisesRegex(CalendarStateError, 'different Microsoft join link'):
            self.plan()

    def test_changed_plan_invalidates_old_occurrence_binding(self):
        self.saved = self.plan()['snapshot']
        self.rows[0]['scheduled_start'] = '2026-10-08T09:00:00Z'
        self.master['cancelledOccurrences'] = ['OID-OCC-1']
        self.instances = self.instances[1:]
        result = self.plan()
        self.assertEqual(result['cancelledIds'], [])
        self.assertEqual(len(result['errors']), 1)

    def test_single_instance_cancellation(self):
        self.rows = self.rows[:1]
        self.master = {**self.instances[0], 'id': 'master-1', 'type': 'singleInstance', 'isCancelled': True}
        result = self.plan()
        self.assertTrue(result['seriesCancelled'])
        self.assertEqual(result['cancelledIds'], ['OCC-1'])

    def test_separate_weekday_series_is_not_cancelled_with_other_day(self):
        self.series['calendar_series'] = [{'eventId': 'master-1', 'sessionNumbers': [1]}, {'eventId': 'master-2', 'sessionNumbers': [2]}]
        self.rows[1]['graph_event_id'] = 'master-2'
        second = {**self.master, 'id': 'master-2'}
        self.instances[1]['seriesMasterId'] = 'master-2'
        self.master['isCancelled'] = True
        def read(path):
            if '/events/master-2?' in path:
                return second
            if '/events/master-2/instances?' in path:
                return {'value': self.instances[1:]}
            return self.read(path)
        result = self.plan(read)
        self.assertEqual(result['cancelledIds'], ['OCC-1'])
        self.assertFalse(result['seriesCancelled'])

    def test_standalone_replacement_survives_parent_cancellation(self):
        self.rows[1]['graph_event_id'] = 'replacement'
        replacement = {**self.instances[1], 'id': 'replacement', 'type': 'singleInstance'}
        self.master['isCancelled'] = True
        def read(path):
            return replacement if '/events/replacement?' in path else self.read(path)
        result = self.plan(read)
        self.assertEqual(result['cancelledIds'], ['OCC-1'])
        self.assertFalse(result['seriesCancelled'])

    def test_existing_cancelled_rows_are_not_reactivated(self):
        self.rows[0]['status'] = 'cancelled'
        self.assertEqual(self.plan()['cancelledIds'], [])
        self.assertEqual(self.rows[0]['status'], 'cancelled')


class ServiceTests(CalendarFixture):
    def setUp(self):
        super().setUp()
        self.v = types.ModuleType('curriculum_api.views')
        self.v.invalidate_curriculum_cache = Mock()
        self.v.__package__ = 'curriculum_api'
        modules = patch.dict(sys.modules, {'curriculum_api.views': self.v})
        modules.start()
        self.addCleanup(modules.stop)
        self.sql = []
        cursor = types.SimpleNamespace(execute=lambda query, values: self.sql.append((query, values)))
        self.loader = Mock(side_effect=lambda *args, **kwargs: copy.deepcopy((self.series, self.rows, self.saved)))
        self.n = {'__name__': 'curriculum_api.teams_calendar_state', '__package__': 'curriculum_api',
                  'json': json, 'datetime': datetime, 'timezone': timezone, 'CalendarStateError': CalendarStateError,
                  'cancellation_plan': cancellation_plan, 'load_calendar_state': self.loader,
                  'calendar_reader': lambda: nullcontext(self.read), 'transaction': types.SimpleNamespace(atomic=nullcontext),
                  'connection': types.SimpleNamespace(cursor=lambda: nullcontext(cursor))}
        functions(ROOT / 'teams_calendar_state.py', {'state_signature', 'reconcile_calendar'}, self.n)

    def test_persistence_changes_only_exact_series_occurrences_and_identity_snapshot(self):
        self.master['isCancelled'] = True
        self.rows[0].update(status='held', attendance_report_id='report')
        result = self.n['reconcile_calendar']('LIVE-1')
        self.assertEqual(result['cancelledSessions'], [2])
        self.assertEqual(len(self.sql), 3)
        self.assertIn('WHERE id = %s AND live_session_id = %s', self.sql[0][0])
        self.assertEqual(self.sql[0][1][1:], ['OCC-2', 'LIVE-1'])
        self.assertEqual(self.sql[1][1][1:], ['LIVE-1'])
        self.assertEqual(self.sql[2][1][0], 'LIVE-1')
        self.v.invalidate_curriculum_cache.assert_called_once()

    def test_concurrent_local_edit_prevents_any_write(self):
        first = copy.deepcopy((self.series, self.rows, self.saved))
        second = copy.deepcopy(first)
        second[1][0]['attendance_report_id'] = 'new-evidence'
        self.loader.side_effect = [first, second]
        with self.assertRaisesRegex(CalendarStateError, 'changed during'):
            self.n['reconcile_calendar']('LIVE-1')
        self.assertEqual(self.sql, [])

    def test_inactive_series_makes_no_graph_or_database_writes(self):
        self.series['status'] = 'cancelled'
        result = self.n['reconcile_calendar']('LIVE-1')
        self.assertFalse(result['changed'])
        self.assertEqual(self.calls, [])
        self.assertEqual(self.sql, [])

    def test_graph_failure_makes_no_database_writes(self):
        self.n['calendar_reader'] = lambda: nullcontext(Mock(side_effect=CalendarStateError('HTTP 429')))
        with self.assertRaisesRegex(CalendarStateError, '429'):
            self.n['reconcile_calendar']('LIVE-1')
        self.assertEqual(self.sql, [])


class BoundaryTests(unittest.TestCase):
    def setUp(self):
        network = patch('socket.socket', side_effect=AssertionError('Network forbidden'))
        network.start()
        self.addCleanup(network.stop)

    def test_actual_role_decorator_blocks_learners_and_anonymous_before_reconciliation(self):
        namespace = {'functools': functools, 'JsonResponse': Response,
                     'authenticate_request': lambda request: request.account, 'session_unreadable': lambda request: False}
        functions(ROOT.parent / 'login/permissions.py', {'_unauthenticated', '_unavailable', '_forbidden', 'require_role'}, namespace)
        reconcile = Mock(return_value={'changed': False, 'seriesStatus': 'active', 'cancelledSessions': [], 'errors': []})
        def post_only(fn):
            return lambda request, *args: fn(request, *args) if request.method == 'POST' else Response(status=405)
        namespace.update(transaction=types.SimpleNamespace(non_atomic_requests=lambda fn: fn), require_POST=post_only,
                         reconcile_calendar=reconcile, CalendarStateError=CalendarStateError,
                         httpx=types.SimpleNamespace(HTTPError=OSError))
        functions(ROOT / 'teams_calendar_state.py', {'sync_calendar_state'}, namespace)
        endpoint = namespace['sync_calendar_state']
        for role, code in [(None, 401), ('learner', 403), ('employer', 403), ('coach', 403), ('staff', 200), ('admin', 200)]:
            with self.subTest(role=role):
                request = types.SimpleNamespace(account=types.SimpleNamespace(role=role) if role else None, method='POST')
                self.assertEqual(endpoint(request, 'LIVE-1').status_code, code)
        self.assertEqual(reconcile.call_count, 2)
        self.assertEqual(endpoint(types.SimpleNamespace(account=types.SimpleNamespace(role='admin'), method='GET'), 'LIVE-1').status_code, 405)
        self.assertFalse(getattr(endpoint, 'csrf_exempt', False))

    def test_cancelled_join_never_redirects_or_records_a_launch(self):
        for series_status, occurrence_status in [('cancelled', 'scheduled'), ('active', 'cancelled')]:
            with self.subTest(series=series_status, occurrence=occurrence_status):
                upsert = Mock(side_effect=AssertionError('Launch must not be recorded'))
                namespace = {'require_GET': lambda fn: fn, 'ensure_live_session_tracking_tables': lambda: None,
                             'authoring_fetch_all': Mock(side_effect=[[{'status': occurrence_status}], [{'status': series_status}]]),
                             'LIVE_SESSION_OCCURRENCES_TABLE': 'occurrences', 'LIVE_SESSIONS_TABLE': 'series',
                             'json_error': lambda message, status: Response({'error': message}, status), 'authoring_upsert': upsert}
                functions(ROOT / 'views.py', {'curriculum_teams_meeting_join'}, namespace)
                result = namespace['curriculum_teams_meeting_join'](object(), 'LIVE-1', 'OCC-1')
                self.assertEqual(result.status_code, 410)
                upsert.assert_not_called()

    def test_calendar_transport_treats_only_confirmed_missing_events_as_absent(self):
        graph = types.ModuleType('coach_api.views')
        graph.get_graph_settings = lambda: {'base_url': 'https://graph.microsoft.com/v1.0'}
        graph.microsoft_graph_token = lambda: 'synthetic-token'
        response = types.SimpleNamespace(status_code=404, json=lambda: {'error': {'code': 'ErrorItemNotFound'}})
        client = types.SimpleNamespace(get=Mock(return_value=response))
        namespace = {'contextmanager': contextmanager, 'time': time, 'CalendarStateError': CalendarStateError,
                     'httpx': types.SimpleNamespace(Client=lambda **kwargs: nullcontext(client))}
        functions(ROOT / 'teams_calendar_state.py', {'calendar_reader'}, namespace)
        with patch.dict(sys.modules, {'coach_api': types.ModuleType('coach_api'), 'coach_api.views': graph}):
            with namespace['calendar_reader']() as read:
                self.assertIsNone(read('users/owner/events/master?$select=id'))
                for path in ['users/missing', 'users/owner/events/master/instances', 'users/owner/calendars']:
                    with self.subTest(path=path), self.assertRaises(CalendarStateError):
                        read(path)
                for status, code in [(403, 'ErrorAccessDenied'), (429, 'TooManyRequests'), (404, 'MailboxNotEnabledForRESTAPI'), (500, 'InternalServerError')]:
                    response.status_code = status
                    response.json = lambda: {'error': {'code': code}}
                    with self.subTest(status=status, code=code), self.assertRaises(CalendarStateError):
                        read('users/owner/events/master')


if __name__ == '__main__':
    unittest.main(verbosity=2)
