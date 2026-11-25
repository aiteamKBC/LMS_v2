"""Old/new session editing contracts on synthetic facts; database/provider access forbidden."""
from curriculum_api.catalogue.tests.parity.composition_test_support import composition_fixture
import copy
import json
from contextlib import ExitStack, contextmanager
from types import FunctionType
from unittest.mock import Mock, patch

from django.test import SimpleTestCase
from curriculum_api import views, country_calendars, delivery_calendar
from curriculum_api.catalogue.api import calendar_editing
from curriculum_api.catalogue.application import session_plan_updates
from curriculum_api.catalogue.domain import week_session_dates
from curriculum_api.catalogue.tests.parity.session_editing_oracle import SNAPSHOT
from curriculum_api.catalogue.tests.test_hierarchy_commands_boundary_no_db import FrozenClock
from curriculum_api.catalogue.tests.test_holiday_boundary_no_db import request, response
from curriculum_api.catalogue.tests.test_module_commands_boundary_no_db import recording

MODULE = {'module_catalogue_id': 'M', 'group_id': 'G', 'cohort_id': 'C',
          'title': 'Synthetic module', 'start_date': '2026-01-05', 'tutor_name': 'Before',
          'session_start_time': '09:00', 'session_end_time': '11:00'}
PLAN = [{'sessionNumber': 1, 'date': '2026-01-05', 'day': 'Monday'}]


@contextmanager
def original_session_editing():
    with ExitStack() as stack:
        for name, entry in SNAPSHOT['functions'].items():
            if isinstance(getattr(views, name), Mock):
                continue
            env = dict(vars(views))
            exec(compile(entry['source'], '<pre-session-editing>', 'exec'), env)
            fn = env[name]
            old = FunctionType(fn.__code__, vars(views), name, fn.__defaults__)
            old.__kwdefaults__ = fn.__kwdefaults__
            for decorator in reversed(entry['decorators']):
                old = eval(decorator, vars(views))(old)
            stack.enter_context(composition_fixture(views, name, old))
        yield


@contextmanager
def editing_scope(old, events, **overrides):
    ports = dict(datetime=FrozenClock,
        resolve_group_row=Mock(return_value={'group_id': 'G', 'coach_name': 'Previous'}),
        canonical_staff_assignment_name=Mock(side_effect=lambda role, value, **kw: str(value or '').strip()),
        canonical_group_coaches=Mock(side_effect=lambda value: str(value or '').strip()),
        resolve_staff_assignment_email=Mock(side_effect=lambda role, name: 'synthetic@example.invalid'),
        group_tutor_assignment_delivery_day_error=Mock(return_value=None),
        group_tutor_assignment_conflict=Mock(return_value=({}, [])),
        update_group_fields=recording(events, 'group'),
        authoring_fetch_all=recording(events, 'read', [copy.deepcopy(MODULE)]),
        update_authoring_rows=recording(events, 'write'),
        authoring_upsert=recording(events, 'upsert'),
        notify_staff_assignment_change=recording(events, 'notify'),
        invalidate_curriculum_cache=recording(events, 'invalidate'),
        module_schedule_view=Mock(side_effect=lambda row: row),
        tutor_assignment_delivery_day_error=Mock(return_value=None),
        module_schedule_assignment_changed=Mock(return_value=True),
        tutor_schedule_conflicts_created=Mock(return_value=[]),
        cohort_selected_holidays_by_cohort=Mock(return_value={'C': []}),
        active_week_rows=Mock(side_effect=lambda rows: rows),
        active_component_rows=Mock(side_effect=lambda rows: rows),
        module_week_delivery_slots=Mock(return_value=([[copy.deepcopy(PLAN[0])]], copy.deepcopy(PLAN))),
        module_session_clock=Mock(return_value=('09:00', '11:00', 120)),
        module_live_session_clock=Mock(return_value=('09:00', '11:00', 120)),
        calendar_clock_to_utc_iso=Mock(side_effect=lambda day, clock, zone: f'{day}T{clock}:00Z'))
    ports.update(overrides)
    with ExitStack() as stack:
        for name, value in ports.items():
            stack.enter_context(composition_fixture(views, name, value))
        stack.enter_context(composition_fixture(delivery_calendar, 'date_non_delivery_reason', return_value=''))
        for name in ('ensure_calendar', 'fetch_holidays'):
            stack.enter_context(composition_fixture(country_calendars, name, side_effect=AssertionError('Provider forbidden')))
        if old:
            stack.enter_context(original_session_editing())
        yield


class SessionEditingParity(SimpleTestCase):
    def compare(self, scenario):
        actual = scenario(False)
        self.assertEqual(actual, scenario(True))
        return actual

    def test_staffing_partial_updates_preserve_response_fields_scope_and_write_order(self):
        for payload in ({'tutor': ' Next '}, {'coach': ' Coach '}, {'tutor': '', 'coach': ''}):
            def scenario(old):
                events = []
                with editing_scope(old, events):
                    result = views.update_staffing_assignment('G', payload)
                return response(result), [e for e in events if e[0] != 'read']
            result, writes = self.compare(scenario)
            self.assertEqual(result, (200, {'updated': True, 'id': 'G'}))
            self.assertEqual(writes[0][0], 'group')
            self.assertEqual([e[0] for e in writes[-2:]], ['notify', 'invalidate'])
            module_writes = [e for e in writes if e[0] == 'write']
            self.assertEqual(len(module_writes), int('tutor' in payload))
            if module_writes:
                self.assertEqual(set(module_writes[0][1][-1]), {'tutor_name', 'tutor_email', 'updated_at'})

    def test_staffing_read_failure_refuses_before_any_write_instead_of_false_success(self):
        def scenario(old):
            events = []
            with editing_scope(old, events, authoring_fetch_all=Mock(side_effect=RuntimeError('private diagnostic'))):
                result = response(views.update_staffing_assignment('G', {'coach': 'Next', 'tutor': 'Next'}))
            return result, events
        # The former helper also now rejects failed reads. Frozen writer source
        # needs its former tolerant helper explicitly to reproduce the old bug.
        with composition_fixture(views, 'safe_authoring_module_rows', return_value=[]):
            before, events = scenario(True)
        self.assertEqual(before[0], 200)
        self.assertEqual([e[0] for e in events], ['group', 'notify', 'invalidate'])
        after, events = scenario(False)
        self.assertEqual(after[0], 503)
        self.assertNotIn('private', json.dumps(after))
        self.assertEqual(events, [])

    def test_required_read_precedes_writes_and_coach_only_needs_no_module_read(self):
        events = []
        with editing_scope(False, events):
            views.update_staffing_assignment('G', {'tutor': 'Next'})
        self.assertEqual([e[0] for e in events], ['read', 'group', 'write', 'notify', 'invalidate'])
        with editing_scope(False, [], authoring_fetch_all=Mock(side_effect=AssertionError('Unneeded read'))):
            self.assertEqual(views.update_staffing_assignment('G', {'coach': 'Next'}).status_code, 200)

    def test_unused_coach_recalculation_is_removed_without_changing_the_saved_value(self):
        for old, expected_calls in ((True, 2), (False, 1)):
            canonical = Mock(return_value='Canonical coach')
            events = []
            with editing_scope(old, events, canonical_group_coaches=canonical):
                result = views.update_staffing_assignment('G', {'coach': 'Alias'})
            self.assertEqual(result.status_code, 200)
            self.assertEqual(canonical.call_count, expected_calls)
            self.assertEqual(next(e for e in events if e[0] == 'group')[1][-1], {'coach_name': 'Canonical coach'})

    def test_staffing_missing_group_and_delivery_or_conflict_refusals_do_not_write(self):
        for ports, status in [({'resolve_group_row': Mock(return_value=None)}, 404),
                ({'group_tutor_assignment_delivery_day_error': Mock(side_effect=lambda *a: views.json_error('No day'))}, 400),
                ({'group_tutor_assignment_conflict': Mock(return_value=({'tutor_name': 'Next'}, [{'moduleName': 'Other', 'dates': []}]))}, 409)]:
            def scenario(old):
                events = []
                with editing_scope(old, events, **ports):
                    result = response(views.update_staffing_assignment('G', {'tutor': 'Next', 'coach': 'Next'}))
                return result, events
            result, events = self.compare(scenario)
            self.assertEqual(result[0], status)
            self.assertEqual(events, [])

    def test_explicit_conflict_override_keeps_delivery_guard_and_allows_existing_write(self):
        conflict = Mock(side_effect=AssertionError('Override must bypass conflict query'))
        def scenario(old):
            events = []
            with editing_scope(old, events, group_tutor_assignment_conflict=conflict):
                result = response(views.update_staffing_assignment('G', {'tutor': 'Next', 'allowTutorConflict': True}))
            return result, [e for e in events if e[0] != 'read']
        self.assertEqual(self.compare(scenario)[0][0], 200)

    def test_staffing_http_delete_and_invalid_payload_contracts(self):
        for method, payload, status in [('DELETE', {}, 200), ('PATCH', {'coach': ''}, 200), ('GET', {}, 405)]:
            def scenario(old):
                events = []
                with editing_scope(old, events):
                    result = response(views.curriculum_staffing_detail(request(method, payload), 'G'))
                return result, [e for e in events if e[0] != 'read']
            self.assertEqual(self.compare(scenario)[0][0], status)
        with editing_scope(False, []):
            self.assertEqual(views.curriculum_staffing_collection(request('POST', {})).status_code, 400)
            self.assertEqual(views.curriculum_staffing_detail(request('PATCH', raw='{bad'), 'G').status_code, 400)

    def test_session_partial_patch_preserves_module_fields_and_calls_actual_adapter(self):
        def scenario(old):
            events = []
            with editing_scope(old, events):
                result = response(views.curriculum_session_detail(request('PATCH', {'startTime': '10:00'}), 'module-M-session-1'))
            return result, events
        with patch.object(calendar_editing, 'curriculum_session_detail', wraps=calendar_editing.curriculum_session_detail) as invoked:
            actual = scenario(False)
        invoked.assert_called_once()
        self.assertEqual(actual, scenario(True))
        row = next(e for e in actual[1] if e[0] == 'upsert')[1][-1]
        self.assertEqual(row, {**MODULE, 'session_start_time': '10:00'})

    def test_session_guard_and_legacy_error_contracts(self):
        for ident, method, payload, status in [('invalid', 'PATCH', {}, 404), ('training-1-session-2', 'PATCH', {}, 409),
                ('module-M-session-1', 'DELETE', {}, 409), ('module-M-session-1', 'GET', {}, 405),
                ('module-M-session-2', 'PATCH', {'date': '2026-01-06'}, 409)]:
            def scenario(old):
                events = []
                with editing_scope(old, events):
                    result = response(views.curriculum_session_detail(request(method, payload), ident))
                return result, [e for e in events if e[0] != 'read']
            result, writes = self.compare(scenario)
            self.assertEqual(result[0], status)
            self.assertEqual(writes, [])

    def test_session_closed_day_and_tutor_conflict_refuse_before_write(self):
        for closed in (True, False):
            def scenario(old):
                events = []
                with editing_scope(old, events, tutor_assignment_delivery_day_error=Mock(side_effect=lambda *a, **kw: views.json_error('No day'))), \
                        composition_fixture(delivery_calendar, 'date_non_delivery_reason', return_value='Closed' if closed else ''):
                    result = response(views.curriculum_session_detail(request('PATCH', {'date': '2026-01-06'}), 'module-M-session-1'))
                return result, [e for e in events if e[0] != 'read']
            result, writes = self.compare(scenario)
            self.assertEqual(result[0], 400)
            self.assertEqual(writes, [])

    def test_week_date_projection_keeps_numbered_booked_additional_and_empty_slots(self):
        cases = [{}, {'teamsSessionNumber': 1}, {'teamsLiveSessionId': 'booked', 'teamsSessionNumber': 1, 'sessionDate': '2025-12-01'},
                 {'extraTeamsMeetingUrl': 'https://example.invalid/extra', 'sessionDate': '2025-12-01'},
                 {'teamsCalendarBinding': 'ambiguous'}]
        for settings in cases:
            def scenario(old):
                weeks = [{'components': [{'id': 'X', 'type': 'live-session', 'settings': copy.deepcopy(settings)},
                                          {'id': 'UNPLANNED', 'type': 'live-session', 'settings': {}}]}, {'components': []}]
                with editing_scope(old, []):
                    result = views.apply_module_session_plan_to_weeks(copy.deepcopy(MODULE), {}, weeks, holidays=[])
                return result, weeks
            with patch.object(week_session_dates, 'stamp_week_session_dates', wraps=week_session_dates.stamp_week_session_dates) as invoked:
                with patch.object(session_plan_updates, 'stamp_week_session_dates', invoked):
                    actual = scenario(False)
            invoked.assert_called_once()
            self.assertEqual(actual, scenario(True))
            self.assertEqual(actual[1][0]['components'][1]['settings'], {})
            self.assertEqual(actual[1][1]['sessionDate'], '')

    def test_missing_calendar_marks_read_result_and_unrelated_error_still_raises(self):
        for old in (True, False):
            module, weeks = copy.deepcopy(MODULE), [{'components': []}]
            with editing_scope(old, [], module_week_delivery_slots=Mock(side_effect=country_calendars.CalendarUnavailable('Missing reference'))):
                self.assertIsNone(views.apply_module_session_plan_to_weeks(module, {}, weeks, holidays=[]))
            self.assertEqual(module['_calendar_error'], 'Missing reference')
            self.assertEqual(weeks[0]['calendarError'], 'Missing reference')
            with editing_scope(old, [], module_week_delivery_slots=Mock(side_effect=ValueError('Malformed plan'))):
                with self.assertRaisesRegex(ValueError, 'Malformed plan'):
                    views.apply_module_session_plan_to_weeks({}, {}, [], holidays=[])

    def test_session_persistence_compares_actual_reads_writes_and_second_save_is_noop(self):
        for original in ({}, {'sessionDate': '2026-01-05', 'sessionDay': 'Monday', 'sessionTime': '09:00',
                'durationMinutes': 120, 'teamsDurationMinutes': 120, 'sessionDateTimeUtc': '2026-01-05T09:00:00Z',
                'teamsStartDateTimeUtc': '2026-01-05T09:00:00Z'}):
            def scenario(old):
                events = []
                def read(table, *args):
                    events.append(('read', table, args))
                    return ([{'id': 'W', 'week_number': 1}] if table == views.AUTHORING_WEEKS_TABLE else
                            [{'id': 'X', 'week_id': 'W', 'type': 'live_session', 'settings_json': copy.deepcopy(original)},
                             {'id': 'R', 'week_id': 'W', 'type': 'reading', 'settings_json': {'keep': True}}])
                with editing_scope(old, events, authoring_fetch_all=Mock(side_effect=read), json_db_value=Mock(side_effect=lambda value: value)):
                    result = views.persist_group_module_session_dates([copy.deepcopy(MODULE)], {})
                return result, events
            result, events = self.compare(scenario)
            self.assertEqual(result, 0 if original else 1)
            self.assertEqual(len([e for e in events if e[0] == 'write']), result)

    def test_empty_session_persistence_never_reads(self):
        for old in (True, False):
            with editing_scope(old, [], authoring_fetch_all=Mock(side_effect=AssertionError('No read expected'))):
                self.assertEqual(views.persist_group_module_session_dates([{}], {}), 0)
