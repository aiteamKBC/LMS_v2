"""Session plan parity against actual pre-extraction functions, synthetic only."""
from curriculum_api.catalogue.tests.parity.composition_test_support import composition_fixture
from .catalogue.tests.parity.read_dependency_test_support import observe_export
from contextlib import ExitStack, contextmanager
from copy import deepcopy
from datetime import date
import importlib
import json
from pathlib import Path
from types import FunctionType
from unittest.mock import Mock, patch

from django.test import SimpleTestCase
from . import views, delivery_calendar, country_calendars

SNAPSHOT = json.loads((Path(__file__).parent / 'catalogue/tests/fixtures/legacy_snapshots/session_plans_snapshot.json').read_text(encoding='utf-8'))


@contextmanager
def original_session_plans():
    with ExitStack() as stack:
        for name, entry in SNAPSHOT.items():
            if isinstance(getattr(views, name), Mock):
                continue
            namespace = dict(vars(views))
            exec(compile(entry['source'], '<original-session-plans>', 'exec'), namespace)
            fn = namespace[name]
            restored = FunctionType(fn.__code__, vars(views), name, fn.__defaults__)
            restored.__kwdefaults__ = fn.__kwdefaults__
            stack.enter_context(composition_fixture(views, name, restored))
        yield


class SessionPlanParity(SimpleTestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.events = []
        self.holidays = [{'id':'H', 'label':'Synthetic closure', 'startDate':'2028-01-03', 'endDate':'2028-01-03'}]
        self.module = {'cohort_id':'C', 'start_date':'2028-01-03', 'session_week_day':'Monday, Thursday',
                       'sessions_number':4, 'weeks_number':2, 'session_start_time':'09:00', 'session_end_time':'11:00'}
        def read(row):
            self.events.append(('calendar', deepcopy(row)))
            return deepcopy(self.holidays)
        self.read = self.stack.enter_context(composition_fixture(views, 'module_cohort_selected_holidays', side_effect=read))
        self.stack.enter_context(composition_fixture(views, 'get_holiday_rows', side_effect=AssertionError('Unexpected read')))
        for name in ('ensure_calendar', 'fetch_holidays'):
            self.stack.enter_context(composition_fixture(country_calendars, name, side_effect=AssertionError('Provider/sync forbidden')))
        self.stack.enter_context(patch('requests.sessions.Session.request', side_effect=AssertionError('Network forbidden')))

    def compare(self, name, *args, **kwargs):
        old_args, old_kwargs = deepcopy((args, kwargs))
        new_args, new_kwargs = deepcopy((args, kwargs))
        self.events.clear()
        with original_session_plans():
            expected = getattr(views, name)(*old_args, **old_kwargs)
        if name == 'module_session_dates' and '_session_dates' in old_args[0]:
            # Dev adds boundary mode to the memoization key, at this exact position.
            key, dates = old_args[0]['_session_dates']
            self.assertEqual(len(key), 11)
            old_args[0]['_session_dates'] = ((*key[:4], None, *key[4:]), dates)
        events = deepcopy(self.events)
        self.events.clear()
        owner = importlib.import_module(SNAPSHOT[name]['module'])
        with observe_export(views, owner, name, wraps=getattr(owner, name)) as called:
            actual = getattr(views, name)(*new_args, **new_kwargs)
        called.assert_called_once()
        self.assertEqual(type(actual), type(expected))
        self.assertEqual(actual, expected)
        self.assertEqual((new_args, new_kwargs), (old_args, old_kwargs))
        self.assertEqual(self.events, events)
        return actual

    def test_weekday_aliases_separators_order_duplicates_and_invalid_inputs(self):
        for value in (None, '', 'MON / thu|Monday+fri & unknown', ['Sunday',' mon ', 'SUN', 3], 0, ('Monday',)):
            self.compare('parse_delivery_days', value)
        self.assertEqual(views.parse_delivery_days('thu,mon,thu'), [3,0])

    def test_holiday_date_ranges_inclusive_overlap_duplicates_and_invalid_dates(self):
        rows = ['2028-01-01', date(2028,1,1), None, 'bad', {'start_date':'2028-01-02', 'end_date':'2028-01-04'},
                {'startDate':'2028-01-04'}, {'startDate':'2028-01-09','endDate':'2028-01-08'}]
        self.assertEqual(self.compare('holiday_date_set', rows), {date(2028,1,n) for n in range(1,5)})
        self.assertEqual(self.compare('holiday_date_set', None), set())

    def test_overlapping_details_keep_order_and_duplicate_labels(self):
        rows = [self.holidays[0], dict(self.holidays[0], id='SECOND'), self.holidays[0], '2028-01-04']
        result = self.compare('holiday_details_by_date', rows)
        self.assertEqual([r['id'] for r in result[date(2028,1,3)]], ['H','SECOND','H'])

    def test_core_plan_matrix_counts_weeks_anchors_and_closure_parity(self):
        # 168 combinations of calendar position, days, limit and week anchor.
        for day in range(1,8):
            for days in ('Monday', 'Monday, Thursday', ['Sunday','Tuesday']):
                for weeks in (0,2):
                    for anchor in (None,'Thursday'):
                        for holidays in ([],self.holidays):
                            self.compare('build_module_session_plan', f'2028-01-{day:02}', 4, days,
                                         holidays, week_count=weeks, week_starts_on=anchor)

    def test_holidays_flag_sessions_without_changing_identity_dates_or_end(self):
        open_plan = self.compare('build_module_session_plan', '2028-01-03',4,'Monday, Thursday',[])
        closed = self.compare('build_module_session_plan', '2028-01-03',4,'Monday, Thursday',self.holidays)
        self.assertEqual([s['date'] for s in closed['sessions']], [s['date'] for s in open_plan['sessions']])
        self.assertEqual(closed['finalEndDate'], open_plan['finalEndDate'])
        self.assertEqual(closed['slots'][0]['cause'],'holiday')
        self.assertEqual(closed['slots'][0]['type'],'live-session')

    def test_invalid_core_inputs_preserve_warning_order_and_anchor_errors(self):
        result = self.compare('build_module_session_plan', None,0,'bad')
        self.assertEqual(len(result['warnings']),3)
        for value in ('bad', '', -3):
            self.compare('build_module_session_plan', '2028-01-03',value,'Monday')
        for old in (True,False):
            with original_session_plans() if old else ExitStack():
                with self.assertRaises(KeyError):
                    views.build_module_session_plan('2028-01-03',2,'Monday',week_starts_on='Funday')

    def test_count_and_week_orchestration_inherit_only_when_calendar_is_omitted(self):
        for name in ('module_session_plan_for_count','module_session_plan_for_weeks'):
            self.compare(name,self.module,2)
            self.assertEqual(len(self.events),1)
            self.compare(name,self.module,2,holidays=[])
            self.assertEqual(self.events,[])
            self.compare(name,self.module,2,holidays=self.holidays)
            for row,count in ((None,2),(self.module,0),(self.module,-1),({'start_date':'bad'},2)):
                result = self.compare(name,row,count)
                self.assertEqual(result['sessions'],[])
                self.assertEqual(self.events,[])

    def test_delivery_plan_projects_exact_sessions_and_default_clock(self):
        result = self.compare('module_delivery_session_plan',self.module,4,date(2028,1,3),self.holidays)
        self.assertEqual(self.compare('module_delivery_plan',self.module,4,date(2028,1,3),self.holidays),result['sessions'])
        self.assertEqual((result['sessions'][0]['startTime'],result['sessions'][0]['endTime'],result['sessions'][0]['durationMinutes']),('09:00','11:00',120))

    def test_weekly_compatibility_without_delivery_days_preserves_warnings_and_count(self):
        for days in ('','invalid'):
            result = self.compare('module_delivery_session_plan',dict(self.module,session_week_day=days),3,date(2028,1,3),self.holidays)
            self.assertEqual([s['date'] for s in result['sessions']],['2028-01-03','2028-01-10','2028-01-17'])
            self.assertEqual(len(result['warnings']),1 if days else 0)
        self.assertEqual(self.compare('module_delivery_session_plan',{},0,None,[])['sessions'],[])

    def test_module_specific_closures_do_not_mutate_shared_calendar_or_other_module(self):
        module = dict(self.module,session_holidays=json.dumps([{'id':'OWN','startDate':'2028-01-06'}]))
        result = self.compare('module_delivery_session_plan',module,4,date(2028,1,3),self.holidays)
        self.assertEqual(result['skippedHolidays'],['2028-01-03','2028-01-06'])
        other = self.compare('module_delivery_session_plan',self.module,4,date(2028,1,3),self.holidays)
        self.assertEqual(other['skippedHolidays'],['2028-01-03'])

    def test_custom_week_anchor_per_day_clocks_and_end_clipping(self):
        module = dict(self.module,schedule_mode='custom',week_starts_on='Thursday',start_date='2028-01-06',end_date='2028-01-18',weekly_schedule=[
            {'day':'Tuesday','startTime':'10:00','endTime':'11:00'}, {'day':'Thursday','startTime':'14:00','endTime':'16:00'}])
        result = self.compare('module_session_plan_for_weeks',module,4,holidays=[])
        self.assertEqual([s['date'] for s in result['sessions']],['2028-01-06','2028-01-11','2028-01-13','2028-01-18'])
        self.assertEqual([s['weekNumber'] for s in result['sessions']],[1,1,2,2])
        self.assertEqual([s['startTime'] for s in result['sessions']],['14:00','10:00','14:00','10:00'])
        self.assertEqual(self.compare('module_session_plan_for_weeks',dict(module,end_date='2028-01-01'),4,holidays=[])['sessions'],[])

    def test_overrides_keep_session_number_slot_link_and_original_date(self):
        override={'date':'2028-02-01','startTime':'12:00','endTime':'13:30','durationMinutes':90}
        module=dict(self.module,session_overrides=json.dumps({'2':override}))
        result=self.compare('module_session_plan_for_count',module,4,holidays=[])
        session=result['sessions'][1]
        self.assertEqual((session['sessionNumber'],session['date'],session['originalDate']),(2,'2028-02-01','2028-01-06'))
        self.assertEqual(result['slots'][1]['date'],session['date'])
        self.assertEqual(result['finalEndDate'],'2028-02-01')

    def test_calendar_error_sentinel_raises_before_planning_and_never_invents_dates(self):
        for old in (True,False):
            with original_session_plans() if old else ExitStack():
                with composition_fixture(views,'build_module_session_plan',side_effect=AssertionError('Must not plan')):
                    with self.assertRaisesRegex(country_calendars.CalendarUnavailable,'Unavailable'):
                        views.module_delivery_session_plan(self.module,4,date(2028,1,3),[{'_calendarError':'Unavailable'}])

    def test_module_policy_adapter_retains_lazy_call_and_error_propagation(self):
        module=dict(self.module,calendar_policy={'country':'US'})
        def policy(row,holidays):
            self.events.append(('policy',deepcopy(row),deepcopy(holidays)))
            return []
        with composition_fixture(delivery_calendar,'module_holidays',side_effect=policy):
            result=self.compare('module_delivery_session_plan',module,4,date(2028,1,3),self.holidays)
            self.assertEqual(result['skippedHolidays'],[])
            self.assertEqual(len(self.events),1)
        with composition_fixture(delivery_calendar,'module_holidays',side_effect=country_calendars.CalendarUnavailable('Missing country')):
            for old in (True,False):
                with original_session_plans() if old else ExitStack():
                    with self.assertRaisesRegex(country_calendars.CalendarUnavailable,'Missing country'):
                        views.module_delivery_session_plan(module,4,date(2028,1,3),[])

    def test_date_cache_preserves_set_identity_and_recomputes_on_changed_signature(self):
        for old in (True,False):
            with original_session_plans() if old else ExitStack():
                module=deepcopy(self.module)
                self.read.reset_mock()
                first=views.module_session_dates(module)
                self.assertIs(first,views.module_session_dates(module))
                self.read.assert_called_once()
                module['session_overrides']={'2':{'date':'2028-02-01','startTime':'09:00','endTime':'11:00','durationMinutes':120}}
                second=views.module_session_dates(module)
                self.assertIsNot(first,second)
                self.assertIn(date(2028,2,1),second)
                self.assertEqual(self.read.call_count,2)
        self.compare('module_session_dates',self.module,{})

    def test_date_cache_empty_inputs_and_new_counts_keep_return_type(self):
        for module in ({},dict(self.module,sessions_number=0),dict(self.module,start_date='bad')):
            self.assertEqual(self.compare('module_session_dates',module),set())
            self.assertEqual(self.events,[])
        for key,value in [('sessions_number',2),('start_date','2028-02-01'),('holidays',self.holidays),('session_week_day','Friday')]:
            module=deepcopy(self.module)
            views.module_session_dates(module)
            module[key]=value
            self.compare('module_session_dates',module)

    def test_boundary_mode_invalidates_the_existing_date_cache(self):
        module = deepcopy(self.module)
        # Exercise the cache contract; calendar planning has its own isolated suite.
        with composition_fixture(views, 'module_delivery_plan', return_value=[{'date': '2028-01-03'}]) as plan:
            first = views.module_session_dates(module)
            module['week_boundary_mode'] = 'calendar'
            second = views.module_session_dates(module)
            self.assertIsNot(first, second)
            self.assertIs(second, views.module_session_dates(module))
            self.assertEqual(plan.call_count, 2)
            self.assertEqual(second, {date(2028, 1, 3)})
        self.assertEqual(self.read.call_count, 2)
        self.assertEqual(module['_session_dates'][0][4], 'calendar')
