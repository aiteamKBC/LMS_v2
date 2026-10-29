"""New weeks extend one owned import without rewriting its old catalogue."""
from copy import deepcopy
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase
from .imported_course_continuation import continuation_components, continuation_cutoffs
from .tests_my_learning_no_db import component, fake_connections, metadata, native


def schedule(day, source='builder_week', **values):
    return dict(date=day,date_source=source,**values)


class ImportedContinuationRulesTests(SimpleTestCase):
    def fixture(self):
        meta=metadata()
        meta['imported_courses']={'current:M1':'legacy:50'}
        owned={'legacy:50':[dict(date='2026-10-14',date_source='section_title',completed=True)]}
        rows=[component('COPY'),component('NEW21'),component('NEW28'),component('FOREIGN','M2')]
        dates={'COPY':schedule('2026-10-14'),'NEW21':schedule('2026-10-21'),
               'NEW28':schedule('2026-10-28'),'FOREIGN':schedule('2026-10-28')}
        return meta,owned,rows,dates

    def test_only_new_teaching_dates_on_exact_owned_import_are_added(self):
        args=self.fixture()
        before=deepcopy(args)
        result=continuation_components(*args)
        self.assertEqual(result,{'current:M1':{'courseRef':'legacy:50','afterDate':'2026-10-14',
                                             'componentIds':['NEW21','NEW28']}})
        self.assertEqual(args,before)

    def test_no_title_matching_unowned_ambiguous_or_replacement_course(self):
        for mode in ('unowned','ambiguous','replacement','no_dates'):
            meta,owned,rows,dates=self.fixture()
            if mode=='unowned': owned={}
            if mode=='ambiguous': meta['imported_courses']['current:M2']='legacy:50'
            if mode=='replacement': meta['replacement_courses']=meta.pop('imported_courses')
            if mode=='no_dates': owned['legacy:50'][0]['date_source']='original_created_at'
            self.assertEqual(continuation_components(meta,owned,rows,dates),{},mode)

    def test_transfer_snapshots_keep_the_existing_approval_boundary(self):
        for status in ('pending','approved'):
            meta,owned,rows,dates=self.fixture()
            meta['progress_transfers']=[{'courseRef':'legacy:50','status':status}]
            self.assertEqual(continuation_components(meta,owned,rows,dates),{})

    def test_invalid_upload_and_review_dates_cannot_make_current_weeks(self):
        for placement in (schedule('2026-10-28','original_created_at'),schedule('2026-10-28','source_date'),
                          schedule('2026-10-28',date_needs_review=True),schedule('2026-02-30')):
            meta,owned,rows,dates=self.fixture()
            dates['NEW28']=placement
            self.assertNotIn('NEW28',continuation_components(meta,owned,rows,dates)['current:M1']['componentIds'])


class ImportedContinuationModuleTests(SimpleTestCase):
    def test_catalogue_counts_new_weeks_once_without_completing_them(self):
        from . import tests_my_learning_no_db as aggregate
        meta=metadata()
        meta['imported_courses']={'current:M1':'legacy:50'}
        meta['activity_dates']={'COPY':schedule('2026-10-14'),'NEW21':schedule('2026-10-21'),'NEW28':schedule('2026-10-28')}
        definitions=[dict(source_course_ref='50',source_activity_id='material:1',source_activity_title='Original 14/10/2026',
            source_section_title='Teaching week 14/10/2026',source_payload={},position=1)]
        cards,_=aggregate.MyLearningAggregateTests().cards(
            native([component('COPY'),component('NEW21'),component('NEW28')]),
            courses=[dict(id=3,source_course_ref='50',source_course_title='Old',curriculum_module_ref='M1')],
            definitions=definitions,done={('50','material:1')},meta=meta)
        self.assertEqual(len(cards),1)
        self.assertEqual(cards[0]['id'],'legacy:50')
        self.assertEqual(cards[0]['activityCount'],3)
        self.assertEqual(cards[0]['completedActivityCount'],1)

    def test_activity_search_finds_added_material_under_the_original_course(self):
        from . import tests_my_learning_no_db as aggregate
        meta=metadata()
        meta['imported_courses']={'current:M1':'legacy:50'}
        meta['activity_dates']={'NEW28':schedule('2026-10-28')}
        definitions=[dict(source_course_ref='50',source_activity_id='material:1',source_activity_title='Original 14/10/2026',
            source_section_title='Teaching week 14/10/2026',source_payload={},position=1)]
        from . import my_learning as learning
        cards,_=learning.assemble_cards(native([component('NEW28')]),meta['current_subjects'],
            [dict(id=3,source_course_ref='50',source_course_title='Old',curriculum_module_ref='M1')],definitions,
            set(),set(),__import__('collections').defaultdict(float),meta,[],{},[],search='new28')
        self.assertEqual(cards,[{'id':'legacy:50','_matches':True}])

    def test_owned_old_route_reads_only_added_weeks_for_both_learner_types(self):
        from . import (my_learning as learning, canonical_learning as canonical,weekly_learning,
            dashboard_training,training_plan_dashboard,live_session_progress,teams_attendance,
            builder_activity_dates,subject_store)
        for kind in ('commercial','apprenticeship'):
            source=SimpleNamespace(pk=7,id=7,email='learner@example.test',programme='Programme',cohort='',group='',
                training_plan=[],learning_plan=[],_case_file_profile=SimpleNamespace(pk=9))
            meta=metadata()
            meta.update(imported_courses={'current:M1':'legacy:50'},progress_transfers=[])
            old={'id':3,'source_course_ref':'50','source_course_title':'Old','curriculum_module_ref':'M1'}
            historical={'activities':[dict(activity_id='catalogue:50:quiz:1',group_id=50,completed=True,
                date='2026-10-14',date_source='title')],'subjects':[{'id':50,'name':'Old'}]}
            context=([{'moduleId':'M1'}],['M1'],[],native(),[old],[],set(),set(),{},meta,[])
            content=native([component('NEW28',weekId='W-new',sessionDate='2026-10-28')],id='7',week=[])
            dates={'OLD':schedule('2026-10-14'),'NEW28':schedule('2026-10-28')}
            connections=fake_connections()
            connections['enrolment'].cursor.return_value.__enter__.return_value.fetchall.return_value=[('W-new',)]
            before=deepcopy(historical)
            with ExitStack() as stack:
                stack.enter_context(patch.object(learning,'load_context',return_value=context))
                stack.enter_context(patch.object(learning,'connections',connections))
                reader=stack.enter_context(patch.object(weekly_learning,'build_learning_content_summary',return_value=deepcopy(content)))
                stack.enter_context(patch.object(canonical,'source_subjects',return_value=historical))
                stack.enter_context(patch.object(dashboard_training,'module_rows',return_value={'M1':{'id':'M1'}}))
                stack.enter_context(patch.object(training_plan_dashboard,'plan_sessions',return_value=[]))
                stack.enter_context(patch.object(live_session_progress,'read_live_credits',return_value=[]))
                stack.enter_context(patch.object(teams_attendance,'annotate_attendance_completion',side_effect=lambda rows,*args:rows))
                stack.enter_context(patch.object(builder_activity_dates,'read_builder_activity_dates',return_value=dates))
                stack.enter_context(patch.object(subject_store,'covers_for',return_value={}))
                result=learning.read_module(source,kind,{'id':9,'name':'Synthetic'},'legacy:50')
            self.assertEqual(result['subjectId'],'legacy:50')
            self.assertEqual(result['activity']['activities'],before['activities'])
            self.assertEqual(result['activity']['subjects'],before['subjects'])
            self.assertEqual(reader.call_args.kwargs['assigned_modules'],[{'moduleId':'M1'}])
            self.assertEqual(reader.call_args.kwargs['week_ids'],['W-new'])
            self.assertEqual(result['metadata']['imported_continuations']['current:M1']['componentIds'],['NEW28'])
            self.assertEqual(source.training_plan,[])
