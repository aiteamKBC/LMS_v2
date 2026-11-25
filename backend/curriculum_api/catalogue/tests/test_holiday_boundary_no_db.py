"""Actual old/new holiday handlers on synthetic ports; no database or provider calls."""
from curriculum_api.catalogue.tests.parity.composition_test_support import composition_fixture
import copy
import json
from contextlib import ExitStack, contextmanager
from datetime import datetime, timezone
from types import FunctionType
from unittest.mock import Mock, patch

from django.test import RequestFactory, SimpleTestCase
from curriculum_api import views, calendar_holidays as calendar, england_holidays
from curriculum_api.catalogue.api import holiday_commands, cohort_preview
from curriculum_api.catalogue.application import cohort_calendar
from curriculum_api.catalogue.tests.parity.holiday_boundary_oracle import SNAPSHOT
from curriculum_api.catalogue.tests.test_hierarchy_commands_boundary_no_db import FrozenClock
from curriculum_api.catalogue.tests.test_module_commands_boundary_no_db import recording

NOW = datetime(2026, 1, 1, tzinfo=timezone.utc)
LOCAL = {'id': '12', 'label': 'Synthetic closure', 'start_date': '2026-12-20',
         'end_date': '2026-12-21', 'type': 'Staff', 'color': '#123456', 'notes': 'Keep', 'is_archived': False}


def request(method, payload=None, *, query='', raw=None):
    return RequestFactory().generic(method, '/holiday/' + query,
                                   data=raw if raw is not None else json.dumps(payload or {}),
                                   content_type='application/json')


def response(value):
    return value.status_code, json.loads(value.content)


@contextmanager
def original_holidays():
    with ExitStack() as stack:
        for key, entry in SNAPSHOT['functions'].items():
            filename, name = key.split(':')
            module = views if filename == 'views.py' else calendar
            if isinstance(getattr(module, name), Mock):
                continue
            env = dict(vars(module))
            exec(compile(entry['source'], '<pre-holiday-boundary>', 'exec'), env)
            fn = env[name]
            old = FunctionType(fn.__code__, vars(module), name, fn.__defaults__)
            old.__kwdefaults__ = fn.__kwdefaults__
            for decorator in reversed(entry['decorators']):
                old = eval(decorator, vars(module))(old)
            stack.enter_context(patch.object(module, name, old))
        yield


@contextmanager
def holiday_scope(old, events, *, normalized=True, values=None):
    with ExitStack() as stack:
        ports = dict(datetime=FrozenClock, authored_holiday_table_name=Mock(return_value='' if normalized else 'holidays'),
                     table_exists=Mock(return_value=not normalized), table_name=Mock(side_effect=lambda t: 'fixture.' + t),
                     invalidate_curriculum_cache=recording(events, 'invalidate'),
                     get_holiday_rows=Mock(return_value=[copy.deepcopy(LOCAL)]),
                     fetch_all=recording(events, 'read', [copy.deepcopy(LOCAL)]),
                     insert_row=recording(events, 'insert', copy.deepcopy(LOCAL)),
                     update_rows=recording(events, 'update', [copy.deepcopy(LOCAL)]),
                     delete_rows=recording(events, 'delete', [copy.deepcopy(LOCAL)]),
                     archive_payload=Mock(return_value={'is_archived': True}),
                     cached_curriculum_value=Mock(side_effect=lambda key, builder: builder()),
                     curriculum_visibility=Mock(return_value='operational'))
        ports.update(values or {})
        for name, value in ports.items():
            stack.enter_context(composition_fixture(views, name, value))
        for name, value in dict(in_use=Mock(return_value=normalized), _now=Mock(return_value=NOW),
                create_local=recording(events, 'create-local', copy.deepcopy(LOCAL)),
                local_row=Mock(return_value=copy.deepcopy(LOCAL)),
                update_local=recording(events, 'update-local', 1), archive_local=recording(events, 'archive-local', 1),
                official_exists=Mock(return_value=False)).items():
            stack.enter_context(patch.object(calendar, name, value))
        for name, value in dict(auto_sync_if_due=recording(events, 'auto-sync'),
                run_sync=recording(events, 'sync', {'status': 'ok'}),
                reset_auto_sync_state=recording(events, 'reset'),
                sync_status=Mock(return_value={'lastStatus': 'ok'}),
                recent_syncs=recording(events, 'recent', [])).items():
            stack.enter_context(patch.object(england_holidays, name, value))
        if old:
            stack.enter_context(original_holidays())
        yield stack


class HolidayBoundaryParity(SimpleTestCase):
    def compare(self, scenario):
        actual = scenario(False)
        self.assertEqual(actual, scenario(True))
        return actual

    def test_collection_create_dates_fields_and_storage_paths_match(self):
        for normalized in (False, True):
            def scenario(old):
                events = []
                with holiday_scope(old, events, normalized=normalized):
                    result = views.curriculum_holiday_collection(request('POST', {'label': '  Closure  ', 'startDate': '2026-12-20'}))
                return response(result), events
            result, events = self.compare(scenario)
            self.assertEqual(result[0], 201)
            payload = events[0][1][-1]
            self.assertEqual((payload['label'], payload['start_date'], payload['end_date']), ('Closure', '2026-12-20', '2026-12-20'))
            self.assertEqual(events[-1][0], 'invalidate')

    def test_partial_patch_keeps_unsent_dates_notes_and_label(self):
        for normalized in (False, True):
            def scenario(old):
                events = []
                with holiday_scope(old, events, normalized=normalized):
                    result = views.curriculum_holiday_detail(request('PATCH', {'type': 'New type'}), '12')
                return response(result), events
            result, events = self.compare(scenario)
            self.assertEqual(result, (200, {'updated': True, 'id': '12'}))
            written = next(e for e in events if e[0] in {'update', 'update-local'})[1][-1]
            self.assertEqual(set(written), {'type', 'updated_at'})

    def test_dates_are_validated_before_writes_and_archive_keeps_contract(self):
        for method, payload, expected in [('POST', {'label': 'X'}, 400),
                ('POST', {'label': 'X', 'startDate': '2026-12-20', 'endDate': '2026-12-19'}, 400),
                ('PATCH', {'startDate': '2026-12-22', 'endDate': '2026-12-20'}, 400),
                ('DELETE', {}, 200)]:
            def scenario(old):
                events = []
                with holiday_scope(old, events):
                    result = (views.curriculum_holiday_collection(request(method, payload)) if method == 'POST'
                              else views.curriculum_holiday_detail(request(method, payload), '12'))
                return response(result), events
            result, events = self.compare(scenario)
            self.assertEqual(result[0], expected)
            self.assertEqual([e[0] for e in events], ['archive-local', 'invalidate'] if method == 'DELETE' else [])

    def test_official_rows_are_read_only_and_missing_local_rows_stay_404(self):
        for official, expected in ((False, 404), (True, 405)):
            def scenario(old):
                events = []
                with holiday_scope(old, events), patch.object(calendar, 'local_row', return_value=None), \
                        patch.object(calendar, 'official_exists', return_value=official):
                    result = views.curriculum_holiday_detail(request('PATCH', {'label': 'No'}), 'official:synthetic')
                return response(result), events
            result, events = self.compare(scenario)
            self.assertEqual(result[0], expected)
            self.assertEqual(events, [])

    def test_list_visibility_cache_key_and_auto_sync_dispatch_are_preserved(self):
        for visibility in ('all', 'operational'):
            def scenario(old):
                events = []
                cache = Mock(side_effect=lambda key, build: build())
                rows = Mock(return_value=[copy.deepcopy(LOCAL)])
                with holiday_scope(old, events, values={'curriculum_visibility': Mock(return_value=visibility),
                                   'cached_curriculum_value': cache, 'get_holiday_rows': rows}):
                    result = views.curriculum_holiday_collection(request('GET'))
                return response(result), events, cache.call_args.args[0], rows.call_args.kwargs
            result, events, key, args = self.compare(scenario)
            self.assertEqual(key, 'holidays:' + visibility)
            self.assertEqual(args, {'include_archived': visibility == 'all'})
            self.assertEqual([e[0] for e in events], ['auto-sync'])

    def test_refresh_dry_run_and_provider_failure_mapping_remain_exact(self):
        for query, payload, status in [('', {}, 'ok'), ('?dryRun=1', {}, 'ok'), ('', {'dryRun': True}, 'error')]:
            def scenario(old):
                events = []
                with holiday_scope(old, events), patch.object(england_holidays, 'run_sync', recording(events, 'sync', {'status': status})):
                    result = views.curriculum_england_holidays_refresh(request('POST', payload, query=query))
                return response(result), events
            result, events = self.compare(scenario)
            self.assertEqual(result[0], 200 if status == 'ok' else 502)
            self.assertEqual(events[0][2], {'source': 'manual', 'apply': not (query or payload)})
            self.assertEqual(events[1][0], 'reset')

    def test_malformed_or_non_object_refresh_never_dispatches_sync(self):
        for raw in ('{broken', '[]', 'null', 'false', '1', '"text"'):
            events = []
            with holiday_scope(False, events):
                result = views.curriculum_england_holidays_refresh(request('POST', raw=raw))
            self.assertEqual(result.status_code, 400)
            self.assertEqual(events, [])
        # Prove the original malformed-JSON fallback actually issued the operation.
        events = []
        with holiday_scope(True, events):
            before = views.curriculum_england_holidays_refresh(request('POST', raw='{broken'))
        self.assertEqual(before.status_code, 200)
        self.assertEqual([e[0] for e in events], ['sync', 'reset'])

    def test_preview_calls_extracted_computation_and_keeps_authored_epa_and_warning_values(self):
        for payload in ({}, {'startDate': '2026-01-01', 'durationMonths': 12, 'epaMonths': 3},
                        {'startDate': '2026-01-01', 'durationMonths': 12, 'practicalEndDate': '2026-11-30', 'epaMonths': 2},
                        {'startDate': '2026-01-01', 'practicalEndDate': '2025-12-01', 'apprenticeshipEndOverride': '2025-11-01'}):
            def scenario(old):
                with holiday_scope(old, []):
                    return response(views.curriculum_preview_cohort_end_date(request('POST', payload)))
            with patch.object(cohort_preview, 'cohort_end_preview', wraps=cohort_calendar.cohort_end_preview) as invoked:
                actual = scenario(False)
            invoked.assert_called_once()
            self.assertEqual(actual, scenario(True))
            self.assertEqual(actual[1]['holidayExtensionDays'], 0)

    def test_method_and_json_guards_call_actual_owner(self):
        with holiday_scope(False, []), patch.object(holiday_commands, 'curriculum_holiday_collection', wraps=holiday_commands.curriculum_holiday_collection) as invoked:
            self.assertEqual(views.curriculum_holiday_collection(request('PUT')).status_code, 405)
            self.assertEqual(views.curriculum_holiday_collection(request('POST', raw='{broken')).status_code, 400)
        self.assertEqual(invoked.call_count, 2)
