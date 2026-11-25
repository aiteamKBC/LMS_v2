"""Actual approved dev bodies versus extracted owners; synthetic, DB-free ports.

The reference is frozen from Git, not copied from the implementation under test.
Old architecture snapshots remain intact: their historic payloads differ from
the explicitly accepted study-week behavior.
"""
import ast
from copy import deepcopy
import inspect
import json
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[4]))
from curriculum_api.catalogue.api import calendar_editing, module_reads
from curriculum_api.catalogue.application import session_plan_updates
from curriculum_api.catalogue.domain import values
from curriculum_api.catalogue.domain.delivery_values import module_stored_week_count
from curriculum_api.meetings.application.invitation_preparation import teams_module_session_limit
from curriculum_api import weekly_schedule

REFERENCE = json.loads((Path(__file__).parents[1] / 'fixtures/dev_reconciliation_99f81.json').read_text(encoding='utf-8'))


def reference(name, ports):
    scope = {'__package__': 'curriculum_api', **ports}
    node = ast.parse(REFERENCE['functions'][name]).body[0]
    node.decorator_list = []
    exec(compile(ast.Module(body=[node], type_ignores=[]), '<approved-dev-99f81>', 'exec'), scope)
    return scope[name]


def current(function, ports, *args, **kwargs):
    selected = {name: ports[name] for name, p in inspect.signature(function).parameters.items()
                if p.kind == p.KEYWORD_ONLY and name in ports and name not in kwargs}
    return function(*args, **kwargs, **selected)


def common_ports():
    return {
        'clean_str': values.clean_str, 'format_date': values.format_date,
        'parse_int': values.parse_int, 'parse_date': values.parse_date,
        'module_week_boundary_mode': weekly_schedule.module_week_boundary_mode,
        'module_week_starts_on': weekly_schedule.module_week_starts_on,
        'module_weekly_schedule': weekly_schedule.module_weekly_schedule,
        'first_weekly_session_day': weekly_schedule.first_weekly_session_day,
        'JsonResponse': lambda body: (200, body),
        'json_error': lambda message, status=400, **extra: (status, {'error': message, **extra}),
        'logger': Mock(),
    }


class ApprovedDevParity(unittest.TestCase):
    def test_get_payload_missing_target_limits_and_error_mapping(self):
        scenarios = 0
        for mode in (None, 'calendar'):
            for method, query, found, failure in (
                ('GET', {}, True, False), ('GET', {'weeks': '3'}, True, False),
                ('GET', {'weeks': '105'}, True, False), ('GET', {'sessions': '4'}, True, False),
                ('GET', {}, False, False), ('POST', {}, True, False), ('GET', {}, True, True),
            ):
                with self.subTest(mode=mode, method=method, query=query, found=found, failure=failure):
                    outcomes = []
                    for use_reference in (True, False):
                        ports = common_ports()
                        row = {'module_catalogue_id': 'SYNTHETIC', 'group_id': 'G',
                               'week_boundary_mode': mode, 'start_date': '2027-03-01', 'session_week_day': 'Monday'}
                        plan = {'sessions': [{'date': '2027-03-01', 'weekNumber': 1}]}
                        if mode:
                            plan['weeks'] = [{'startDate': '2027-03-01', 'endDate': '2027-03-07'}]
                        ports.update(AUTHORING_MODULES_TABLE='synthetic_modules',
                            resolve_stored_module_catalogue_id=Mock(return_value='SYNTHETIC'),
                            authoring_fetch_all=Mock(return_value=[row] if found else []),
                            fetch_group_row=Mock(return_value={'group_id': 'G'}),
                            module_delivery_row=Mock(side_effect=lambda m, g: m),
                            module_stored_week_count=Mock(return_value=2),
                            module_session_plan_for_count=Mock(return_value=deepcopy(plan)),
                            module_session_plan_for_weeks=Mock(return_value=deepcopy(plan)))
                        if failure:
                            ports['module_session_plan_for_weeks'].side_effect = RuntimeError('Synthetic planner unavailable')
                        request = SimpleNamespace(method=method, GET=query)
                        args = (request, 'SYNTHETIC')
                        outcome = (reference('curriculum_module_session_plan', ports)(*args) if use_reference
                                   else current(module_reads.curriculum_module_session_plan, ports, *args))
                        traces = {k: v.call_args_list for k, v in ports.items() if isinstance(v, Mock) and k != 'logger'}
                        outcomes.append((outcome, traces))
                    self.assertEqual(outcomes[0], outcomes[1])
                    scenarios += 1
        self.assertEqual(scenarios, 14)

    def test_preview_validation_response_and_planner_calls(self):
        cases = [None, {}, {'weekBoundaryMode': 'calendar'},
                 {'weekBoundaryMode': 'invalid'},
                 {'weekBoundaryMode': 'calendar', 'weekStartsOn': 'Monday', 'weeksNumber': 3},
                 {'endDate': '2027-03-21', 'weeksNumber': 3},
                 {'weeklySchedule': 'invalid'}]
        for payload in cases:
            for fails in (False, True):
                with self.subTest(payload=payload, fails=fails):
                    outcomes = []
                    for use_reference in (True, False):
                        ports = common_ports()
                        ports.update(json_body=lambda _: deepcopy(payload),
                            module_schedule_view=Mock(side_effect=lambda p: dict(p)),
                            module_session_clock=lambda *a, **k: ('09:00', '10:00', 60),
                            module_delivery_session_plan=Mock(return_value={'weeks': [], 'sessions': []}),
                            build_module_session_plan=Mock(return_value={'sessions': []}))
                        if fails:
                            ports['module_delivery_session_plan'].side_effect = ValueError('Synthetic invalid end date')
                        request = SimpleNamespace(method='POST')
                        value = (reference('curriculum_preview_module_session_plan', ports)(request) if use_reference
                                 else current(calendar_editing.curriculum_preview_module_session_plan, ports, request))
                        outcomes.append((value, ports['module_delivery_session_plan'].call_args_list,
                                         ports['build_module_session_plan'].call_args_list))
                    self.assertEqual(*outcomes)

    def test_actual_date_stamper_matches_dev_for_legacy_calendar_and_booked_rows(self):
        for calendar in (False, True):
            for booked, extra, holiday in ((False, False, False), (True, False, False),
                                          (False, True, False), (False, False, True)):
                with self.subTest(calendar=calendar, booked=booked, extra=extra, holiday=holiday):
                    outcomes = []
                    for use_reference in (True, False):
                        ports = common_ports()
                        row = {'week_boundary_mode': 'calendar' if calendar else None}
                        settings = {'sessionTime': '14:00', 'durationMinutes': 90}
                        if booked:
                            settings.update(teamsLiveSessionId='MEETING-SYNTHETIC', sessionDate='2027-02-22')
                        if extra:
                            settings['extraTeamsMeetingUrl'] = 'https://example.invalid/synthetic'
                        weeks = [{'id': 'W', 'components': [{'id': 'C', 'type': 'live-session', 'settings': settings}]}]
                        sessions = [] if holiday else [{'sessionNumber': 1, 'weekNumber': 1, 'date': '2027-03-01', 'day': 'Monday'}]
                        ports.update(module_delivery_row=lambda m, g: m,
                            module_session_plan_for_weeks=lambda *a, **k: {'sessions': sessions, 'weeks': [
                                {'startDate': '2027-03-01', 'endDate': '2027-03-07', 'holidays': ['synthetic'] if holiday else []}]},
                            module_week_delivery_slots=lambda *a, **k: ([sessions], sessions),
                            module_session_clock=lambda *a: ('09:00', '10:00', 60),
                            module_live_session_clock=lambda *a, **k: ('09:00', '10:00', 60),
                            calendar_clock_to_utc_iso=lambda d, t, z: f'{d}T{t}:00Z',
                            is_calendar_unavailable=lambda e: False)
                        args = (row, {}, weeks)
                        value = (reference('apply_module_session_plan_to_weeks', ports)(*args, holidays=[]) if use_reference
                                 else current(session_plan_updates.apply_module_session_plan_to_weeks, ports, *args, holidays=[]))
                        outcomes.append((value, row, weeks))
                    self.assertEqual(*outcomes)

    def test_saved_series_limit_preserves_dev_fallback_when_no_authored_weeks_exist(self):
        # Preserve the existing fallback only when the normalized week source is empty.
        # StudyCalendarLimitTests separately verify that live week rows take precedence.
        for row in (None, {'weeks_number': 104}, {'weeks_number': 104, 'week_boundary_mode': 'calendar'},
                    {'sessions_number': 104, 'week_boundary_mode': 'calendar'}):
            ports = common_ports()
            ports.update(authoring_module_exists=lambda _: row, module_stored_week_count=module_stored_week_count,
                         authored_week_count=lambda _: 0)
            self.assertEqual(reference('teams_module_session_limit', ports)('SYNTHETIC'),
                             current(teams_module_session_limit, ports, 'SYNTHETIC'))


if __name__ == '__main__':
    unittest.main()
