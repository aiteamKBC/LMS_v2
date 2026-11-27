"""Synthetic people/roles refresh: no database or Microsoft traffic."""
import copy
import json
from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import Mock, patch
from urllib.parse import quote

import httpx
from django.db import DatabaseError
from django.middleware.csrf import get_token
from django.test import Client, RequestFactory, SimpleTestCase, override_settings
from django.urls import path

from . import teams_people_refresh as refresh


OWNER = '11111111-1111-1111-1111-111111111111'
JOIN = 'https://teams.microsoft.com/l/meetup-join/synthetic?context=' + quote(json.dumps({'Oid': OWNER}))
urlpatterns = [path('refresh/<str:live_session_id>/', refresh.teams_people_refresh)]
REAL_SYNC_LOCK = refresh.people_sync_lock


class PeopleRefreshTests(SimpleTestCase):
    def setUp(self):
        lock = patch.object(refresh, 'people_sync_lock', return_value=nullcontext())
        self.lock = lock.start()
        self.addCleanup(lock.stop)
        cached = patch.object(refresh, 'cache')
        self.cached = cached.start()
        self.cached.get.return_value = None
        self.cached.get_many.return_value = {}
        self.addCleanup(cached.stop)
        committed = patch.object(refresh.transaction, 'on_commit', side_effect=lambda callback: callback())
        committed.start()
        self.addCleanup(committed.stop)
        self.series = {'id': 'LIVE', 'status': 'active', 'meeting_type': 'live-session', 'module_catalogue_id': 'MODULE',
                       'organizer_email': 'owner@example.invalid', 'graph_event_id': 'EVENT', 'join_url': JOIN,
                       'online_meeting_id': 'ONLINE', 'presenters': ['tutor@example.invalid'], 'co_organizers': [], 'attendees': []}
        self.event = {'id': 'EVENT', 'type': 'seriesMaster', 'isOrganizer': True,
                      'organizer': {'emailAddress': {'address': 'owner@example.invalid'}}, 'onlineMeeting': {'joinUrl': JOIN},
                      'attendees': [{'type': 'required', 'emailAddress': {'address': 'learner@example.invalid'}},
                                    {'type': 'required', 'emailAddress': {'address': 'tutor@example.invalid'}}]}
        self.meeting = {'id': 'ONLINE', 'joinWebUrl': JOIN, 'participants': {
            'organizer': {'identity': {'user': {'id': OWNER}}},
            'attendees': [{'upn': 'tutor@example.invalid', 'role': 'coorganizer'}]},
            'recordAutomatically': True, 'allowTranscription': True,
            'lobbyBypassSettings': {'scope': 'invited'}, 'meetingSpokenLanguageTag': 'en-GB'}
        self.reader = Mock(side_effect=lambda path, **kwargs: copy.deepcopy(self.meeting if 'onlineMeetings' in path else self.event))

    def test_reads_both_verified_identities_and_preserves_tutor_label(self):
        result = refresh.read_people(self.series, self.reader)
        self.assertEqual(result['presenters'], ['tutor@example.invalid'])
        self.assertEqual(result['coOrganizers'], ['tutor@example.invalid'])
        self.assertEqual(self.reader.call_count, 2)
        self.assertEqual(self.reader.call_args.kwargs, {'prefer': 'include-unknown-enum-members'})

    def test_wrong_event_link_owner_or_cancelled_event_is_not_imported(self):
        for changes in ({'id': 'FOREIGN'}, {'onlineMeeting': {'joinUrl': 'https://example.invalid/foreign'}},
                        {'isOrganizer': False}, {'isCancelled': True}, {'organizer': {}}, {'attendees': None}):
            with self.subTest(changes=changes):
                event = {**self.event, **changes}
                reader = Mock(side_effect=lambda path, **kwargs: self.meeting if 'onlineMeetings' in path else event)
                with self.assertRaises((refresh.CalendarStateError, refresh.Blocked)):
                    refresh.read_people(self.series, reader)

    def test_wrong_online_meeting_or_unknown_roles_cannot_clear_saved_lists(self):
        for changes in ({'id': 'FOREIGN'}, {'joinWebUrl': 'https://example.invalid/foreign'},
                        {'participants': {'attendees': [{'upn': 'tutor@example.invalid', 'role': 'unknownFutureValue'}]}}):
            with self.subTest(changes=changes):
                meeting = {**self.meeting, **changes}
                reader = Mock(side_effect=lambda path, **kwargs: meeting if 'onlineMeetings' in path else self.event)
                with self.assertRaises((refresh.CalendarStateError, refresh.Blocked)):
                    refresh.read_people(self.series, reader)

    def test_different_weekday_rosters_require_review_instead_of_merging_them(self):
        series = {**self.series, 'calendar_series': [
            {'eventId': 'EVENT', 'joinUrl': JOIN, 'onlineMeetingId': 'ONLINE'},
            {'eventId': 'SECOND', 'joinUrl': JOIN, 'onlineMeetingId': 'ONLINE'}]}
        def read(path, **kwargs):
            if 'onlineMeetings' in path:
                return self.meeting
            return {**self.event, 'id': 'SECOND', 'attendees': []} if '/SECOND?' in path else self.event
        with self.assertRaisesRegex(refresh.CalendarStateError, 'weekday meetings have different') as failure:
            refresh.read_people(series, read)
        self.assertEqual(refresh._failure_details(failure.exception), ('weekday_roster_mismatch', 'read_roster'))

    def test_import_is_scoped_to_people_and_roles_of_one_series(self):
        state = (self.series, [{'id': 'OCC', 'attendance_report_id': 'KEEP'}], {})
        with patch.object(refresh, 'load_calendar_state', return_value=state), \
                patch.object(refresh, 'calendar_reader', return_value=nullcontext(self.reader)), \
                patch.object(refresh.transaction, 'atomic', return_value=nullcontext()), \
                patch('curriculum_api.views.update_authoring_rows') as update, \
                patch('curriculum_api.views.invalidate_curriculum_cache'):
            result = refresh.refresh_people('LIVE')
        update.assert_called_once()
        self.assertEqual(update.call_args.args[1:3], ('id = %s', ['LIVE']))
        self.assertEqual(set(update.call_args.args[3]), {'attendees', 'co_organizers', 'updated_at'})
        self.assertEqual(result['form']['attendees'], ['learner@example.invalid'])
        self.assertEqual(result['form']['coOrganizers'], ['tutor@example.invalid'])

    def test_concurrent_local_change_prevents_import(self):
        with patch.object(refresh, 'load_calendar_state', side_effect=[(self.series, [], {}), ({**self.series, 'updated_at': 'NEW'}, [], {})]), \
                patch.object(refresh, 'calendar_reader', return_value=nullcontext(self.reader)), \
                patch.object(refresh.transaction, 'atomic', return_value=nullcontext()), \
                patch('curriculum_api.views.update_authoring_rows') as update:
            with self.assertRaisesRegex(refresh.CalendarStateError, 'changed during') as failure:
                refresh.refresh_people('LIVE')
        self.assertEqual(refresh._failure_details(failure.exception), ('saved_state_changed', 'verify_saved_state'))
        update.assert_not_called()

    def test_additional_meeting_updates_its_own_editor_without_changing_the_main_booking(self):
        series = {**self.series, 'status': 'week-meeting', 'meeting_type': 'week-additional'}
        settings = {'extraTeamsLiveSessionId': 'LIVE', 'extraTeamsEventId': 'EVENT', 'extraTeamsMeetingUrl': JOIN,
                    'extraTeamsOnlineMeetingId': 'ONLINE', 'extraTeamsOrganizerEmail': 'OWNER@example.invalid',
                    'extraTeamsStartDateTimeUtc': '2026-12-16T12:00:00Z', 'extraTeamsDurationMinutes': 120,
                    'extraTeamsPresenters': [], 'extraTeamsCoOrganizers': [], 'extraTeamsAttendees': [],
                    'teamsOccurrenceId': 'MAIN-OCC-KEEP', 'teamsMeetingUrl': 'https://example.invalid/main-keep',
                    'sessionDate': '2026-12-16', 'customValue': {'keep': True}}
        cursor = Mock()
        cursor.__enter__ = Mock(return_value=cursor)
        cursor.__exit__ = Mock(return_value=False)
        cursor.fetchall.return_value = [('COMP-ONE', json.dumps(settings))]
        with patch.object(refresh, 'load_calendar_state', return_value=(series, [], {})), \
                patch.object(refresh, 'calendar_reader', return_value=nullcontext(self.reader)), \
                patch.object(refresh.transaction, 'atomic', return_value=nullcontext()), \
                patch.object(refresh, 'connection', SimpleNamespace(cursor=lambda: cursor)), \
                patch('curriculum_api.views.update_authoring_rows') as update, \
                patch('curriculum_api.views.invalidate_curriculum_cache'):
            self.assertTrue(refresh.refresh_people('LIVE')['changed'])
        component_write = next(call for call in update.call_args_list if call.args[0] == 'components')
        self.assertEqual(component_write.args[1:3], ('id = %s', ['COMP-ONE']))
        actual = component_write.args[3]['settings_json']
        actual = json.loads(actual) if isinstance(actual, str) else actual
        self.assertEqual(actual, {**settings, 'extraTeamsPresenters': ['tutor@example.invalid'],
                                 'extraTeamsCoOrganizers': ['tutor@example.invalid'],
                                 'extraTeamsAttendees': ['learner@example.invalid']})
        self.assertEqual(cursor.execute.call_args.args[1], ['MODULE', 'LIVE'])
        self.assertTrue(all(call.args[0] in {'components', 'live_sessions'} for call in update.call_args_list))
        self.assertEqual(self.reader.call_count, 2)

    def test_additional_editor_is_repaired_even_when_the_series_roster_already_matches(self):
        series = {**self.series, 'status': 'week-meeting', 'meeting_type': 'week-additional',
                  'co_organizers': ['tutor@example.invalid'],
                  'attendees': ['learner@example.invalid', 'tutor@example.invalid']}
        settings = {'extraTeamsLiveSessionId': 'LIVE', 'extraTeamsEventId': 'EVENT', 'extraTeamsMeetingUrl': JOIN,
                    'extraTeamsOnlineMeetingId': 'ONLINE', 'extraTeamsOrganizerEmail': 'owner@example.invalid'}
        cursor = Mock()
        cursor.__enter__ = Mock(return_value=cursor)
        cursor.__exit__ = Mock(return_value=False)
        cursor.fetchall.return_value = [('COMP-ONE', settings)]
        with patch.object(refresh, 'load_calendar_state', return_value=(series, [], {})), \
                patch.object(refresh, 'calendar_reader', return_value=nullcontext(self.reader)), \
                patch.object(refresh.transaction, 'atomic', return_value=nullcontext()), \
                patch.object(refresh, 'connection', SimpleNamespace(cursor=lambda: cursor)), \
                patch('curriculum_api.views.update_authoring_rows') as update, \
                patch('curriculum_api.views.invalidate_curriculum_cache') as invalidate:
            self.assertTrue(refresh.refresh_people('LIVE')['changed'])
        update.assert_called_once()
        self.assertEqual(update.call_args.args[0], 'components')
        invalidate.assert_called_once()

    def test_ambiguous_or_foreign_additional_binding_preserves_both_saved_rosters(self):
        series = {**self.series, 'status': 'week-meeting', 'meeting_type': 'week-additional'}
        identity = {'extraTeamsLiveSessionId': 'LIVE', 'extraTeamsEventId': 'EVENT', 'extraTeamsMeetingUrl': JOIN,
                    'extraTeamsOnlineMeetingId': 'ONLINE', 'extraTeamsOrganizerEmail': 'owner@example.invalid'}
        for rows in ([], [('ONE', {}), ('TWO', {})], [('ONE', {'extraTeamsMeetingUrl': 'foreign'})],
                     [('ONE', {**identity, 'extraTeamsOnlineMeetingId': 'FOREIGN'})],
                     [('ONE', {**identity, 'extraTeamsOrganizerEmail': 'another@example.invalid'})]):
            with self.subTest(rows=rows):
                cursor = Mock()
                cursor.__enter__ = Mock(return_value=cursor)
                cursor.__exit__ = Mock(return_value=False)
                cursor.fetchall.return_value = rows
                with patch.object(refresh, 'load_calendar_state', return_value=(series, [], {})), \
                        patch.object(refresh, 'calendar_reader', return_value=nullcontext(self.reader)), \
                        patch.object(refresh.transaction, 'atomic', return_value=nullcontext()), \
                        patch.object(refresh, 'connection', SimpleNamespace(cursor=lambda: cursor)), \
                        patch('curriculum_api.views.update_authoring_rows') as update:
                    with self.assertRaises(refresh.CalendarStateError) as failure:
                        refresh.refresh_people('LIVE')
                self.assertEqual(refresh._failure_details(failure.exception), ('additional_binding_unverified', 'save_people'))
                update.assert_not_called()

    def test_unrecognized_week_meeting_status_does_not_enable_another_meeting_type(self):
        with patch.object(refresh, 'load_calendar_state', return_value=({**self.series, 'status': 'week-meeting'}, [], {})), \
                patch.object(refresh, 'calendar_reader') as reader:
            with self.assertRaises(refresh.CalendarStateError):
                refresh.refresh_people('LIVE')
        reader.assert_not_called()

    def test_inactive_meetings_do_not_use_application_transport(self):
        for changes in ({'status': 'cancelled'}, {'status': 'deleted'}):
            with self.subTest(changes=changes), patch.object(refresh, 'load_calendar_state', return_value=({**self.series, **changes}, [], {})), \
                    patch.object(refresh, 'calendar_reader') as reader:
                with self.assertRaises(refresh.CalendarStateError):
                    refresh.refresh_people('LIVE')
                reader.assert_not_called()

    def test_imported_roles_can_sync_without_using_someones_calendar_credential(self):
        series = {**self.series, 'meeting_type': 'linked-external', 'attendees': ['learner@example.invalid'], 'graph_event_id': ''}
        result = refresh.read_people(series, self.reader)
        self.assertEqual(result['coOrganizers'], ['tutor@example.invalid'])
        self.assertEqual(result['attendees'], ['learner@example.invalid'])
        self.assertEqual(self.reader.call_count, 1)
        self.assertIn('/onlineMeetings/ONLINE', self.reader.call_args.args[0])

    def test_automatic_and_manual_sync_share_service_but_manual_bypasses_cooldown(self):
        self.cached.get.return_value = {'attemptEpoch': refresh.time.time(), 'status': 'synced'}
        with patch.object(refresh, '_refresh_people', return_value={'changed': False}) as service:
            self.assertTrue(refresh.refresh_people('LIVE', automatic=True)['skipped'])
            service.assert_not_called()
            refresh.refresh_people('LIVE')
        service.assert_called_once_with('LIVE')
        self.assertEqual(self.cached.set.call_args.args[1]['status'], 'synced')

    def test_failed_read_is_visible_without_private_errors_or_cleared_roles(self):
        with patch.object(refresh, '_refresh_people', side_effect=RuntimeError('synthetic private transport')):
            with self.assertRaises(RuntimeError):
                refresh.refresh_people('LIVE', automatic=True)
        state = self.cached.set.call_args.args[1]
        self.assertEqual(state['status'], 'failed')
        self.assertNotIn('synthetic private transport', state['message'])

    def test_worker_prioritizes_oldest_checks_and_isolates_failures(self):
        cursor = Mock()
        cursor.__enter__ = Mock(return_value=cursor)
        cursor.__exit__ = Mock(return_value=False)
        cursor.fetchall.return_value = [('OLD',), ('DUE',), ('RECENT',)]
        self.cached.get_many.return_value = {'teams-people-sync:RECENT': {'attemptEpoch': refresh.time.time()}}
        with patch.object(refresh, 'connection', SimpleNamespace(cursor=lambda: cursor)), \
                patch.object(refresh, 'refresh_people', side_effect=[RuntimeError('private'), {'changed': False}]) as service:
            with self.assertLogs(refresh.log, level='WARNING') as logs:
                self.assertEqual(refresh.sync_due_people(limit=10, series_ids=['OLD', 'DUE', 'RECENT']), {'checked': 1, 'failed': 1})
        self.assertEqual(service.call_count, 2)
        self.assertTrue(all(call.kwargs == {'automatic': True} for call in service.call_args_list))
        self.assertNotIn('private', '\n'.join(logs.output))
        self.assertIn("s.status='active'", cursor.execute.call_args.args[0])
        self.assertIn('m.deleted_at IS NULL', cursor.execute.call_args.args[0])
        self.assertEqual(cursor.execute.call_args.args[1], [False, ['OLD', 'DUE', 'RECENT']])

    def _worker_failure_log(self, failure, identity='LIVE-SYNTHETIC'):
        cursor = Mock()
        cursor.__enter__ = Mock(return_value=cursor)
        cursor.__exit__ = Mock(return_value=False)
        cursor.fetchall.return_value = [(identity,)]
        with patch.object(refresh, 'connection', SimpleNamespace(cursor=lambda: cursor)), \
                patch.object(refresh, 'refresh_people', side_effect=failure):
            with self.assertLogs(refresh.log, level='WARNING') as logs:
                self.assertEqual(refresh.sync_due_people(), {'checked': 0, 'failed': 1})
        return '\n'.join(logs.output)

    def test_local_validation_reasons_are_stable_without_changing_exception_type_or_message(self):
        cases = [
            ({**self.series, 'online_meeting_id': ''}, self.event, self.meeting,
             'saved_identity_incomplete', 'The saved meeting identities are incomplete. No people or roles were imported.'),
            (self.series, {**self.event, 'isOrganizer': False}, self.meeting,
             'organizer_event_unverified', 'Microsoft did not verify the saved organiser event. No people or roles were imported.'),
            (self.series, self.event, {**self.meeting, 'participants': {**self.meeting['participants'], 'attendees': None}},
             'meeting_roles_incomplete', 'Microsoft did not return complete meeting roles. Saved values were preserved.'),
        ]
        for series, event, meeting, reason, message in cases:
            with self.subTest(reason=reason):
                reader = Mock(side_effect=lambda path, **kwargs: meeting if 'onlineMeetings' in path else event)
                with self.assertRaises(refresh.CalendarStateError) as failure:
                    refresh.read_people(series, reader)
                self.assertIs(type(failure.exception), refresh.CalendarStateError)
                self.assertEqual(str(failure.exception), message)
                output = self._worker_failure_log(failure.exception)
                self.assertIn(f'series_id=LIVE-SYNTHETIC reason={reason} phase=read_roster', output)
                self.assertNotIn(message, output)
                self.assertNotIn('example.invalid', output)
                self.assertNotIn(JOIN, output)

    def test_state_load_failure_logs_phase_and_keeps_failed_cache_and_retry_outcome(self):
        service = refresh.refresh_people
        with patch.object(refresh, 'load_calendar_state', side_effect=refresh.CalendarStateError('private calendar details')):
            output = self._worker_failure_log(service)
        self.assertIn('reason=calendar_state_invalid phase=load_state', output)
        self.assertNotIn('private calendar details', output)
        self.assertEqual(self.cached.set.call_args.args[1]['status'], 'failed')

    def test_graph_transport_failure_logs_only_category_and_phase(self):
        service = refresh.refresh_people
        with patch.object(refresh, 'load_calendar_state', return_value=(self.series, [], {})), \
                patch.object(refresh, 'calendar_reader', side_effect=httpx.ConnectError('private URL and token')):
            output = self._worker_failure_log(service)
        self.assertIn('reason=graph_transport_error phase=read_roster', output)
        self.assertNotIn('private URL and token', output)

    def test_database_import_failure_is_distinguished_from_roster_read_without_leaking_sql(self):
        service = refresh.refresh_people
        with patch.object(refresh, 'load_calendar_state', return_value=(self.series, [], {})), \
                patch.object(refresh, 'calendar_reader', return_value=nullcontext(self.reader)), \
                patch.object(refresh.transaction, 'atomic', return_value=nullcontext()), \
                patch('curriculum_api.views.update_authoring_rows', side_effect=DatabaseError('private SQL and names')):
            output = self._worker_failure_log(service)
        self.assertIn('reason=database_error phase=save_people', output)
        self.assertNotIn('private SQL and names', output)

    def test_busy_lock_logs_identity_and_reason_without_writing_failed_cache(self):
        service = refresh.refresh_people
        cursor = Mock()
        cursor.__enter__ = Mock(return_value=cursor)
        cursor.__exit__ = Mock(return_value=False)
        cursor.fetchall.return_value = [('LIVE-SYNTHETIC',)]
        cursor.fetchone.return_value = (False,)
        with patch.object(refresh, 'people_sync_lock', REAL_SYNC_LOCK), \
                patch.object(refresh.transaction, 'atomic', return_value=nullcontext()), \
                patch.object(refresh, 'connection', SimpleNamespace(cursor=lambda: cursor)), \
                patch.object(refresh, 'refresh_people', side_effect=service):
            with self.assertLogs(refresh.log, level='WARNING') as logs:
                self.assertEqual(refresh.sync_due_people(), {'checked': 0, 'failed': 1})
        self.assertIn('series_id=LIVE-SYNTHETIC reason=lock_busy phase=lock', '\n'.join(logs.output))
        self.cached.set.assert_not_called()

    def test_http_failures_use_numeric_status_metadata_never_message_or_url(self):
        for status in (400, 403, 404, 429, 503):
            for error in (refresh.CalendarStateError('private provider body'),
                          httpx.HTTPStatusError('private provider body', request=httpx.Request('GET', JOIN),
                                                response=httpx.Response(status))):
                with self.subTest(status=status, kind=type(error).__name__):
                    error.status_code = status
                    output = self._worker_failure_log(error)
                    self.assertIn(f'reason=graph_http_{status}', output)
                    self.assertNotIn('private provider body', output)
                    self.assertNotIn(JOIN, output)

    def test_blocked_reason_allowlist_preserves_known_codes_and_redacts_unknown_attributes_and_identity(self):
        error = refresh.Blocked('meeting_identity_mismatch', 'private meeting details')
        self.assertIn('reason=meeting_identity_mismatch', self._worker_failure_log(error))
        for error in (RuntimeError('private\nhttps://example.invalid?token=secret'),
                      refresh.Blocked('https://example.invalid?token=secret', 'private')):
            for value in ('https://example.invalid?token=secret', []):
                error.people_sync_reason = value
                error.people_sync_phase = value
                output = self._worker_failure_log(error, identity='LIVE\nhttps://example.invalid?token=secret')
                self.assertIn('series_id=invalid_series_id reason=unexpected_error phase=unknown', output)
                self.assertNotIn('private', output)
                self.assertNotIn('example.invalid', output)
                self.assertNotIn('secret', output)

    def test_saved_status_read_does_not_call_microsoft(self):
        with patch.object(refresh, 'load_calendar_state', return_value=(self.series, [], {})), \
                patch.object(refresh, 'calendar_reader') as reader:
            self.assertEqual(refresh.saved_people('LIVE')['form']['presenters'], ['tutor@example.invalid'])
        reader.assert_not_called()


@override_settings(ROOT_URLCONF=__name__, MIDDLEWARE=['django.middleware.csrf.CsrfViewMiddleware'],
                   ALLOWED_HOSTS=['testserver'], CSRF_COOKIE_SECURE=False)
class PeopleRefreshHttpTests(SimpleTestCase):
    def setUp(self):
        self.actor = SimpleNamespace(pk=7, role='staff')
        def authenticate(request):
            request.login_account = self.actor
            return self.actor
        auth = patch('login.permissions.authenticate_request', side_effect=authenticate)
        auth.start()
        self.addCleanup(auth.stop)
        read = patch.object(refresh, 'refresh_people', return_value={'form': {}, 'changed': False})
        self.read = read.start()
        self.addCleanup(read.stop)
        saved = patch.object(refresh, 'saved_people', return_value={'form': {}, 'syncInfo': {'status': 'never', 'checkedAt': None}})
        self.saved = saved.start()
        self.addCleanup(saved.stop)
        self.client = Client(enforce_csrf_checks=True)
        request = RequestFactory().get('/')
        self.token = get_token(request)
        self.client.cookies['csrftoken'] = request.META['CSRF_COOKIE']

    def post(self, csrf=True):
        return self.client.post('/refresh/LIVE/', '{"liveId":"FOREIGN"}', content_type='application/json',
                                **({'HTTP_X_CSRFTOKEN': self.token} if csrf else {}))

    def test_staff_and_admin_use_only_url_identity(self):
        for role in ('staff', 'admin'):
            self.actor.role = role
            self.assertEqual(self.post().status_code, 200)
        self.assertEqual(self.read.call_args.args, ('LIVE',))

    def test_other_roles_cannot_import_meeting_data(self):
        for role in ('learner', 'coach', 'employer'):
            self.actor.role = role
            self.assertEqual(self.post().status_code, 403)
        self.read.assert_not_called()

    def test_csrf_is_required_for_sync_but_saved_status_is_read_only(self):
        self.assertEqual(self.post(csrf=False).status_code, 403)
        self.assertEqual(self.client.get('/refresh/LIVE/').status_code, 200)
        self.saved.assert_called_once_with('LIVE')
        self.read.assert_not_called()

    def test_failed_read_is_not_reported_as_success(self):
        self.read.side_effect = refresh.CalendarStateError('Roles are incomplete. Retry.')
        self.assertEqual(self.post().status_code, 409)
        self.read.side_effect = RuntimeError('transport failed')
        self.assertEqual(self.post().status_code, 502)


class PeopleSyncCoordinationTests(SimpleTestCase):
    def test_concurrent_reader_is_refused_and_owned_lock_is_released_on_failure(self):
        cursor = Mock()
        cursor.__enter__ = Mock(return_value=cursor)
        cursor.__exit__ = Mock(return_value=False)
        atomic = Mock(return_value=nullcontext())
        with patch.object(refresh.transaction, 'atomic', atomic), \
                patch.object(refresh, 'connection', SimpleNamespace(cursor=lambda: cursor)):
            cursor.fetchone.return_value = (False,)
            with self.assertRaisesRegex(refresh.CalendarStateError, 'already running'):
                with REAL_SYNC_LOCK('LIVE'):
                    self.fail('Another reader owns the lock')
            self.assertEqual(cursor.execute.call_count, 1)
            cursor.reset_mock()
            cursor.fetchone.return_value = (True,)
            with self.assertRaises(ValueError):
                with REAL_SYNC_LOCK('LIVE'):
                    raise ValueError('synthetic failure')
        self.assertEqual(atomic.call_count, 2)
        self.assertEqual(cursor.execute.call_count, 1)
        self.assertIn('pg_try_advisory_xact_lock', cursor.execute.call_args.args[0])
        self.assertEqual(cursor.execute.call_args.args[1], ['curriculum:teams-people:LIVE'])

    def test_success_callbacks_wait_for_commit_and_preserve_error_phase(self):
        publish = Mock()
        with patch.object(refresh.transaction, 'on_commit') as committed:
            refresh._after_commit('cache_write', publish)
        publish.assert_not_called()
        committed.call_args.args[0]()
        publish.assert_called_once_with()
        publish.side_effect = RuntimeError('private cache details')
        with self.assertRaises(RuntimeError) as failure:
            committed.call_args.args[0]()
        self.assertEqual(refresh._failure_details(failure.exception), ('unexpected_error', 'cache_write'))

    def test_existing_scheduled_worker_calls_shared_service_and_keeps_session_outcome(self):
        from .management.commands import process_session_results as worker
        cursor = Mock()
        cursor.__enter__ = Mock(return_value=cursor)
        cursor.__exit__ = Mock(return_value=False)
        cursor.fetchone.return_value = None
        command = worker.Command()
        command.stdout = Mock()
        with patch.object(worker, 'connections', {'default': SimpleNamespace(cursor=lambda: cursor)}), \
                patch.object(worker, 'archive_runtime_preflight', return_value='synthetic:instance:1:s3'), \
                patch.object(worker, 'transaction', SimpleNamespace(atomic=nullcontext)), \
                patch('curriculum_api.session_captions.sync_pending_captions'), \
                patch.object(refresh, 'sync_due_people', side_effect=RuntimeError('private Graph body')) as service:
            with self.assertLogs(worker.logging.getLogger(worker.__name__), level='WARNING') as logs:
                command.handle(limit=2, scheduled=True, provision_container=False, live_session_ids=['LIVE'])
        service.assert_called_once_with(limit=2, series_ids=['LIVE'])
        command.stdout.write.assert_called_once_with('Processed 0 session jobs; 0 need retry.')
        self.assertNotIn('private Graph body', '\n'.join(logs.output))
