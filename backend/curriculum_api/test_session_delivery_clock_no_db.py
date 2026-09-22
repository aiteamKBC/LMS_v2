"""Run directly: real clock/read functions with storage and planning test doubles.

No Django setup, imports of views, database connections or Graph transport.
"""
import ast
import copy
import importlib.util
import json
import logging
import re
import types
import unittest
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import Mock, patch
from zoneinfo import ZoneInfo

ROOT = Path(__file__).parent


def pure_module(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / f'{name}.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class SessionDeliveryClockTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.weekly = pure_module('weekly_schedule')
        cls.overrides = pure_module('session_overrides')
        names = {
            'clean_str', 'parse_int', 'parse_date', 'format_date', 'parse_graph_datetime',
            'parse_clock_minutes', 'clock_time_plus_minutes', 'teams_calendar_minute_key',
            'module_session_clock', 'module_live_session_clock', 'calendar_clock_to_utc_iso',
            'apply_module_session_plan_to_weeks', 'build_sessions_from_authoring_modules',
            'module_expected_teams_occurrence_keys', 'authoring_session_links_by_catalogue',
            'curriculum_module_session_plan',
        }
        tree = ast.parse((ROOT / 'views.py').read_text(encoding='utf-8-sig'))
        nodes = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names]
        assert {node.name for node in nodes} == names
        cls.code = compile(ast.Module(body=nodes, type_ignores=[]), str(ROOT / 'views.py'), 'exec')

    def setUp(self):
        network = patch('socket.socket', side_effect=AssertionError('Network forbidden'))
        network.start()
        self.addCleanup(network.stop)
        self.plan = {'sessions': [
            {'sessionNumber': 1, 'weekNumber': 1, 'date': '2026-10-23', 'day': 'Friday'},
            {'sessionNumber': 2, 'weekNumber': 2, 'date': '2026-10-30', 'day': 'Friday'},
        ]}
        self.module = {'module_catalogue_id': 'MOD-CLOCK', 'title': 'Synthetic module',
                       'group_id': 'GROUP-CLOCK', 'session_start_time': '09:00', 'session_end_time': '11:00'}
        self.weeks = [{'id': f'WEEK-{index}', 'components': [{
            'id': f'COMP-{index}', 'type': 'live-session', 'settings': {
                'sessionDate': session['date'], 'sessionTime': '12:00', 'durationMinutes': 60,
                'sessionPurpose': 'Keep outline', 'teamsRecording': 'record-transcribe',
            }}]} for index, session in enumerate(self.plan['sessions'])]
        self.n = {
            'datetime': datetime, 'date': date, 'timedelta': timedelta, 'timezone': timezone, 'ZoneInfo': ZoneInfo,
            're': re, 'defaultdict': defaultdict, 'logger': logging.getLogger('session-clock-test'),
            'module_weekly_schedule': self.weekly.module_weekly_schedule, 'override_clock': self.overrides.override_clock,
            'DEFAULT_SESSION_START_TIME': '09:00', 'DEFAULT_SESSION_END_TIME': '10:00',
            'graph_timezone_iana': lambda _: 'Europe/London',
            'module_session_plan_for_weeks': Mock(side_effect=lambda *args, **kwargs: copy.deepcopy(self.plan)),
            'module_session_plan_for_count': Mock(side_effect=lambda *args, **kwargs: copy.deepcopy(self.plan)),
            'parse_json_value': lambda value, fallback: json.loads(value) if isinstance(value, str) else (value or fallback),
            'holiday_date_set': lambda holidays: {date.fromisoformat(item['date']) for item in holidays},
            'slugify': lambda value: value.lower().replace(' ', '-'), 'unique': lambda values: list(dict.fromkeys(values)),
            'active_week_rows': lambda rows: rows, 'active_component_rows': lambda rows: rows,
            'normalise_component_type': lambda value: value.replace('-', '_'),
            'component_builder_settings': lambda row: row['settings_json'],
            'AUTHORING_WEEKS_TABLE': 'weeks', 'AUTHORING_COMPONENTS_TABLE': 'components',
            'AUTHORING_MODULES_TABLE': 'modules', 'csrf_exempt': lambda function: function,
            'resolve_stored_module_catalogue_id': lambda value: value,
            'JsonResponse': lambda payload: payload,
            'json_error': lambda *args, **kwargs: self.fail('Unexpected endpoint error'),
            'module_stored_week_count': lambda module: 2,
            'fetch_group_row': Mock(return_value={'session_start_time': '09:00', 'session_end_time': '11:00'}),
            'LIVE_SESSION_TYPE_SQL': "type = 'live_session'", 'authoring_fetch_all': self.fetch,
        }
        exec(self.code, self.n)

    def fetch(self, table, *args):
        if table == 'modules':
            return [self.module]
        if table == 'weeks':
            return [{'id': week['id'], 'module_catalogue_id': 'MOD-CLOCK'} for week in self.weeks]
        if table == 'components':
            return [{'week_id': week['id'], 'module_catalogue_id': 'MOD-CLOCK', 'id': component['id'],
                     'type': component['type'], 'settings_json': component['settings']}
                    for week in self.weeks for component in week['components']]
        self.fail('Unexpected storage access')

    def stamp(self, module=None, group=None):
        return self.n['apply_module_session_plan_to_weeks'](module or self.module, group, self.weeks, holidays=[])

    def test_unbooked_components_inherit_two_hours_and_correct_utc_across_dst(self):
        weeks = self.stamp()
        for week in weeks:
            settings = week['components'][0]['settings']
            self.assertEqual((settings['sessionTime'], settings['durationMinutes']), ('09:00', 120))
            self.assertEqual(settings['teamsDurationMinutes'], 120)
            self.assertEqual(settings['sessionPurpose'], 'Keep outline')
            self.assertEqual(settings['teamsRecording'], 'record-transcribe')
        self.assertEqual([week['components'][0]['settings']['sessionDateTimeUtc'] for week in weeks],
                         ['2026-10-23T08:00:00+00:00', '2026-10-30T09:00:00+00:00'])

    def test_plan_endpoint_fills_missing_module_clocks_from_its_own_group_without_mutation(self):
        self.module.pop('session_start_time')
        self.module.pop('session_end_time')
        before = copy.deepcopy(self.module)
        result = self.n['curriculum_module_session_plan'](types.SimpleNamespace(method='GET', GET={'weeks': '2'}), 'MOD-CLOCK')
        planned_module = self.n['module_session_plan_for_weeks'].call_args.args[0]
        self.assertEqual(planned_module['session_start_time'], '09:00')
        self.assertEqual(planned_module['session_end_time'], '11:00')
        self.assertEqual(result['moduleCatalogueId'], 'MOD-CLOCK')
        self.n['fetch_group_row'].assert_called_once_with('GROUP-CLOCK')
        self.assertEqual(self.module, before)

    def test_group_clock_is_inherited_when_module_has_no_clock(self):
        module = {'module_catalogue_id': 'MOD-CLOCK', 'group_id': 'GROUP-CLOCK'}
        settings = self.stamp(module, self.module)[0]['components'][0]['settings']
        self.assertEqual((settings['sessionTime'], settings['durationMinutes']), ('09:00', 120))
        sessions = self.n['build_sessions_from_authoring_modules']([module], groups_by_id={'GROUP-CLOCK': self.module})
        self.assertEqual((sessions[0]['startTime'], sessions[0]['endTime']), ('09:00', '11:00'))

    def test_booked_occurrence_and_other_module_are_unchanged(self):
        self.weeks[0]['components'][0]['settings'].update(teamsLiveSessionId='LIVE-1', teamsSessionNumber=1,
            teamsEventId='EVENT-1', sessionTime='11:00', durationMinutes=90)
        before = copy.deepcopy(self.weeks[0]['components'][0])
        untouched = copy.deepcopy(self.module)
        self.stamp()
        self.assertEqual(self.weeks[0]['components'][0], before)
        self.assertEqual(self.module, untouched)
        self.assertEqual(self.weeks[1]['components'][0]['settings']['durationMinutes'], 120)

    def test_per_day_clock_does_not_reuse_the_first_day_in_a_week(self):
        self.module['weekly_schedule'] = [
            {'day': 'Monday', 'startTime': '09:00', 'endTime': '11:00'},
            {'day': 'Thursday', 'startTime': '19:00', 'endTime': '20:30'},
        ]
        self.plan['sessions'][0].update(date='2026-09-07', day='Monday')
        self.plan['sessions'][1].update(date='2026-09-10', day='Thursday', weekNumber=1)
        self.weeks[0]['components'].extend(self.weeks.pop()['components'])
        values = [item['settings'] for item in self.stamp()[0]['components']]
        self.assertEqual([(item['sessionTime'], item['durationMinutes']) for item in values], [('09:00', 120), ('19:00', 90)])

    def test_explicit_confirmed_reschedule_overrides_the_weekly_pattern(self):
        self.module['session_overrides'] = {'1': {
            'date': '2026-10-23', 'startTime': '11:00', 'endTime': '12:30', 'durationMinutes': 90,
        }}
        self.plan['sessions'][0]['rescheduled'] = True
        self.weeks[0]['components'][0]['settings'].update(teamsLiveSessionId='LIVE-1', teamsSessionNumber=1)
        settings = self.stamp()[0]['components'][0]['settings']
        self.assertEqual((settings['sessionTime'], settings['durationMinutes']), ('11:00', 90))
        self.assertTrue(settings['sessionRescheduled'])

    def test_session_list_and_sync_verdict_resolve_the_same_clock_without_persisting(self):
        before = copy.deepcopy(self.weeks)
        sessions = self.n['build_sessions_from_authoring_modules']([self.module])
        keys, _ = self.n['module_expected_teams_occurrence_keys'](self.module, holidays=[])
        self.assertEqual([(session['startTime'], session['endTime']) for session in sessions], [('09:00', '11:00')] * 2)
        self.assertEqual(keys, ['2026-10-23T08:00', '2026-10-30T09:00'])
        self.assertEqual([session['componentId'] for session in sessions], ['COMP-0', 'COMP-1'])
        self.assertEqual(self.weeks, before)

    def test_session_list_and_verdict_keep_the_confirmed_booking(self):
        self.weeks[0]['components'][0]['settings'].update(teamsLiveSessionId='LIVE-1', teamsSessionNumber=1)
        sessions = self.n['build_sessions_from_authoring_modules']([self.module])
        keys, _ = self.n['module_expected_teams_occurrence_keys'](self.module, holidays=[])
        self.assertEqual((sessions[0]['startTime'], sessions[0]['endTime']), ('12:00', '13:00'))
        self.assertEqual(keys, ['2026-10-23T11:00', '2026-10-30T09:00'])

    def test_cairo_booking_keeps_its_zone_in_the_session_list_and_sync_verdict(self):
        for index, week in enumerate(self.weeks):
            week['components'][0]['settings'].update(teamsLiveSessionId='LIVE-EGYPT', teamsSessionNumber=index + 1,
                                                    sessionTimeZone='Africa/Cairo', sessionTime='09:00', durationMinutes=120)
        sessions = self.n['build_sessions_from_authoring_modules']([self.module])
        keys, _ = self.n['module_expected_teams_occurrence_keys'](self.module, holidays=[])
        self.assertEqual([session['timeZone'] for session in sessions], ['Africa/Cairo'] * 2)
        self.assertEqual(keys, ['2026-10-23T06:00', '2026-10-30T07:00'])

    def test_no_authored_date_is_invented_and_holiday_dates_stay_put(self):
        self.weeks[0]['components'][0]['settings']['sessionDate'] = ''
        self.module['cohort_id'] = 'COHORT-1'
        sessions = self.n['build_sessions_from_authoring_modules']([self.module], {'COHORT-1': [{'date': '2026-10-30'}]})
        self.assertEqual(len(sessions), 1)
        self.assertEqual(sessions[0]['date'], '2026-10-30')
        self.assertEqual(sessions[0]['skippedHolidays'], ['2026-10-30'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
