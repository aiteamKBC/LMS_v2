"""Standard editor transport/binding regressions; synthetic data, no DB/network."""
import copy
import json
from contextlib import nullcontext, ExitStack
from types import SimpleNamespace
from unittest.mock import Mock, patch
from urllib.parse import quote

from django.http import JsonResponse
from django.core import signing
from django.test import SimpleTestCase, RequestFactory

from . import teams_original_calendar as original
from . import teams_imported_calendar_update as imported
from . import teams_imported_meeting_edit as editing
from . import teams_calendar_state as state
from . import views


OWNER = '11111111-1111-1111-1111-111111111111'
JOIN = 'https://teams.microsoft.com/l/meetup-join/test?context=' + quote(json.dumps({'Oid': OWNER}))


def fixtures():
    series = {'id': 'LIVE', 'module_catalogue_id': 'MODULE', 'meeting_type': 'linked-external',
              'organizer_email': 'group@example.invalid', 'join_url': JOIN, 'graph_event_id': '',
              'online_meeting_id': 'ONLINE', 'status': 'active', 'attendees': '[]',
              'presenters': '[]', 'co_organizers': '[]', 'calendar_series': []}
    rows = [{'id': 'OCC', 'live_session_id': 'LIVE', 'session_number': 8, 'join_url': JOIN,
             'graph_event_id': '', 'scheduled_start': '2026-10-28T09:00:00Z', 'scheduled_end': '2026-10-28T11:00:00Z',
             'status': 'completed', 'attendance_report_id': 'REPORT', 'participant_count': 12}]
    master = {'id': 'ROOT', 'type': 'seriesMaster', 'isOrganizer': True, 'onlineMeeting': {'joinUrl': JOIN},
              'attendees': [{'type': 'required', 'emailAddress': {'address': 'learner@example.invalid'}}]}
    events = [{'id': 'GRAPH-OCC', 'type': 'occurrence', 'seriesMasterId': 'ROOT', 'onlineMeeting': {'joinUrl': JOIN},
               'start': {'dateTime': '2026-10-28T09:00:00', 'timeZone': 'UTC'},
               'end': {'dateTime': '2026-10-28T11:00:00', 'timeZone': 'UTC'}}]
    return series, rows, master, events


class OriginalCalendarTransportTests(SimpleTestCase):
    def setUp(self):
        series, _, _, _ = fixtures()
        self.client = Mock()
        self.calendar = original.OriginalCalendar(series, {'accessToken': 'synthetic-test-token'},
            'groups/GROUP/events/ROOT', self.client)

    def test_only_the_original_calendar_is_translated(self):
        self.assertEqual(self.calendar.path('users/group%40example.invalid/events/GRAPH-OCC?x=1'), 'groups/GROUP/events/GRAPH-OCC?x=1')
        self.assertIsNone(self.calendar.path('users/another/events/ROOT'))
        self.assertIsNone(self.calendar.path('users/group%40example.invalid/events/../calendar'))
        self.assertIsNone(self.calendar.path('https://example.invalid/users/group%40example.invalid/events'))

    def test_unrelated_calendar_requests_and_online_meeting_writes_are_refused(self):
        for method, path in [('PATCH', 'users/another/events/E'), ('GET', 'groups/another/events/E'),
                             ('PATCH', f'users/{OWNER}/onlineMeetings/ANOTHER'), ('POST', f'users/{OWNER}/onlineMeetings')]:
            with self.subTest(path=path), self.assertRaises(RuntimeError):
                self.calendar.check_application_request(method, path)
        self.calendar.check_application_request('GET', 'users?$select=id')
        self.calendar.check_application_request('PATCH', f'users/{OWNER}/onlineMeetings/ONLINE')

    def test_silent_patch_keeps_the_existing_event_and_preferences(self):
        response = Mock(status_code=204, content=b'')
        self.client.client.request.return_value = response
        self.assertEqual(self.calendar.request('PATCH', 'users/group%40example.invalid/events/ROOT',
            payload={'attendees': []}, headers={'Prefer': 'outlook.send-invitations="none"'}), {})
        self.client.client.request.assert_called_once_with('PATCH', 'groups/GROUP/events/ROOT',
            json={'attendees': []}, headers={'Prefer': 'outlook.send-invitations="none"'})

    def test_no_replacement_can_be_created(self):
        with self.assertRaises(RuntimeError):
            self.calendar.request('POST', 'users/group%40example.invalid/events', payload={})
        self.client.client.request.assert_not_called()

    def test_status_read_does_not_write_and_propagates_denied_access(self):
        for status, code in [(403, 'ErrorAccessDenied'), (404, 'Request_ResourceNotFound')]:
            self.client.client.get.return_value = Mock(status_code=status, json=Mock(return_value={'error': {'code': code}}))
            with self.subTest(status=status), self.assertRaises(state.CalendarStateError):
                self.calendar.read('users/group%40example.invalid/events/ROOT')
        self.client.client.request.assert_not_called()

    def test_group_cancellation_uses_one_delete_after_identity_preflight(self):
        from . import teams_calendar_actions as actions
        series, _, master, _ = fixtures()
        client = Mock()
        client.__enter__ = Mock(return_value=client)
        client.__exit__ = Mock(return_value=False)
        client.get.return_value = Mock(status_code=200, json=Mock(return_value={**master, '@odata.etag': 'VERSION'}))
        client.delete.return_value = Mock(status_code=204)
        token = original._original.set(self.calendar)
        try:
            with patch('coach_api.views.get_graph_settings', return_value={'base_url': 'https://graph.microsoft.com/v1.0'}), patch.object(actions.httpx, 'Client', return_value=client):
                self.assertTrue(actions.graph_action(series, {'action': 'cancel', 'eventId': 'ROOT', 'joinUrl': JOIN, 'etag': 'VERSION'}, 'Reviewed cancellation'))
        finally:
            original._original.reset(token)
        client.delete.assert_called_once_with('groups/GROUP/events/ROOT')
        client.post.assert_not_called()


class OriginalCalendarBindingTests(SimpleTestCase):
    def setUp(self):
        self.series, self.rows, self.master, self.events = fixtures()

    def test_main_update_preserves_a_selected_week_meeting_and_the_following_slots(self):
        weeks = [{'id': f'W{i}', 'week_number': i + 1} for i in range(3)]
        components = [{'id': f'C{i}', 'week_id': f'W{i}', 'type': 'live_session',
            'settings_json': {'teamsMeetingScope': 'main', **({'liveSessionLinkOverride': 'https://example.invalid/masterclass',
                'teamsOccurrenceId': 'FOREIGN-OCC', 'sessionDate': '2026-10-02'} if i == 1 else {})}} for i in range(3)]
        before = copy.deepcopy(components)
        plan = [{'date': day} for day in ('2026-10-01', '2026-10-08', '2026-10-15')]
        rows = [{'id': f'O{i}', 'session_number': i + 1, 'join_url': JOIN,
                 'scheduled_start': item['date'] + 'T09:00:00Z'} for i, item in enumerate(plan)]
        def fetch(table, *_args, **_kwargs):
            return {views.AUTHORING_MODULES_TABLE: [{'module_catalogue_id': 'MODULE'}],
                    views.AUTHORING_WEEKS_TABLE: weeks, views.AUTHORING_COMPONENTS_TABLE: components}.get(table, [])
        with ExitStack() as stack:
            mocks = {'authoring_fetch_all': fetch, 'active_week_rows': lambda rows: rows,
                'active_component_rows': lambda rows: rows, 'module_has_booked_series': lambda *_: True,
                'module_structure_uses_session_rows': lambda *_: False, 'module_stored_session_count': lambda *_: 3,
                'delivery_days_per_week': lambda *_: 1, 'module_week_session_plan': lambda *_: plan,
                'module_session_clock': lambda *_: ('09:00', '11:00', 120),
                'live_occurrence_component_settings': lambda row, _settings: {'teamsOccurrenceId': row['id'],
                    'sessionDate': row['scheduled_start'][:10], 'liveSessionUrl': JOIN, 'teamsMeetingUrl': JOIN}}
            for name, replacement in mocks.items():
                stack.enter_context(patch.object(views, name, replacement))
            write = stack.enter_context(patch.object(views, 'update_authoring_rows'))
            self.assertEqual(views.attach_teams_meeting_to_module_weeks('MODULE',
                {**self.series, 'meeting_type': 'live-session'}, {'sessionTimeZone': 'Europe/London'}, rows), (2, 0))
        self.assertEqual([call.args[2] for call in write.call_args_list], [['C0'], ['C2']])
        saved = [views.parse_json_value(call.args[3]['settings_json'], {}) for call in write.call_args_list]
        self.assertEqual([row['teamsOccurrenceId'] for row in saved], ['O0', 'O2'])
        self.assertEqual([row['sessionDate'] for row in saved], ['2026-10-01', '2026-10-15'])
        self.assertEqual(components, before)

    def bind(self, current=None):
        before = copy.deepcopy(self.rows)
        with patch.object(original.transaction, 'atomic', nullcontext), \
             patch.object(state, 'load_calendar_state', return_value=(current or self.series, self.rows, {})), \
             patch.object(views, 'update_authoring_rows') as write:
            original.bind_calendar(self.series, self.rows, self.master, self.events)
        self.assertEqual(self.rows, before)
        return write

    def test_binding_preserves_history_and_only_fills_proven_ids_and_roster(self):
        write = self.bind()
        self.assertEqual(write.call_count, 2)
        self.assertEqual(write.call_args_list[0].args[3]['graph_event_id'], 'ROOT')
        self.assertEqual(write.call_args_list[1].args[2], ['OCC', 'LIVE'])
        self.assertEqual(write.call_args_list[1].args[3], {'graph_event_id': 'GRAPH-OCC'})
        for call in write.call_args_list:
            self.assertLessEqual(set(call.args[3]), {'graph_event_id', 'attendees', 'presenters', 'co_organizers'})

    def test_ambiguous_or_foreign_meeting_does_not_acquire_an_occurrence_id(self):
        for ambiguous in (False, True):
            with self.subTest(ambiguous=ambiguous):
                self.series, self.rows, self.master, self.events = fixtures()
                if ambiguous:
                    self.events.append({**self.events[0], 'id': 'DUPLICATE'})
                else:
                    self.rows[0]['join_url'] = 'https://example.invalid/master-class'
                self.assertEqual(self.bind().call_count, 1)

    def test_an_existing_occurrence_identity_is_retained(self):
        self.rows[0]['graph_event_id'] = 'KEEP-EXCEPTION'
        self.assertEqual(self.bind().call_count, 1)

    def test_a_different_root_and_concurrent_save_are_refused(self):
        self.series['graph_event_id'] = 'OTHER'
        with self.assertRaises(imported.Blocked):
            self.bind()
        self.series['graph_event_id'] = ''
        with self.assertRaises(imported.Blocked):
            self.bind({**self.series, 'join_url': 'https://example.invalid/changed'})

    def test_only_proved_non_secret_owner_binding_is_saved_for_recovery(self):
        from . import teams_calendar_actions as actions
        with patch.object(original.transaction, 'atomic', nullcontext), \
             patch.object(state, 'load_calendar_state', return_value=(self.series, self.rows, {})), \
             patch.object(views, 'update_authoring_rows'), patch.object(actions, 'store_snapshot') as store:
            original.bind_calendar(self.series, self.rows, self.master, self.events, original_path='groups/GROUP/events/ROOT')
        binding = store.call_args.args[1]['originalCalendar']
        self.assertEqual(set(binding), {'liveId', 'joinUrl', 'organizer', 'eventId', 'path'})
        self.assertEqual(binding['path'], 'groups/GROUP/events/ROOT')
        series = {**self.series, 'graph_event_id': 'ROOT'}
        self.assertEqual(original.saved_binding(series, {'originalCalendar': binding}, {'calendarKind': 'group'}), binding['path'])
        self.assertIsNone(original.saved_binding({**series, 'join_url': 'https://example.invalid/another'}, {'originalCalendar': binding}, {'calendarKind': 'group'}))
        self.assertIsNone(original.saved_binding(series, {'originalCalendar': binding}, {'calendarKind': 'user'}))

    def test_group_default_calendar_scan_does_not_rewrite_completed_attendance(self):
        from .teams_cancellation_checks import cancellation_plan
        self.series['graph_event_id'] = 'ROOT'
        before = copy.deepcopy(self.rows)
        binding = {'path': 'groups/GROUP/events/ROOT'}
        paths = []
        def read(path):
            paths.append(path)
            return None if '/events/ROOT?' in path else {'value': []}
        plan = cancellation_plan(self.series, self.rows, {'originalCalendar': binding}, read, original_prefix='groups/GROUP')
        self.assertTrue(plan['seriesCancelled'])
        self.assertEqual(plan['cancelledIds'], [])
        self.assertEqual(plan['snapshot']['originalCalendar'], binding)
        self.assertEqual(self.rows, before)
        self.assertFalse(any('/calendars?' in path for path in paths))

    def test_a_live_group_event_with_the_same_link_prevents_false_cancellation(self):
        from .teams_cancellation_checks import cancellation_plan
        self.series['graph_event_id'] = 'ROOT'
        def read(path):
            return None if '/events/ROOT?' in path else {'value': [{'id': 'MOVED', 'onlineMeeting': {'joinUrl': JOIN}}]}
        with self.assertRaises(state.CalendarStateError):
            cancellation_plan(self.series, self.rows, {}, read, original_prefix='groups/GROUP')


class StandardOriginalCalendarRequestTests(SimpleTestCase):
    def setUp(self):
        self.series, self.rows, self.master, self.events = fixtures()
        self.request = RequestFactory().post('/calendar-action/', data='{}', content_type='application/json')
        self.request.login_account = SimpleNamespace(pk=7)
        online = patch.object(original, 'read_original_online', return_value=(None, None))
        online.start()
        self.addCleanup(online.stop)

    def test_native_calendar_uses_the_existing_view_without_imported_transport(self):
        callback = Mock(return_value=JsonResponse({'updated': True}))
        with patch.object(views, 'authoring_fetch_all', return_value=[{**self.series, 'meeting_type': 'live-session'}]), \
             patch.object(imported, 'access_for') as access:
            self.assertEqual(original.original_calendar_request(callback)(self.request, 'LIVE').status_code, 200)
        access.assert_not_called()
        callback.assert_called_once_with(self.request, 'LIVE')

    def test_missing_owner_access_does_not_enter_the_standard_mutation(self):
        callback = Mock()
        callback.__name__ = 'calendar_action'
        with patch.object(views, 'authoring_fetch_all', return_value=[self.series]), \
             patch.object(state, 'load_calendar_state', return_value=(self.series, self.rows, {})), \
             patch.object(imported, 'access_for', return_value={'calendarKind': 'group'}), \
             patch.object(imported, 'require_access', side_effect=imported.Blocked('denied', 'Connect the original calendar.', connection_required=True, kind='group')):
            response = original.original_calendar_request(callback)(self.request, 'LIVE')
        self.assertEqual(response.status_code, 409)
        self.assertTrue(json.loads(response.content)['connectionRequired'])
        callback.assert_not_called()
        self.assertIsNone(original.current_calendar())

    def test_verified_group_reuses_the_same_view_and_clears_request_context(self):
        def view(request, live_id):
            self.assertTrue(original.calendar_authorized(live_id))
            self.assertFalse(original.calendar_authorized('OTHER'))
            return JsonResponse({'updated': True})
        client = Mock()
        client.__enter__ = Mock(return_value=client)
        client.__exit__ = Mock(return_value=False)
        with patch.object(views, 'authoring_fetch_all', return_value=[self.series]), \
             patch.object(state, 'load_calendar_state', return_value=(self.series, self.rows, {})), \
             patch.object(imported, 'access_for', return_value={'calendarKind': 'group', 'scopes': []}), \
             patch.object(imported, 'require_access'), patch.object(imported, 'CalendarClient', return_value=client), \
             patch.object(editing, 'verified_context', return_value=('groups/GROUP/events/ROOT', self.master, self.events, None)), \
             patch.object(editing, 'online_path', return_value=None), patch.object(original, 'bind_calendar') as bind:
            self.assertEqual(original.original_calendar_request(view)(self.request, 'LIVE').status_code, 200)
        bind.assert_called_once_with(self.series, self.rows, self.master, self.events, None, original_path='groups/GROUP/events/ROOT')
        self.assertIsNone(original.current_calendar())

    def test_patch_rejects_a_missing_stale_or_different_accounts_read(self):
        access = {'mode': 'application', 'actorId': 'APP', 'calendarKind': 'group', 'tenantId': 'TENANT'}
        source = {'standard': True, 'kind': editing.KIND, 'liveId': 'LIVE', 'actor': '7', 'version': 'CURRENT',
                  'accessMode': 'application', 'accessActor': 'APP', 'calendarKind': 'group', 'tenantId': 'TENANT',
                  'path': 'groups/GROUP/events/ROOT', 'master': self.master, 'joinUrl': JOIN}
        for change in ('missing', 'stale', 'other-account', 'microsoft-changed', 'valid'):
            with self.subTest(change=change), ExitStack() as stack:
                proof = {**source, **({'version': 'OLD'} if change == 'stale' else {'actor': '8'} if change == 'other-account' else {})}
                payload = {'peopleOnly': True}
                if change != 'missing':
                    payload['originalSourceToken'] = signing.dumps(proof, salt=editing.SALT)
                req = RequestFactory().patch('/schedule/', data=json.dumps(payload), content_type='application/json')
                req.login_account = self.request.login_account
                client = Mock()
                client.__enter__ = Mock(return_value=client)
                client.__exit__ = Mock(return_value=False)
                callback = Mock(return_value=JsonResponse({'updated': True}))
                callback.__name__ = 'curriculum_teams_meeting_schedule'
                for target, name, value in [(views, 'authoring_fetch_all', [self.series]),
                    (state, 'load_calendar_state', (self.series, self.rows, {})), (imported, 'access_for', access),
                    (imported, 'require_access', None), (imported, 'CalendarClient', client),
                    (editing, 'load_edit', (self.series, self.rows, {}, {}, 'CURRENT')),
                    (editing, 'online_path', None),
                    (editing, 'verified_context', ('groups/GROUP/events/ROOT', {**self.master, **({'subject': 'Changed by another staff member'} if change == 'microsoft-changed' else {})}, self.events, None))]:
                    stack.enter_context(patch.object(target, name, return_value=value))
                bind = stack.enter_context(patch.object(original, 'bind_calendar'))
                response = original.original_calendar_request(callback)(req, 'LIVE')
                if change == 'valid':
                    self.assertEqual(response.status_code, 200)
                    callback.assert_called_once()
                else:
                    self.assertEqual(response.status_code, 409)
                    callback.assert_not_called()
                    bind.assert_not_called()
                self.assertIsNone(original.current_calendar())

    def test_read_only_connection_does_not_rewrite_binding_or_history(self):
        req = RequestFactory().get('/compare/')
        client = Mock()
        client.__enter__ = Mock(return_value=client)
        client.__exit__ = Mock(return_value=False)
        with patch.object(views, 'authoring_fetch_all', return_value=[self.series]), \
             patch.object(state, 'load_calendar_state', return_value=(self.series, self.rows, {})), \
             patch.object(imported, 'access_for', return_value={}), patch.object(imported, 'require_access'), \
             patch.object(imported, 'CalendarClient', return_value=client), \
             patch.object(editing, 'verified_context', return_value=('groups/GROUP/events/ROOT', self.master, self.events, None)), \
             patch.object(editing, 'online_path', return_value=None), patch.object(original, 'bind_calendar') as bind:
            response = original.original_calendar_read(lambda *_args: JsonResponse({'readOnly': True}))(req, 'LIVE')
        self.assertEqual(response.status_code, 200)
        bind.assert_not_called()
        self.assertIsNone(original.current_calendar())

    def test_pending_cancellation_status_uses_the_saved_owner_without_resending(self):
        self.series['graph_event_id'] = 'ROOT'
        snapshot = {'originalCalendar': {'liveId': 'LIVE', 'joinUrl': JOIN, 'organizer': self.series['organizer_email'],
            'eventId': 'ROOT', 'path': 'groups/GROUP/events/ROOT'}, 'management': {'id': 'OP', 'status': 'uncertain'}}
        req = RequestFactory().post('/calendar-action/', data='{"stage":"status"}', content_type='application/json')
        def calendar_action(*_args):
            current = original.current_calendar()
            self.assertTrue(current.read_only)
            self.assertIsNone(current.read('users/group%40example.invalid/events/ROOT'))
            with self.assertRaises(RuntimeError):
                current.request('DELETE', 'users/group%40example.invalid/events/ROOT')
            return JsonResponse({'status': 'done'})
        client = Mock()
        client.__enter__ = Mock(return_value=client)
        client.__exit__ = Mock(return_value=False)
        client.client.get.return_value = Mock(status_code=404, json=Mock(return_value={'error': {'code': 'ErrorItemNotFound'}}))
        with patch.object(views, 'authoring_fetch_all', return_value=[self.series]), \
             patch.object(state, 'load_calendar_state', return_value=(self.series, self.rows, snapshot)), \
             patch.object(imported, 'access_for', return_value={'calendarKind': 'group'}), patch.object(imported, 'require_access'), \
             patch.object(imported, 'CalendarClient', return_value=client), patch.object(editing, 'verified_context') as active_master, \
             patch.object(original, 'bind_calendar') as bind:
            response = original.original_calendar_request(calendar_action)(req, 'LIVE')
        self.assertEqual(response.status_code, 200)
        active_master.assert_not_called()
        bind.assert_not_called()
        client.client.request.assert_not_called()
        self.assertIsNone(original.current_calendar())


class StandardEditorReadTests(SimpleTestCase):
    def test_group_calendar_permission_report_checks_the_online_organizer_separately(self):
        from . import teams_permission_check as permissions
        series, _, _, _ = fixtures()
        report = {'organizer': {'email': OWNER}, 'app': {'permissionContext': 'application'}}
        with patch.object(views, 'authoring_fetch_all', return_value=[series]), \
             patch.object(original, 'current_calendar', return_value=SimpleNamespace()), \
             patch.object(views, 'teams_online_meeting_owner_id', return_value=OWNER), \
             patch('coach_api.views.microsoft_graph_token', return_value='synthetic-test-token'), \
             patch.object(permissions, 'permission_report', return_value=report) as build:
            actual = permissions.check_live_session('LIVE')
        self.assertEqual(build.call_args.kwargs['organizer'], OWNER)
        self.assertEqual(actual['organizer']['email'], 'group@example.invalid')
        self.assertIn('verified original calendar', actual['app']['permissionContext'])

    def test_calendar_delegation_uses_the_existing_application_for_verified_online_options(self):
        series, _, _, _ = fixtures()
        meeting = {'id': 'ONLINE', 'joinWebUrl': JOIN, 'participants': {'organizer': {'identity': {'user': {'id': OWNER}}},
            'attendees': [{'upn': 'presenter@example.invalid', 'role': 'presenter'}]}}
        with patch('coach_api.views.microsoft_graph_request', return_value=meeting) as graph:
            path, actual = original.read_original_online(series, {'scopes': ['Group.ReadWrite.All']}, Mock())
        self.assertEqual(actual, meeting)
        self.assertEqual(path, f'users/{OWNER}/onlineMeetings/ONLINE')
        graph.assert_called_once_with('GET', path)

    def test_standard_read_binds_proven_identifiers_before_signing_the_fresh_version(self):
        series, rows, master, events = fixtures()
        client = Mock()
        client.__enter__ = Mock(return_value=client)
        client.__exit__ = Mock(return_value=False)
        with patch.object(editing, 'load_edit', side_effect=[(series, rows, {}, {}, 'BEFORE'), (series, rows, {}, {}, 'AFTER')]), \
             patch.object(imported, 'require_access'), patch.object(imported, 'CalendarClient', return_value=client), \
             patch.object(editing, 'verified_context', return_value=('groups/GROUP/events/ROOT', master, events, __import__('datetime').date(2026, 10, 28))), \
             patch.object(editing, 'online_path', return_value=None), patch.object(original, 'read_original_online', return_value=(None, None)), patch.object(original, 'bind_calendar') as bind:
            result = editing.read_edit('LIVE', '7', {'mode': 'application', 'actorId': 'APP', 'calendarKind': 'group', 'tenantId': 'TENANT'}, standard=True)
        self.assertEqual(result['status'], 'editable')
        bind.assert_called_once_with(series, rows, master, events, None, original_path='groups/GROUP/events/ROOT')
        token = signing.loads(result['sourceToken'], salt=editing.SALT)
        self.assertEqual(token['version'], 'AFTER')

    def test_silent_extension_retains_the_existing_event_and_concurrency_header(self):
        client = imported.CalendarClient.__new__(imported.CalendarClient)
        client.client = Mock()
        client.client.patch.return_value = Mock(status_code=204)
        client.extend({'path': 'groups/GROUP/events/ROOT', 'afterRecurrence': {'range': {'endDate': '2027-01-29'}}, 'etag': 'VERSION', 'notifyAttendees': False})
        client.client.patch.assert_called_once_with('groups/GROUP/events/ROOT', json={'recurrence': {'range': {'endDate': '2027-01-29'}}},
            headers={'If-Match': 'VERSION', 'Prefer': 'outlook.send-invitations="none"'})


class OriginalScheduleHistoryTests(SimpleTestCase):
    def test_blocked_extension_does_not_apply_people_or_create_another_event(self):
        request = RequestFactory().patch('/schedule/', data='{}', content_type='application/json')
        request.login_account = SimpleNamespace(pk=7)
        view = Mock()
        with patch.object(imported, 'review', return_value={'status': 'blocked', 'message': 'Historical dates must be preserved.'}), \
             patch.object(imported, 'confirm') as confirm, \
             patch.object(views, 'held_schedule_snapshot', return_value=[]):
            response = original.update_original_schedule(request, 'LIVE', {}, view, (), {})
        self.assertEqual(response.status_code, 409)
        view.assert_not_called()
        confirm.assert_not_called()

    def test_the_standard_update_uses_held_dates_after_verified_extension(self):
        series, rows, _, _ = fixtures()
        series['graph_event_id'] = 'ROOT'
        original_body = json.dumps({'attendees': ['new@example.invalid'], 'notifyAttendees': False}).encode()
        request = RequestFactory().patch('/schedule/', data=original_body, content_type='application/json')
        request.login_account = SimpleNamespace(pk=7)
        def view(req, live_id):
            payload = json.loads(req.body)
            self.assertEqual(live_id, 'LIVE')
            self.assertTrue(payload['peopleOnly'])
            self.assertEqual(payload['scheduledOccurrences'], [{'sessionNumber': 8, 'startDateTimeUtc': '2026-10-28T09:00:00Z', 'durationMinutes': 120}])
            self.assertEqual(payload['attendees'], ['new@example.invalid'])
            return JsonResponse({'updated': True})
        with patch.object(imported, 'review', return_value={'status': 'up_to_date'}) as review, \
             patch.object(state, 'load_calendar_state', return_value=(series, rows, {})), \
             patch.object(views, 'held_schedule_snapshot', return_value=[]):
            self.assertEqual(original.update_original_schedule(request, 'LIVE', {}, view, (), {}).status_code, 200)
        review.assert_called_once_with('LIVE', '7', {}, notify_attendees=False, standard_before=[])
        self.assertEqual(request.body, original_body)
