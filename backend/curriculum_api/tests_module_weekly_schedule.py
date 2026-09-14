import copy
import json
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from urllib.parse import unquote
from zoneinfo import ZoneInfo

from curriculum_api import views
from curriculum_api.tests import CurriculumPersistenceHarness
from curriculum_api.teams_weekly_calendar import calendar_groups, graph_event_utc


SLOTS = [
    {'day': 'Monday', 'startTime': '09:00', 'endTime': '11:00'},
    {'day': 'Thursday', 'startTime': '19:00', 'endTime': '20:00'},
]
GRAPH_SETTINGS = {'timezone': 'GMT Standard Time'}


class GraphCalendar:
    """A deterministic Graph boundary: real recurrence requests create real-shaped instances."""
    def __init__(self):
        self.events = {}
        self.instances = {}
        self.posts = []
        self.fail_day = ''

    def __call__(self, method, path, payload=None):
        if method == 'POST':
            day = ((payload.get('recurrence') or {}).get('pattern') or {}).get('daysOfWeek', [''])[0]
            if day == self.fail_day:
                raise RuntimeError('Simulated Graph rejection')
            self.posts.append(copy.deepcopy(payload))
            key = f'event-{len(self.posts)}'
            self.events[key] = {'id': key, 'onlineMeeting': {'joinUrl': f'https://teams.example/{key}'}}
        else:
            key = unquote(path.split('/events/')[1].split('/')[0].split('?')[0])
        if method == 'DELETE':
            self.events.pop(key, None)
            for values in self.instances.values():
                values[:] = [value for value in values if value['id'] != key]
            return {}
        if method == 'GET':
            return {'value': copy.deepcopy(self.instances.get(key, []))} if '/instances?' in path else copy.deepcopy(self.events[key])
        if method == 'PATCH' and key not in self.events:
            for values in self.instances.values():
                for value in values:
                    if value['id'] == key:
                        value.update(payload)
                        return copy.deepcopy(value)
            raise RuntimeError('No such instance')
        self.events[key].update(copy.deepcopy(payload))
        recurrence = payload.get('recurrence')
        if recurrence:
            anchor = datetime.fromisoformat(payload['start']['dateTime'])
            end = datetime.fromisoformat(payload['end']['dateTime'])
            duration = end - anchor
            zone_name = views.GRAPH_WINDOWS_TO_IANA.get(payload['start']['timeZone'], payload['start']['timeZone'])
            zone = ZoneInfo(zone_name)
            current, instances = anchor, []
            while len(instances) < recurrence['range']['numberOfOccurrences']:
                if current.strftime('%A').lower() in recurrence['pattern']['daysOfWeek']:
                    start = current.replace(tzinfo=zone).astimezone(timezone.utc)
                    instances.append({'id': f'{key}-instance-{len(instances)+1}',
                                      'start': {'dateTime': start.isoformat(), 'timeZone': 'UTC'},
                                      'end': {'dateTime': (start + duration).isoformat(), 'timeZone': 'UTC'}})
                current += timedelta(days=1)
            self.instances[key] = instances
        return copy.deepcopy(self.events[key])


class ModuleWeeklyScheduleTests(CurriculumPersistenceHarness):
    def create_module(self):
        response = self.post_json('/curriculum_api/curriculum/modules/', {
            'moduleType': 'authoring', 'title': 'Independent weekday times',
            'weeks': 2, 'sessionsNumber': 4, 'startDate': '2026-09-07', 'weeklySchedule': SLOTS,
            'weekStructure': [{'weekNumber': index + 1, 'title': f'Week {index + 1}', 'components': []} for index in range(2)],
        })
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()['moduleCatalogueId']

    def test_per_day_times_round_trip_and_reach_every_planned_session(self):
        module_id = self.create_module()
        row = self.row(views.AUTHORING_MODULES_TABLE, 'module_catalogue_id', module_id)
        self.assertEqual(views.module_weekly_schedule(row), SLOTS)
        self.assertEqual(row['weeks_number'], 2)
        self.assertEqual(row['session_week_day'], 'Monday, Thursday')
        structure = views.get_authoring_structure_payload(module_id)
        self.assertEqual(structure['weeklySchedule'], SLOTS)
        catalogue = views.authoring_summary_catalogue_item(views.authoring_catalogue_summaries()[module_id])
        self.assertEqual(catalogue['weeklySchedule'], SLOTS)
        plan = views.module_session_plan_for_count(row, 4)
        self.assertEqual([item['startTime'] for item in plan['sessions']], ['09:00', '19:00'] * 2)
        self.assertEqual([item['durationMinutes'] for item in plan['sessions']], [120, 60] * 2)
        revised = [SLOTS[0], {**SLOTS[1], 'startTime': '20:00', 'endTime': '21:30'}]
        response = self.client.patch(f'/curriculum_api/curriculum/modules/{module_id}/', json.dumps({'weeklySchedule': revised}), content_type='application/json')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(views.get_authoring_structure_payload(module_id)['weeklySchedule'], revised)

    def test_conflicts_use_the_clock_of_the_shared_day(self):
        left = {'start_date': '2026-09-07', 'sessions_number': 4, 'weekly_schedule': SLOTS}
        right = {'start_date': '2026-09-10', 'sessions_number': 2, 'session_week_day': 'Thursday', 'session_start_time': '09:00', 'session_end_time': '11:00'}
        self.assertEqual(views.module_slot_clash_dates(left, right), [])
        right.update(session_start_time='19:30', session_end_time='20:30')
        self.assertEqual([day.isoformat() for day in views.module_slot_clash_dates(left, right)], ['2026-09-10', '2026-09-17'])

    def test_group_attachment_uses_module_days_without_changing_the_group(self):
        tree = self.tree_payload()
        tree['cohorts'][0]['groups'][0]['modules'] = []
        self.assertEqual(self.post_json('/curriculum_api/curriculum/programmes/tree/', tree).status_code, 200)
        response = self.post_json('/curriculum_api/curriculum/groups/GROUP-DATA-1/modules/', {
            'moduleName': 'Independent module slots', 'startDate': '2026-09-07',
            'weeks': 4, 'weeklySchedule': SLOTS, 'tutor': 'Tutor One',
        })
        self.assertEqual(response.status_code, 200, response.content)
        module = self.row(views.AUTHORING_MODULES_TABLE, 'module_catalogue_id', response.json()['created'][0]['catalogueId'])
        self.assertEqual(module['sessions_number'], 8)
        self.assertEqual(module['weeks_number'], 4)
        self.assertEqual(views.module_weekly_schedule(module), SLOTS)
        self.assertEqual(self.row(views.GROUPS_TABLE, 'group_id', 'GROUP-DATA-1')['session_week_day'], 'Wednesday')

    def test_invalid_slots_are_rejected_before_a_module_is_saved(self):
        for slots in ([SLOTS[0], SLOTS[0]], [{**SLOTS[0], 'endTime': '08:00'}], [{**SLOTS[0], 'startTime': ''}]):
            response = self.post_json('/curriculum_api/curriculum/modules/', {'moduleType': 'authoring', 'title': 'Invalid', 'weeklySchedule': slots})
            self.assertEqual(response.status_code, 400, response.content)


class TeamsWeekdaySeriesTests(CurriculumPersistenceHarness):
    create_module = ModuleWeeklyScheduleTests.create_module

    def setUp(self):
        super().setUp()
        views.ensure_live_session_tracking_tables()
        self.graph = GraphCalendar()
        for target, kwargs in (
            ('coach_api.views.microsoft_graph_request', {'side_effect': self.graph}),
            ('coach_api.views.has_graph_credentials', {'return_value': True}),
            ('coach_api.views.get_graph_settings', {'return_value': GRAPH_SETTINGS}),
            ('curriculum_api.views.apply_teams_meeting_options', {'side_effect': lambda organizer, join_url, **kw: (True, {'id': 'meeting-' + join_url.rsplit('/', 1)[-1]}, [])}),
        ):
            mocked = patch(target, **kwargs)
            mocked.start()
            self.addCleanup(mocked.stop)
        self.module_id = self.create_module()
        self.payload = {
            'title': 'Independent weekday times', 'moduleCatalogueId': self.module_id,
            'organizerEmail': 'tutor@example.com', 'attendees': ['learner@example.com'],
            'startDateTimeUtc': '2026-09-07T08:00:00Z', 'localStartDateTime': '2026-09-07T09:00',
            'durationMinutes': 120, 'repeat': 'weekly', 'repeatOccurrences': 4,
            'scheduledOccurrences': [
                {'sessionNumber': 1, 'startDateTimeUtc': '2026-09-07T08:00:00Z', 'durationMinutes': 120},
                {'sessionNumber': 2, 'startDateTimeUtc': '2026-09-10T18:00:00Z', 'durationMinutes': 60},
                {'sessionNumber': 3, 'startDateTimeUtc': '2026-09-14T08:00:00Z', 'durationMinutes': 120},
                {'sessionNumber': 4, 'startDateTimeUtc': '2026-09-17T18:00:00Z', 'durationMinutes': 60},
            ],
        }

    def test_creates_two_masters_and_attaches_the_correct_link_to_each_session(self):
        response = self.post_json('/curriculum_api/curriculum/teams-meetings/', self.payload)
        self.assertEqual(response.status_code, 201, response.content)
        meeting = response.json()['meeting']
        self.assertEqual(len(self.graph.posts), 2)
        self.assertEqual([body['recurrence']['pattern']['daysOfWeek'] for body in self.graph.posts], [['monday'], ['thursday']])
        self.assertEqual([body['start']['dateTime'][11:16] for body in self.graph.posts], ['09:00', '19:00'])
        self.assertEqual(meeting['trackedOccurrences'], 4)
        occurrences = views.authoring_fetch_all(views.LIVE_SESSION_OCCURRENCES_TABLE, 'live_session_id = %s', [meeting['liveSessionId']], 'session_number')
        self.assertEqual([item['join_url'] for item in occurrences], ['https://teams.example/event-1', 'https://teams.example/event-2'] * 2)
        self.assertEqual([item['online_meeting_id'] for item in occurrences], ['meeting-event-1', 'meeting-event-2'] * 2)
        series = self.row(views.LIVE_SESSIONS_TABLE, 'id', meeting['liveSessionId'])
        with patch.object(views, 'teams_meeting_base_path', side_effect=lambda organizer, meeting_id, join_url='': meeting_id):
            groups = views.live_session_meeting_groups(series, occurrences)
        self.assertEqual([[item['session_number'] for item in group] for _, group in groups], [[1, 3], [2, 4]])
        restore = self.post_json(f'/curriculum_api/curriculum/modules/{self.module_id}/teams-meetings/restore/', {'createMissingComponents': True})
        self.assertEqual(restore.status_code, 200, restore.content)
        structure = views.get_authoring_structure_payload(self.module_id)
        components = [c for week in structure['weekStructure'] for c in week['components'] if c['type'] == 'live-session']
        self.assertEqual([c['settings']['teamsMeetingUrl'] for c in components], [item['join_url'] for item in occurrences])
        # An authoring save with stale shared links cannot replace the canonical day links.
        for week in structure['weekStructure']:
            for component in week['components']:
                component['settings']['liveSessionUrl'] = 'https://teams.example/stale'
        saved = views.save_module_authoring_structure(self.module_id, structure)
        self.assertEqual([c['settings']['liveSessionUrl'] for week in saved['weekStructure'] for c in week['components'] if c['type'] == 'live-session'], [item['join_url'] for item in occurrences])

    def test_same_clocks_can_share_one_series_or_explicitly_use_separate_links(self):
        uniform = copy.deepcopy(self.payload)
        for item in uniform['scheduledOccurrences']:
            item['startDateTimeUtc'] = item['startDateTimeUtc'][:11] + '08:00:00Z'
            item['durationMinutes'] = 120
        self.assertEqual(calendar_groups(uniform, GRAPH_SETTINGS), [])
        self.assertEqual(len(calendar_groups({**uniform, 'seriesMode': 'per_day'}, GRAPH_SETTINGS)), 2)
        response = self.post_json('/curriculum_api/curriculum/teams-meetings/', uniform)
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(len(self.graph.posts), 1)
        self.assertEqual(self.graph.posts[0]['recurrence']['pattern']['daysOfWeek'], ['monday', 'thursday'])

    def test_refuses_a_shared_series_with_different_clocks_before_graph(self):
        response = self.post_json('/curriculum_api/curriculum/teams-meetings/', {**self.payload, 'seriesMode': 'shared'})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.graph.posts, [])

    def test_rescheduling_keeps_both_links_and_does_not_create_more_series(self):
        response = self.post_json('/curriculum_api/curriculum/teams-meetings/', self.payload)
        self.assertEqual(response.status_code, 201, response.content)
        live_id = response.json()['meeting']['liveSessionId']
        changed = copy.deepcopy(self.payload)
        for item in changed['scheduledOccurrences'][1::2]:
            item['startDateTimeUtc'] = item['startDateTimeUtc'].replace('T18:', 'T20:')
        response = self.client.patch(f'/curriculum_api/curriculum/teams-meetings/{live_id}/schedule/', json.dumps(changed), content_type='application/json')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(len(self.graph.posts), 2)
        self.assertEqual(response.json()['meeting']['trackedOccurrences'], 4)
        self.assertEqual(len(response.json()['meeting']['calendarSeries']), 2)

    def test_partial_failure_can_resume_without_duplicate_monday_invitations(self):
        self.graph.fail_day = 'thursday'
        response = self.post_json('/curriculum_api/curriculum/teams-meetings/', self.payload)
        self.assertEqual(response.status_code, 502, response.content)
        live_id = response.json()['liveSessionId']
        self.assertTrue(live_id)
        self.graph.fail_day = ''
        response = self.client.patch(f'/curriculum_api/curriculum/teams-meetings/{live_id}/schedule/', json.dumps(self.payload), content_type='application/json')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(len(self.graph.posts), 2)
        self.assertEqual(response.json()['meeting']['trackedOccurrences'], 4)

    def test_clock_grouping_survives_daylight_saving_and_midnight(self):
        payload = {'scheduledOccurrences': [
            {'sessionNumber': 1, 'startDateTimeUtc': '2026-10-19T08:00:00Z', 'durationMinutes': 60},
            {'sessionNumber': 2, 'startDateTimeUtc': '2026-10-26T09:00:00Z', 'durationMinutes': 60},
        ]}
        self.assertEqual(calendar_groups(payload, GRAPH_SETTINGS), [])
        self.assertEqual(graph_event_utc({'start': {'dateTime': '2026-09-07T00:30:00', 'timeZone': 'GMT Standard Time'}})['start']['dateTime'], '2026-09-06T23:30:00+00:00')

    def test_unresolved_second_meeting_never_uses_the_first_meetings_attendance(self):
        series = {'organizer_email': 'tutor@example.com', 'online_meeting_id': 'meeting-1', 'join_url': 'https://teams.example/first'}
        rows = [{'session_number': 1, 'join_url': series['join_url']}, {'session_number': 2, 'join_url': 'https://teams.example/second'}]
        with patch.object(views, 'teams_meeting_base_path', return_value='meeting-1'):
            groups = views.live_session_meeting_groups(series, rows)
        self.assertEqual([[row['session_number'] for row in group] for _, group in groups], [[1]])
