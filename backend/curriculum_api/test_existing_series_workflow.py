"""Existing-series review/import, retries and individual link isolation.

All Graph reads and persistence are test doubles; no live service is called.
SQL persistence is additionally covered by the curriculum harness suite.
"""
import copy
import io
import json
from contextlib import ExitStack, nullcontext
from datetime import datetime, timezone
from unittest.mock import Mock, patch

from django.core.management import call_command
from django.test import SimpleTestCase, RequestFactory, override_settings
from django.urls import resolve

from curriculum_api import views as v, teams_existing_series as service
from curriculum_api.teams_external_calendar import manual_link_settings, external_calendar_settings

OWNER = '11111111-1111-4111-8111-111111111111'
LINK = 'https://teams.microsoft.com/l/meetup-join/original/0?context=%7B%22Oid%22%3A%22' + OWNER + '%22%7D'


@override_settings(SECRET_KEY='existing-series-synthetic-test')
class ExistingSeriesWorkflowTests(SimpleTestCase):
    def setUp(self):
        self.module = {'module_catalogue_id': 'MOD-TEST', 'group_id': 'GROUP-TEST'}
        self.components = [
            {'id': 'C1', 'week_id': 'W1', 'title': 'October lesson', 'settings_json': {'sessionPurpose': 'Keep content'}},
            {'id': 'C2', 'week_id': 'W2', 'title': 'Winter lesson', 'settings_json': {}},
        ]
        self.series = []
        self.occurrences = []
        self.writes = []
        self.events = [
            self.event('E1', '2026-10-23T08:00:00Z', '2026-10-23T10:00:00Z'),
            self.event('E2', '2026-10-30T09:00:00Z', '2026-10-30T11:00:00Z'),
        ]
        self.master_owned = True
        self.master_zone = 'GMT Standard Time'
        self.online = {'id': 'ONLINE-TEST', 'joinWebUrl': LINK,
                       'participants': {'organizer': {'identity': {'user': {'id': OWNER}}}}}
        self.graph = Mock(side_effect=self.graph_read)
        self.jobs = Mock()
        self.jobs.__enter__ = Mock(return_value=self.jobs)
        self.jobs.__exit__ = Mock(return_value=False)
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.object(service, 'module_targets', side_effect=self.targets))
        self.stack.enter_context(patch.object(v, 'authoring_fetch_all', side_effect=self.fetch))
        self.stack.enter_context(patch.object(v, 'module_structure_revision', side_effect=lambda _: self.revision()))
        self.stack.enter_context(patch.object(v, 'component_builder_settings', side_effect=lambda row: copy.deepcopy(row['settings_json'])))
        self.stack.enter_context(patch.object(v, 'authoring_upsert', side_effect=self.upsert))
        self.stack.enter_context(patch.object(v, 'update_authoring_rows', side_effect=self.update))
        self.stack.enter_context(patch.object(v, 'json_db_value', side_effect=lambda x: copy.deepcopy(x)))
        self.stack.enter_context(patch.object(v, 'lock_module_structure_row'))
        self.stack.enter_context(patch.object(v, 'invalidate_curriculum_cache'))
        self.stack.enter_context(patch.object(v, 'get_authoring_structure_payload', side_effect=lambda _: copy.deepcopy(self.components)))
        self.stack.enter_context(patch.object(v, 'stamp_revision_after_write', side_effect=lambda module, _: {'components': module, 'structureRevision': self.revision()}))
        self.stack.enter_context(patch.object(v, 'teams_meeting_default_organizer', return_value='owner@example.invalid'))
        self.stack.enter_context(patch('coach_api.views.microsoft_graph_request', self.graph))
        self.stack.enter_context(patch('coach_api.views.get_graph_settings', return_value={'base_url': 'https://graph.microsoft.com/v1.0/'}))
        self.stack.enter_context(patch.object(service.transaction, 'atomic', side_effect=lambda: nullcontext()))
        self.stack.enter_context(patch.object(service, 'connection', Mock(vendor='sqlite', cursor=Mock(return_value=self.jobs))))

    def event(self, identity, start, end, **extra):
        return {'id': identity, 'seriesMasterId': 'MASTER', 'type': 'occurrence',
                'onlineMeeting': {'joinUrl': LINK}, 'start': {'dateTime': start, 'timeZone': 'UTC'},
                'end': {'dateTime': end, 'timeZone': 'UTC'}, **extra}

    def graph_read(self, method, path):
        self.assertEqual(method, 'GET', 'The import must never mutate Microsoft.')
        if '/onlineMeetings?' in path:
            return {'value': [copy.deepcopy(self.online)]}
        if '/calendarView?' in path:
            return {'value': copy.deepcopy(self.events)}
        if '/events/MASTER' in path:
            return {'id': 'MASTER', 'subject': 'Original course series', 'isOrganizer': self.master_owned,
                    'onlineMeeting': {'joinUrl': LINK}, 'organizer': {'emailAddress': {'address': 'owner@example.invalid'}},
                    'recurrence': {'pattern': {'type': 'weekly'}, 'range': {'recurrenceTimeZone': self.master_zone}}}
        if '/recordings?' in path or '/attendanceReports?' in path:
            return {'value': []}
        self.fail('Unexpected Graph path: ' + path)

    def revision(self):
        return service.digest(self.components)

    def targets(self, module, weeks):
        self.assertEqual(module, 'MOD-TEST')
        return self.module, [{'row': copy.deepcopy(row), 'week': {'id': row['week_id'], 'title': row['title']},
                 'planned': {'date': '2026-10-23' if row['id'] == 'C1' else '2026-10-30', 'startTime': '09:00'}}
                for row in self.components if row['week_id'] in weeks]

    def fetch(self, table, where, params, *args):
        if table == v.LIVE_SESSIONS_TABLE:
            key = 'online_meeting_id' if 'online_meeting_id' in where else 'module_catalogue_id'
            return copy.deepcopy([r for r in self.series if r.get(key) == params[0]])
        if table == v.LIVE_SESSION_OCCURRENCES_TABLE:
            return copy.deepcopy([r for r in self.occurrences if r['live_session_id'] == params[0]])
        self.fail('Unexpected table ' + table)

    def upsert(self, table, keys, row):
        self.writes.append((table, copy.deepcopy(row)))
        target = self.series if table == v.LIVE_SESSIONS_TABLE else self.occurrences
        self.assertFalse(any(x['id'] == row['id'] for x in target), 'A retry must not overwrite an existing occurrence.')
        target.append(copy.deepcopy(row))

    def update(self, table, where, params, values):
        self.assertEqual(table, v.AUTHORING_COMPONENTS_TABLE)
        self.assertEqual(params[1], 'MOD-TEST')
        next(x for x in self.components if x['id'] == params[0]).update(copy.deepcopy(values))
        self.writes.append((table, params[0]))

    def preview(self, weeks=None):
        return service.preview('MOD-TEST', {'link': LINK, 'weekIds': weeks or ['W1', 'W2']})

    def test_preview_is_read_only_and_keeps_both_sides_of_the_uk_clock_change(self):
        result = self.preview()
        self.assertEqual((result['matched'], result['unmatched']), (2, 0))
        self.assertEqual([r['date'] for r in result['sessions']], ['2026-10-23', '2026-10-30'])
        self.assertFalse(self.writes)
        self.jobs.execute.assert_not_called()

    def test_egypt_clock_change_preserves_local_nine_oclock_and_the_real_utc_instants(self):
        self.master_zone = 'Egypt Standard Time'
        self.events = [
            self.event('E1', '2026-10-23T06:00:00Z', '2026-10-23T08:00:00Z'),
            self.event('E2', '2026-10-30T07:00:00Z', '2026-10-30T09:00:00Z'),
        ]
        review = self.preview()
        self.assertEqual(review['timeZone'], 'Africa/Cairo')
        service.apply('MOD-TEST', {'previewToken': review['previewToken']})
        self.assertEqual([r['scheduled_start'].hour for r in self.occurrences], [6, 7])
        self.assertEqual([r['settings_json']['sessionTime'] for r in self.components], ['09:00', '09:00'])

    def test_original_calendar_runtime_accepts_equivalent_clock_formats(self):
        from curriculum_api.teams_calendar_checks import event_instant
        local = {'start': {'dateTime': '2030-10-18T12:00:00', 'timeZone': 'GMT Standard Time'}}
        utc = {'start': {'dateTime': '2030-10-18T11:00:00.0000000', 'timeZone': 'UTC'}}
        self.assertEqual(event_instant(local, 'start'), event_instant(utc, 'start'))

    def test_apply_and_replay_keep_ids_dates_content_and_one_sync_job(self):
        token = self.preview()['previewToken']
        first = service.apply('MOD-TEST', {'previewToken': token})
        ids = [r['id'] for r in self.occurrences]
        self.assertEqual(len(self.series), 1)
        self.assertEqual(len(ids), 2)
        self.assertEqual([r['scheduled_start'].hour for r in self.occurrences], [8, 9])
        self.assertEqual(self.components[0]['settings_json']['sessionPurpose'], 'Keep content')
        for component, occurrence in zip(self.components, self.occurrences):
            self.assertEqual(component['settings_json']['teamsOccurrenceId'], occurrence['id'])
            self.assertEqual(component['settings_json']['teamsOnlineMeetingId'], 'ONLINE-TEST')
            self.assertEqual(component['settings_json']['teamsCalendarBinding'], 'matched')
        count = len(self.writes)
        replay = service.apply('MOD-TEST', {'previewToken': token})
        self.assertFalse(first['alreadyLinked'])
        self.assertTrue(replay['alreadyLinked'])
        self.assertEqual([r['id'] for r in self.occurrences], ids)
        self.assertEqual(len(self.writes), count)
        self.jobs.execute.assert_called_once()

    def test_selected_weeks_only_leave_the_other_week_untouched(self):
        before = copy.deepcopy(self.components[1])
        service.apply('MOD-TEST', {'previewToken': self.preview(['W1'])['previewToken']})
        self.assertEqual(self.components[1], before)
        self.assertEqual(len(self.occurrences), 1)

    def test_missing_holiday_occurrence_is_visible_and_never_gets_another_weeks_identity(self):
        self.events = self.events[:1]
        result = self.preview()
        self.assertEqual((result['matched'], result['unmatched']), (1, 1))
        service.apply('MOD-TEST', {'previewToken': result['previewToken']})
        self.assertEqual(self.components[1]['settings_json']['teamsCalendarBinding'], 'missing')
        self.assertFalse(self.components[1]['settings_json']['teamsOccurrenceId'])
        self.assertEqual(self.components[1]['settings_json']['sessionDate'], '2026-10-30')
        self.assertEqual(len(self.occurrences), 1)

    def test_cancelled_calendar_dates_are_not_shifted_to_the_next_week(self):
        self.events[0]['isCancelled'] = True
        result = self.preview()
        self.assertEqual([r['status'] for r in result['sessions']], ['missing', 'matched'])

    def test_attendee_copy_ids_are_not_saved_as_organiser_event_ids(self):
        self.master_owned = False
        service.apply('MOD-TEST', {'previewToken': self.preview()['previewToken']})
        self.assertFalse(self.series[0]['graph_event_id'])
        self.assertTrue(all(not r['graph_event_id'] for r in self.occurrences))

    def test_changed_module_refuses_the_old_review_without_writes(self):
        token = self.preview()['previewToken']
        self.components[0]['title'] = 'Another writer changed this'
        with self.assertRaisesRegex(service.LinkError, 'module changed'):
            service.apply('MOD-TEST', {'previewToken': token})
        self.assertFalse(self.writes)

    def test_changed_microsoft_dates_refuse_the_old_review_without_writes(self):
        token = self.preview()['previewToken']
        self.events[0] = self.event('E1', '2026-10-24T08:00:00Z', '2026-10-24T10:00:00Z')
        with self.assertRaisesRegex(service.LinkError, 'series or selected dates changed'):
            service.apply('MOD-TEST', {'previewToken': token})
        self.assertFalse(self.writes)

    def test_an_unverifiable_online_identity_never_becomes_a_manual_success(self):
        self.online['joinWebUrl'] = 'https://teams.microsoft.com/another-meeting'
        with self.assertRaises(service.LinkError):
            self.preview()
        self.assertFalse(self.writes)

    def test_two_original_recurrences_are_not_guessed_by_title(self):
        self.events[1]['seriesMasterId'] = 'ANOTHER-MASTER'
        with self.assertRaisesRegex(service.LinkError, 'More than one recurrence'):
            self.preview()

    def test_incomplete_pagination_never_publishes_a_partial_match(self):
        def incomplete(method, path):
            if '/calendarView?' in path:
                return {'value': [self.events[0]], '@odata.nextLink': 'https://not-microsoft.invalid/events'}
            return self.graph_read(method, path)
        self.graph.side_effect = incomplete
        with self.assertRaises(service.LinkError):
            self.preview()
        self.assertFalse(self.writes)

    def test_existing_managed_calendar_is_not_reimported_or_recreated(self):
        self.series.append({'id': 'LIVE-MANAGED', 'module_catalogue_id': 'MOD-TEST',
                            'join_url': LINK, 'online_meeting_id': 'ONLINE-TEST', 'status': 'active'})
        with self.assertRaisesRegex(service.LinkError, 'created by the LMS'):
            self.preview()
        self.assertFalse(self.writes)

    def test_recording_permission_failure_is_visible_and_writes_nothing(self):
        def failure(method, path):
            if '/recordings?' in path:
                raise RuntimeError('Graph 403')
            return self.graph_read(method, path)
        self.graph.side_effect = failure
        with self.assertRaisesRegex(service.LinkError, 'recordings/attendance'):
            self.preview()
        self.assertFalse(self.writes)

    def test_unknown_original_time_zone_cannot_invent_dates_or_crash_the_review(self):
        self.master_zone = 'Unavailable original time zone'
        with self.assertRaisesRegex(service.LinkError, 'time zone'):
            self.preview()
        self.assertFalse(self.writes)

    def test_additional_meeting_does_not_prevent_linking_the_modules_main_series(self):
        extra = {'id': 'EXTRA', 'module_catalogue_id': 'MOD-TEST', 'join_url': 'https://teams.microsoft.com/extra',
                 'online_meeting_id': 'ANOTHER-ONLINE', 'meeting_type': 'week-additional', 'status': 'active'}
        self.series.append(copy.deepcopy(extra))
        service.apply('MOD-TEST', {'previewToken': self.preview()['previewToken']})
        self.assertEqual(self.series[0], extra)
        self.assertEqual(len(self.series), 2)

    def test_invalid_link_and_no_matching_dates_cannot_be_applied(self):
        with self.assertRaises(service.LinkError):
            service.request_values({'link': 'https://[malformed', 'weekIds': ['W1']})
        self.events[0] = self.event('E1', '2026-10-24T08:00:00Z', '2026-10-24T10:00:00Z')
        self.events[1] = self.event('E2', '2026-10-31T09:00:00Z', '2026-10-31T11:00:00Z')
        report = self.preview()
        self.assertEqual(report['matched'], 0)
        with self.assertRaisesRegex(service.LinkError, 'No session matches'):
            service.apply('MOD-TEST', {'previewToken': report['previewToken']})
        self.assertFalse(self.writes)

    def test_expired_or_other_modules_review_is_not_sent_to_graph(self):
        with self.assertRaises(service.LinkError):
            service.apply('MOD-TEST', {'previewToken': 'invalid-proof'})
        self.graph.assert_not_called()
        token = self.preview()['previewToken']
        self.graph.reset_mock()
        with patch.object(v, 'resolve_stored_module_catalogue_id', return_value='ANOTHER'):
            with self.assertRaisesRegex(service.LinkError, 'another module'):
                service.apply('ANOTHER', {'previewToken': token})
        self.graph.assert_not_called()

    def test_command_uses_the_same_review_and_apply_without_printing_the_link(self):
        output = io.StringIO()
        call_command('link_existing_teams_series', module_id='MOD-TEST', join_url=LINK,
                     week_ids=['W1', 'W2'], apply=True, stdout=output)
        self.assertEqual(json.loads(output.getvalue())['action'], 'linked')
        self.assertNotIn(LINK, output.getvalue())
        self.assertEqual(len(self.occurrences), 2)


class ManualLinkIdentityTests(SimpleTestCase):
    def test_shared_projection_keeps_an_additional_meetings_own_join_link(self):
        extra = 'https://teams.microsoft.com/additional'
        weeks = [{'components': [{'type': 'live-session', 'settings': {}},
                                  {'type': 'live-session', 'settings': {'extraTeamsMeetingUrl': extra}}]}]
        with patch.object(v, 'teams_module_owner_id', return_value='SOURCE'), \
                patch.object(v, 'shared_teams_component_settings', return_value=[{'liveSessionUrl': LINK}]):
            v.apply_shared_teams_settings_to_weeks({'teams_shared_source_module_id': 'SOURCE'}, weeks)
        self.assertEqual(weeks[0]['components'][1]['settings']['liveSessionUrl'], extra)

    def test_new_shared_link_matches_its_dated_occurrence_instead_of_the_first_source_week(self):
        source = [
            {'liveSessionUrl': 'https://teams.microsoft.com/another-day', 'teamsLiveSessionId': 'SOURCE', 'teamsOccurrenceId': 'FIRST', 'sessionDate': '2026-10-23'},
            {'liveSessionUrl': LINK, 'teamsLiveSessionId': 'SOURCE', 'teamsOccurrenceId': 'SECOND', 'sessionDate': '2026-10-30', 'sessionTime': '09:00'},
        ]
        weeks = [{'sessionDate': '2026-10-30', 'components': [{'type': 'live-session', 'settings': {
            'liveSessionUrl': LINK, 'liveSessionLinkOverride': LINK, 'sessionDate': '2026-10-30',
            'sessionTime': '09:00:00', 'teamsCalendarBinding': 'unverified'}}]}]
        with patch.object(v, 'teams_module_owner_id', return_value='SOURCE'), \
                patch.object(v, 'shared_teams_component_settings', return_value=source):
            v.apply_shared_teams_settings_to_weeks({'teams_shared_source_module_id': 'SOURCE'}, weeks)
        settings = weeks[0]['components'][0]['settings']
        self.assertEqual(settings['teamsOccurrenceId'], 'SECOND')
        self.assertEqual(settings['sessionDate'], '2026-10-30')
        self.assertEqual(settings['teamsCalendarBinding'], 'matched')

    def test_shared_source_cannot_project_its_identity_onto_an_unrelated_manual_link(self):
        original = {'liveSessionUrl': LINK, 'teamsLiveSessionId': 'SOURCE-LIVE',
                    'teamsOccurrenceId': 'SOURCE-OCC', 'sessionDate': '2026-10-23'}
        weeks = [{'components': [{'type': 'live-session', 'settings': {
            'liveSessionLinkOverride': 'https://teams.microsoft.com/another',
            'sessionDate': '2026-10-30'}}]}]
        with patch.object(v, 'teams_module_owner_id', return_value='SOURCE'), \
                patch.object(v, 'shared_teams_component_settings', return_value=[original]):
            v.apply_shared_teams_settings_to_weeks({'teams_shared_source_module_id': 'SOURCE'}, weeks)
        settings = weeks[0]['components'][0]['settings']
        self.assertFalse(settings.get('teamsOccurrenceId'))
        self.assertFalse(settings.get('teamsLiveSessionId'))
        self.assertEqual(settings['sessionDate'], '2026-10-30')
        self.assertEqual(settings['teamsCalendarBinding'], 'unverified')

    def test_different_link_drops_old_provider_ids_but_keeps_date_recording_source_and_other_settings(self):
        old = {'liveSessionUrl': LINK, 'teamsMeetingUrl': LINK, 'teamsLiveSessionId': 'OLD-LIVE',
               'teamsOccurrenceId': 'OLD-OCC', 'teamsEventId': 'OLD-EVENT',
               'sessionDate': '2026-10-30', 'sessionDateTimeUtc': '2026-10-30T09:00:00Z',
               'recordingSeriesId': 'HISTORICAL', 'sessionPurpose': 'Keep',
               'legacySettings': json.dumps({'teamsOnlineMeetingId': 'OLD-ONLINE', 'legacyNote': 'Keep'})}
        result = manual_link_settings({**old, 'liveSessionUrl': 'https://teams.microsoft.com/manual'}, old)
        self.assertFalse(result.get('teamsOccurrenceId'))
        self.assertFalse(result.get('teamsLiveSessionId'))
        self.assertEqual(result['teamsCalendarBinding'], 'unverified')
        self.assertEqual(result['sessionDateTimeUtc'], old['sessionDateTimeUtc'])
        self.assertEqual(result['recordingSeriesId'], 'HISTORICAL')
        self.assertEqual(result['legacySettings'], {'legacyNote': 'Keep'})
        # A stale editor cannot reinsert IDs after the replacement was stored.
        again = manual_link_settings({**old, 'liveSessionUrl': result['liveSessionUrl']}, result)
        self.assertFalse(again.get('teamsOccurrenceId'))

    def test_same_verified_url_and_additional_meeting_keep_their_identity(self):
        old = {'liveSessionUrl': LINK, 'teamsLiveSessionId': 'LIVE', 'teamsOccurrenceId': 'OCC'}
        self.assertEqual(manual_link_settings({**old, 'sessionPurpose': 'Changed'}, old)['teamsOccurrenceId'], 'OCC')
        additional = {**old, 'extraTeamsMeetingUrl': LINK}
        self.assertIs(manual_link_settings(additional, old), additional)

    def test_clearing_a_link_drops_its_old_identity_but_preserves_the_authored_date(self):
        old = {'liveSessionUrl': LINK, 'teamsMeetingUrl': LINK, 'teamsLiveSessionId': 'LIVE',
               'teamsOccurrenceId': 'OCC', 'sessionDate': '2026-10-30'}
        result = manual_link_settings({**old, 'liveSessionUrl': '', 'teamsMeetingUrl': ''}, old)
        self.assertFalse(result.get('teamsOccurrenceId'))
        self.assertFalse(result.get('teamsLiveSessionId'))
        self.assertEqual(result['sessionDate'], old['sessionDate'])

    def test_two_sessions_on_one_date_match_their_clock_and_duplicates_stay_ambiguous(self):
        rows = [
            {'id': 'EARLY', 'join_url': LINK, 'scheduled_start': '2026-10-30T09:00:00Z'},
            {'id': 'LATE', 'join_url': LINK, 'scheduled_start': '2026-10-30T14:00:00Z'},
        ]
        series = {'id': 'LIVE', 'join_url': LINK}
        actual = external_calendar_settings({}, series, {'date': '2026-10-30', 'startTime': '14:00'}, rows, set(), 'Europe/London')
        self.assertEqual(actual['teamsOccurrenceId'], 'LATE')
        rows.append({**rows[-1], 'id': 'DUPLICATE'})
        actual = external_calendar_settings({}, series, {'date': '2026-10-30', 'startTime': '14:00'}, rows, set(), 'Europe/London')
        self.assertEqual(actual['teamsCalendarBinding'], 'ambiguous')
        self.assertFalse(actual['teamsOccurrenceId'])


class ExistingSeriesStaffBoundaryTests(SimpleTestCase):
    def test_signed_out_and_non_staff_callers_cannot_even_start_discovery(self):
        view = resolve('/curriculum_api/curriculum/modules/MOD-TEST/teams-existing-series/').func
        request = RequestFactory().post('/curriculum_api/curriculum/modules/MOD-TEST/teams-existing-series/',
                                       data=json.dumps({'action': 'preview'}), content_type='application/json')
        with patch('curriculum_api.teams_endpoint_guard._gate_enabled', return_value=True), \
                patch('login.sessions.authenticate_request') as auth, patch.object(service, 'preview') as read:
            for account in [None, Mock(role='learner'), Mock(role='coach'), Mock(role='employer')]:
                auth.return_value = account
                response = view(request, module_catalogue_id='MOD-TEST')
                self.assertIn(response.status_code, (401, 403))
            read.assert_not_called()
            for role in ('staff', 'admin'):
                auth.return_value = Mock(role=role)
                read.return_value = {'matched': 1}
                self.assertEqual(view(request, module_catalogue_id='MOD-TEST').status_code, 200)
