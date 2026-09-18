"""Run directly with Python. No Django imports, DB setup, credentials or network."""
import ast
import copy
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
from unittest.mock import patch
from urllib import parse as urllib_parse
from zoneinfo import ZoneInfo

ROOT = Path(__file__).parent
spec = importlib.util.spec_from_file_location('calendar_checks', ROOT / 'teams_calendar_checks.py')
checks = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checks)


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
        self.events, self.instances, self.calls, self.series, self.tracked = {}, [], [], [], []
        self.instances_by_master = {}
        self.options_ok = True
        self.corrupt = ''
        self.payload = self.make_payload()
        self.v = types.ModuleType('curriculum_api.views')
        self.v.__dict__.update(datetime=datetime, timedelta=timedelta, timezone=timezone, ZoneInfo=ZoneInfo,
                              escape=escape, re=re, urllib_parse=urllib_parse, logger=logging.getLogger('calendar-test'),
                              TEAMS_REPEAT_VALUES={'none', 'weekly', 'daily', 'weekdays'},
                              TEAMS_LOBBY_VALUES={'invited'}, LIVE_SESSIONS_TABLE='series', LIVE_SESSION_OCCURRENCES_TABLE='occurrences',
                              csrf_exempt=lambda fn: fn, JsonResponse=Response,
                              json_error=lambda message, status=400, **kwargs: Response({'error': message, **kwargs}, status),
                              graph_timezone_iana=lambda _: 'Europe/London', teams_calendar_subject=lambda payload, series=None: payload.get('title', 'Synthetic'),
                              calendar_targets=checks.calendar_targets, local_calendar_recurrence=checks.local_calendar_recurrence,
                              CalendarMismatch=checks.CalendarMismatch, safe_teams_join_url=checks.safe_teams_join_url,
                              utc_datetime=checks.utc_datetime, graph_calendar_time=checks.graph_calendar_time,
                              verify_calendar=checks.verify_calendar, publish_attendees=checks.publish_attendees,
                              teams_meeting_default_organizer=lambda: '', teams_new_meeting_organizer=lambda value: value,
                              json_body=lambda request: self.payload, ensure_live_sessions_table=lambda: None,
                              ensure_live_session_tracking_tables=lambda: None,
                              resolve_authoring_catalogue_id=lambda value: value, authoring_module_exists=lambda _: True,
                              authoring_fetch_all=self.fetch_rows, has_column=lambda *args: True,
                              calendar_groups=lambda *args: [], stored_calendar_series=lambda _: [],
                              graph_event_utc=self.utc_event, persist_live_session_series=self.persist_series,
                              replace_live_session_occurrences=self.persist_occurrences,
                              update_authoring_rows=self.update_series, json_db_value=lambda value: value,
                              apply_teams_meeting_options=lambda *args, **kwargs: (self.options_ok, {'id': 'online-1'}, []),
                              teams_series_email_list=lambda value: value or [],
                              persist_recreated_occurrence_details=lambda *args: None)
        names = {'clean_str', 'parse_graph_datetime', 'teams_attendee_emails', 'teams_event_body_html',
                 'teams_event_payload', 'teams_calendar_minute_key', 'teams_shifted_occurrence_targets',
                 'apply_teams_occurrence_shifts', 'curriculum_teams_meeting', 'curriculum_teams_meeting_schedule',
                 'reschedule_single_live_session_occurrence'}
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
        dates = ['2026-09-17', '2026-10-08', '2026-10-15', '2026-10-22', '2026-10-29',
                 '2026-11-05', '2026-11-12', '2026-11-19', '2026-11-26', '2026-12-03', '2026-12-10', '2026-12-17']
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
                        'hide_attendees': True, 'warnings': warnings}]
        self.assertFalse(kwargs['persist_occurrences'])
        return 'LIVE-SYNTHETIC', 0

    def persist_occurrences(self, live_id, payload, *args, **kwargs):
        self.tracked = copy.deepcopy(payload['scheduledOccurrences'])
        return self.tracked

    def update_series(self, table, where, params, values):
        if self.series:
            self.series[0].update(values)

    def expand(self, event):
        self.instances = []
        start = checks.event_instant(event, 'start').astimezone(ZoneInfo('Europe/London'))
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
        self.calls.append((method, path, copy.deepcopy(payload)))
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
            self.assertFalse(event.get('attendees'), 'Cleanup must happen before invitations')
            next(items for items in self.instances_by_master.values() if event in items).remove(event)
            return {}
        raise AssertionError(method)

    def create(self):
        return self.v.curriculum_teams_meeting(types.SimpleNamespace(method='POST'))

    def test_midnight_dst_uses_one_weekday_and_publishes_after_cleanup(self):
        result = self.create()
        self.assertEqual(result.status_code, 201, result)
        self.assertEqual(self.events['event-1']['recurrence']['pattern']['daysOfWeek'], ['thursday'])
        self.assertEqual(self.events['event-1']['recurrence']['range']['numberOfOccurrences'], 14)
        self.assertEqual(len(self.instances), 12)
        self.assertEqual(len(self.tracked), 12)
        deletes = [i for i, call in enumerate(self.calls) if call[0] == 'DELETE']
        invitations = [i for i, call in enumerate(self.calls) if call[0] == 'PATCH' and 'attendees' in call[2]]
        self.assertEqual(len(deletes), 2)
        self.assertEqual(len(invitations), 1)
        self.assertLess(max(deletes), invitations[0])
        self.assertTrue(self.events['event-1']['hideAttendees'])

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

    def test_overlapping_sessions_rejected_before_graph(self):
        self.payload['scheduledOccurrences'][1]['startDateTimeUtc'] = self.payload['startDateTimeUtc']
        self.assertEqual(self.create().status_code, 400)
        self.assertFalse(self.calls)

    def test_existing_calendar_cannot_be_created_again(self):
        self.assertEqual(self.create().status_code, 201)
        self.calls.clear()
        self.assertEqual(self.create().status_code, 409)
        self.assertFalse(self.calls)

    def test_people_only_save_does_not_reset_recurrence_or_duplicate_mail(self):
        self.assertEqual(self.create().status_code, 201)
        before = copy.deepcopy(self.instances)
        self.payload.update(peopleOnly=True, attendees=['replacement@example.invalid'])
        self.calls.clear()
        result = self.v.curriculum_teams_meeting_schedule(types.SimpleNamespace(method='PATCH'), 'LIVE-SYNTHETIC')
        self.assertEqual(result.status_code, 200, result)
        patches = [call[2] for call in self.calls if call[0] == 'PATCH']
        self.assertEqual(len(patches), 1)
        self.assertEqual(set(patches[0]), {'attendees'})
        self.assertEqual([item['start'] for item in self.instances], [item['start'] for item in before])
        self.calls.clear()
        self.assertEqual(self.v.curriculum_teams_meeting_schedule(types.SimpleNamespace(method='PATCH'), 'LIVE-SYNTHETIC').status_code, 200)
        self.assertFalse([call for call in self.calls if call[0] == 'PATCH'])

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
        self.assertFalse([call for call in self.calls if call[0] in ('POST', 'DELETE')])

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
                     'CalendarMismatch': checks.CalendarMismatch}
        tree = ast.parse((ROOT / 'teams_weekly_calendar.py').read_text(encoding='utf-8-sig'))
        functions = [node for node in tree.body if isinstance(node, ast.FunctionDef)]
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
        self.assertLess(max(i for i, call in enumerate(self.calls) if call[0] == 'DELETE'), min(invite_indexes))
        self.assertTrue(all(event['hideAttendees'] for event in self.events.values()))

    def test_second_weekday_failure_does_not_send_first_weekday_invites(self):
        self.prepare_weekday_path()
        self.corrupt = 'second_day_link'
        result = self.create()
        self.assertEqual(result.status_code, 502, result)
        self.assertEqual(len(self.events), 2)
        self.assertTrue(all(not event['attendees'] for event in self.events.values()))

    def test_pending_invites_resume_without_recreating_or_rewriting_dates(self):
        self.options_ok = False
        self.assertEqual(self.create().status_code, 502)
        self.options_ok = True
        self.calls.clear()
        result = self.v.curriculum_teams_meeting_schedule(types.SimpleNamespace(method='PATCH'), 'LIVE-SYNTHETIC')
        self.assertEqual(result.status_code, 200, result)
        self.assertFalse([call for call in self.calls if call[0] in ('POST', 'DELETE')])
        patches = [call[2] for call in self.calls if call[0] == 'PATCH']
        self.assertEqual(len(patches), 1)
        self.assertEqual(set(patches[0]), {'attendees'})

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

    def test_meeting_spanning_clock_change_keeps_absolute_duration(self):
        start = '2026-10-24T23:00:00Z'  # Sunday midnight BST before the clock goes back.
        self.payload.update(startDateTimeUtc=start, localStartDateTime='2026-10-25T00:00', repeat='none', repeatOccurrences=1,
                            scheduledOccurrences=[{'sessionNumber': 1, 'startDateTimeUtc': start, 'durationMinutes': 120}])
        result = self.create()
        self.assertEqual(result.status_code, 201, result)
        event = self.events['event-1']
        self.assertEqual(checks.event_instant(event, 'end') - checks.event_instant(event, 'start'), timedelta(hours=2))


if __name__ == '__main__':
    unittest.main()
