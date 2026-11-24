"""Actual old/new inherited-calendar contracts with synthetic read capabilities."""
from curriculum_api.catalogue.tests.parity.composition_test_support import composition_fixture
from contextlib import ExitStack, contextmanager
from copy import deepcopy
import json
from pathlib import Path
from types import FunctionType
from unittest.mock import Mock, patch

from django.test import SimpleTestCase
from . import country_calendars, delivery_calendar, views
from .catalogue.application import inherited_calendar
from .catalogue.tests.parity.read_dependency_test_support import observe_export

SNAPSHOT = json.loads((Path(__file__).parent / 'catalogue/tests/fixtures/legacy_snapshots/inherited_calendar_snapshot.json').read_text(encoding='utf-8'))


@contextmanager
def original_inherited_calendar():
    with ExitStack() as stack:
        for name, entry in SNAPSHOT.items():
            if isinstance(getattr(views, name), Mock):
                continue
            namespace = dict(vars(views))
            exec(compile(entry['source'], '<original-inherited-calendar>', 'exec'), namespace)
            fn = namespace[name]
            restored = FunctionType(fn.__code__, vars(views), name, fn.__defaults__)
            restored.__kwdefaults__ = fn.__kwdefaults__
            stack.enter_context(composition_fixture(views, name, restored))
        yield


class InheritedCalendarParity(SimpleTestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.events = []
        self.holidays = [
            {'id': 'BEFORE', 'holiday_date': '2027-12-01', 'title': 'Before'},
            {'id': 'BANK', 'holiday_date': '2028-01-01', 'title': 'Bank'},
            {'id': 'RANGE', 'start_date': '2027-12-30', 'end_date': '2028-01-02', 'label': 'Closure'},
            {'id': 'LATER', 'holiday_date': '2028-04-01', 'title': 'Later'},
        ]
        self.cohorts = [{'cohort_id': 'C', 'start_date': '2028-01-01', 'end_date': '2028-01-31',
                         'excluded_holiday_ids': '["BANK"]', 'holiday_ids': '["STALE"]',
                         'selected_holidays': '[{"id":"STALE"}]'}]
        def rows(*args, **kwargs):
            self.events.append(('cohorts', deepcopy(args), deepcopy(kwargs)))
            return deepcopy(self.cohorts)
        def calendar():
            self.events.append(('holidays',))
            return deepcopy(self.holidays)
        self.read_cohorts = self.stack.enter_context(composition_fixture(views, 'authoring_rows_by_id', side_effect=rows))
        self.read_holidays = self.stack.enter_context(composition_fixture(views, 'get_holiday_rows', side_effect=calendar))
        self.stack.enter_context(composition_fixture(views, 'ensure_module_authoring_tables', side_effect=AssertionError('Provisioning forbidden')))
        for name in ('ensure_calendar', 'fetch_holidays'):
            self.stack.enter_context(composition_fixture(country_calendars, name, side_effect=AssertionError('Provider/sync forbidden')))
        self.stack.enter_context(patch('requests.sessions.Session.request', side_effect=AssertionError('Network forbidden')))

    def compare(self, name, *args, **kwargs):
        old_args, old_kwargs = deepcopy((args, kwargs))
        new_args, new_kwargs = deepcopy((args, kwargs))
        self.events.clear()
        with original_inherited_calendar():
            expected = getattr(views, name)(*old_args, **old_kwargs)
        old_events = deepcopy(self.events)
        self.events.clear()
        with observe_export(views, inherited_calendar, name, wraps=getattr(inherited_calendar, name)) as owner:
            actual = getattr(views, name)(*new_args, **new_kwargs)
        owner.assert_called_once()
        self.assertEqual(actual, expected)
        self.assertEqual((new_args, new_kwargs), (old_args, old_kwargs))
        self.assertEqual(self.events, old_events)
        return actual, new_args, new_kwargs

    def test_open_ended_selection_keeps_spanning_and_later_holidays(self):
        rows, _, _ = self.compare('scheduling_holidays_from', self.holidays, '2028-01-01', ['\u2003BANK\t'])
        self.assertEqual([r['id'] for r in rows], ['RANGE', 'LATER'])

    def test_missing_invalid_dates_and_duplicate_holidays_preserved(self):
        for start in (None, '', 'invalid'):
            rows, _, _ = self.compare('scheduling_holidays_from', self.holidays * 2, start)
            self.assertEqual(len(rows), 8)
        rows, _, _ = self.compare('scheduling_holidays_from', [{'id': 'INVALID', 'start_date': 'invalid'}], '2028-01-01')
        self.assertEqual(len(rows), 1)
        self.assertEqual(self.compare('scheduling_holidays_from', None, None)[0], [])

    def test_overview_camel_snake_precedence_and_duplicate_cohort_ids(self):
        cohorts = [{}, {'id':' C ', 'startDate':'2028-01-01', 'excludedHolidayIds':['BANK']},
                   {'id':'C', 'start_date':'2028-01-01', 'excluded_holiday_ids':['LATER']}]
        result, _, _ = self.compare('cohort_selected_holidays_by_id', cohorts, self.holidays)
        self.assertEqual([r['id'] for r in result['C']], ['RANGE', 'BANK'])
        self.assertEqual(self.events, [])

    def test_overview_country_failure_retains_visible_error_and_input_mutation(self):
        for message in ('Synthetic unavailable calendar', ''):
            with composition_fixture(delivery_calendar, 'policy_holidays', side_effect=country_calendars.CalendarUnavailable(message)):
                result, args, _ = self.compare('cohort_selected_holidays_by_id', [{'id':'C', 'calendarPolicy':{'country':'US'}}], self.holidays)
            self.assertEqual(result, {'C': []})
            self.assertEqual(args[0][0]['calendarError'], message)

    def test_overview_success_does_not_clear_preexisting_calendar_error(self):
        cohorts = [{'id':'C', 'calendarError':'Existing', 'calendarPolicy':{'country':'GB'}, 'startDate':'2028-01-01'}]
        result, args, _ = self.compare('cohort_selected_holidays_by_id', cohorts, self.holidays)
        self.assertEqual(args[0][0]['calendarError'], 'Existing')
        self.assertEqual(len(result['C']), 3)

    def test_bulk_read_deduplicates_ids_and_reads_calendar_once_without_provisioning(self):
        result, _, _ = self.compare('cohort_selected_holidays_by_cohort', [' C ', None, '', 'C', '\u2003D\t'])
        self.assertEqual([r['id'] for r in result['C']], ['RANGE', 'LATER'])
        self.assertEqual(self.events, [('cohorts', (views.COHORT_AUTHORING_DETAILS_TABLE, 'cohort_id', ['C','D'], views.COHORT_ROWS_ORDER), {'ensure_tables':False}), ('holidays',)])

    def test_empty_ids_and_missing_rows_do_not_read_calendar(self):
        self.assertEqual(self.compare('cohort_selected_holidays_by_cohort', [None, ''])[0], {})
        self.assertEqual(self.events, [])
        self.cohorts = []
        self.assertEqual(self.compare('cohort_selected_holidays_by_cohort', ['missing'])[0], {})
        self.assertEqual(len(self.events), 1)

    def test_bulk_existing_read_failure_contract_is_not_certified_as_empty_data(self):
        self.read_cohorts.side_effect = RuntimeError('Synthetic cohort failure')
        self.assertEqual(self.compare('cohort_selected_holidays_by_cohort', ['C'])[0], {})
        self.read_cohorts.side_effect = lambda *a, **k: deepcopy(self.cohorts)
        self.read_holidays.side_effect = RuntimeError('Synthetic calendar failure')
        self.assertEqual(self.compare('cohort_selected_holidays_by_cohort', ['C'])[0], {'C': []})

    def test_bulk_country_errors_propagate_and_never_fall_back_to_england(self):
        self.cohorts[0]['calendar_policy'] = {'country':'US'}
        with composition_fixture(delivery_calendar, 'policy_holidays', side_effect=country_calendars.CalendarUnavailable('Missing saved calendar')):
            with original_inherited_calendar(), self.assertRaisesRegex(country_calendars.CalendarUnavailable, 'Missing saved calendar'):
                views.cohort_selected_holidays_by_cohort(['C'])
            with self.assertRaisesRegex(country_calendars.CalendarUnavailable, 'Missing saved calendar'):
                views.cohort_selected_holidays_by_cohort(['C'])

    def test_unexpected_country_exceptions_still_propagate_from_overview(self):
        args = ([{'id':'C', 'calendarPolicy':{'country':'US'}}], self.holidays)
        with composition_fixture(delivery_calendar, 'policy_holidays', side_effect=ValueError('Synthetic malformed policy')):
            with original_inherited_calendar(), self.assertRaisesRegex(ValueError, 'Synthetic malformed policy'):
                views.cohort_selected_holidays_by_id(*args)
            with self.assertRaisesRegex(ValueError, 'Synthetic malformed policy'):
                views.cohort_selected_holidays_by_id(*args)

    def test_bulk_manual_calendar_and_period_arguments_preserved(self):
        self.cohorts[0].update(calendar_policy={'country':'GB', 'observePublicHolidays':False,
            'manualHolidays':[{'id':'X', 'label':'Manual', 'startDate':'2028-03-01', 'endDate':'2028-03-01'}]},
            end_date=None, duration_months=1)
        original = delivery_calendar.policy_holidays
        def wrapped(policy, start, end, rows):
            self.events.append(('policy', deepcopy(policy), start, end))
            return original(policy, start, end, rows)
        with composition_fixture(delivery_calendar, 'policy_holidays', side_effect=wrapped):
            result, _, _ = self.compare('cohort_selected_holidays_by_cohort', ['C'])
        self.assertEqual([r['id'] for r in result['C']], ['manual:X'])
        self.assertEqual(self.events[-1][2:], ('2028-01-01', '2028-01-31'))

    def test_stale_selected_holidays_ignored_and_duplicate_rows_last_wins(self):
        self.cohorts += [{'cohort_id':''}, dict(self.cohorts[0], excluded_holiday_ids='["LATER"]')]
        result, _, _ = self.compare('cohort_selected_holidays_by_cohort', ['C'])
        self.assertEqual([r['id'] for r in result['C']], ['RANGE', 'BANK'])

    def test_module_cohort_missing_target_and_normalized_identifier(self):
        for row in (None, {}, {'cohort_id':' '}, {'cohort_id':' C '}):
            result, _, _ = self.compare('module_cohort_selected_holidays', row)
            self.assertEqual(len(result), 2 if row and row.get('cohort_id')==' C ' else 0)
        with composition_fixture(views, 'cohort_selected_holidays_by_cohort', return_value={'C':None}):
            self.assertEqual(self.compare('module_cohort_selected_holidays', {'cohort_id':'C'})[0], [])

    def test_preview_nonempty_list_wins_with_same_object_and_no_reads(self):
        for old in (True, False):
            with original_inherited_calendar() if old else ExitStack():
                holidays = [{'id':'UNSAVED'}]
                cache = {}
                self.assertIs(views.module_schedule_holidays({'holidays':holidays, 'cohort_id':'C'}, cache), holidays)
                self.assertEqual(cache, {})
        self.assertEqual(self.events, [])

    def test_empty_or_nonlist_preview_inherits_and_cache_preserves_identity(self):
        for value in ([], None, (), 'not a list'):
            result, args, _ = self.compare('module_schedule_holidays', {'holidays':value, 'cohort_id':' C '}, {})
            self.assertEqual(len(result), 2)
            self.assertIs(result, args[1]['C'])
        for old in (True, False):
            with original_inherited_calendar() if old else ExitStack():
                self.events.clear()
                cache = {}
                first = views.module_schedule_holidays({'cohort_id':'C'}, cache)
                second = views.module_schedule_holidays({'cohort_id':' C '}, cache)
                self.assertIs(first, second)
                self.assertEqual(len(self.events), 2)

    def test_missing_schedule_and_existing_falsey_cache_values(self):
        for schedule in (None, {}, {'cohort_id':' '}):
            self.assertEqual(self.compare('module_schedule_holidays', schedule)[0], [])
        for value in (None, [], False):
            self.assertEqual(self.compare('module_schedule_holidays', {'cohort_id':'C'}, {'C':value})[0], value)
        self.assertEqual(self.events, [])
