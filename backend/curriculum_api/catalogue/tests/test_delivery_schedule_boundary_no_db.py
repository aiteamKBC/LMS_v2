"""Delivery/display parity against frozen production bodies, synthetic data only."""
from curriculum_api.catalogue.tests.parity.composition_test_support import composition_fixture
from curriculum_api.catalogue.tests.parity.read_dependency_test_support import observe_export
from contextlib import ExitStack, contextmanager
from copy import deepcopy
import importlib
import json
from pathlib import Path
from types import FunctionType
from unittest.mock import Mock, patch

from django.test import RequestFactory, SimpleTestCase
from curriculum_api import views

SNAPSHOT = json.loads((Path(__file__).parents[2] / 'catalogue/tests/fixtures/legacy_snapshots/delivery_schedules_snapshot.json').read_text(encoding='utf-8'))


@contextmanager
def original_delivery_schedules():
    """Execute the original bodies with the same global bindings, not copies of rules."""
    with ExitStack() as stack:
        for name, entry in SNAPSHOT.items():
            if isinstance(getattr(views,name),Mock):
                continue
            namespace=dict(vars(views))
            exec(compile(entry['source'],'<original-delivery-schedules>','exec'),namespace)
            fn=namespace[name]
            restored=FunctionType(fn.__code__,vars(views),name,fn.__defaults__)
            restored.__kwdefaults__=fn.__kwdefaults__
            for decorator in reversed(entry['decorators']):
                restored=eval(decorator,vars(views))(restored)
            stack.enter_context(composition_fixture(views,name,restored))
        yield


class DeliveryScheduleParity(SimpleTestCase):
    def setUp(self):
        self.stack=ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch('requests.sessions.Session.request',side_effect=AssertionError('Network forbidden')))
        self.stack.enter_context(composition_fixture(views,'authoring_fetch_all',side_effect=AssertionError('Unexpected read')))
        self.stack.enter_context(composition_fixture(views,'authoring_session_links_by_catalogue',side_effect=AssertionError('Unexpected links read')))
        self.row={'module_catalogue_id':'M','group_id':'G','cohort_id':'C','programme_id':'P','title':'Synthetic',
                  'start_date':'2028-01-03','session_week_day':'Monday','sessions_number':4,'weeks_number':2,
                  'session_start_time':'09:00','session_end_time':'11:00'}
        self.group={'session_week_day':'Thursday','session_start_time':'14:00','session_end_time':'16:00'}
        self.weekly=[{'day':'Monday','startTime':'12:00','endTime':'13:00'}]
        self.factory=RequestFactory()

    def compare(self,name,*args,**kwargs):
        old_args,old_kwargs=deepcopy((args,kwargs))
        new_args,new_kwargs=deepcopy((args,kwargs))
        with original_delivery_schedules():
            expected=getattr(views,name)(*old_args,**old_kwargs)
        if name == 'module_schedule_view':
            expected = {**expected, 'week_boundary_mode': None}
        owner=importlib.import_module(SNAPSHOT[name]['module'])
        with observe_export(views, owner, name, wraps=getattr(owner, name)) as invoked:
            actual=getattr(views,name)(*new_args,**new_kwargs)
        invoked.assert_called_once()
        self.assertEqual(type(actual),type(expected))
        self.assertEqual(actual,expected)
        self.assertEqual((new_args,new_kwargs),(old_args,old_kwargs))
        return actual

    def compare_http(self,name,request,*args,owner=None):
        with original_delivery_schedules():
            expected=getattr(views,name)(request,*args)
        from curriculum_api.catalogue.application import delivery_schedules
        with patch.object(delivery_schedules,owner,wraps=getattr(delivery_schedules,owner)) if owner else ExitStack() as called:
            actual=getattr(views,name)(request,*args)
        if owner:
            called.assert_called_once()
        self.assertEqual((actual.status_code,actual.content),(expected.status_code,expected.content))
        return actual

    def test_parsers_keep_separators_empty_and_legacy_clock_formats(self):
        for text in ('',None,'Monday 09:00-11:00','Thu 9:30 AM-12:00 PM','Monday, Thursday',
                     'Monday 09:00\ufffd11:00','Monday 09:00\u201311:00','bad',17):
            self.compare('schedule_time_parts',text)
            self.compare('schedule_day_part',text)
        for clock in ('10:00','1000','10.00','9:30 AM','12 AM','12 PM','13 AM','24:00','9:60','bad',None,0):
            self.compare('parse_clock_minutes',clock)
        self.assertEqual(self.compare('parse_clock_minutes','12 AM'),0)
        self.assertEqual(self.compare('parse_clock_minutes','12 PM'),720)

    def test_clock_duration_wraps_midnight_but_invalid_or_nonpositive_is_empty(self):
        for start in ('23:30','09:00','bad',None):
            for duration in (90,'60',0,-1,'bad',None):
                self.compare('clock_time_plus_minutes',start,duration)
        self.assertEqual(self.compare('clock_time_plus_minutes','23:30',90),'01:00')

    def test_group_schedule_format_and_normalized_projection(self):
        for days in ('Monday',[' Monday ','',None,'Friday'],None):
            for start,end in (('09:00','11:00'),('09:00',''),('','')):
                self.compare('build_group_schedule',days,start,end,'fallback')
        for group in (None,{},self.group,{'schedule':'Thursday 14:00-16:00'}):
            self.compare('group_schedule_value',group)

    def test_group_custom_and_empty_slot_precedence_matrix(self):
        for mode in ('group','custom','',None):
            for group in (None,{},self.group,{'session_start_time':'14:00'},{'session_week_day':'Thursday'}):
                for weekly in ([],self.weekly):
                    module=dict(self.row,schedule_mode=mode,weekly_schedule=weekly)
                    result=self.compare('module_delivery_row',module,group)
                    self.assertEqual(module,dict(self.row,schedule_mode=mode,weekly_schedule=weekly))
                    if mode=='custom':
                        self.assertEqual(result,module)
        result=self.compare('module_delivery_row',dict(self.row,weekly_schedule=self.weekly),{'session_start_time':'14:00'})
        self.assertEqual(result['session_week_day'],'')
        self.assertIsNone(result['weekly_schedule'])

    def test_per_day_and_override_clocks_keep_group_and_custom_priorities(self):
        for mode in ('group','custom'):
            for group in (None,{},self.group,{'session_start_time':'14:00'}):
                for day in ('2028-01-03','2028-01-06',None):
                    self.compare('module_session_clock',dict(self.row,schedule_mode=mode,weekly_schedule=self.weekly),group,day)
        override={'1':{'date':'2028-01-03','startTime':'17:00','endTime':'18:30','durationMinutes':90}}
        result=self.compare('module_session_clock',dict(self.row,session_overrides=json.dumps(override)),self.group,'2028-01-03')
        self.assertEqual(result,('17:00','18:30',90))
        self.assertEqual(self.compare('module_session_clock',{'session_start_time':'23:00','session_end_time':'01:00'})[2],60)

    def test_live_display_clock_preserves_confirmation_flag_and_override_semantics(self):
        for row in ({},self.row,dict(self.row,schedule_mode='custom',weekly_schedule=self.weekly)):
            for confirmed in (True,False):
                for duration in (90,0,-2,None):
                    self.compare('module_live_session_clock',row,'20:00',duration,booked=confirmed,group_row=self.group,session_date='2028-01-03')
        result=self.compare('module_live_session_clock',self.row,'20:00',90,booked=True,group_row=self.group)
        self.assertEqual(result,('20:00','21:30',90))
        override={'1':{'date':'2028-01-03','startTime':'17:00','endTime':'18:30','durationMinutes':90}}
        self.assertEqual(self.compare('module_live_session_clock',dict(self.row,session_overrides=override),'20:00',60,booked=True,session_date='2028-01-03'),('17:00','18:30',90))

    def test_schedule_normalization_preserves_field_precedence_and_unassigned_tutor(self):
        for module in (None,{},self.row,{'catalogueId':' M ','tutorName':'Unassigned','sessions_number':None,'sessionsNumber':5,
                     'calendarPolicy':None,'calendar_policy':{'country':'US'},'weeklySchedule':self.weekly,'holidays':'invalid'},
                     {'title':' A ','moduleName':'B','startDate':'2028-01-03','selectedHolidays':[{'id':'H'}]}):
            for tutor in (None,'',' Tutor '):
                self.compare('module_schedule_view',module,tutor)
        result=self.compare('module_schedule_view',{'sessions_number':0,'sessionsNumber':5,'tutor':'Unassigned'})
        self.assertEqual((result['sessions_number'],result['tutor_name']),(0,''))

    def test_invalid_weekly_and_override_values_propagate_existing_errors(self):
        for row in ({'weekly_schedule':'bad'},{'session_overrides':'bad'},{'weekStartsOn':'Funday'}):
            outcomes=[]
            for old in (True,False):
                with original_delivery_schedules() if old else ExitStack():
                    try:
                        views.module_schedule_view(row)
                    except Exception as exc:
                        outcomes.append((type(exc),str(exc)))
            self.assertEqual(len(outcomes),2)
            self.assertEqual(outcomes[0],outcomes[1])

    def test_tutor_policy_does_not_silently_become_full_group_inheritance(self):
        for mode in ('group','custom'):
            for group in ({},self.group,{'session_start_time':'14:00'}):
                row=dict(self.row,schedule_mode=mode,weekly_schedule=self.weekly)
                result=self.compare('tutor_delivery_schedule',row,{'G':group})
                self.compare('module_delivery_day_gap',row,{'G':group})
                if group==self.group:
                    self.assertEqual(result['session_week_day'],'Monday')
        self.assertIs(views.tutor_delivery_schedule(self.row,{'G':self.group}),self.row)
        self.assertEqual(views.module_delivery_row(self.row,self.group)['session_week_day'],'Thursday')

    def test_group_reader_preserves_order_key_dedup_and_failure_fallback(self):
        rows=[{'group_id':' G ','schedule':'old'},{'group_id':'G','schedule':'new'},{'group_id':''}]
        with composition_fixture(views,'authoring_fetch_all',return_value=rows) as read:
            result=self.compare('safe_group_delivery_rows')
            self.assertEqual(result,{'G':rows[1]})
            for call in read.call_args_list:
                self.assertEqual(call.args,(views.GROUPS_TABLE,))
                self.assertEqual(call.kwargs,{'order_sql':views.GROUP_ROWS_ORDER})
        with composition_fixture(views,'authoring_fetch_all',side_effect=RuntimeError('Synthetic unavailable')):
            self.assertEqual(self.compare('safe_group_delivery_rows'),{})

    def test_gap_reads_groups_only_when_argument_is_omitted(self):
        with composition_fixture(views,'safe_group_delivery_rows',return_value={'G':{'session_start_time':'14:00'}}) as read:
            self.assertIsNone(self.compare('module_delivery_day_gap',self.row,{}))
            read.assert_not_called()
            self.assertEqual(self.compare('module_delivery_day_gap',self.row),{'session_start_time':'14:00'})
            self.assertEqual(read.call_count,2)

    def test_authored_calendar_keeps_component_identity_order_dates_and_holiday_flags(self):
        rows=[self.row,dict(self.row,module_catalogue_id='ARCHIVED',status='archived'),{'title':'No ID'}]
        links={'M':[{'date':'2028-01-06','componentId':'C2','weekId':'W2','weekTitle':'Second','title':'Session two'},
                    {'date':'2028-01-03','componentId':'C1','weekId':'W1','title':'First'}, {'date':'','componentId':'UNDATED'}]}
        holidays={'C':[{'startDate':'2028-01-03'}]}
        result=self.compare('build_sessions_from_authoring_modules',rows,holidays,{'G':self.group},session_links=links)
        self.assertEqual([s['componentId'] for s in result],['C2','C1'])
        self.assertEqual([s['date'] for s in result],['2028-01-06','2028-01-03'])
        self.assertEqual([s['skippedHolidays'] for s in result],[[],['2028-01-03']])
        self.assertEqual({s['startTime'] for s in result},{'14:00'})
        self.assertEqual(self.compare('build_sessions_from_authoring_modules',rows,session_links={}),[])

    def test_authored_link_reader_gets_module_and_holiday_context_but_not_clock_only_groups(self):
        with composition_fixture(views,'authoring_session_links_by_catalogue',return_value={}) as read:
            self.assertEqual(self.compare('build_sessions_from_authoring_modules',[self.row],{}, {'G':self.group}),[])
            for call in read.call_args_list:
                self.assertEqual(call.args,(['M'],))
                self.assertEqual(set(call.kwargs),{'modules_by_catalogue','holidays_by_cohort'})

    def test_session_list_orchestration_keeps_only_authored_source_and_context(self):
        with composition_fixture(views, 'authoring_session_links_by_catalogue', return_value={}) as links, \
                composition_fixture(views, 'build_sessions_from_authoring_modules', return_value=[{'id': 'authored'}]) as authored, \
                composition_fixture(views, 'cohort_selected_holidays_by_id', return_value={'C': []}):
            result = views.curriculum_sessions_from_rows({'modules': [], 'program_configs': []},
                [{'sessions_number': 99}], [self.row], [], [{'id': 'G', 'startTime': '09:00'}], [], list_only_summaries=True)
            self.assertEqual(result, [{'id': 'authored'}])
            self.assertEqual(authored.call_args.kwargs['session_links'], {})
            self.assertEqual(authored.call_args.kwargs['groups_by_id']['G']['session_start_time'], '09:00')
            self.assertEqual(links.call_args.kwargs['modules_by_catalogue'], {'M': self.row})

    def test_scoped_missing_module_is_empty_without_global_fallback(self):
        from curriculum_api import delivery_dashboard
        with composition_fixture(delivery_dashboard, 'build_calendar_snapshot', return_value={'sessions': []}) as read:
            self.assertEqual(views.module_scoped_sessions(' M '), [])
        read.assert_called_once_with(module_ids=['M'], visibility='operational')

    def test_scoped_visibility_uses_the_same_authored_source(self):
        from curriculum_api import delivery_dashboard
        for visibility in ('operational', 'all'):
            with composition_fixture(delivery_dashboard, 'build_calendar_snapshot', return_value={'sessions': [{'id': 'S'}]}) as read:
                self.assertEqual(views.module_scoped_sessions('M', visibility=visibility), [{'id': 'S'}])
            read.assert_called_once_with(module_ids=['M'], visibility=visibility)

    def test_preview_http_valid_payload_matrix_invokes_application(self):
        payload={'startDate':'2028-01-03','sessionsNumber':3,'weekDays':'Monday','startTime':'09:00','endTime':'11:00'}
        for extra in ({},{'endDate':'2028-01-31','weeksNumber':2},
                      {'scheduleMode':'custom','weekStartsOn':'Thursday','weeklySchedule':self.weekly+[{'day':'Thursday','startTime':'14:00','endTime':'16:00'}]}):
            request=self.factory.post('/preview/',data=json.dumps({**payload,**extra}),content_type='application/json')
            response=self.compare_http('curriculum_preview_module_session_plan',request,owner='preview_module_session_plan')
            self.assertEqual(response.status_code,200)

    def test_preview_http_validation_errors_do_not_enter_application(self):
        from curriculum_api.catalogue.application import delivery_schedules
        requests=[(self.factory.get('/preview/'),405),
                  (self.factory.post('/preview/',data='bad',content_type='application/json'),400),
                  (self.factory.post('/preview/',data={'weekStartsOn':'bad'},content_type='application/json'),400),
                  (self.factory.post('/preview/',data={'weeklySchedule':'bad'},content_type='application/json'),400)]
        with patch.object(delivery_schedules,'preview_module_session_plan',side_effect=AssertionError('Must validate first')):
            for request,status in requests:
                self.assertEqual(self.compare_http('curriculum_preview_module_session_plan',request).status_code,status)

    def test_stored_http_read_count_week_default_and_group_projection_parity(self):
        with composition_fixture(views,'resolve_stored_module_catalogue_id',return_value='M'), \
                composition_fixture(views,'authoring_fetch_all',return_value=[self.row]), \
                composition_fixture(views,'fetch_group_row',return_value=self.group), \
                composition_fixture(views,'module_cohort_selected_holidays',return_value=[]), \
                composition_fixture(views,'module_stored_week_count',return_value=2):
            for query in ({},{'weeks':'3'},{'sessions':'2'},{'sessions':'-1','weeks':'bad'}):
                response=self.compare_http('curriculum_module_session_plan',self.factory.get('/plan/',query),'alias',owner='load_module_session_plan')
                self.assertEqual(response.status_code,200)
                self.assertEqual(json.loads(response.content)['weekDays'],'Thursday')

    def test_stored_http_method_missing_and_read_failure_mapping(self):
        response=self.compare_http('curriculum_module_session_plan',self.factory.post('/plan/'),'M')
        self.assertEqual(response.status_code,405)
        with composition_fixture(views,'resolve_stored_module_catalogue_id',return_value=None):
            self.assertEqual(self.compare_http('curriculum_module_session_plan',self.factory.get('/plan/'),'M',owner='load_module_session_plan').status_code,404)
        with composition_fixture(views,'resolve_stored_module_catalogue_id',side_effect=RuntimeError('Synthetic read error')):
            self.assertEqual(self.compare_http('curriculum_module_session_plan',self.factory.get('/plan/'),'M',owner='load_module_session_plan').status_code,500)

    def test_final_serialization_errors_remain_outside_the_http_read_error_mapping(self):
        with composition_fixture(views,'resolve_stored_module_catalogue_id',return_value='M'), \
                composition_fixture(views,'authoring_fetch_all',return_value=[dict(self.row,group_id=None)]), \
                composition_fixture(views,'module_session_plan_for_count',return_value={'sessions':[]}), \
                composition_fixture(views,'module_stored_week_count',return_value=2), \
                composition_fixture(views,'format_date',side_effect=ValueError('Synthetic serialization error')):
            for old in (True,False):
                with original_delivery_schedules() if old else ExitStack():
                    with self.assertRaisesRegex(ValueError,'Synthetic serialization error'):
                        views.curriculum_module_session_plan(self.factory.get('/plan/',{'sessions':'1'}),'M')
