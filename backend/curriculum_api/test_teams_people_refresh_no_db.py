"""Synthetic people/roles refresh: no database or Microsoft traffic."""
import copy
import json
from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import Mock, patch
from urllib.parse import quote

from django.middleware.csrf import get_token
from django.test import Client, RequestFactory, SimpleTestCase, override_settings
from django.urls import path

from . import teams_people_refresh as refresh


OWNER = '11111111-1111-1111-1111-111111111111'
JOIN = 'https://teams.microsoft.com/l/meetup-join/synthetic?context=' + quote(json.dumps({'Oid': OWNER}))
urlpatterns = [path('refresh/<str:live_session_id>/', refresh.teams_people_refresh)]


class PeopleRefreshTests(SimpleTestCase):
    def setUp(self):
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
        with self.assertRaisesRegex(refresh.CalendarStateError, 'weekday meetings have different'):
            refresh.read_people(series, read)

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
            with self.assertRaisesRegex(refresh.CalendarStateError, 'changed during'):
                refresh.refresh_people('LIVE')
        update.assert_not_called()

    def test_imported_or_inactive_meetings_do_not_use_application_transport(self):
        for changes in ({'meeting_type': 'linked-external'}, {'status': 'cancelled'}):
            with self.subTest(changes=changes), patch.object(refresh, 'load_calendar_state', return_value=({**self.series, **changes}, [], {})), \
                    patch.object(refresh, 'calendar_reader') as reader:
                with self.assertRaises(refresh.CalendarStateError):
                    refresh.refresh_people('LIVE')
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

    def test_csrf_and_post_are_required(self):
        self.assertEqual(self.post(csrf=False).status_code, 403)
        self.assertEqual(self.client.get('/refresh/LIVE/').status_code, 405)
        self.read.assert_not_called()

    def test_failed_read_is_not_reported_as_success(self):
        self.read.side_effect = refresh.CalendarStateError('Roles are incomplete. Retry.')
        self.assertEqual(self.post().status_code, 409)
        self.read.side_effect = RuntimeError('transport failed')
        self.assertEqual(self.post().status_code, 502)
