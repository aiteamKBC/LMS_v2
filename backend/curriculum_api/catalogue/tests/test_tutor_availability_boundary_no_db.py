"""Original-source conflict/preview parity and incomplete-read refusal tests."""
from curriculum_api.catalogue.tests.parity.composition_test_support import composition_fixture
from curriculum_api.catalogue.tests.parity.read_dependency_test_support import observe_export
from contextlib import ExitStack, contextmanager
from copy import deepcopy
from datetime import date
import importlib
import json
from pathlib import Path
from types import FunctionType
from unittest.mock import Mock, patch

from django.test import RequestFactory, SimpleTestCase
from curriculum_api import views
from curriculum_api.catalogue.application import tutor_availability
from curriculum_api.catalogue.infrastructure import tutor_reads

SNAPSHOT=json.loads((Path(__file__).parents[2]/'catalogue/tests/fixtures/legacy_snapshots/tutor_availability_snapshot.json').read_text(encoding='utf-8'))


@contextmanager
def original_tutor_availability():
    with ExitStack() as stack:
        for name,entry in SNAPSHOT.items():
            if isinstance(getattr(views,name),Mock):
                continue
            namespace=dict(vars(views))
            exec(compile(entry['source'],'<original-tutor-availability>','exec'),namespace)
            fn=namespace[name]
            restored=FunctionType(fn.__code__,vars(views),name,fn.__defaults__)
            restored.__kwdefaults__=fn.__kwdefaults__
            for decorator in reversed(entry['decorators']):
                restored=eval(decorator,vars(views))(restored)
            stack.enter_context(composition_fixture(views,name,restored))
        yield


class TutorAvailabilityParity(SimpleTestCase):
    def setUp(self):
        self.stack=ExitStack()
        self.addCleanup(self.stack.close)
        self.modules=[]
        self.groups={}
        self.directory=[{'Username':'Tutor Busy','Email':'busy@example.invalid','Access':'tutor'},
                        {'Username':'Tutor Free','Email':'free@example.invalid','Access':'tutor'}]
        self.row={'module_catalogue_id':'M','title':'Module','group_id':'G','cohort_id':'C','programme_id':'P',
                  'tutor_name':'Tutor Busy','start_date':'2028-01-03','sessions_number':2,
                  'session_week_day':'Monday','session_start_time':'09:00','session_end_time':'11:00'}
        self.payload={'startDate':'2028-01-03','sessionsNumber':2,'weekDays':'Monday','startTime':'09:00','endTime':'11:00'}
        self.stack.enter_context(patch('requests.sessions.Session.request',side_effect=AssertionError('Network forbidden')))
        self.stack.enter_context(composition_fixture(views,'safe_group_delivery_rows',side_effect=lambda:deepcopy(self.groups)))
        self.stack.enter_context(composition_fixture(views,'safe_authoring_module_rows',side_effect=lambda:deepcopy(self.modules)))
        self.stack.enter_context(composition_fixture(views,'module_schedule_holidays',return_value=[]))
        self.stack.enter_context(composition_fixture(views,'resolve_stored_module_catalogue_id',side_effect=lambda value: {'alias':'M','M':'M'}.get(value)))
        self.stack.enter_context(composition_fixture(views,'fetch_staff_users_by_access',side_effect=lambda role:deepcopy(self.directory)))
        def fetch(table,**kwargs):
            if table==views.AUTHORING_MODULES_TABLE:
                return deepcopy(self.modules)
            if table==views.GROUPS_TABLE:
                return [dict(row,group_id=key) for key,row in self.groups.items()]
            raise AssertionError('Unexpected table')
        self.read=self.stack.enter_context(composition_fixture(views,'authoring_fetch_all',side_effect=fetch))
        self.factory=RequestFactory()

    def compare(self,name,*args,**kwargs):
        old_args,old_kwargs=deepcopy((args,kwargs));new_args,new_kwargs=deepcopy((args,kwargs))
        with original_tutor_availability():
            expected=getattr(views,name)(*old_args,**old_kwargs)
        owner=importlib.import_module(SNAPSHOT[name]['module'])
        with observe_export(views, owner, name, wraps=getattr(owner, name)) as called:
            actual=getattr(views,name)(*new_args,**new_kwargs)
        called.assert_called_once()
        self.assertEqual(type(actual),type(expected))
        self.assertEqual(actual,expected)
        self.assertEqual((new_args,new_kwargs),(old_args,old_kwargs))
        return actual

    def preview(self,payload=None):
        return views.curriculum_preview_tutor_availability(self.factory.post('/preview/',data=payload or self.payload,content_type='application/json'))

    def compare_preview(self,payload):
        request=self.factory.post('/preview/',data=payload,content_type='application/json')
        with original_tutor_availability():
            expected=views.curriculum_preview_tutor_availability(request)
        with patch.object(tutor_availability,'preview_tutor_availability',wraps=tutor_availability.preview_tutor_availability) as called:
            actual=views.curriculum_preview_tutor_availability(request)
        called.assert_called_once()
        self.assertEqual((actual.status_code,actual.content),(expected.status_code,expected.content))
        return actual

    def test_clock_windows_preserve_invalid_and_inverted_fallbacks(self):
        for start in ('09:00','14:00','bad',''):
            for end in ('11:00','09:00','bad',''):
                self.compare('module_time_window',{'session_start_time':start,'session_end_time':end})
        self.assertEqual(self.compare('module_time_window',{'session_start_time':'14:00','session_end_time':'09:00'}),(840,900))

    def test_assignment_change_preserves_custom_only_fields_and_content_edits(self):
        for mode in ('group','custom'):
            before=dict(self.row,schedule_mode=mode)
            for key,value in [('title','Renamed'),('tutor_name','Tutor Free'),('weeks_number',3),('end_date','2028-02-01'),('week_starts_on','Thursday'),('calendar_policy',{'country':'US'}),('session_start_time','09:00 ')]:
                self.compare('module_schedule_assignment_changed',before,dict(before,**{key:value}))
        self.assertFalse(views.module_schedule_assignment_changed(self.row,dict(self.row,title='Renamed')))

    def test_date_overlap_back_to_back_per_day_and_explicit_override(self):
        right=dict(self.row,module_catalogue_id='OTHER')
        for clock in ('08:00','10:00','11:00','12:00'):
            self.compare('module_slot_clash_dates',self.row,dict(right,session_start_time=clock,session_end_time='13:00'))
        self.assertEqual(self.compare('module_slot_clash_dates',self.row,dict(right,session_start_time='11:00',session_end_time='13:00')),[])
        override={'1':{'date':'2028-01-04','startTime':'09:00','endTime':'11:00','durationMinutes':120}}
        shared=self.compare('module_slot_clash_dates',dict(self.row,session_overrides=override),right)
        self.assertEqual(shared,[date(2028,1,10)])

    def test_context_filters_archived_rows_and_reuses_calendar_memo(self):
        self.modules=[self.row,dict(self.row,module_catalogue_id='OTHER'),dict(self.row,module_catalogue_id='OLD',status='archived')]
        result=self.compare('tutor_conflict_context')
        self.assertEqual([r['module_catalogue_id'] for r in result['stored']],['M','OTHER'])
        self.assertIn('groups',result)
        self.assertIn('holidays',result)

    def test_unassigned_candidate_does_not_read_context(self):
        with composition_fixture(views,'tutor_conflict_context',side_effect=AssertionError('Unexpected context')):
            for name in ('','Unassigned',None):
                self.assertEqual(self.compare('find_tutor_schedule_conflicts',dict(self.row,tutor_name=name)),[])

    def test_pending_exclusions_dedup_normalized_identity_and_order(self):
        self.modules=[dict(self.row,module_catalogue_id='B',title='Beta'),dict(self.row,module_catalogue_id='A',title='Alpha'),dict(self.row,module_catalogue_id='M')]
        result=self.compare('find_tutor_schedule_conflicts',self.row,exclude_catalogue_ids=[' B ','B',''],pending=[dict(self.row,module_catalogue_id='B',title='Pending',tutor_name='Tutor  Busy.')])
        self.assertEqual([r['moduleName'] for r in result],['Alpha','Pending'])
        self.assertEqual(len(result),2)
        self.assertEqual(result[0]['dates'],['2028-01-03','2028-01-10'])

    def test_conflicts_group_dates_by_actual_clock_and_sort(self):
        override={'2':{'date':'2028-01-10','startTime':'10:00','endTime':'12:00','durationMinutes':120}}
        self.modules=[dict(self.row,module_catalogue_id='OTHER',session_overrides=override)]
        result=self.compare('find_tutor_schedule_conflicts',self.row)
        self.assertEqual([(r['startTime'],r['dates']) for r in result],[('09:00',['2028-01-03']),('10:00',['2028-01-10'])])

    def test_dayless_and_custom_group_policies_remain_distinct(self):
        self.groups={'G':{'session_start_time':'09:00','session_end_time':'11:00'}}
        candidate=dict(self.row,start_date='2028-01-04')
        self.modules=[dict(candidate,module_catalogue_id='OTHER')]
        # Clearing the group day currently reaches the existing weekly-from-start
        # planner fallback. It does NOT prove no clashes. Preserve the original
        # shared writer guard rather than changing its policy in an extraction.
        result=self.compare('find_tutor_schedule_conflicts',candidate)
        self.assertEqual(result[0]['dates'],['2028-01-04','2028-01-11'])
        self.modules=[dict(self.modules[0],schedule_mode='custom')]
        result=self.compare('find_tutor_schedule_conflicts',dict(candidate,schedule_mode='custom'))
        self.assertEqual(result[0]['dates'],['2028-01-10','2028-01-17'])

    def test_created_conflicts_subtract_only_inherited_dates_and_keep_group(self):
        self.modules=[dict(self.row,module_catalogue_id='OTHER',sessions_number=3)]
        before=dict(self.row,sessions_number=2)
        candidate=dict(self.row,sessions_number=3,group_id='')
        result=self.compare('tutor_schedule_conflicts_created',before,candidate)
        self.assertEqual(result[0]['dates'],['2028-01-17'])
        self.assertEqual(self.compare('tutor_schedule_conflicts_created',before,dict(before,title='Renamed')),[])

    def test_batch_guard_keeps_non_enforced_candidates_for_later_checks(self):
        first=dict(self.row,module_catalogue_id='FIRST',enforce=False)
        second=dict(self.row,module_catalogue_id='SECOND')
        candidate,conflicts=self.compare('first_tutor_schedule_conflict',[None,first,second],[])
        self.assertEqual(candidate['module_catalogue_id'],'SECOND')
        self.assertEqual(conflicts[0]['moduleCatalogueId'],'FIRST')
        self.assertEqual(self.compare('first_tutor_schedule_conflict',[],[]),(None,[]))

    def test_group_assignment_uses_all_members_and_existing_enforcement_flags(self):
        self.modules=[dict(self.row,tutor_name='Tutor Free'),dict(self.row,module_catalogue_id='OTHER',group_id='OTHER-GROUP')]
        candidate,conflicts=self.compare('group_tutor_assignment_conflict',' G ','Tutor Busy')
        self.assertEqual(candidate['module_catalogue_id'],'M')
        self.assertEqual(conflicts[0]['moduleCatalogueId'],'OTHER')

    def test_conflict_message_preserves_first_date_missing_date_and_extra_count(self):
        conflict={'moduleName':'Other','startTime':'09:00','endTime':'11:00','dates':['2028-01-03']}
        for rows in ([conflict],[conflict,conflict],[dict(conflict,dates=[])]):
            self.compare('tutor_conflict_message',self.row,rows)

    def test_successful_preview_single_roster_alias_stored_slot_and_edited_slot_parity(self):
        self.modules=[self.row,dict(self.row,module_catalogue_id='OTHER',tutor_name='Former Tutor')]
        for payload in (self.payload,{**self.payload,'tutor':'Tutor Busy'}, {'moduleCatalogueId':'alias'},
                        {**self.payload,'moduleId':'M','startTime':'13:00','endTime':'15:00'},
                        {**self.payload,'tutor':'Unassigned'},{**self.payload,'sessionsNumber':0}):
            self.assertEqual(self.compare_preview(payload).status_code,200)

    def test_missing_module_and_input_errors_remain_distinct(self):
        self.assertEqual(self.compare_preview({'moduleCatalogueId':'missing'}).status_code,404)
        with patch.object(tutor_availability,'preview_tutor_availability',side_effect=AssertionError('Must validate first')):
            for request,status in ((self.factory.get('/preview/'),405),
                    (self.factory.post('/preview/',data='bad',content_type='application/json'),400),
                    (self.factory.post('/preview/',data={'weekStartsOn':'bad'},content_type='application/json'),400),
                    (self.factory.post('/preview/',data={'weeklySchedule':'bad'},content_type='application/json'),400)):
                self.assertEqual(views.curriculum_preview_tutor_availability(request).status_code,status)

    def test_preview_module_and_group_read_failures_never_emit_availability(self):
        for table in (views.AUTHORING_MODULES_TABLE,views.GROUPS_TABLE):
            def fetch(current,**kwargs):
                if current==table:
                    raise RuntimeError('Synthetic confidential diagnostic')
                return []
            with composition_fixture(views,'authoring_fetch_all',side_effect=fetch):
                response=self.preview()
            self.assertEqual(response.status_code,503)
            body=json.loads(response.content)
            self.assertEqual(set(body),{'error'})
            self.assertNotIn('confidential',body['error'])

    def test_directory_read_failure_and_absent_alias_never_emit_partial_roster(self):
        with composition_fixture(views,'fetch_staff_users_by_access',side_effect=RuntimeError('Synthetic unavailable')):
            self.assertEqual(self.preview().status_code,503)
        with self.assertRaises(tutor_availability.TutorAvailabilityUnavailable):
            tutor_reads.read_tutor_rows(fetch_staff_users_by_access=Mock(side_effect=AssertionError('Must not connect')),
                staff_user_profile_source=Mock(),staff_profile_is_archived=Mock(),enrolment_available=False)

    def test_empty_successful_reads_remain_valid_and_provisioning_is_disabled(self):
        self.directory=[]
        response=self.preview()
        self.assertEqual(response.status_code,200)
        self.assertEqual(json.loads(response.content)['results'],[])
        self.assertEqual(len(self.read.call_args_list),2)
        for call in self.read.call_args_list:
            self.assertIs(call.kwargs['ensure_tables'],False)
        self.assertEqual(self.read.call_args_list[1].kwargs['order_sql'],views.GROUP_ROWS_ORDER)

    def test_strict_directory_projection_keeps_existing_archive_filter(self):
        self.directory.append({'Username':'Archived','Access':'tutor',' Status':'archived'})
        expected=views.get_tutor_rows()
        actual=tutor_reads.read_tutor_rows(fetch_staff_users_by_access=views.fetch_staff_users_by_access,
            staff_user_profile_source=views.staff_user_profile_source,staff_profile_is_archived=views.staff_profile_is_archived,enrolment_available=True)
        self.assertEqual(actual,expected)
        self.assertNotIn('Archived',[row['name'] for row in actual])

    def test_existing_staffing_writer_refuses_same_conflict_before_mutation(self):
        self.modules=[dict(self.row,tutor_name='Tutor Free'),dict(self.row,module_catalogue_id='OTHER',group_id='OTHER-GROUP')]
        with composition_fixture(views,'with_group_coaches',side_effect=lambda p:p), \
                composition_fixture(views,'resolve_group_row',return_value={'group_id':'G'}), \
                composition_fixture(views,'canonical_staff_assignment_name',side_effect=lambda role,name:name), \
                composition_fixture(views,'group_tutor_assignment_delivery_day_error',return_value=None), \
                composition_fixture(views,'update_group_fields',side_effect=AssertionError('Must refuse before write')) as write:
            with original_tutor_availability():
                expected=views.update_staffing_assignment('G',{'tutor':'Tutor Busy'})
            actual=views.update_staffing_assignment('G',{'tutor':'Tutor Busy'})
        self.assertEqual((actual.status_code,actual.content),(expected.status_code,expected.content))
        self.assertEqual(actual.status_code,409)
        write.assert_not_called()
