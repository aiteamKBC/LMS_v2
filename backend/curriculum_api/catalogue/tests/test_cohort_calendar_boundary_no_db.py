"""Cohort/holiday read parity: actual frozen functions, synthetic inputs, no I/O."""
from curriculum_api.catalogue.tests.parity.composition_test_support import composition_fixture
from curriculum_api.catalogue.tests.parity.read_dependency_test_support import observe_export
from contextlib import ExitStack, contextmanager
from copy import deepcopy
from datetime import date, datetime, timezone
import importlib
import json
from pathlib import Path
from types import FunctionType
from unittest.mock import Mock, patch

from django.test import SimpleTestCase
from curriculum_api import calendar_holidays, country_calendars, delivery_calendar, views

SNAPSHOT = json.loads((Path(__file__).parents[2] / 'catalogue/tests/fixtures/legacy_snapshots/cohort_calendar_snapshot.json').read_text(encoding='utf-8'))


@contextmanager
def original_cohort_calendar():
    with ExitStack() as stack:
        for name, entry in SNAPSHOT.items():
            if isinstance(getattr(views, name), Mock):
                continue
            namespace = dict(vars(views))
            exec(compile(entry['source'], '<original-cohort-calendar>', 'exec'), namespace)
            fn = namespace[name]
            restored = FunctionType(fn.__code__, vars(views), name, fn.__defaults__)
            restored.__kwdefaults__ = fn.__kwdefaults__
            for decorator in reversed(entry['decorators']):
                restored = getattr(views, decorator)(restored)
            stack.enter_context(composition_fixture(views, name, restored))
        yield


class CohortCalendarParity(SimpleTestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.events = []
        self.holidays = [
            {'id': 'B', 'title': 'Bank', 'holiday_date': '2028-01-01', 'division': 'england-and-wales'},
            {'id': 'A', 'label': 'Closure', 'start_date': '2028-01-03', 'end_date': '2028-01-05'},
            {'id': 'OLD', 'label': 'Old closure', 'start_date': '2027-12-01', 'is_archived': True},
            {'id': 'OUT', 'title': 'Later bank', 'holiday_date': '2028-02-01'},
        ]
        self.in_use = self.stack.enter_context(patch.object(calendar_holidays, 'in_use', return_value=True))
        def read():
            self.events.append(('normalized-calendar',))
            return deepcopy(self.holidays)
        self.rows = self.stack.enter_context(patch.object(calendar_holidays, 'rows', side_effect=read))
        for obj, name in [(country_calendars, 'ensure_calendar'), (country_calendars, 'fetch_holidays')]:
            self.stack.enter_context(patch.object(obj, name, side_effect=AssertionError('Sync/provider forbidden')))
        self.stack.enter_context(patch('requests.sessions.Session.request', side_effect=AssertionError('HTTP provider forbidden')))

    def compare(self, name, *args, **kwargs):
        before = deepcopy((args, kwargs))
        self.events.clear()
        with original_cohort_calendar():
            expected = getattr(views, name)(*args, **kwargs)
        expected_events = deepcopy(self.events)
        self.events.clear()
        owner = importlib.import_module(SNAPSHOT[name]['module'])
        with observe_export(views, owner, name, wraps=getattr(owner, name)) as called:
            actual = getattr(views, name)(*args, **kwargs)
        called.assert_called_once()
        self.assertEqual(actual, expected)
        self.assertEqual(self.events, expected_events)
        self.assertEqual((args, kwargs), before)
        return actual

    def test_normalized_reader_preserves_archive_scope_source_choice_and_order(self):
        with composition_fixture(views, 'table_exists', side_effect=AssertionError('Separate source forbidden')):
            self.assertEqual([r['id'] for r in self.compare('_scoped_holiday_rows')], ['B', 'A', 'OUT'])
            self.assertEqual([r['id'] for r in self.compare('_scoped_holiday_rows', True)], ['OLD', 'B', 'A', 'OUT'])

    def test_separate_table_reader_preserves_exact_sql_and_legacy_table_choice(self):
        self.in_use.return_value = False
        self.rows.side_effect = AssertionError('Normalized source forbidden')
        def read(query):
            self.events.append(query)
            return deepcopy([self.holidays[0]] if 'england_holidays' in query else self.holidays[1:3])
        with composition_fixture(views, 'table_exists', return_value=True), \
                composition_fixture(views, 'authored_holiday_table_name', return_value='training_plan_holidays'), \
                composition_fixture(views, 'table_name', side_effect=lambda name: 'curriculum.'+name), \
                composition_fixture(views, 'fetch_all', side_effect=read):
            self.assertEqual([r['id'] for r in self.compare('_scoped_holiday_rows')], ['B', 'A'])
            self.assertEqual(len(self.events), 2)
            self.assertIn('order by holiday_date, title', self.events[0])
            self.assertIn('from curriculum.training_plan_holidays', self.events[1])

    def test_absent_sources_return_empty_but_strict_read_errors_propagate(self):
        self.in_use.return_value = False
        with composition_fixture(views, 'table_exists', return_value=False), \
                composition_fixture(views, 'authored_holiday_table_name', return_value=''), \
                composition_fixture(views, 'fetch_all', side_effect=AssertionError('No source to read')):
            self.assertEqual(self.compare('_scoped_holiday_rows'), [])
        self.in_use.return_value = True
        self.rows.side_effect = RuntimeError('synthetic calendar read failure')
        with original_cohort_calendar(), self.assertRaisesRegex(RuntimeError, 'synthetic calendar read failure'):
            views.get_holiday_rows()
        with self.assertRaisesRegex(RuntimeError, 'synthetic calendar read failure'):
            views.get_holiday_rows()
        # The explicitly approved correction retires failure-to-empty behavior.
        from curriculum_api.catalogue.application.read_errors import CatalogueReadUnavailable
        with original_cohort_calendar():
            with self.assertRaises(CatalogueReadUnavailable):
                views.get_holiday_rows_safe()
        with self.assertRaises(CatalogueReadUnavailable):
            views.get_holiday_rows_safe()

    def test_scope_memo_key_default_arguments_and_list_ownership_unchanged(self):
        def scenario():
            self.rows.reset_mock()
            with views.curriculum_read_scope():
                first = views.get_holiday_rows()
                original = deepcopy(first)
                first.clear()
                second = views.get_holiday_rows(include_archived=False)
                all_rows = views.get_holiday_rows(include_archived=True)
                self.assertEqual(second, original)
                self.assertEqual(self.rows.call_count, 2)
            views.get_holiday_rows()
            self.assertEqual(self.rows.call_count, 3)
            return second, all_rows
        with original_cohort_calendar():
            expected = scenario()
            key = views._scoped_holiday_rows.memo_key()
        self.assertEqual(scenario(), expected)
        self.assertEqual(views._scoped_holiday_rows.memo_key(include_archived=False), key)

    def test_holiday_source_shapes_notes_country_and_bunting_contract(self):
        rows = [None, {}, {'id': 'N', 'division': 'x', 'holiday_date': date(2028, 1, 1), 'title': ' Bank ', 'notes': 'Substitute day', 'bunting': False},
                {'id': 'L', 'label': 'Closure', 'start_date': '2028-01-03', 'end_date': '2028-01-05', 'notes': '__private: hidden', 'type': 'Exam'},
                {'id': 'C', 'source': 'calendarific', 'country': 'US', 'label': 'Synthetic', 'startDate': '2028-01-10'}]
        for row in rows:
            result = self.compare('serialize_holiday_row', row)
            if row and row.get('id') == 'L':
                self.assertNotIn('notes', result)
                self.assertEqual(result['type'], 'Exam')
            if row and row.get('id') == 'N':
                self.assertFalse(result['bunting'])
                self.assertEqual(result['startDate'], result['endDate'])
            if row and row.get('id') == 'C':
                self.assertEqual(result['country'], 'US')
            self.compare('holiday_row_source', row)

    def test_england_projection_native_timestamp_and_raw_feed_contract(self):
        result = self.compare('serialize_england_holiday_row', {
            'id': 'N', 'division': ' england-and-wales ', 'title': ' Bank ',
            'holiday_date': date(2028, 1, 1), 'notes': ' Substitute day ', 'bunting': True,
            'fetched_at': datetime(2027, 12, 1, tzinfo=timezone.utc)})
        self.assertEqual((result['date'], result['title'], result['notes']), ('2028-01-01', 'Bank', 'Substitute day'))

    def test_archive_markers_are_not_confused_with_false_or_inactive(self):
        for row in ({'is_archived': True}, {'archived': 'yes'}, {'status': ' Archived '},
                    {'notes': '__archived: true'}, {'is_archived': False}, {'status': 'inactive'}, None):
            self.compare('holiday_row_archived', row)
        self.assertFalse(views.holiday_row_archived({'status': 'inactive'}))

    def test_overlap_inclusive_endpoints_missing_dates_and_invalid_ranges(self):
        for args in [('2028-01-01','2028-01-31','2028-01-31','2028-02-02'),
                     ('2028-01-01','2028-01-31','2028-02-01','2028-02-02'),
                     ('2028-01-01',None,'2028-01-01',None), (None,None,'2028-01-01',None),
                     ('invalid','2028-01-31','2028-01-01','2028-01-02'),
                     ('2028-01-10','2028-01-01','2028-01-02','2028-01-03')]:
            self.compare('date_ranges_overlap', *args)
        self.assertTrue(views.date_ranges_overlap('2028-01-01', None, '2028-01-01', None))

    def test_period_projection_sorting_ties_and_no_new_deduplication(self):
        rows = [self.holidays[1], self.holidays[0], self.holidays[0], self.holidays[3]]
        result = self.compare('holidays_within_period', rows, '2028-01-01', '2028-01-31')
        self.assertEqual([r['id'] for r in result], ['B', 'B', 'A'])
        self.compare('sorted_holidays', [{'label': 'Z', 'startDate': '2028-01-01'}, {'label': 'A', 'startDate': '2028-01-01'}, {}])
        self.compare('holiday_row_sort_key', {'label': ' A ', 'start_date': date(2028, 1, 1)})

    def test_exclusions_are_in_range_deny_list_not_stale_stored_selection(self):
        rows = [self.holidays[0], self.holidays[1], self.holidays[3]]
        result = self.compare('cohort_holiday_details', rows, ['\u2003B\t', 'OUT', 'STALE', 'B'], '2028-01-01', '2028-01-31')
        self.assertEqual(result['holidayIds'], ['A'])
        self.assertEqual(result['excludedHolidayIds'], ['B'])
        self.assertEqual(result['summary'], {'global': 3, 'inRange': 2, 'selected': 1})
        for excluded in (None, []):
            self.assertEqual(self.compare('cohort_holiday_details', rows, excluded, '2028-01-01', '2028-01-31')['holidayIds'], ['B', 'A'])

    def test_practical_period_uses_explicit_end_then_contracted_duration_not_epa(self):
        for row, expected in [({'practicalEndDate':'2028-01-31','end_date':'2028-02-01'}, '2028-01-31'),
                              ({'start_date':'2028-01-01','duration_months':2,'apprenticeship_end_date':'2099-01-01'}, '2028-02-29'),
                              ({'start_date':'2028-01-01','duration_months':0}, ''), (None,'')]:
            self.assertEqual(self.compare('cohort_holiday_period_end', row), expected)

    def test_cohort_details_recompute_holidays_and_dates_keep_input_and_lists(self):
        row = {'cohort_id':'C', 'cohort_name':'Synthetic', 'programme_id':'P', 'end_date':'2028-01-31',
               'start_date':'2028-01-01', 'epa_months':1, 'duration_months':1, 'excluded_holiday_ids':'["B"]',
               'holiday_ids':'["STALE"]', 'selected_holidays':'["STALE"]', 'apprenticeship_end_date':'2099-01-01',
               'training_plan_ids':'["T"]', 'group_ids':['G'], 'module_names':'["Module"]'}
        result = self.compare('serialize_cohort_authoring_detail', row, [self.holidays[0], self.holidays[1]])
        self.assertEqual((result['holidayIds'], result['excludedHolidayIds']), (['A'], ['B']))
        self.assertEqual(result['apprenticeshipEndDate'], '2028-02-29')
        self.assertEqual((result['groupIds'], result['trainingPlanIds']), (['G'], ['T']))
        self.assertEqual(self.events, [])

    def test_supplied_empty_calendar_skips_io_and_default_reads_once(self):
        row = {'cohort_id':'C','start_date':'2028-01-01','end_date':'2028-01-31'}
        self.assertEqual(self.compare('serialize_cohort_authoring_detail', row, [])['holidayIds'], [])
        self.assertEqual(self.events, [])
        result = self.compare('serialize_cohort_authoring_detail', row)
        self.assertEqual(result['holidayIds'], ['B', 'A'])
        self.assertEqual(self.events, [('normalized-calendar',)])

    def test_gb_policy_manual_closures_and_public_holiday_toggle_use_real_policy(self):
        row = {'cohort_id':'C','start_date':'2028-01-01','end_date':'2028-01-31',
               'calendar_policy':{'country':'GB','observePublicHolidays':False,'manualHolidays':[
                   {'id':'M','label':'Manual','startDate':'2028-01-15','endDate':'2028-01-16'}]}}
        result = self.compare('serialize_cohort_authoring_detail', row, [self.holidays[0]])
        self.assertEqual(result['holidayIds'], ['manual:M'])
        self.assertEqual(result['calendarError'], '')

    def test_country_failure_is_visible_and_never_falls_back_to_england(self):
        row = {'cohort_id':'C','start_date':'2028-01-01','end_date':'2028-01-31','calendar_policy':{'country':'US'}}
        with composition_fixture(delivery_calendar, 'holidays_for_period', side_effect=country_calendars.CalendarUnavailable('Synthetic missing US calendar')):
            result = self.compare('serialize_cohort_authoring_detail', row, [self.holidays[0]])
        self.assertEqual(result['holidayIds'], [])
        self.assertEqual(result['calendarError'], 'Synthetic missing US calendar')

    def test_invalid_policy_and_unexpected_reader_errors_are_not_calendar_unavailable(self):
        for error in (ValueError('bad policy'), RuntimeError('unexpected calendar failure')):
            with composition_fixture(delivery_calendar, 'policy_holidays', side_effect=error):
                row = {'calendar_policy': {'country':'GB'}}
                with original_cohort_calendar(), self.assertRaises(type(error)):
                    views.serialize_cohort_authoring_detail(row, [])
                with self.assertRaises(type(error)):
                    views.serialize_cohort_authoring_detail(row, [])
        with composition_fixture(delivery_calendar, 'policy_holidays', side_effect=AssertionError('No policy should call this')):
            self.compare('serialize_cohort_authoring_detail', {}, [])

    def test_multi_cohort_consumer_shares_one_calendar_read_and_keeps_row_order(self):
        rows = [{'cohort_id':'C2','cohort_name':'Second','start_date':'2028-01-01','end_date':'2028-01-31'},
                {'cohort_id':'C1','cohort_name':'First','start_date':'2028-02-01','end_date':'2028-02-28'}]
        with composition_fixture(views, 'authoring_fetch_all', return_value=rows):
            self.rows.reset_mock()
            with original_cohort_calendar():
                expected = views.cohort_authoring_detail_rows()
            self.assertEqual(self.rows.call_count, 1)
            self.rows.reset_mock()
            actual = views.cohort_authoring_detail_rows()
            self.assertEqual(self.rows.call_count, 1)
            self.assertEqual(actual, expected)
            self.assertEqual([r['cohortId'] for r in actual], ['C2','C1'])
            self.assertEqual([r['holidayIds'] for r in actual], [['B','A'],['OUT']])
