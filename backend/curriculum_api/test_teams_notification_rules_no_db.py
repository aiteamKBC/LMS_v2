"""Who Microsoft and the LMS tell, and how often. Run directly with Python; no Django, DB or network.

Pins the notification rules of a Teams calendar update:

* A retry of the same update after a timeout is never announced twice, and
  never emails the same "was / now" twice (``teams_update_guard``).
* A per-weekday calendar announces a date change exactly like a shared one,
  honours the author's choice, and never announces a date that did not move.
* An additional week meeting is announced once, never contradicts Outlook,
  and never reaches the module's own calendar.
* A people-only save never touches a date: drift is reported, not repaired.
* The retired single-session route cannot move anything.
* Somebody added gets the full schedule and never the change email too; a
  person removed and added back is sent it again; a retry is not.
* A module with future Teams sessions cannot be archived or deleted.

None of this proves what Exchange actually delivers. Graph accepting a write
under ``Prefer: outlook.send-invitations="none"`` is a request for silence,
not proof of it; that needs the live mailbox checks.
"""
import ast
import copy
import json
import sys
import types
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import Mock, patch

import test_calendar_checks_no_db as checks_tests
import test_schedule_email_no_db as email_tests

ROOT = Path(__file__).resolve().parent
checks = checks_tests.checks
SILENT = checks_tests.SILENT_INVITE
TIMED_OUT = 'Microsoft Graph request failed: <urlopen error timed out>'
REFUSED = 'Microsoft Graph request failed: HTTP 400 code=ErrorInvalidRequest'


class Harness(checks_tests.CalendarChecksTests):
    """The calendar test double, without re-running every inherited test."""

    def setUp(self):
        super().setUp()
        # The LMS's own saved dates, read the way the endpoint reads them.
        self.v.held_schedule_snapshot = lambda _live: self.held()
        self.v.authoring_upsert = self.upsert

    def held(self):
        rows = []
        for item in self.tracked:
            if 'scheduled_start' in item:
                start, end = checks.utc_datetime(item['scheduled_start']), checks.utc_datetime(item['scheduled_end'])
                number = item['session_number']
            else:
                start = checks.utc_datetime(item['startDateTimeUtc'])
                end, number = start + timedelta(minutes=item['durationMinutes']), item['sessionNumber']
            rows.append({'n': int(number), 'start': start.isoformat(), 'end': end.isoformat()})
        return sorted(rows, key=lambda item: item['n'])

    def upsert(self, table, keys, values):
        self.tracked = [row for row in self.tracked
                        if row.get('session_number', row.get('sessionNumber')) != values['session_number']]
        self.tracked.append(copy.deepcopy(values))

    def update(self):
        return self.v.curriculum_teams_meeting_schedule(types.SimpleNamespace(method='PATCH'), 'LIVE-SYNTHETIC')

    def shift_dates(self, hours=1):
        shifted = []
        for item in self.payload['scheduledOccurrences']:
            start = datetime.fromisoformat(item['startDateTimeUtc']) + timedelta(hours=hours)
            shifted.append({**item, 'startDateTimeUtc': start.isoformat()})
        self.payload.update(startDateTimeUtc=shifted[0]['startDateTimeUtc'], scheduledOccurrences=shifted,
                            localStartDateTime=(datetime.fromisoformat(self.payload['localStartDateTime'])
                                                + timedelta(hours=hours)).isoformat())

    def announced(self):
        """Every attendee write Microsoft was asked to announce."""
        return [item for item in self.headers if item[0] == 'PATCH' and item[2] is None and 'attendees' in (item[3] or {})]

    def writes(self):
        return [call for call in self.calls if call[0] in ('PATCH', 'POST', 'DELETE')]

    def failing_after(self, message, applied=True):
        """Microsoft answers the next announced attendee write with ``message``.

        ``applied`` decides whether the write landed first -- a timeout after
        Microsoft did the work, the case a blind retry duplicates.
        """
        real, state = self.graph, {'fired': False}

        def graph(method, path, payload=None, *, extra_headers=None):
            announcing = method == 'PATCH' and extra_headers is None and 'attendees' in (payload or {})
            if announcing and not state['fired']:
                state['fired'] = True
                if applied:
                    real(method, path, payload, extra_headers=extra_headers)
                raise RuntimeError(message)
            return real(method, path, payload, extra_headers=extra_headers)
        sys.modules['coach_api.views'].microsoft_graph_request = graph

    def restore_graph(self):
        sys.modules['coach_api.views'].microsoft_graph_request = self.graph


for _name in dir(checks_tests.CalendarChecksTests):
    if _name.startswith('test_'):
        setattr(Harness, _name, None)


# --------------------------------------------------------------------------- 1
class SharedSeriesRetryTests(Harness):
    def test_a_retry_after_the_update_landed_announces_and_emails_nothing(self):
        self.assertEqual(self.create().status_code, 201)
        self.headers.clear()
        self.shift_dates()
        self.payload['notifyAttendees'] = True
        first = self.update()
        self.assertEqual(first.status_code, 200, first)
        self.assertEqual(len(self.announced()), 1)
        self.assertEqual((first['announced'], first['microsoftUpdate']), (True, 'sent'))
        # The response was lost; the author presses Update again, unchanged.
        self.headers.clear()
        self.calls.clear()
        retry = self.update()
        self.assertEqual(retry.status_code, 200, retry)
        self.assertEqual(self.announced(), [])
        # No date changed against Microsoft or the LMS: no "was / now" either.
        self.assertEqual((retry['announced'], retry['microsoftUpdate']), (False, 'not_needed'))

    def test_a_retry_after_a_timeout_that_followed_the_announcement_is_not_announced_again(self):
        self.assertEqual(self.create().status_code, 201)
        self.shift_dates()
        self.payload['notifyAttendees'] = True
        self.failing_after(TIMED_OUT, applied=True)
        first = self.update()
        # Uncertain, and said so: Microsoft may well have sent it.
        self.assertEqual(first.status_code, 502, first)
        self.assertTrue(first['verificationRequired'])
        self.assertEqual(first['code'], 'teams_update_verification_required')
        self.restore_graph()
        self.headers.clear()
        retry = self.update()
        self.assertEqual(retry.status_code, 200, retry)
        # Never asked again ...
        self.assertEqual(self.announced(), [])
        self.assertEqual(retry['microsoftUpdate'], 'already_attempted')
        # ... while the LMS change email, never sent by the failed attempt, still
        # follows -- under the same logical change id, so it too goes once.
        self.assertTrue(retry['announced'])
        # One logical change, one claim: both attempts named it the same.
        self.assertEqual(list(self.announcements.rows.values()), ['unknown'])
        self.assertTrue(next(iter(self.announcements.rows))[0].endswith(retry['changeId']))

    def test_a_definite_refusal_leaves_the_change_free_to_announce_once(self):
        self.assertEqual(self.create().status_code, 201)
        self.shift_dates()
        self.payload['notifyAttendees'] = True
        self.failing_after(REFUSED, applied=False)
        self.assertEqual(self.update().status_code, 502)
        self.restore_graph()
        self.headers.clear()
        retry = self.update()
        self.assertEqual(retry.status_code, 200, retry)
        self.assertEqual(len(self.announced()), 1)
        self.assertEqual(retry['microsoftUpdate'], 'sent')
        self.assertEqual(set(self.announcements.rows.values()), {'accepted'})

    def test_the_same_change_has_the_same_name_and_a_different_change_does_not(self):
        self.assertEqual(self.create().status_code, 201)
        self.shift_dates()
        self.payload['notifyAttendees'] = True
        self.failing_after(TIMED_OUT, applied=False)
        self.update()
        self.restore_graph()
        retried = self.update()
        self.shift_dates(hours=1)
        other = self.update()
        self.assertEqual(other.status_code, 200, other)
        self.assertNotEqual(retried['changeId'], other['changeId'])
        self.assertEqual(len(self.announcements.rows), 2)

    def test_without_the_ledger_the_update_is_announced_as_before_and_says_so(self):
        broken = types.SimpleNamespace(check=Mock(side_effect=RuntimeError('ledger not provisioned')))
        self.guard_ledger.stop()
        with patch.object(self.guard, '_ledger', lambda ledger: broken):
            self.assertEqual(self.create().status_code, 201)
            self.shift_dates()
            self.payload['notifyAttendees'] = True
            self.headers.clear()
            result = self.update()
        self.guard_ledger.start()
        self.assertEqual(result.status_code, 200, result)
        self.assertEqual(len(self.announced()), 1)
        self.assertEqual((result['microsoftUpdate'], result['retryGuard']), ('sent', 'unavailable'))

    def test_an_update_whose_dates_did_not_move_announces_nothing(self):
        self.assertEqual(self.create().status_code, 201)
        self.payload.update(notifyAttendees=True, attendees=['learner@example.invalid', 'joined@example.invalid'])
        self.headers.clear()
        self.forwards.clear()
        result = self.update()
        self.assertEqual(result.status_code, 200, result)
        # Nobody already invited hears about a learner joining ...
        self.assertEqual(self.announced(), [])
        self.assertEqual(result['microsoftUpdate'], 'not_needed')
        self.assertFalse(result['announced'])
        # ... and the learner who joined is reached on their own.
        self.assertEqual(self.forwards, [('event-1', ['joined@example.invalid'])])


# --------------------------------------------------------------------------- 2/3
class WeekdayCalendarTests(Harness):
    def setUp(self):
        super().setUp()
        self.prepare_weekday_path()
        self.v.authoring_upsert = self.upsert
        self.assertEqual(self.create().status_code, 201)
        self.v.stored_calendar_series = lambda series: series.get('calendar_series') or []
        self.headers.clear()
        self.calls.clear()
        self.forwards.clear()

    def test_a_dates_only_update_is_announced_on_every_day_that_moved(self):
        self.shift_dates()
        self.payload['notifyAttendees'] = True
        result = self.update()
        self.assertEqual(result.status_code, 200, result)
        # The day's date write is silent; the attendee write announces it, even
        # though nobody was added or removed -- or Outlook keeps the old dates.
        self.assertEqual(len(self.announced()), 2)
        self.assertTrue(all([p['emailAddress']['address'] for p in item[3]['attendees']] == ['learner@example.invalid']
                            for item in self.announced()))
        self.assertEqual((result['announced'], result['microsoftUpdate']), (True, 'sent'))
        self.assertFalse(self.forwards)

    def test_the_authors_choice_not_to_notify_is_honoured_for_both_channels(self):
        self.shift_dates()
        self.payload['notifyAttendees'] = False
        result = self.update()
        self.assertEqual(result.status_code, 200, result)
        self.assertEqual(self.announced(), [])
        # announced=False is what keeps the LMS "was / now" from going either.
        self.assertEqual((result['announced'], result['microsoftUpdate']), (False, 'silent'))

    def test_unchanged_dates_announce_nothing(self):
        self.payload['notifyAttendees'] = True
        result = self.update()
        self.assertEqual(result.status_code, 200, result)
        self.assertEqual(self.announced(), [])
        self.assertEqual(result['microsoftUpdate'], 'not_needed')

    def test_dates_and_a_new_person_reach_the_new_person_on_the_announcement_only(self):
        self.shift_dates()
        self.payload.update(notifyAttendees=True, attendees=['learner@example.invalid', 'joined@example.invalid'])
        result = self.update()
        self.assertEqual(result.status_code, 200, result)
        self.assertEqual(len(self.announced()), 2)
        self.assertTrue(all('joined@example.invalid' in [p['emailAddress']['address'] for p in item[3]['attendees']]
                            for item in self.announced()))
        # Already on the announced write: never forwarded it a second time.
        self.assertFalse(self.forwards)

    def test_an_added_person_alone_is_forwarded_and_nobody_else_hears(self):
        self.payload.update(notifyAttendees=True, attendees=['learner@example.invalid', 'joined@example.invalid'])
        result = self.update()
        self.assertEqual(result.status_code, 200, result)
        self.assertEqual(self.announced(), [])
        self.assertEqual(sorted(self.forwards), [('event-1', ['joined@example.invalid']),
                                                 ('event-2', ['joined@example.invalid'])])

    def test_a_removed_person_is_taken_off_silently_before_a_date_is_announced(self):
        self.payload['attendees'] = ['learner@example.invalid', 'second@example.invalid']
        self.payload['peopleOnly'] = True
        self.assertEqual(self.update().status_code, 200)
        self.payload.pop('peopleOnly')
        self.headers.clear()
        self.shift_dates()
        self.payload.update(notifyAttendees=True, attendees=['learner@example.invalid'])
        result = self.update()
        self.assertEqual(result.status_code, 200, result)
        attendee_writes = [item for item in self.headers if item[0] == 'PATCH' and 'attendees' in (item[3] or {})]
        # Per day: silently drop the person, then announce to who stays. Never
        # a cancellation, never DELETE or /cancel.
        self.assertEqual([item[2] for item in attendee_writes], [SILENT, None, SILENT, None])
        self.assertFalse([call for call in self.calls if call[0] == 'DELETE' or call[1].endswith('/cancel')])

    def test_a_retry_of_a_failed_weekday_update_does_not_announce_a_day_twice(self):
        self.shift_dates()
        self.payload['notifyAttendees'] = True
        self.failing_after(TIMED_OUT, applied=True)
        self.assertEqual(self.update().status_code, 502)
        self.restore_graph()
        self.headers.clear()
        retry = self.update()
        self.assertEqual(retry.status_code, 200, retry)
        # The first day was announced by the failed attempt and is not asked
        # again; the second day never was, and is announced now, once.
        self.assertEqual(len(self.announced()), 1)
        self.assertEqual(retry['microsoftUpdate'], 'sent')
        self.assertTrue(retry['announced'])

    def test_a_failed_weekday_update_saves_no_dates_nobody_was_told_about(self):
        before = self.held()
        self.shift_dates()
        self.payload['notifyAttendees'] = True
        self.failing_after(REFUSED, applied=False)
        self.assertEqual(self.update().status_code, 502)
        self.assertEqual(self.held(), before)

    def test_a_people_only_save_on_a_drifted_weekday_calendar_writes_nothing(self):
        moved = self.instances_by_master['event-2'][0]
        for field in ('start', 'end'):
            moved[field]['dateTime'] = (checks.utc_datetime(moved[field]['dateTime']) + timedelta(days=1)).isoformat()
        self.payload.update(peopleOnly=True, invitationsOnly=True,
                            attendees=['learner@example.invalid', 'joined@example.invalid'])
        result = self.update()
        self.assertEqual(result.status_code, 409, result)
        self.assertEqual(result['code'], 'teams_schedule_drift')
        self.assertEqual(self.writes(), [])


# --------------------------------------------------------------------------- 6
class PeopleOnlyNeverTouchesDatesTests(Harness):
    def setUp(self):
        super().setUp()
        self.assertEqual(self.create().status_code, 201)
        self.v.apply_teams_meeting_options = Mock(return_value=(True, {'id': 'online-1'}, []))
        self.calls.clear()
        self.headers.clear()

    def drift(self, index=3, days=1):
        moved = self.instances_by_master['event-1'][index]
        for field in ('start', 'end'):
            moved[field]['dateTime'] = (checks.utc_datetime(moved[field]['dateTime']) + timedelta(days=days)).isoformat()

    def test_a_moved_session_is_reported_and_left_where_it_is(self):
        self.drift()
        self.payload.update(peopleOnly=True, invitationsOnly=True, attendees=['replacement@example.invalid'])
        result = self.update()
        self.assertEqual(result.status_code, 409, result)
        self.assertEqual(result['code'], 'teams_schedule_drift')
        # Nothing was written: no date, no attendee, no option.
        self.assertEqual(self.writes(), [])
        self.v.apply_teams_meeting_options.assert_not_called()

    def test_a_missing_session_is_not_recreated_by_a_people_save(self):
        del self.instances_by_master['event-1'][4]
        self.payload.update(peopleOnly=True, attendees=['replacement@example.invalid'])
        result = self.update()
        self.assertEqual(result.status_code, 409, result)
        self.assertFalse([call for call in self.calls if call[0] == 'POST'])
        self.assertEqual(self.writes(), [])

    def test_a_people_save_on_a_matching_calendar_writes_the_roster_and_no_date(self):
        self.payload.update(peopleOnly=True, attendees=['replacement@example.invalid'])
        result = self.update()
        self.assertEqual(result.status_code, 200, result)
        for _method, _path, payload in self.writes():
            self.assertFalse({'start', 'end', 'recurrence'} & set(payload or {}), payload)
        self.assertEqual(result['microsoftUpdate'], 'not_needed')


# --------------------------------------------------------------------------- 7
class RetiredRouteTests(Harness):
    def test_the_old_single_session_route_cannot_move_anything(self):
        self.assertEqual(self.create().status_code, 201)
        self.calls.clear()
        self.payload = {'startDateTimeUtc': '2026-09-18T09:00:00Z', 'durationMinutes': 60}
        result = self.v.curriculum_teams_meeting_occurrence_schedule(
            types.SimpleNamespace(method='PATCH'), 'LIVE-SYNTHETIC', 2)
        self.assertEqual(result.status_code, 410, result)
        self.assertEqual(result['code'], 'use_calendar_action')
        self.assertEqual(self.calls, [])

    def test_the_browser_no_longer_carries_the_silent_helper(self):
        source = (ROOT.parents[1] / 'frontend' / 'src' / 'pages' / 'curriculum' / 'module-builder'
                  / 'moduleAuthoringData.ts').read_text(encoding='utf-8')
        self.assertNotIn('export async function rescheduleTeamsOccurrence', source)
        self.assertNotIn('/occurrences/${sessionNumber}/schedule/', source)


# --------------------------------------------------------------------------- 13
class ModuleCalendarLeavesWeekMeetingsAloneTests(Harness):
    def test_the_module_update_refuses_an_additional_week_meeting(self):
        self.series = [{'id': 'LIVE-EXTRA', 'status': 'week-meeting', 'organizer_email': 'guest-host@example.invalid',
                        'graph_event_id': 'additional-event'}]
        result = self.v.curriculum_teams_meeting_schedule(types.SimpleNamespace(method='PATCH'), 'LIVE-EXTRA')
        self.assertEqual(result.status_code, 404, result)
        self.assertEqual(result['code'], 'not_a_module_calendar')
        self.assertEqual(self.calls, [])


# --------------------------------------------------------------------------- 4/5/14
class WeekMeetingEditTests(unittest.TestCase):
    """An additional week meeting is told once, never contradicts Outlook, and never reaches the module."""

    START = datetime(2026, 9, 21, 10, 0, tzinfo=timezone.utc)

    def setUp(self):
        network = patch('socket.socket', side_effect=AssertionError('Network forbidden'))
        network.start()
        self.addCleanup(network.stop)
        from django.conf import settings
        if not settings.configured:
            settings.configure(DEFAULT_CHARSET='utf-8')
        self.calls, self.writes, self.forwards, self.fail = [], [], [], None
        self.event = {'id': 'additional-event', 'onlineMeeting': {'joinUrl': 'https://teams.microsoft.com/meet/extra'},
                      'organizer': {'emailAddress': {'address': 'guest-host@example.invalid'}},
                      'start': {'dateTime': self.START.isoformat(), 'timeZone': 'UTC'},
                      'end': {'dateTime': (self.START + timedelta(hours=1)).isoformat(), 'timeZone': 'UTC'},
                      'attendees': [self.person('one@example.invalid'), self.person('gone@example.invalid')]}
        self.row = {'id': 'LIVE-EXTRA', 'organizer_email': 'guest-host@example.invalid', 'status': 'week-meeting',
                    'graph_event_id': 'additional-event', 'join_url': 'https://teams.microsoft.com/meet/extra',
                    'attendees': ['one@example.invalid', 'gone@example.invalid'], 'presenters': [], 'co_organizers': [],
                    'start_datetime': self.START, 'duration_minutes': 60}
        self.body = {'title': 'Guest panel', 'startDateTimeUtc': self.START.isoformat(), 'durationMinutes': 60,
                     'attendees': ['one@example.invalid', 'gone@example.invalid']}
        test = self

        def graph(method, path, payload=None, extra_headers=None):
            test.calls.append((method, path, copy.deepcopy(payload), extra_headers))
            if method == 'POST' and path.endswith('/forward'):
                test.forwards.append([item['emailAddress']['address'] for item in payload['ToRecipients']])
                return {}
            if method == 'PATCH':
                if test.fail and extra_headers is None:
                    message, applied = test.fail
                    test.fail = None
                    if applied:
                        test.event.update(copy.deepcopy(payload))
                    raise RuntimeError(message)
                test.event.update(copy.deepcopy(payload))
            return copy.deepcopy(test.event)

        def fetch(table, where='', params=None, order=''):
            if table == 'live_sessions':
                return [self.row] if params and params[0] == 'LIVE-EXTRA' and 'week-meeting' in params else []
            if table == 'components':
                return [{'id': 'COMP-2', 'settings': {'extraTeamsLiveSessionId': 'LIVE-EXTRA'}}]
            return []

        def event_payload(single, _settings):
            start = checks.utc_datetime(single['startDateTimeUtc'])
            minutes = int(single.get('durationMinutes') or 60)
            people = list(single.get('attendees') or [])
            return ({'subject': single.get('title'), 'body': {}, 'responseRequested': True, 'allowNewTimeProposals': True,
                     'start': {'dateTime': start.isoformat(), 'timeZone': 'UTC'},
                     'end': {'dateTime': (start + timedelta(minutes=minutes)).isoformat(), 'timeZone': 'UTC'},
                     'attendees': [test.person(email) for email in people]},
                    people, [], [], people, start, minutes, 'none', 1)

        transport = types.ModuleType('coach_api.views')
        transport.microsoft_graph_request = graph
        transport.has_graph_credentials = lambda: True
        transport.get_graph_settings = lambda: {'timezone': 'GMT Standard Time'}
        minute = lambda value: (checks.utc_datetime(value).replace(second=0, microsecond=0, tzinfo=None)
                                .isoformat(timespec='minutes') if value else '')
        v = types.SimpleNamespace(
            LIVE_SESSIONS_TABLE='live_sessions', AUTHORING_COMPONENTS_TABLE='components',
            LIVE_SESSION_OCCURRENCES_TABLE='occurrences', TEAMS_LOBBY_VALUES={'invited', 'everyone'},
            GRAPH_SILENT_INVITE_HEADERS=dict(SILENT), urllib_parse=__import__('urllib.parse').parse,
            json_error=lambda message, status=400, **kw: types.SimpleNamespace(status_code=status, message=message, **kw),
            ensure_module_authoring_tables=lambda: None, ensure_live_sessions_table=lambda: None,
            json_body=lambda _request: test.body, clean_str=lambda value: str(value or '').strip(),
            resolve_stored_module_catalogue_id=lambda value: value, authoring_fetch_all=fetch,
            active_component_rows=lambda rows: rows, component_builder_settings=lambda item: item['settings'],
            teams_schedule_settings=lambda settings, *_a, **_k: settings, teams_event_payload=event_payload,
            calendar_targets=lambda *a, **k: [], graph_timezone_iana=lambda _settings: 'Europe/London',
            teams_non_delivery_reason=lambda *a: '', as_json_value=lambda value, fallback: value or fallback,
            apply_teams_meeting_options=lambda *a, **k: (True, {}, []),
            forward_teams_invitation=lambda request, owner, ids, people, comment='': (
                [request('POST', f'users/{owner}/events/{ids[0]}/forward',
                         payload={'ToRecipients': [{'emailAddress': {'address': p}} for p in people]})] and []
                if people else []),
            update_authoring_rows=lambda table, where, params, values: test.writes.append((table, params)),
            json_db_value=lambda value: value,
            authoring_upsert=lambda table, keys, values: test.writes.append((table, values.get('live_session_id'))),
            parse_graph_datetime=lambda value: value, invalidate_curriculum_cache=lambda: None,
            parse_int=lambda value, default=0: int(value) if value not in (None, '') else default,
            utc_datetime=checks.utc_datetime, teams_calendar_minute_key=minute,
            remove_attendees_silently=checks.remove_attendees_silently, graph_event_utc=lambda event: event,
            attendee_differences=checks.attendee_differences, event_organizer_address=checks.event_organizer_address,
            unconfirmed_attendee_detail=checks.unconfirmed_attendee_detail,
        )
        package = types.ModuleType('curriculum_api')
        package.__path__ = [str(ROOT)]
        package.views = v
        self.delivery = types.SimpleNamespace(send_week_meeting_emails=Mock(return_value={'status': 'complete'}),
                                              send_week_meeting_change_emails=Mock(return_value={'status': 'complete'}))
        modules = patch.dict(sys.modules, {'curriculum_api': package, 'curriculum_api.views': v,
                                           'curriculum_api.teams_schedule_delivery': self.delivery,
                                           'coach_api': types.ModuleType('coach_api'), 'coach_api.views': transport})
        modules.start()
        self.addCleanup(modules.stop)
        sys.modules.pop('curriculum_api.teams_week_meeting', None)
        sys.modules.pop('curriculum_api.teams_update_guard', None)
        from curriculum_api import teams_update_guard, teams_week_meeting
        self.week = teams_week_meeting
        self.announcements = checks_tests.AnnouncementLedger()
        guard = patch.object(teams_update_guard, '_ledger', lambda ledger: ledger or self.announcements)
        guard.start()
        self.addCleanup(guard.stop)
        mail = patch.object(teams_week_meeting, 'may_send_schedule_email', lambda _request: True)
        mail.start()
        self.addCleanup(mail.stop)

    @staticmethod
    def person(email):
        return {'emailAddress': {'address': email}, 'type': 'required'}

    def edit(self, **body):
        self.body.update(body)
        response = self.week.curriculum_week_teams_meeting_detail(types.SimpleNamespace(method='PATCH'), 'MOD-1', 'LIVE-EXTRA')
        if hasattr(response, 'content'):
            # A saved edit is a real JsonResponse; read what it says.
            result = email_tests.Response(json.loads(response.content), response.status_code)
            return result
        return response

    def announced(self):
        return [call for call in self.calls if call[0] == 'PATCH' and call[3] is None]

    def test_a_notified_time_change_is_one_announcement_with_everyone_on_it(self):
        moved = (self.START + timedelta(days=1)).isoformat()
        result = self.edit(startDateTimeUtc=moved, notifyAttendees=True,
                           attendees=['one@example.invalid', 'gone@example.invalid', 'new@example.invalid'])
        self.assertEqual(result.status_code, 200, getattr(result, 'message', result))
        announced = self.announced()
        # One write: the new time and the whole list together, never a second
        # "attendees" announcement after it.
        self.assertEqual(len(announced), 1)
        self.assertIn('start', announced[0][2])
        self.assertEqual([p['emailAddress']['address'] for p in announced[0][2]['attendees']],
                         ['one@example.invalid', 'gone@example.invalid', 'new@example.invalid'])
        # The person added is on that announcement, so is never forwarded too.
        self.assertEqual(self.forwards, [])
        self.assertEqual(result['microsoftUpdate'], 'sent')
        # The LMS: the added guest gets the schedule, everyone else one "was / now".
        self.delivery.send_week_meeting_emails.assert_called_once()
        self.assertEqual(self.delivery.send_week_meeting_emails.call_args.kwargs['added'], ['new@example.invalid'])
        self.delivery.send_week_meeting_change_emails.assert_called_once()
        self.assertEqual(self.delivery.send_week_meeting_change_emails.call_args.kwargs['exclude'], ['new@example.invalid'])

    def test_a_silent_time_change_is_refused_before_microsoft_is_asked(self):
        result = self.edit(startDateTimeUtc=(self.START + timedelta(hours=2)).isoformat(), notifyAttendees=False)
        self.assertEqual(result.status_code, 400)
        self.assertEqual(result.code, 'time_change_needs_notice')
        self.assertEqual(self.calls, [])
        self.delivery.send_week_meeting_change_emails.assert_not_called()

    def test_a_people_only_edit_tells_only_the_person_added(self):
        result = self.edit(attendees=['one@example.invalid', 'gone@example.invalid', 'new@example.invalid'])
        self.assertEqual(result.status_code, 200, getattr(result, 'message', result))
        self.assertEqual(self.announced(), [])
        self.assertEqual(self.forwards, [['new@example.invalid']])
        self.delivery.send_week_meeting_change_emails.assert_not_called()
        self.assertEqual(self.delivery.send_week_meeting_emails.call_args.kwargs['added'], ['new@example.invalid'])

    def test_a_removed_guest_is_taken_off_silently_before_the_announcement(self):
        result = self.edit(startDateTimeUtc=(self.START + timedelta(days=1)).isoformat(), notifyAttendees=True,
                           attendees=['one@example.invalid'])
        self.assertEqual(result.status_code, 200, getattr(result, 'message', result))
        attendee_writes = [call[3] for call in self.calls if call[0] == 'PATCH' and 'attendees' in (call[2] or {})]
        self.assertEqual(attendee_writes, [SILENT, None])
        self.assertFalse([call for call in self.calls if call[0] == 'DELETE' or call[1].endswith('/cancel')])

    def test_a_retry_of_a_timed_out_edit_is_not_announced_twice_and_emails_once(self):
        moved = (self.START + timedelta(days=1)).isoformat()
        self.fail = (TIMED_OUT, True)
        first = self.edit(startDateTimeUtc=moved, notifyAttendees=True)
        self.assertEqual(first.status_code, 502)
        self.assertTrue(first.verificationRequired)
        self.delivery.send_week_meeting_change_emails.assert_not_called()
        self.calls.clear()
        retry = self.edit(startDateTimeUtc=moved, notifyAttendees=True)
        self.assertEqual(retry.status_code, 200, getattr(retry, 'message', retry))
        self.assertEqual(self.announced(), [])
        self.assertEqual(retry['microsoftUpdate'], 'already_attempted')
        # The LMS email the failed attempt never sent goes now, under a key
        # named after the edit itself, so a third press cannot repeat it.
        key = self.delivery.send_week_meeting_change_emails.call_args.kwargs['key']
        self.assertTrue(key.startswith('LIVE-EXTRA#'))
        self.edit(startDateTimeUtc=moved, notifyAttendees=True)
        self.assertEqual(self.delivery.send_week_meeting_change_emails.call_args.kwargs['key'], key)

    def test_every_write_reaches_only_the_additional_event(self):
        self.edit(startDateTimeUtc=(self.START + timedelta(days=1)).isoformat(), notifyAttendees=True,
                  attendees=['one@example.invalid', 'new@example.invalid'])
        self.assertTrue(self.calls)
        for _method, path, _payload, _headers in self.calls:
            self.assertIn('additional-event', path)
        self.assertEqual({params[0] if isinstance(params, list) else params for _table, params in self.writes},
                         {'LIVE-EXTRA', 'COMP-2'})


# --------------------------------------------------------------------------- 8/9/10
class OneEmailPerPersonTests(unittest.TestCase):
    service = email_tests.service

    def setUp(self):
        self.ledger = email_tests.MemoryLedger()
        self.sender = Mock(return_value=('accepted', ''))
        mail = types.SimpleNamespace(is_configured=lambda: True)
        self.modules = patch.dict(sys.modules, {'login': types.SimpleNamespace(email_azure=mail)})
        self.modules.start()
        self.addCleanup(self.modules.stop)
        message = (['one@example.invalid', 'back@example.invalid'], ['organizer@example.invalid'], 'learner', 'organiser')
        verified = patch.dict(self.service, {'verified_message': lambda _live, _added=None: copy.deepcopy(message)})
        verified.start()
        self.addCleanup(verified.stop)

    def send_added(self, key):
        return self.service['send_creation_emails']('LIVE-ONE', ledger=self.ledger, send=self.sender,
                                                    added=['back@example.invalid'], key=key)

    def test_a_person_removed_and_added_back_is_sent_the_schedule_again(self):
        # The creation email reached them under the calendar's own key ...
        self.ledger.rows[('LIVE-ONE', 'back@example.invalid')] = 'accepted'
        # ... and the old rule read that as "already sent" for ever.
        self.send_added('LIVE-ONE+first-readd-key')
        self.assertEqual([call.args[0] for call in self.sender.call_args_list], ['back@example.invalid'])

    def test_a_retry_of_the_same_add_does_not_send_it_twice(self):
        self.send_added('LIVE-ONE+first-readd-key')
        self.send_added('LIVE-ONE+first-readd-key')
        self.assertEqual(self.sender.call_count, 1)

    def test_a_later_genuine_re_add_is_its_own_membership(self):
        self.send_added('LIVE-ONE+first-readd-key')
        self.send_added('LIVE-ONE+second-readd-key')
        self.assertEqual(self.sender.call_count, 2)

    def test_the_change_email_leaves_out_the_people_the_same_update_added(self):
        changed = (['one@example.invalid', 'new@example.invalid'],
                   ['organizer@example.invalid', 'tutor@example.invalid', 'co@example.invalid'], 'learner', 'organiser')
        with patch.dict(self.service, {'verified_change_messages': lambda _live, _notice: copy.deepcopy(changed),
                                       'dispatch_change': self.service['dispatch_change']}), \
                patch.dict(sys.modules, {'curriculum_api.teams_schedule_notice': types.SimpleNamespace(
                    read_change_notice=lambda token, live: {'id': 'change-1'})}):
            self.service['dispatch_change']('LIVE-ONE', 'TOKEN', self.ledger, send=self.sender,
                                            exclude=['NEW@example.invalid', 'tutor@example.invalid', 'co@example.invalid'])
        # A learner, a presenter and a co-organiser added by the same update.
        self.assertEqual(sorted(call.args[0] for call in self.sender.call_args_list),
                         ['one@example.invalid', 'organizer@example.invalid'])

    def test_the_browser_retry_continues_the_updates_own_added_batch(self):
        for body, status in (({'addedPeople': ['back@example.invalid'], 'addedKey': 'short'}, 400),
                             ({'addedKey': 'first-readd-key'}, 400),
                             ({'resendKey': 'round-one-key', 'addedKey': 'first-readd-key'}, 400)):
            view = types.SimpleNamespace(json_body=lambda _, body=body: body)
            with patch.dict(sys.modules, {'curriculum_api.views': view}):
                request = types.SimpleNamespace(account=types.SimpleNamespace(role='staff'), method='POST')
                self.assertEqual(self.service['schedule_email'](request, 'LIVE-ONE').status_code, status, body)
        source = (ROOT / 'teams_schedule_delivery.py').read_text(encoding='utf-8')
        self.assertIn("f'{live_session_id}+{added_key}' if added_key", source)


# --------------------------------------------------------------------------- 11/12
class ArchiveGuardTests(unittest.TestCase):
    NOW = datetime(2026, 10, 7, 12, 0)

    def namespace(self, series, occurrences, fail=False):
        class DatabaseError(Exception):
            pass

        def fetch(table, where, params):
            if fail:
                raise DatabaseError('down')
            if table == 'series':
                return [row for row in series if row.get('status') not in ('cancelled', 'canceled')]
            return [row for row in occurrences.get(params[0], []) if row.get('status') not in ('cancelled', 'canceled')]

        ns = {'authoring_fetch_all': fetch, 'LIVE_SESSIONS_TABLE': 'series', 'LIVE_SESSION_OCCURRENCES_TABLE': 'occ',
              'clean_str': lambda value: str(value or '').strip(), 'utc_datetime': checks.utc_datetime,
              'parse_graph_datetime': lambda value: checks.utc_datetime(value) if value else None,
              'parse_int': lambda value, default=0: int(value) if value not in (None, '') else default,
              'utc_iso_value': lambda value: value.isoformat() if value else '', 'timedelta': timedelta,
              'datetime': types.SimpleNamespace(utcnow=lambda: self.NOW), 'DatabaseError': DatabaseError,
              'logger': types.SimpleNamespace(warning=lambda *a: None),
              'json_error': lambda message, status=400, **kw: email_tests.Response({'error': message, **kw}, status)}
        email_tests.definitions(ROOT / 'views.py', ns, {'module_future_teams_sessions', 'module_teams_calendar_block_response'})
        tree = ast.parse((ROOT / 'views.py').read_text(encoding='utf-8'))
        for node in tree.body:
            if isinstance(node, ast.Assign) and getattr(node.targets[0], 'id', '') == 'MODULE_TEAMS_CALENDAR_BLOCKS_ARCHIVE':
                ns['MODULE_TEAMS_CALENDAR_BLOCKS_ARCHIVE'] = ast.literal_eval(node.value)
        return ns

    def occurrence(self, number, start, status='scheduled'):
        start = datetime.fromisoformat(start)
        return {'session_number': number, 'status': status, 'scheduled_start': start,
                'scheduled_end': start + timedelta(hours=2)}

    def test_a_module_with_a_future_session_cannot_be_archived(self):
        ns = self.namespace([{'id': 'LIVE-1', 'status': 'active'}],
                            {'LIVE-1': [self.occurrence(1, '2026-09-01T09:00'), self.occurrence(2, '2026-11-01T09:00')]})
        response = ns['module_teams_calendar_block_response']('MOD-1')
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response['code'], 'module_has_active_teams_calendar')
        self.assertIn('Cancel the Teams calendar before archiving', response['error'])
        self.assertEqual(response['futureSessions'], 1)

    def test_only_past_sessions_never_block(self):
        ns = self.namespace([{'id': 'LIVE-1', 'status': 'active'}],
                            {'LIVE-1': [self.occurrence(1, '2026-09-01T09:00'), self.occurrence(2, '2026-10-01T09:00')]})
        self.assertIsNone(ns['module_teams_calendar_block_response']('MOD-1'))

    def test_cancelled_sessions_and_calendars_never_block(self):
        ns = self.namespace([{'id': 'LIVE-1', 'status': 'active'}, {'id': 'LIVE-2', 'status': 'cancelled'}],
                            {'LIVE-1': [self.occurrence(1, '2026-11-01T09:00', 'cancelled')],
                             'LIVE-2': [self.occurrence(1, '2026-11-01T09:00')]})
        self.assertIsNone(ns['module_teams_calendar_block_response']('MOD-1'))

    def test_a_not_in_plan_slot_and_a_week_meeting_still_block(self):
        ns = self.namespace([{'id': 'LIVE-1', 'status': 'active'}, {'id': 'WEEK-1', 'status': 'week-meeting'}],
                            {'LIVE-1': [self.occurrence(5, '2026-12-01T09:00', 'superseded')],
                             'WEEK-1': [self.occurrence(1, '2026-11-15T09:00')]})
        response = ns['module_teams_calendar_block_response']('MOD-1')
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response['liveSessionIds'], ['LIVE-1', 'WEEK-1'])

    def test_an_unreadable_calendar_fails_closed(self):
        ns = self.namespace([], {}, fail=True)
        self.assertEqual(ns['module_teams_calendar_block_response']('MOD-1').status_code, 503)

    def test_archive_permanent_delete_and_move_all_check_before_removing_anything(self):
        tree = ast.parse((ROOT / 'views.py').read_text(encoding='utf-8'))
        functions = {node.name: node for node in tree.body if isinstance(node, ast.FunctionDef)}

        def first_line(fn, name):
            return min(node.lineno for node in ast.walk(functions[fn])
                       if isinstance(node, ast.Call) and getattr(node.func, 'id', '') == name)
        self.assertLess(first_line('curriculum_module_detail', 'module_teams_calendar_block_response'),
                        first_line('curriculum_module_detail', 'delete_module_authoring_structure'))
        self.assertLess(first_line('permanent_module_delete_response', 'module_teams_calendar_block_response'),
                        first_line('permanent_module_delete_response', 'delete_rows'))
        self.assertLess(first_line('convert_module_to_free_course', 'module_future_teams_sessions'),
                        first_line('convert_module_to_free_course', 'delete_module_authoring_structure'))
        # Read-only: the guard reaches no Graph call and writes no row.
        for name in ('module_future_teams_sessions', 'module_teams_calendar_block_response'):
            source = ast.unparse(functions[name])
            for forbidden in ('microsoft_graph_request', 'update_authoring_rows', 'delete_rows', 'send_cancellation'):
                self.assertNotIn(forbidden, source)


# --------------------------------------------------------------------------- 15/16
class NothingNewCancelsTests(unittest.TestCase):
    def test_the_new_and_changed_paths_have_no_delete_or_cancel(self):
        for name in ('teams_update_guard.py', 'teams_weekly_calendar.py'):
            source = (ROOT / name).read_text(encoding='utf-8')
            self.assertNotIn("'DELETE'", source, name)
            self.assertNotIn('/cancel', source, name)
        tree = ast.parse((ROOT / 'views.py').read_text(encoding='utf-8'))
        for node in tree.body:
            if isinstance(node, ast.FunctionDef) and node.name in {
                    'curriculum_teams_meeting_schedule', 'refresh_standalone_occurrence_options',
                    'curriculum_teams_meeting_occurrence_schedule', 'module_future_teams_sessions',
                    'module_teams_calendar_block_response', 'with_schedule_change_notice'}:
                source = ast.unparse(node)
                self.assertNotIn("'DELETE'", source, node.name)
                self.assertNotIn('/cancel', source, node.name)
                self.assertNotIn('send_cancellation', source, node.name)

    def test_the_week_meeting_edit_never_deletes_only_its_cancel_does(self):
        tree = ast.parse((ROOT / 'teams_week_meeting.py').read_text(encoding='utf-8'))
        detail = next(node for node in tree.body
                      if isinstance(node, ast.FunctionDef) and node.name == 'curriculum_week_teams_meeting_detail')
        deletes = [node for node in ast.walk(detail) if isinstance(node, ast.Constant) and node.value == 'DELETE']
        # The only 'DELETE' it knows is the HTTP method that routes to the
        # explicit Cancel; the edit path itself issues none.
        self.assertTrue(all(isinstance(node, ast.Constant) for node in deletes))
        self.assertNotIn("graph_request('DELETE'", ast.unparse(detail))


if __name__ == '__main__':
    unittest.main()
