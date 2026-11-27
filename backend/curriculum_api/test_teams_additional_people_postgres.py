"""Additional-meeting role imports on a verified disposable PostgreSQL database."""
import copy
import json
from contextlib import nullcontext
from pathlib import Path
from unittest.mock import Mock, patch
from urllib.parse import quote

from django.db import connection

from . import teams_people_refresh as refresh, views
from .tests import CurriculumTeamsRequestTestCase


class AdditionalMeetingPeopleTests(CurriculumTeamsRequestTestCase):
    def setUp(self):
        views.reset_schema_ready_flags()
        views.ensure_module_authoring_tables()
        views.ensure_live_sessions_table()
        self.prepare_teams_fixtures('PROG-RESTORE')
        with connection.cursor() as cursor:
            cursor.execute((Path(__file__).resolve().parents[1] / 'sql/teams_calendar_sync_state.sql').read_text(encoding='utf-8-sig'))
        self.module = 'MOD-PEOPLE-ADDITIONAL'
        self.live_id = 'LIVE-PEOPLE-ADDITIONAL'
        self.owner_id = '11111111-1111-1111-1111-111111111111'
        self.join = 'https://teams.microsoft.com/l/meetup-join/synthetic?context=' + quote(json.dumps({'Oid': self.owner_id}))
        views.authoring_upsert(views.AUTHORING_MODULES_TABLE, ['module_catalogue_id'], {
            'module_catalogue_id': self.module, 'programme_id': 'PROG-RESTORE', 'title': 'Synthetic module'})
        views.authoring_upsert(views.AUTHORING_WEEKS_TABLE, ['id'], {
            'id': 'WEEK-PEOPLE-ADDITIONAL', 'module_catalogue_id': self.module, 'week_number': 1})
        self.series = {'id': self.live_id, 'module_catalogue_id': self.module,
                       'status': 'week-meeting', 'meeting_type': 'week-additional',
                       'organizer_email': 'owner@example.invalid', 'graph_event_id': 'EVENT',
                       'online_meeting_id': 'ONLINE', 'join_url': self.join,
                       'presenters': views.json_db_value(['tutor@example.invalid']),
                       'co_organizers': views.json_db_value([]), 'attendees': views.json_db_value([])}
        views.authoring_upsert(views.LIVE_SESSIONS_TABLE, ['id'], self.series)
        self.original = {'extraTeamsLiveSessionId': self.live_id, 'extraTeamsEventId': 'EVENT',
                         'extraTeamsOnlineMeetingId': 'ONLINE', 'extraTeamsOrganizerEmail': 'owner@example.invalid',
                         'extraTeamsMeetingUrl': self.join, 'extraTeamsStartDateTimeUtc': '2026-12-16T12:00:00Z',
                         'extraTeamsDurationMinutes': 120, 'teamsOccurrenceId': 'MAIN-OCC-KEEP',
                         'teamsMeetingUrl': 'https://example.invalid/main-keep', 'custom': {'keep': True}}
        for identity, settings in (('COMP-PEOPLE-OWN', self.original),
                                   ('COMP-PEOPLE-OTHER', {**self.original, 'extraTeamsLiveSessionId': 'OTHER'})):
            views.authoring_upsert(views.AUTHORING_COMPONENTS_TABLE, ['id'], {
                'id': identity, 'module_catalogue_id': self.module, 'week_id': 'WEEK-PEOPLE-ADDITIONAL',
                'type': 'live_session', 'title': 'Synthetic live session', 'expected_otjh': 2.5, 'points': 30,
                'settings_json': views.json_db_value(settings)})
        self.event = {'id': 'EVENT', 'type': 'singleInstance', 'isOrganizer': True,
                      'organizer': {'emailAddress': {'address': 'owner@example.invalid'}},
                      'onlineMeeting': {'joinUrl': self.join}, 'attendees': [
                          {'type': 'required', 'emailAddress': {'address': 'learner@example.invalid'}},
                          {'type': 'required', 'emailAddress': {'address': 'tutor@example.invalid'}}]}
        self.meeting = {'id': 'ONLINE', 'joinWebUrl': self.join, 'participants': {
            'organizer': {'identity': {'user': {'id': self.owner_id}}},
            'attendees': [{'upn': 'tutor@example.invalid', 'role': 'coorganizer'}]}}
        self.reader = Mock(side_effect=lambda path, **kwargs: copy.deepcopy(self.meeting if 'onlineMeetings' in path else self.event))
        cached = patch.object(refresh, 'cache')
        self.cached = cached.start()
        self.cached.get.return_value = None
        self.cached.get_many.return_value = {}
        self.addCleanup(cached.stop)
        reader = patch.object(refresh, 'calendar_reader', return_value=nullcontext(self.reader))
        reader.start()
        self.addCleanup(reader.stop)
        invalidation = patch.object(views, 'invalidate_curriculum_cache')
        self.invalidate = invalidation.start()
        self.addCleanup(invalidation.stop)

    def component(self, identity='COMP-PEOPLE-OWN'):
        return views.authoring_fetch_all(views.AUTHORING_COMPONENTS_TABLE, 'id=%s', [identity], ensure_tables=False)[0]

    def test_scheduled_worker_covers_additional_meetings_without_enabling_inactive_series(self):
        for identity, status, kind in (('CANCELLED', 'cancelled', 'week-additional'),
                                       ('WRONG-TYPE', 'week-meeting', 'live-session'),
                                       ('UNATTACHED', 'week-meeting', 'week-additional')):
            views.authoring_upsert(views.LIVE_SESSIONS_TABLE, ['id'], {**self.series, 'id': identity,
                                                                      'status': status, 'meeting_type': kind})
        other_before = self.component('COMP-PEOPLE-OTHER')
        result = refresh.sync_due_people(limit=10, series_ids=[self.live_id, 'CANCELLED', 'WRONG-TYPE', 'UNATTACHED'])
        self.assertEqual(result, {'checked': 1, 'failed': 0})
        self.assertEqual(self.component('COMP-PEOPLE-OTHER'), other_before)
        own = self.component()
        settings = views.as_json_value(own['settings_json'], {})
        self.assertEqual(settings, {**self.original, 'extraTeamsPresenters': ['tutor@example.invalid'],
                                   'extraTeamsCoOrganizers': ['tutor@example.invalid'],
                                   'extraTeamsAttendees': ['learner@example.invalid']})
        self.assertEqual(float(own['expected_otjh']), 2.5)
        self.assertEqual(own['points'], 30)
        self.assertEqual(self.reader.call_count, 2)

    def test_repeated_sync_is_idempotent_and_keeps_original_component_identity(self):
        self.assertTrue(refresh.refresh_people(self.live_id)['changed'])
        before = self.component()
        self.assertFalse(refresh.refresh_people(self.live_id)['changed'])
        self.assertEqual(self.component(), before)
        self.assertEqual(before['id'], 'COMP-PEOPLE-OWN')
        self.invalidate.assert_called_once()

    def test_newer_committed_lms_edit_is_not_overwritten_by_an_older_graph_read(self):
        peer = connection.copy(alias='additional_people_peer')
        self.addCleanup(peer.close)
        peer.ensure_connection()
        peer.set_autocommit(True)
        before = self.component()

        def changed_during_read(_series, _read):
            with peer.cursor() as cursor:
                cursor.execute('''UPDATE curriculum.live_sessions SET co_organizers=%s::jsonb,
                    updated_at=now() WHERE id=%s''', [json.dumps(['newer@example.invalid']), self.live_id])
            return {'attendees': ['learner@example.invalid'], 'presenters': [],
                    'coOrganizers': ['older@example.invalid']}

        with patch.object(refresh, 'read_people', side_effect=changed_during_read):
            with self.assertRaisesRegex(refresh.CalendarStateError, 'changed during'):
                refresh.refresh_people(self.live_id)
        saved = views.authoring_fetch_all(views.LIVE_SESSIONS_TABLE, 'id=%s', [self.live_id], ensure_tables=False)[0]
        self.assertEqual(views.teams_series_email_list(saved['co_organizers']), ['newer@example.invalid'])
        self.assertEqual(self.component(), before)
        self.invalidate.assert_not_called()
