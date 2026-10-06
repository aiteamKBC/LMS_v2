"""Run directly with Python. No Django imports, DB setup, credentials or network."""
import ast
import copy
import hashlib
import importlib.util
import logging
import re
import sys
import types
import unittest
import uuid
from datetime import datetime, timedelta, timezone
from html import escape
from pathlib import Path
from unittest.mock import Mock, patch
from urllib import parse as urllib_parse
from zoneinfo import ZoneInfo

ROOT = Path(__file__).parent
spec = importlib.util.spec_from_file_location('calendar_checks', ROOT / 'teams_calendar_checks.py')
checks = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checks)


#: What a Graph write carries when the author chose not to email.
SILENT_INVITE = {'Prefer': 'outlook.send-invitations="none"'}


class Response(dict):
    def __init__(self, data, status=200):
        super().__init__(data)
        self.status_code = status


class CalendarChecksTests(unittest.TestCase):
    def setUp(self):
        # Also blocks an accidental network dependency added in a future refactor.
        self.network = patch('socket.socket', side_effect=AssertionError('Network forbidden'))
        self.network.start()
        self.addCleanup(self.network.stop)
        self.events, self.instances, self.calls, self.headers, self.series, self.tracked = {}, [], [], [], [], []
        self.forwards = []
        self.instances_by_master = {}
        self.options_ok = True
        self.attach = Mock()
        self.corrupt = ''
        self.payload = self.make_payload()
        self.v = types.ModuleType('curriculum_api.views')
        self.v.__dict__.update(datetime=datetime, timedelta=timedelta, timezone=timezone, ZoneInfo=ZoneInfo, hashlib=hashlib,
                              escape=escape, re=re, urllib_parse=urllib_parse, logger=logging.getLogger('calendar-test'),
                              TEAMS_REPEAT_VALUES={'none', 'weekly', 'daily', 'weekdays'},
                              TEAMS_LOBBY_VALUES={'invited', 'organizer', 'everyone'}, DEFAULT_TEAMS_LOBBY_BYPASS='everyone', LIVE_SESSIONS_TABLE='series', LIVE_SESSION_OCCURRENCES_TABLE='occurrences',
                              csrf_exempt=lambda fn: fn, JsonResponse=Response,
                              json_error=lambda message, status=400, **kwargs: Response({'error': message, **kwargs}, status),
                              graph_timezone_iana=lambda settings: settings.get('_schedule_timezone_iana') or 'Europe/London', teams_calendar_subject=lambda payload, series=None: payload.get('title', 'Synthetic'),
                              GRAPH_WINDOWS_TO_IANA={'GMT Standard Time': 'Europe/London', 'Egypt Standard Time': 'Africa/Cairo'},
                              attach_teams_meeting_to_module_weeks=self.attach,
                              live_session_row_to_component_settings=lambda row: {'liveSessionUrl': row['join_url']},
                              calendar_targets=checks.calendar_targets, local_calendar_recurrence=checks.local_calendar_recurrence,
                              CalendarMismatch=checks.CalendarMismatch, safe_teams_join_url=checks.safe_teams_join_url,
                              utc_datetime=checks.utc_datetime, graph_calendar_time=checks.graph_calendar_time,
                              verify_calendar=checks.verify_calendar, publish_attendees=checks.publish_attendees,
                              attendee_differences=checks.attendee_differences,
                              attendees_already_match=checks.attendees_already_match,
                              event_organizer_address=checks.event_organizer_address,
                              unconfirmed_attendee_detail=checks.unconfirmed_attendee_detail,
                              sessions_a_rewrite_would_drop=checks.sessions_a_rewrite_would_drop,
                              dropped_sessions_sentence=checks.dropped_sessions_sentence,
                              teams_meeting_default_organizer=lambda: '', teams_new_meeting_organizer=lambda value: value,
                              json_body=lambda request: self.payload, ensure_live_sessions_table=lambda: None,
                              ensure_live_session_tracking_tables=lambda: None,
                              resolve_authoring_catalogue_id=lambda value: value, authoring_module_exists=lambda _: True,
                              resolve_stored_module_catalogue_id=lambda value: value,
                              authoring_fetch_all=self.fetch_rows, has_column=lambda *args: True,
                              calendar_groups=lambda *args: [], stored_calendar_series=lambda _: [],
                              teams_non_delivery_reason=lambda *args, **kwargs: '',
                              truthy=lambda value: str(value).strip().lower() in {'1', 'true', 'yes', 'on'},
                              graph_event_utc=self.utc_event, persist_live_session_series=self.persist_series,
                              replace_live_session_occurrences=self.persist_occurrences,
                              held_schedule_snapshot=lambda _live_session_id: [],
                              with_schedule_change_notice=lambda response, _live_session_id, _before: response,
                              update_authoring_rows=self.update_series, json_db_value=lambda value: value,
                              apply_teams_meeting_options=lambda *args, **kwargs: (self.options_ok, {'id': 'online-1'}, []),
                              teams_series_email_list=lambda value: value or [],
                              persist_recreated_occurrence_details=self.persist_recreated_details,
                              # The instance read waits for Microsoft to finish expanding a
                              # recurrence. A test double answers at once, so the wait is a
                              # no-op here rather than real seconds on every short series.
                              time=types.SimpleNamespace(sleep=lambda _seconds: None))
        names = {'clean_str', 'parse_graph_datetime', 'teams_attendee_emails', 'teams_event_body_html',
                 'teams_event_payload', 'teams_single_occurrence_payload', 'teams_calendar_minute_key',
                 'teams_shifted_occurrence_targets', 'teams_expanded_instances',
                 'teams_standalone_occurrence_meeting',
                 'apply_teams_occurrence_shifts', 'curriculum_teams_meeting', 'curriculum_teams_meeting_schedule',
                 # The occurrence-deletion rule and the sentence a refusal is reported with.
                 'parse_int', 'vacated_occurrence_keys', 'tracked_occurrence_keys', 'flag_teams_occurrence_leftovers',
                 'teams_warning_sentence',
                 'verify_teams_calendar_with_standalones', 'publish_teams_calendar_attendees',
                 'teams_newly_invited', 'forward_teams_invitation',
                 'reschedule_single_live_session_occurrence', 'saved_live_session_occurrences',
                 'teams_schedule_settings'}
        tree = ast.parse((ROOT / 'views.py').read_text(encoding='utf-8-sig'))
        for node in tree.body:
            if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == 'GRAPH_SILENT_INVITE_HEADERS' for target in node.targets):
                self.v.GRAPH_SILENT_INVITE_HEADERS = ast.literal_eval(node.value)
        nodes = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names]
        self.assertEqual(len(nodes), len(names))
        exec(compile(ast.Module(body=nodes, type_ignores=[]), str(ROOT / 'views.py'), 'exec'), self.v.__dict__)
        transport = types.ModuleType('coach_api.views')
        transport.microsoft_graph_request = self.graph
        transport.has_graph_credentials = lambda: True
        transport.get_graph_settings = lambda: {'timezone': 'GMT Standard Time'}
        self.modules = patch.dict(sys.modules, {'coach_api': types.ModuleType('coach_api'), 'coach_api.views': transport})
        self.modules.start()
        self.addCleanup(self.modules.stop)

    def make_payload(self, hour=0):
        dates = ['2026-09-17', '2026-09-24', '2026-10-08', '2026-10-15', '2026-10-22', '2026-10-29',
                 '2026-11-05', '2026-11-12', '2026-11-19', '2026-11-26', '2026-12-03', '2026-12-10']
        starts = [datetime.fromisoformat(day).replace(hour=hour, tzinfo=ZoneInfo('Europe/London')).astimezone(timezone.utc) for day in dates]
        return {'title': 'Synthetic', 'moduleCatalogueId': 'MOD-SYNTHETIC', 'organizerEmail': 'organizer@example.invalid',
                'attendees': ['learner@example.invalid'], 'presenters': [], 'coOrganizers': [],
                'localStartDateTime': f'2026-09-17T{hour:02}:00:00', 'startDateTimeUtc': starts[0].isoformat(),
                'durationMinutes': 120, 'repeat': 'weekly', 'repeatOccurrences': 12,
                'hideAttendees': False, 'transactionId': 'synthetic-transaction',
                'scheduledOccurrences': [{'sessionNumber': i + 1, 'startDateTimeUtc': start.isoformat(), 'durationMinutes': 120} for i, start in enumerate(starts)]}

    def utc_event(self, event):
        result = copy.deepcopy(event)
        for field in ('start', 'end'):
            result[field] = {'dateTime': checks.event_instant(event, field).isoformat(), 'timeZone': 'UTC'}
        return result

    def fetch_rows(self, table, where='', values=(), *args):
        return self.series if table == 'series' else self.tracked

    def persist_series(self, payload, event, warnings, settings, organizer, attendees, presenters, *args, **kwargs):
        self.series = [{'id': 'LIVE-SYNTHETIC', 'graph_event_id': event['id'], 'organizer_email': organizer,
                        'join_url': event['onlineMeeting']['joinUrl'], 'attendees': attendees, 'presenters': presenters,
                        'co_organizers': [], 'duration_minutes': 120, 'repeat_pattern': 'weekly', 'repeat_occurrences': 12,
                        'hide_attendees': True, 'warnings': warnings, 'timezone': settings.get('timezone'),
                        'module_catalogue_id': payload.get('moduleCatalogueId')}]
        self.assertFalse(kwargs['persist_occurrences'])
        return 'LIVE-SYNTHETIC', 0

    def persist_occurrences(self, live_id, payload, *args, **kwargs):
        self.tracked = copy.deepcopy(payload['scheduledOccurrences'])
        return self.tracked

    def persist_recreated_details(self, live_id, details):
        by_number = {int(item['sessionNumber']): item for item in self.tracked}
        for detail in details:
            row = by_number[int(detail['session_number'])]
            row.update(detail)

    def update_series(self, table, where, params, values):
        if self.series:
            self.series[0].update(values)

    def expand(self, event):
        self.instances = []
        zone = self.v.GRAPH_WINDOWS_TO_IANA.get(event['start'].get('timeZone'), 'Europe/London')
        start = checks.event_instant(event, 'start').astimezone(ZoneInfo(zone))
        duration = checks.event_instant(event, 'end') - checks.event_instant(event, 'start')
        recurrence = event.get('recurrence')
        count = recurrence['range']['numberOfOccurrences'] if recurrence else 1
        while len(self.instances) < count:
            if not recurrence or start.strftime('%A').lower() in recurrence['pattern'].get('daysOfWeek', [start.strftime('%A').lower()]):
                instance = copy.deepcopy(event)
                instance.update(id=f'instance-{event["id"]}-{len(self.instances)}', start={'dateTime': start.astimezone(timezone.utc).isoformat(), 'timeZone': 'UTC'},
                                end={'dateTime': (start.astimezone(timezone.utc) + duration).isoformat(), 'timeZone': 'UTC'})
                self.instances.append(instance)
            start += timedelta(days=1)
        self.instances_by_master[event['id']] = self.instances

    def graph(self, method, path, payload=None, *, extra_headers=None):
        if extra_headers is not None:
            self.assertEqual(extra_headers, {'Prefer': 'outlook.send-invitations="none"'})
        self.headers.append((method, path, copy.deepcopy(extra_headers), copy.deepcopy(payload)))
        self.calls.append((method, path, copy.deepcopy(payload)))
        if method == 'POST' and path.endswith('/forward'):
            # Graph accepts a forward and returns nothing. It is the one write
            # that reaches named people only, so a people-only save uses it to
            # invite whoever it added without mailing everyone already invited.
            self.forwards.append((urllib_parse.unquote(path.split('/')[-2]),
                                  [item['emailAddress']['address'] for item in (payload or {}).get('ToRecipients', [])]))
            return {}
        if method == 'POST':
            event_id = f'event-{len(self.events) + 1}'
            event = {**copy.deepcopy(payload), 'id': event_id, 'onlineMeeting': {'joinUrl': f'https://teams.microsoft.com/meet/synthetic-{event_id}'}, 'isCancelled': False}
            self.events[event_id] = event
            self.expand(event)
            if self.corrupt == 'link' or self.corrupt == 'second_day_link' and event_id == 'event-2':
                self.instances[-1]['onlineMeeting']['joinUrl'] = 'https://teams.microsoft.com/meet/different'
            if self.corrupt == 'duration':
                self.instances[-1]['end']['dateTime'] = (checks.event_instant(self.instances[-1], 'end') + timedelta(minutes=5)).isoformat()
            return copy.deepcopy(event)
        if '/instances?' in path:
            return {'value': copy.deepcopy(self.instances_by_master[urllib_parse.unquote(path.split('/')[-2])])}
        key = urllib_parse.unquote(path.split('/')[-1])
        event = self.events.get(key) or next(item for items in self.instances_by_master.values() for item in items if item['id'] == key)
        if method == 'GET':
            return copy.deepcopy(event)
        if method == 'PATCH':
            if self.corrupt == 'rejected' and key.startswith('instance'):
                raise RuntimeError('ErrorOccurrenceCrossingBoundary')
            event.update(copy.deepcopy(payload))
            if 'recurrence' in payload:
                self.expand(event)
            if 'attendees' in payload:
                for item in self.instances_by_master.get(key, []):
                    item['attendees'] = copy.deepcopy(payload['attendees'])
            return copy.deepcopy(event)
        if method == 'DELETE':
            if not self.series:
                self.assertFalse(event.get('attendees'), 'Initial cleanup must happen before invitations')
            next(items for items in self.instances_by_master.values() if event in items).remove(event)
            return {}
        raise AssertionError(method)

    def create(self):
        return self.v.curriculum_teams_meeting(types.SimpleNamespace(method='POST'))

    def test_verified_shared_calendar_attaches_before_response_without_browser_restore(self):
        result = self.create()
        self.assertEqual(result.status_code, 201, result)
        module_id, saved, settings, occurrences = self.attach.call_args.args
        # Sending a calendar only links components the author already added;
        # missing weeks stay content-only until Restore/Re-attach is requested.
        self.assertFalse(self.attach.call_args.kwargs.get('create_missing'))
        self.assertEqual(module_id, 'MOD-SYNTHETIC')
        self.assertEqual(saved['id'], 'LIVE-SYNTHETIC')
        self.assertEqual(settings['liveSessionUrl'], result['meeting']['joinUrl'])
        self.assertEqual(len(occurrences), 12)
        self.assertTrue(all(event['attendees'] for event in self.events.values()))

    def test_unverified_calendar_does_not_attach_links(self):
        self.options_ok = False
        self.assertEqual(self.create().status_code, 502)
        self.attach.assert_not_called()

    def test_cairo_clock_is_used_for_graph_and_saved_for_future_updates(self):
        starts = [datetime.fromisoformat(day + 'T09:00:00').replace(tzinfo=ZoneInfo('Africa/Cairo')).astimezone(timezone.utc)
                  for day in ['2026-10-23', '2026-10-30', '2026-11-06']]
        self.payload.update(scheduleTimeZone='Africa/Cairo', localStartDateTime='2026-10-23T09:00:00',
                            startDateTimeUtc=starts[0].isoformat(), repeatOccurrences=3,
                            scheduledOccurrences=[{'sessionNumber': i + 1, 'startDateTimeUtc': start.isoformat(), 'durationMinutes': 120}
                                                  for i, start in enumerate(starts)])
        result = self.create()
        self.assertEqual(result.status_code, 201, result)
        self.assertEqual(self.events['event-1']['start'], {'dateTime': '2026-10-23T09:00:00', 'timeZone': 'Egypt Standard Time'})
        self.assertEqual(self.series[0]['timezone'], 'Egypt Standard Time')
        settings = self.v.teams_schedule_settings({'timezone': 'GMT Standard Time'}, series=self.series[0])
        self.assertEqual(settings['_schedule_timezone_iana'], 'Africa/Cairo')
        self.assertEqual([checks.event_instant(item, 'start') for item in self.instances], starts)

    def test_invalid_schedule_zone_is_refused_before_graph(self):
        self.payload['scheduleTimeZone'] = 'Invalid/Zone'
        self.assertEqual(self.create().status_code, 400)
        self.assertEqual(self.calls, [])

    def test_midnight_dst_uses_one_weekday_and_publishes_after_cleanup(self):
        result = self.create()
        self.assertEqual(result.status_code, 201, result)
        self.assertEqual(self.events['event-1']['recurrence']['pattern']['daysOfWeek'], ['thursday'])
        self.assertEqual(self.events['event-1']['recurrence']['range']['numberOfOccurrences'], 13)
        # The recurrence's one spare weekly slot is no longer deleted: removing it
        # is a cancellation Exchange emails to everyone invited, and only an
        # explicit Cancel may send one. It stays on Teams and is reported.
        self.assertEqual(len(self.instances), 13)
        self.assertEqual(len(self.tracked), 12)
        self.assertFalse([call for call in self.calls if call[0] == 'DELETE' or call[1].endswith('/cancel')])
        self.assertEqual(len(result['leftoverSlots']), 1)
        invitations = [i for i, call in enumerate(self.calls) if call[0] == 'PATCH' and 'attendees' in call[2]]
        self.assertEqual(len(invitations), 1)
        self.assertTrue(self.events['event-1']['hideAttendees'])

    def test_an_additional_middle_week_is_left_on_teams_without_a_cancellation(self):
        """Routing week 2 to its own event never cancels the module's old slot."""
        self.assertEqual(self.create().status_code, 201)
        # A module series can already have three tracked occurrences while the
        # author routes the middle week to an independent event. The module
        # update sends weeks 1 and 3 only; the old week-2 slot is a leftover,
        # not a request to cancel it or mail everyone invited.
        first_three = self.instances_by_master['event-1'][:3]
        self.instances_by_master['event-1'] = first_three
        existing = [
            {'id': f'OCC-{index + 1}', 'session_number': index + 1,
             'scheduled_start': item['start']['dateTime']}
            for index, item in enumerate(first_three)
        ]
        starts = [checks.event_instant(item, 'start') for item in first_three]
        targets = [
            {'session_number': 1, 'start': starts[0], 'end': starts[0] + timedelta(minutes=120)},
            {'session_number': 3, 'start': starts[2], 'end': starts[2] + timedelta(minutes=120)},
        ]
        self.calls.clear()
        warnings, _recreated, leftovers = self.v.apply_teams_occurrence_shifts(
            'organizer%40example.invalid', 'event-1', 'Synthetic', targets,
            [{'emailAddress': {'address': 'learner@example.invalid'}, 'type': 'required'}],
            {'organizer': 'organizer@example.invalid'}, existing,
        )

        self.assertEqual(warnings, [])
        # The middle slot is tracked by the module and remains on Teams. It is
        # neither deleted nor turned into a cancellation notification.
        self.assertEqual(leftovers, [])
        self.assertFalse([call for call in self.calls if call[0] == 'DELETE' or call[1].endswith('/cancel')])
        self.assertEqual(
            {checks.event_instant(item, 'start') for item in self.instances_by_master['event-1']},
            set(starts),
        )

    def test_noon_remains_noon_across_dst(self):
        self.payload = self.make_payload(12)
        self.assertEqual(self.create().status_code, 201)
        self.assertTrue(all(checks.event_instant(item, 'start').astimezone(ZoneInfo('Europe/London')).hour == 12 for item in self.instances))

    def test_different_join_link_blocks_invitations_and_tracking(self):
        self.corrupt = 'link'
        self.assertEqual(self.create().status_code, 502)
        self.assertFalse(self.events['event-1']['attendees'])
        self.assertFalse(self.tracked)
        self.assertTrue(self.series, 'Prepared calendar remains available for retry')

    def test_rejected_move_does_not_publish_requested_dates(self):
        self.corrupt = 'duration'
        original = self.graph
        def rejecting(method, path, payload=None, **kwargs):
            if method == 'PATCH' and 'instance-' in path:
                raise RuntimeError('ErrorOccurrenceCrossingBoundary')
            return original(method, path, payload, **kwargs)
        sys.modules['coach_api.views'].microsoft_graph_request = rejecting
        self.assertEqual(self.create().status_code, 502)
        self.assertFalse(self.tracked)
        self.assertFalse(self.events['event-1']['attendees'])

    def test_options_failure_keeps_invitations_pending(self):
        self.options_ok = False
        self.assertEqual(self.create().status_code, 502)
        self.assertFalse(self.events['event-1']['attendees'])

    def test_an_update_refused_after_preparation_has_cancelled_nothing(self):
        """A later validation failure must not find occurrences already deleted.

        The deletes used to run inside the schedule shift, several Graph calls
        before the meeting-option check could reject the whole update -- so an
        author whose update was refused had already had Exchange tell the cohort
        a session was cancelled. They are issued last now, after everything that
        can still refuse has run.
        """
        self.assertEqual(self.create().status_code, 201)
        shifted = []
        for index, item in enumerate(self.payload['scheduledOccurrences']):
            start = datetime.fromisoformat(item['startDateTimeUtc'])
            # Move one session a day on -- genuine cleanup to hold back, and no
            # collision with the session that follows it.
            shifted.append({**item, 'startDateTimeUtc': (start + timedelta(days=1)).isoformat()} if index == 2 else item)
        self.payload.update(scheduledOccurrences=shifted, notifyAttendees=False)
        self.options_ok = False
        self.calls.clear()

        result = self.v.curriculum_teams_meeting_schedule(types.SimpleNamespace(method='PATCH'), 'LIVE-SYNTHETIC')

        self.assertEqual(result.status_code, 502, result)
        self.assertFalse([item for item in self.calls if item[0] == 'DELETE'],
                         'a refused update deleted a Microsoft occurrence anyway')

    def test_overlapping_sessions_rejected_before_graph(self):
        self.payload['scheduledOccurrences'][1]['startDateTimeUtc'] = self.payload['startDateTimeUtc']
        self.assertEqual(self.create().status_code, 400)
        self.assertFalse(self.calls)

    def test_existing_calendar_cannot_be_created_again(self):
        self.assertEqual(self.create().status_code, 201)
        self.calls.clear()
        self.assertEqual(self.create().status_code, 409)
        self.assertFalse(self.calls)

    def test_people_only_save_writes_the_new_list_silently_without_resetting_recurrence(self):
        """Changing who is invited changes who is invited, with or without mail.

        This save used to write the new list to the online meeting only and to
        leave the calendar event attendees alone unless the author had ticked
        the review email box, so an author who chose not to email got a meeting
        whose invitation list never changed. The list is written either way now;
        only the Prefer header differs, and for a people-only save it is always
        the silent one -- correcting who is invited is not news for everyone who
        already was. The recurrence must still be left alone, and a second
        identical save must still write nothing at all.
        """
        self.assertEqual(self.create().status_code, 201)
        before = copy.deepcopy(self.instances)
        self.payload.update(peopleOnly=True, attendees=['replacement@example.invalid'])
        self.v.apply_teams_meeting_options = Mock(return_value=(True, {'id': 'online-1'}, []))
        self.calls.clear()
        self.headers.clear()
        result = self.v.curriculum_teams_meeting_schedule(types.SimpleNamespace(method='PATCH'), 'LIVE-SYNTHETIC')
        self.assertEqual(result.status_code, 200, result)
        patches = [call[2] for call in self.calls if call[0] == 'PATCH']
        self.assertEqual([sorted(patch) for patch in patches], [['attendees']])
        self.assertEqual(
            [item['emailAddress']['address'] for item in patches[0]['attendees']],
            ['replacement@example.invalid'],
        )
        announced = [item[2] for item in self.headers if item[0] == 'PATCH' and 'attendees' in (item[3] or {})]
        self.assertEqual(announced, [SILENT_INVITE])
        # Silence for the people already invited, not for the person added: they
        # are forwarded the meeting, which is the only write Graph offers that
        # reaches named recipients alone.
        self.assertEqual(self.forwards, [('event-1', ['replacement@example.invalid'])])
        self.assertEqual(self.v.apply_teams_meeting_options.call_args.kwargs['attendees'],
                         ['replacement@example.invalid'])
        self.assertEqual([item['start'] for item in self.instances], [item['start'] for item in before])
        self.calls.clear()
        self.forwards.clear()
        self.assertEqual(self.v.curriculum_teams_meeting_schedule(types.SimpleNamespace(method='PATCH'), 'LIVE-SYNTHETIC').status_code, 200)
        self.assertFalse([call for call in self.calls if call[0] == 'PATCH'])
        # Nobody is new the second time, so nobody is forwarded anything either.
        self.assertFalse(self.forwards)

    def test_browser_cannot_make_a_people_only_save_announce_itself(self):
        self.assertEqual(self.create().status_code, 201)
        self.payload.update(peopleOnly=True, attendees=['replacement@example.invalid'], notifyAttendees=True)
        self.calls.clear()
        self.headers.clear()

        result = self.v.curriculum_teams_meeting_schedule(types.SimpleNamespace(method='PATCH'), 'LIVE-SYNTHETIC')

        self.assertEqual(result.status_code, 200, result)
        invitations = [call for call in self.calls if call[0] == 'PATCH' and 'attendees' in call[2]]
        self.assertEqual(len(invitations), 1)
        # What the save touched decides who hears about it, not what the browser
        # asked for: a field claiming otherwise buys no mail to the people who
        # were already invited.
        self.assertEqual([item[2] for item in self.headers
                          if item[0] == 'PATCH' and 'attendees' in (item[3] or {})], [SILENT_INVITE])

    def test_notified_date_update_waits_for_silent_repair_then_sends_final_master_state(self):
        self.assertEqual(self.create().status_code, 201)
        shifted = []
        for item in self.payload['scheduledOccurrences']:
            start = datetime.fromisoformat(item['startDateTimeUtc']) + timedelta(hours=1)
            shifted.append({**item, 'startDateTimeUtc': start.isoformat()})
        self.payload.update(
            localStartDateTime='2026-09-17T01:00:00',
            startDateTimeUtc=shifted[0]['startDateTimeUtc'],
            scheduledOccurrences=shifted,
            notifyAttendees=True,
        )
        self.calls.clear()
        self.headers.clear()

        result = self.v.curriculum_teams_meeting_schedule(types.SimpleNamespace(method='PATCH'), 'LIVE-SYNTHETIC')

        self.assertEqual(result.status_code, 200, result)
        master_updates = [item for item in self.headers if item[0] == 'PATCH' and 'recurrence' in (item[3] or {})]
        self.assertEqual(len(master_updates), 1)
        self.assertEqual(master_updates[0][2], {'Prefer': 'outlook.send-invitations="none"'})
        notifications = [item for item in self.headers if item[0] == 'PATCH' and 'attendees' in (item[3] or {})]
        self.assertEqual(len(notifications), 1)
        self.assertIsNone(notifications[0][2])
        self.assertIn('subject', notifications[0][3])
        attendee_only = [call for call in self.calls if call[0] == 'PATCH' and set(call[2] or {}) == {'attendees'}]
        self.assertEqual(attendee_only, [])

    def test_existing_calendar_options_update_preserves_identity_dates_and_invitation_body(self):
        self.assertEqual(self.create().status_code, 201)
        before = copy.deepcopy(self.events['event-1'])
        self.payload.update(peopleOnly=True, recording='record', lobbyBypass='organizer', spokenLanguage='ar-EG')
        self.v.apply_teams_meeting_options = Mock(return_value=(True, {'id': 'online-1'}, []))
        self.calls.clear()
        result = self.v.curriculum_teams_meeting_schedule(types.SimpleNamespace(method='PATCH'), 'LIVE-SYNTHETIC')
        self.assertEqual(result.status_code, 200, result)
        self.assertEqual(self.events['event-1'], before)
        self.assertFalse([call for call in self.calls if call[0] in ('POST', 'DELETE')])
        self.assertEqual(self.series[0]['recording'], 'record')
        self.assertEqual(self.series[0]['lobby_bypass'], 'organizer')
        self.assertEqual(self.series[0]['spoken_language'], 'ar-EG')
        options = self.v.apply_teams_meeting_options.call_args.kwargs
        self.assertEqual((options['recording'], options['lobby_bypass'], options['spoken_language']), ('record', 'organizer', 'ar-EG'))
        for key in ('recording', 'lobbyBypass', 'spokenLanguage'):
            self.payload.pop(key)
        self.v.curriculum_teams_meeting_schedule(types.SimpleNamespace(method='PATCH'), 'LIVE-SYNTHETIC')
        self.assertEqual(self.v.apply_teams_meeting_options.call_args.kwargs, options)

    def test_invalid_options_do_not_reach_microsoft(self):
        self.assertEqual(self.create().status_code, 201)
        self.payload['recording'] = 'invalid'
        self.calls.clear()
        self.assertEqual(self.v.curriculum_teams_meeting_schedule(types.SimpleNamespace(method='PATCH'), 'LIVE-SYNTHETIC').status_code, 400)
        self.assertEqual(self.calls, [])

    def test_rejected_option_update_does_not_claim_saved_options_or_success(self):
        self.assertEqual(self.create().status_code, 201)
        self.series[0]['recording'] = 'none'
        self.payload.update(peopleOnly=True, recording='record')
        self.options_ok = False
        result = self.v.curriculum_teams_meeting_schedule(types.SimpleNamespace(method='PATCH'), 'LIVE-SYNTHETIC')
        self.assertEqual(result.status_code, 502)
        self.assertTrue(result['partial'])
        self.assertEqual(self.series[0]['recording'], 'none')

    def test_people_only_does_not_split_a_shared_calendar_with_mixed_durations(self):
        self.assertEqual(self.create().status_code, 201)
        # A shared series can have an individual duration exception.
        self.instances[1]['end']['dateTime'] = (checks.event_instant(self.instances[1], 'start') + timedelta(minutes=60)).isoformat()
        self.payload['scheduledOccurrences'][1]['durationMinutes'] = 60
        self.payload.update(peopleOnly=True, attendees=['replacement@example.invalid'])
        self.v.calendar_groups = lambda *args: self.fail('A people save must not choose a new series mode')
        before = copy.deepcopy(self.tracked)
        self.calls.clear()
        result = self.v.curriculum_teams_meeting_schedule(types.SimpleNamespace(method='PATCH'), 'LIVE-SYNTHETIC')
        self.assertEqual(result.status_code, 200, result)
        self.assertEqual(self.tracked, before)
        self.assertFalse([call for call in self.calls
                          if call[0] == 'DELETE' or (call[0] == 'POST' and not call[1].endswith('/forward'))])
        # The one person this save added is invited directly, so nobody already
        # on the meeting is mailed about them joining it.
        self.assertEqual(self.forwards, [('event-1', ['replacement@example.invalid'])])

    def test_unrelated_event_id_rejected_before_graph(self):
        self.assertEqual(self.create().status_code, 201)
        self.payload['eventId'] = 'another-calendar'
        self.calls.clear()
        self.assertEqual(self.v.curriculum_teams_meeting_schedule(types.SimpleNamespace(method='PATCH'), 'LIVE-SYNTHETIC').status_code, 409)
        self.assertFalse(self.calls)

    def test_join_url_rejects_non_microsoft_and_credentials(self):
        for url in ['http://teams.microsoft.com/meet/test', 'https://teams.microsoft.com.evil.invalid/meet/test',
                    'https://user:secret@teams.microsoft.com/meet/test', 'https://teams.microsoft.com:bad/meet/test']:
            self.assertFalse(checks.safe_teams_join_url(url))

    def prepare_weekday_path(self):
        package = types.ModuleType('curriculum_api')
        package.views = self.v
        self.modules2 = patch.dict(sys.modules, {'curriculum_api': package, 'curriculum_api.views': self.v})
        self.modules2.start()
        self.addCleanup(self.modules2.stop)
        namespace = {'__package__': 'curriculum_api', 'datetime': datetime, 'timedelta': timedelta, 'timezone': timezone,
                     'quote': urllib_parse.quote, 'urlencode': urllib_parse.urlencode, 'ZoneInfo': ZoneInfo, 'uuid': uuid,
                     'JsonResponse': Response, 'calendar_targets': checks.calendar_targets,
                     'verify_calendar': checks.verify_calendar, 'publish_attendees': checks.publish_attendees,
                     'CalendarMismatch': checks.CalendarMismatch,
                     'sessions_a_rewrite_would_drop': checks.sessions_a_rewrite_would_drop,
                     'dropped_sessions_sentence': checks.dropped_sessions_sentence}
        tree = ast.parse((ROOT / 'teams_weekly_calendar.py').read_text(encoding='utf-8-sig'))
        functions = [node for node in tree.body if isinstance(node, (ast.FunctionDef, ast.ClassDef))]
        exec(compile(ast.Module(body=functions, type_ignores=[]), 'weekday_calendar_functions', 'exec'), namespace)
        self.v.calendar_groups = namespace['calendar_groups']
        self.v.save_weekday_calendar = namespace['save_weekday_calendar']
        self.v.teams_event_recurrence = lambda repeat, start, count, days: None if repeat == 'none' else {
            'pattern': {'type': 'weekly', 'interval': 1, 'daysOfWeek': days},
            'range': {'type': 'numbered', 'startDate': start.date().isoformat(), 'numberOfOccurrences': count}}
        self.v.parse_json_value = lambda value, fallback: value or fallback
        self.v.authoring_module_exists = lambda _: False  # Component persistence is a separate DB boundary.
        self.v.authoring_upsert = lambda table, keys, values: self.tracked.append(copy.deepcopy(values))
        dates = ['2026-09-14T08:00:00Z', '2026-09-17T11:00:00Z', '2026-10-26T09:00:00Z', '2026-10-29T12:00:00Z']
        self.payload.update(startDateTimeUtc=dates[0], localStartDateTime='2026-09-14T09:00', repeatOccurrences=4,
                            scheduledOccurrences=[{'sessionNumber': i + 1, 'startDateTimeUtc': date, 'durationMinutes': 120} for i, date in enumerate(dates)])

    def test_weekday_calendars_are_all_verified_before_first_invitation(self):
        self.prepare_weekday_path()
        result = self.create()
        self.assertEqual(result.status_code, 201, result)
        self.assertEqual(len(self.events), 2)
        self.assertEqual(len(self.tracked), 4)
        invite_indexes = [i for i, call in enumerate(self.calls) if call[0] == 'PATCH' and 'attendees' in call[2]]
        self.assertEqual(len(invite_indexes), 2)
        # Spare weekly slots are reported, never deleted (see flag_teams_occurrence_leftovers).
        self.assertFalse([call for call in self.calls if call[0] == 'DELETE' or call[1].endswith('/cancel')])
        self.assertTrue(all(event['hideAttendees'] for event in self.events.values()))

    def test_second_weekday_failure_does_not_send_first_weekday_invites(self):
        self.prepare_weekday_path()
        self.corrupt = 'second_day_link'
        result = self.create()
        self.assertEqual(result.status_code, 502, result)
        self.assertEqual(len(self.events), 2)
        self.assertTrue(all(not event['attendees'] for event in self.events.values()))

    def test_weekday_option_update_keeps_each_existing_calendar_and_saves_options(self):
        self.prepare_weekday_path()
        self.assertEqual(self.create().status_code, 201)
        identities = {key: event['onlineMeeting']['joinUrl'] for key, event in self.events.items()}
        self.payload.update(peopleOnly=True, recording='record', lobbyBypass='organizer', spokenLanguage='ar-EG')
        self.v.stored_calendar_series = lambda series: series.get('calendar_series') or []
        self.calls.clear()
        result = self.v.curriculum_teams_meeting_schedule(types.SimpleNamespace(method='PATCH'), 'LIVE-SYNTHETIC')
        self.assertEqual(result.status_code, 200, result)
        self.assertEqual({key: event['onlineMeeting']['joinUrl'] for key, event in self.events.items()}, identities)
        self.assertFalse([call for call in self.calls if call[0] in ('POST', 'DELETE')])
        self.assertEqual(self.series[0]['recording'], 'record')
        self.assertEqual(self.series[0]['lobby_bypass'], 'organizer')
        self.assertEqual(self.series[0]['spoken_language'], 'ar-EG')

    def test_weekday_people_save_forwards_the_meeting_to_whoever_it_added(self):
        """A learner added to a per-day calendar is invited; nobody else hears.

        Both day series are written under the silent preference, so not one of
        the people already invited is mailed about somebody joining. The learner
        who was just added would get nothing at all from that write, so each
        day's meeting is forwarded to them by name -- the only call Graph offers
        that reaches named recipients alone.
        """
        self.prepare_weekday_path()
        self.assertEqual(self.create().status_code, 201)
        self.payload.update(peopleOnly=True,
                            attendees=['learner@example.invalid', 'joined@example.invalid'])
        self.v.stored_calendar_series = lambda series: series.get('calendar_series') or []
        self.calls.clear()
        self.headers.clear()
        self.forwards.clear()
        result = self.v.curriculum_teams_meeting_schedule(types.SimpleNamespace(method='PATCH'), 'LIVE-SYNTHETIC')
        self.assertEqual(result.status_code, 200, result)
        announced = [item[2] for item in self.headers if item[0] == 'PATCH' and 'attendees' in (item[3] or {})]
        self.assertEqual(announced, [SILENT_INVITE, SILENT_INVITE])
        self.assertEqual(sorted(self.forwards), sorted([('event-1', ['joined@example.invalid']),
                                                        ('event-2', ['joined@example.invalid'])]))

    def test_pending_invites_are_repaired_silently_without_recreating_or_rewriting_dates(self):
        """A create that failed before inviting anyone is repaired by the update.

        The invitation list used to stay empty until somebody ticked the review
        email box, which left a real meeting that no learner was on and no
        screen said so. The repair now puts the intended people on the calendar
        under the silent preference: no new event, no rewritten date, and no
        mail this application asked for.
        """
        self.options_ok = False
        self.assertEqual(self.create().status_code, 502)
        self.options_ok = True
        self.calls.clear()
        self.headers.clear()
        result = self.v.curriculum_teams_meeting_schedule(types.SimpleNamespace(method='PATCH'), 'LIVE-SYNTHETIC')
        self.assertEqual(result.status_code, 200, result)
        self.assertFalse([call for call in self.calls if call[0] in ('POST', 'DELETE')])
        patches = [call[2] for call in self.calls if call[0] == 'PATCH']
        self.assertEqual([sorted(patch) for patch in patches], [['attendees', 'hideAttendees', 'subject']])
        self.assertEqual([item[2] for item in self.headers if item[0] == 'PATCH'], [None])
        self.assertTrue(all(
            [item['emailAddress']['address'] for item in event['attendees']] == ['learner@example.invalid']
            for event in self.events.values()
        ))

    def test_deleted_series_occurrence_is_restored_silently_and_tracked_with_its_real_link(self):
        self.assertEqual(self.create().status_code, 201)
        missing_start = datetime.fromisoformat(self.payload['scheduledOccurrences'][2]['startDateTimeUtc'])
        wanted_starts = {
            datetime.fromisoformat(item['startDateTimeUtc'])
            for item in self.payload['scheduledOccurrences']
        }
        original = self.graph

        def preserve_deleted_occurrence(method, path, payload=None, **kwargs):
            result = original(method, path, payload, **kwargs)
            if method == 'PATCH' and path.endswith('/events/event-1') and payload and 'recurrence' in payload:
                master = self.instances_by_master['event-1']
                self.instances_by_master['event-1'] = [
                    item for item in master
                    if checks.event_instant(item, 'start') in wanted_starts
                    and checks.event_instant(item, 'start') != missing_start
                ]
            return result

        self.instances_by_master['event-1'] = [
            item for item in self.instances_by_master['event-1']
            if checks.event_instant(item, 'start') != missing_start
        ]
        sys.modules['coach_api.views'].microsoft_graph_request = preserve_deleted_occurrence
        self.v.apply_teams_meeting_options = Mock(return_value=(True, {'id': 'online-restored'}, []))
        self.calls.clear()
        self.headers.clear()

        result = self.v.curriculum_teams_meeting_schedule(
            types.SimpleNamespace(method='PATCH'), 'LIVE-SYNTHETIC',
        )

        self.assertEqual(result.status_code, 200, result)
        restored = self.events['event-2']
        self.assertEqual(checks.event_instant(restored, 'start'), missing_start)
        # The 1 October 2026 regression: a session rebuilt on its own event was
        # created with nobody on it, and only a later publish, which ran only
        # when the author had asked for email, would have put anyone there. It
        # carries its people from the moment it exists.
        self.assertEqual(
            [item['emailAddress']['address'] for item in restored['attendees']],
            ['learner@example.invalid'],
        )
        self.assertTrue(restored['hideAttendees'])
        restored_row = next(item for item in self.tracked if int(item['sessionNumber']) == 3)
        self.assertEqual(restored_row['graph_event_id'], 'event-2')
        self.assertEqual(restored_row['join_url'], restored['onlineMeeting']['joinUrl'])
        post = next(item for item in self.headers if item[0] == 'POST' and item[1].endswith('/events'))
        self.assertEqual(post[2], self.v.GRAPH_SILENT_INVITE_HEADERS)
        self.assertEqual(
            [item['emailAddress']['address'] for item in post[3]['attendees']],
            ['learner@example.invalid'],
        )
        # The update announces the newly added session to the existing roster.
        self.assertTrue([
            item for item in self.headers
            if item[0] in ('POST', 'PATCH') and item[2] is None
        ])

        # Later people/options saves must update both the master meeting and the
        # separately restored occurrence without creating another event or mail.
        self.payload.update(peopleOnly=True, presenters=['presenter@example.invalid'])
        self.calls.clear()
        self.headers.clear()
        self.v.apply_teams_meeting_options.reset_mock()
        result = self.v.curriculum_teams_meeting_schedule(
            types.SimpleNamespace(method='PATCH'), 'LIVE-SYNTHETIC',
        )
        self.assertEqual(result.status_code, 200, result)
        self.assertEqual(self.v.apply_teams_meeting_options.call_count, 2)
        self.assertTrue(all(
            call.kwargs['presenters'] == ['presenter@example.invalid']
            for call in self.v.apply_teams_meeting_options.call_args_list
        ))
        self.assertFalse([call for call in self.calls
                          if call[0] == 'DELETE' or (call[0] == 'POST' and not call[1].endswith('/forward'))])
        # The presenter this save added is forwarded the master and the restored
        # session, which is how somebody new gets the meeting on their calendar
        # when Microsoft has been told to announce nothing.
        self.assertEqual(self.forwards, [('event-1', ['presenter@example.invalid']),
                                         ('event-2', ['presenter@example.invalid'])])
        # The added presenter reaches the master and the separately restored
        # session alike -- they are on both meetings, not only in the online
        # meeting's roles -- and neither write asks Microsoft to announce it.
        invited = [
            [item['emailAddress']['address'] for item in call[2]['attendees']]
            for call in self.calls if call[0] == 'PATCH' and call[2] and 'attendees' in call[2]
        ]
        self.assertEqual(len(invited), 2)
        self.assertTrue(all(sorted(people) == ['learner@example.invalid', 'presenter@example.invalid']
                            for people in invited))
        self.assertEqual(
            [item[2] for item in self.headers if item[0] == 'PATCH' and 'attendees' in (item[3] or {})],
            [SILENT_INVITE, SILENT_INVITE],
        )

    def test_date_update_always_announces_the_change(self):
        """Existing-calendar updates always announce the new session dates."""
        self.assertEqual(self.create().status_code, 201)
        shifted = []
        for item in self.payload['scheduledOccurrences']:
            start = datetime.fromisoformat(item['startDateTimeUtc']) + timedelta(hours=1)
            shifted.append({**item, 'startDateTimeUtc': start.isoformat()})
        self.payload.update(
            localStartDateTime='2026-09-17T01:00:00',
            startDateTimeUtc=shifted[0]['startDateTimeUtc'],
            scheduledOccurrences=shifted,
            notifyAttendees=False,
        )
        self.calls.clear()
        self.headers.clear()

        result = self.v.curriculum_teams_meeting_schedule(types.SimpleNamespace(method='PATCH'), 'LIVE-SYNTHETIC')

        self.assertEqual(result.status_code, 200, result)
        writes = [item for item in self.headers if item[0] in ('POST', 'PATCH', 'DELETE')]
        self.assertTrue(writes)
        self.assertTrue([item for item in writes if item[2] is None])
        # The calendar really moved, and everyone invited is still invited.
        self.assertEqual(
            {checks.event_instant(item, 'start') for item in self.instances},
            {datetime.fromisoformat(item['startDateTimeUtc']) for item in shifted},
        )
        self.assertTrue(all(
            [person['emailAddress']['address'] for person in event['attendees']] == ['learner@example.invalid']
            for event in self.events.values()
        ))

    def test_ticked_date_update_keeps_everyone_invited_while_it_announces_the_change(self):
        """Ticked is unchanged: one announced master write, and nobody loses their place."""
        self.assertEqual(self.create().status_code, 201)
        shifted = []
        for item in self.payload['scheduledOccurrences']:
            start = datetime.fromisoformat(item['startDateTimeUtc']) + timedelta(hours=1)
            shifted.append({**item, 'startDateTimeUtc': start.isoformat()})
        self.payload.update(
            localStartDateTime='2026-09-17T01:00:00',
            startDateTimeUtc=shifted[0]['startDateTimeUtc'],
            scheduledOccurrences=shifted,
            notifyAttendees=True,
        )
        self.headers.clear()

        result = self.v.curriculum_teams_meeting_schedule(types.SimpleNamespace(method='PATCH'), 'LIVE-SYNTHETIC')

        self.assertEqual(result.status_code, 200, result)
        announced = [item for item in self.headers
                     if item[0] in ('POST', 'PATCH') and item[2] != self.v.GRAPH_SILENT_INVITE_HEADERS]
        self.assertEqual(len(announced), 1)
        self.assertIn('attendees', announced[0][3])
        self.assertTrue(all(
            [person['emailAddress']['address'] for person in event['attendees']] == ['learner@example.invalid']
            for event in self.events.values()
        ))

    def test_a_standalone_without_its_learners_cannot_pass_verification(self):
        """An empty or short invitation list is not a verified session.

        Dates alone used to be the whole of "verified", which is how a session
        rebuilt on its own event with nobody on it was reported as a success.
        """
        # One session the master still owns, one rebuilt on its own event: the
        # shape the master/standalone verification exists for.
        master_target = {'session_number': 2,
                         'start': datetime(2026, 9, 24, 8, 0, tzinfo=timezone.utc),
                         'end': datetime(2026, 9, 24, 10, 0, tzinfo=timezone.utc)}
        target = {'session_number': 3,
                  'start': datetime(2026, 10, 1, 8, 0, tzinfo=timezone.utc),
                  'end': datetime(2026, 10, 1, 10, 0, tzinfo=timezone.utc)}
        expected = [
            {'emailAddress': {'address': 'a@example.invalid'}, 'type': 'required'},
            {'emailAddress': {'address': 'b@example.invalid'}, 'type': 'required'},
        ]
        standalone_people = []

        def read(method, path, payload=None, **kwargs):
            event = {'id': 'event-2', 'isCancelled': False, 'hideAttendees': True,
                     'attendees': standalone_people,
                     'onlineMeeting': {'joinUrl': 'https://teams.microsoft.com/l/meetup-join/standalone'},
                     'start': {'dateTime': '2026-10-01T08:00:00.0000000', 'timeZone': 'UTC'},
                     'end': {'dateTime': '2026-10-01T10:00:00.0000000', 'timeZone': 'UTC'}}
            if path.endswith('/events/event-1'):
                return {**event, 'id': 'event-1', 'attendees': expected,
                        'start': {'dateTime': '2026-09-24T08:00:00.0000000', 'timeZone': 'UTC'},
                        'end': {'dateTime': '2026-09-24T10:00:00.0000000', 'timeZone': 'UTC'},
                        'onlineMeeting': {'joinUrl': 'https://teams.microsoft.com/l/meetup-join/master'}}
            return event

        details = [{'session_number': 3, 'graph_event_id': 'event-2',
                    'join_url': 'https://teams.microsoft.com/l/meetup-join/standalone'}]
        verify = lambda: self.v.verify_teams_calendar_with_standalones(
            read, 'organizer%40example.invalid', 'event-1', [master_target, target],
            'https://teams.microsoft.com/l/meetup-join/master', False, details,
            expected_attendees=expected,
        )

        # Nobody on it at all: the 1 October 2026 shape.
        with self.assertRaises(checks.CalendarMismatch):
            verify()
        # One learner short of the list is just as wrong.
        standalone_people = [expected[0]]
        with self.assertRaises(checks.CalendarMismatch):
            verify()
        # Someone the series does not invite, the same equality publish_attendees
        # confirms a published list with.
        standalone_people = [*expected, {'emailAddress': {'address': 'stranger@example.invalid'}}]
        with self.assertRaises(checks.CalendarMismatch):
            verify()
        # The intended list, in any order, passes.
        standalone_people = [expected[1], expected[0]]
        self.assertEqual(verify()['id'], 'event-1')

    def test_a_silent_publish_writes_nothing_it_does_not_have_to_and_a_heard_one_always_writes(self):
        """Membership and announcement are decided separately, and both are real.

        A silent publish over a list that already matches asks Microsoft for
        nothing. A publish meant to be heard writes even then: a session created
        under the silent preference already carries its people, and Microsoft
        puts a meeting on somebody's calendar only when something is sent, so
        skipping that write would leave a correct attendee list nobody ever saw.
        """
        people = [{'emailAddress': {'address': 'learner@example.invalid'}, 'type': 'required'}]
        event = {'id': 'event-1', 'subject': 'M3', 'attendees': people}
        standalone = {'id': 'event-2', 'subject': 'M3', 'attendees': people}
        details = [{'session_number': 3, 'graph_event_id': 'event-2'}]
        sent = []

        def request(method, path, payload=None, extra_headers=None, **kwargs):
            if method != 'GET':
                sent.append((method, path, extra_headers, payload))
            return standalone

        self.v.publish_teams_calendar_attendees(
            request, 'organizer%40example.invalid', event, people, details, silent=True,
        )
        self.assertEqual(sent, [])

        self.v.publish_teams_calendar_attendees(
            request, 'organizer%40example.invalid', event, people, details,
        )
        self.assertEqual([item[0] for item in sent], ['PATCH', 'PATCH'])
        self.assertEqual([item[1].rsplit('/', 1)[-1] for item in sent], ['event-1', 'event-2'])
        self.assertTrue(all(item[2] is None for item in sent))
        self.assertTrue(all(sorted(item[3]) == ['attendees'] for item in sent))

    def test_read_failure_does_not_trigger_blind_calendar_update(self):
        self.assertEqual(self.create().status_code, 201)
        self.calls.clear()
        original = self.graph
        def failed_read(method, path, payload=None, **kwargs):
            if method == 'GET' and '/instances?' in path:
                raise RuntimeError('Synthetic read failure')
            return original(method, path, payload, **kwargs)
        sys.modules['coach_api.views'].microsoft_graph_request = failed_read
        result = self.v.curriculum_teams_meeting_schedule(types.SimpleNamespace(method='PATCH'), 'LIVE-SYNTHETIC')
        self.assertEqual(result.status_code, 502)
        self.assertFalse([call for call in self.calls if call[0] != 'GET'])

    def test_single_session_move_verifies_its_own_link_and_preserves_others(self):
        self.assertEqual(self.create().status_code, 201)
        before = copy.deepcopy(self.instances)
        first = self.instances[0]
        occurrence = {'session_number': 1, 'scheduled_start': first['start']['dateTime'], 'graph_event_id': 'event-1'}
        desired = checks.event_instant(first, 'start') + timedelta(hours=12)
        result = self.v.reschedule_single_live_session_occurrence(self.series[0], occurrence, desired, 120)
        self.assertFalse(result[3])
        self.assertEqual(result[2], first['id'])
        self.assertEqual(checks.event_instant(self.instances[0], 'start'), desired)
        self.assertEqual(self.instances[1:], before[1:])
        move_call = next(call for call in reversed(self.headers) if call[0] == 'PATCH')
        self.assertEqual(move_call[2], self.v.GRAPH_SILENT_INVITE_HEADERS)

    def test_single_session_move_notifies_only_when_explicitly_requested(self):
        self.assertEqual(self.create().status_code, 201)
        first = self.instances[0]
        occurrence = {'session_number': 1, 'scheduled_start': first['start']['dateTime'], 'graph_event_id': 'event-1'}
        desired = checks.event_instant(first, 'start') + timedelta(hours=12)
        result = self.v.reschedule_single_live_session_occurrence(
            self.series[0], occurrence, desired, 120, notify_attendees=True,
        )
        self.assertFalse(result[3])
        move_call = next(call for call in reversed(self.headers) if call[0] == 'PATCH')
        self.assertIsNone(move_call[2])

    def test_meeting_spanning_clock_change_keeps_absolute_duration(self):
        start = '2026-10-24T23:00:00Z'  # Sunday midnight BST before the clock goes back.
        self.payload.update(startDateTimeUtc=start, localStartDateTime='2026-10-25T00:00', repeat='none', repeatOccurrences=1,
                            scheduledOccurrences=[{'sessionNumber': 1, 'startDateTimeUtc': start, 'durationMinutes': 120}])
        result = self.create()
        self.assertEqual(result.status_code, 201, result)
        event = self.events['event-1']
        self.assertEqual(checks.event_instant(event, 'end') - checks.event_instant(event, 'start'), timedelta(hours=2))


class AttendeeConfirmationTests(unittest.TestCase):
    """What counts as Microsoft confirming the invitation list it was sent.

    A pasted internal alias comes back from Graph as that mailbox's primary
    address, and the organizer is never an attendee of their own event. Read
    character by character, both looked like a lost invitation -- and because
    the saved roster kept the alias, the same save failed again every time,
    which also blocked simply taking somebody off the meeting.
    """

    def people(self, *addresses):
        return [{'emailAddress': {'address': address}} for address in addresses]

    def test_an_alias_stored_under_its_primary_address_is_the_same_person(self):
        self.assertEqual(
            checks.attendee_differences(
                self.people('med.maher@example.invalid', 'learner@example.invalid'),
                self.people('mohamed.maher@example.invalid', 'learner@example.invalid'),
                'organizer@example.invalid',
            ),
            ([], []),
        )

    def test_the_organizer_is_not_expected_back_as_an_attendee(self):
        self.assertEqual(
            checks.attendee_differences(
                self.people('organizer@example.invalid', 'learner@example.invalid'),
                self.people('learner@example.invalid'),
                'organizer@example.invalid',
            ),
            ([], []),
        )

    def test_a_learner_microsoft_dropped_is_still_a_failure(self):
        missing, extra = checks.attendee_differences(
            self.people('one@example.invalid', 'two@example.invalid'),
            self.people('one@example.invalid'), 'organizer@example.invalid',
        )
        self.assertEqual((missing, extra), (['two@example.invalid'], []))
        self.assertIn('two@example.invalid', checks.unconfirmed_attendee_detail(missing, extra))

    def test_somebody_the_series_does_not_invite_is_still_a_failure(self):
        self.assertEqual(
            checks.attendee_differences(
                self.people('one@example.invalid'),
                self.people('one@example.invalid', 'stranger@example.invalid'),
                'organizer@example.invalid',
            ),
            ([], ['stranger@example.invalid']),
        )

    def test_swapping_one_invitee_for_another_is_a_change_worth_writing(self):
        # The write decision stays strict: pairing is only how a list already
        # sent is read back, never how "has anything changed" is answered.
        self.assertFalse(checks.attendees_already_match(
            self.people('new@example.invalid'), self.people('old@example.invalid'),
            'organizer@example.invalid',
        ))

    def test_removing_somebody_is_a_change_worth_writing(self):
        self.assertFalse(checks.attendees_already_match(
            self.people('one@example.invalid'),
            self.people('one@example.invalid', 'two@example.invalid'),
            'organizer@example.invalid',
        ))

    def test_an_unchanged_list_writes_nothing(self):
        self.assertTrue(checks.attendees_already_match(
            self.people('one@example.invalid'),
            self.people('one@example.invalid', 'organizer@example.invalid'),
            'organizer@example.invalid',
        ))


if __name__ == '__main__':
    unittest.main()
