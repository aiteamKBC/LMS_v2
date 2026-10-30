"""My Learning contracts, aggregates and ownership, with all I/O mocked.

Run with SQLite-only settings and BaseDatabaseWrapper.ensure_connection denied.
"""
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, patch
from contextlib import ExitStack
import json

from django.test import SimpleTestCase, RequestFactory
from old_otjh.service import ServiceError
from . import my_learning as learning
from . import canonical_learning as canonical


def component(ident='C1', module='M1', **values):
    row = dict(componentId=ident, moduleId=module, module='One' if module=='M1' else 'Two', component=ident, type='reading', week='Week 1')
    row.update(values)
    return row


def native(components=None, **values):
    return dict(modules=['One'],components=components or [],retiredQuizComponents=[],
                quizAttempts=[],videoProgress=[],componentProgress=[],**values)


def metadata():
    return dict(covers={},builder_subjects={},current_subjects=[{'id':'M1','title':'One'}],
        imported_courses={},replacement_courses={},previous_learning_groups={},
        replacement_settings={},record_ids={},activity_dates={})


def fake_connections():
    connection=MagicMock()
    return {'enrolment':connection}


class MyLearningAggregateTests(SimpleTestCase):
    def test_next_title_uses_the_whole_delivery_week_not_an_individual_material_date(self):
        def item(title, when, placement, completed=False):
            return {'title': title, 'completed': completed, 'position': 1,
                    'schedule': {'date': when, 'month': when[:7], 'delivery_week': placement}}
        previous = {'module_id': 'M1', 'id': 'W4', 'start': '2026-10-23', 'end': '2026-10-29', 'month': '2026-10'}
        current = {'module_id': 'M1', 'id': 'W5', 'start': '2026-10-30', 'end': '2026-11-05', 'month': '2026-10'}
        items = [item('Previous unfinished reading', '2026-10-23', previous),
                 item('Current live', '2026-10-30', current, True),
                 item('Current reading', '2026-11-02', current)]
        self.assertEqual(learning.next_title(items, '2026-10-30'), 'Current reading')
    def test_undated_execution_month_matches_detail_and_next_activity_preview(self):
        from .course_catalogue_display import catalogue_display_context, display_schedule
        course = {'id': 3, 'source_course_ref': '50', 'source_course_title': 'Old'}
        definitions = [{'source_course_ref': '50', 'source_course_title': 'Old',
            'source_activity_id': f'material:{ident}', 'source_activity_title': title,
            'source_section_title': section, 'source_payload': {}}
            for ident, title, section in [(7, 'Undated lesson', ''), (8, 'June lesson', 'June 2026')]]
        record = {'id': 1, 'accepted': False, 'actual_seconds': 0, 'activity_status': 'in_progress',
            'reporting_month': '2026-03', 'sources': [{'source_system': 'old_lms',
                'source_course_ref': '50', 'source_activity_id': 'material:7'}]}
        with patch.object(canonical, 'query', return_value=definitions):
            rows, done, started, hours, _ = learning.course_facts({'id': 9}, [record], [course])
        self.assertNotIn('_learner_schedule', definitions[0])
        projected = catalogue_display_context(rows, [])
        self.assertEqual(display_schedule(projected[0])['month'], '2026-03')
        detail = canonical.recorded_course_items([course], projected, [record], include_catalogue=True)[0]
        self.assertEqual(detail[0]['month'], '2026-03')
        self.assertEqual(detail[1]['month'], '2026-06')
        cards, _ = self.cards(native(), [course], rows, done, started, hours, records=[record])
        card = next(card for card in cards if card['source'] == 'legacy')
        self.assertEqual(card['nextTitle'], 'Undated lesson')
        self.assertEqual(card['completedActivityCount'], 0)
        self.assertEqual(card['activityCount'], 2)

    def cards(self, content, courses=(), definitions=(), done=None, started=None, hours=None, meta=None, records=()):
        from . import course_catalogue_display
        meta = meta or metadata()
        with patch.object(course_catalogue_display,'read_export_placements',return_value=[]):
            return learning.assemble_cards(content,meta['current_subjects'],list(courses),list(definitions),
                done or set(),started or set(),hours or __import__('collections').defaultdict(float),
                meta,list(records),{'M1':{'id':'M1','title':'One','total_otjh':10,'educational_session_count':2}},[])

    def test_quiz_pass_component_ownership_attendance_and_retained_completion(self):
        content=native([component(), component('Q1',isQuiz=True,quizMeta={'quizId':1}),
            component('Q2',isQuiz=True,quizMeta={'quizId':1}),component('L1',type='live_session',attendanceCompleted=True)])
        content['quizAttempts']=[{'componentId':'Q2','quizId':1,'passed':True},{'componentId':'Q2','quizId':1,'passed':False}]
        content['componentProgress']=[{'componentId':'C1','kind':'component','passed':None}]
        content['retiredQuizComponents']=[component('OLD',isQuiz=True,quizMeta={'quizId':99})]
        content['quizAttempts'].append({'componentId':'OLD','quizId':99,'passed':True})
        cards,summary=self.cards(content)
        self.assertEqual(summary['current'],{'subjects':1,'completed':4,'total':5,'percent':80})
        self.assertEqual(cards[0]['status'],'In progress')
        self.assertEqual(cards[0]['nextTitle'],'Q1')
        self.assertNotIn('activities',cards[0])
        self.assertNotIn('quizAttempts',cards[0])

    def test_current_previous_counts_and_grouping_are_separate(self):
        courses=[{'id':3,'source_course_ref':'50','source_course_title':'Old','curriculum_module_ref':'M1'}]
        definitions=[{'source_course_ref':'50','source_activity_id':kind+':7','source_activity_title':kind,
            'source_course_title':'Old','source_activity_type':kind} for kind in ('material','quiz')]
        meta=metadata();meta['previous_learning_groups']={'legacy:50':'current:M1'}
        cards,summary=self.cards(native([component()]),courses,definitions,{('50','material:7')},meta=meta)
        self.assertEqual(summary['current']['total'],1)
        self.assertEqual(summary['previous'],{'subjects':1,'completed':1,'total':2,'percent':50})
        self.assertEqual(summary['subjectCount'],1)
        self.assertEqual(next(c for c in cards if c['source']=='legacy')['previousLearningFor'],'current:M1')

    def test_import_suppresses_only_exact_owned_native_alias(self):
        meta=metadata();meta['imported_courses']={'current:M1':'legacy:50'}
        cards,summary=self.cards(native([component()]),meta=meta)
        self.assertEqual(summary['current']['total'],1) # unowned provenance grants nothing
        course={'id':3,'source_course_ref':'50','source_course_title':'Old'}
        cards,summary=self.cards(native([component()]),[course],meta=meta)
        self.assertEqual(summary['current']['total'],0)
        self.assertEqual([c['id'] for c in cards],['legacy:50'])
        self.assertIsNone(cards[0]['planModule'])

    def test_verified_replacement_keeps_old_catalogue_until_transfer_approval(self):
        meta=metadata();meta['replacement_courses']={'current:M1':'legacy:50'}
        meta['replacement_settings']={'C1':{'legacySettings':{'sourceLessonId':7,'sourceMaterialKey':'reading-7'}}}
        meta['record_ids']={('50','material:7'):{'1'}}
        course={'id':3,'source_course_ref':'50','source_course_title':'Old'}
        definitions=[{'source_course_ref':'50','source_activity_id':'material:7','source_activity_title':'Old reading','source_course_title':'Old'}]
        record={'id':1,'accepted':True,'actual_seconds':3600,'ksbs':[],'module_ref':'50'}
        cards,summary=self.cards(native([component()]),[course],definitions,{('50','material:7')},hours={'50':1},meta=meta,records=[record])
        self.assertEqual(summary['current']['completed'],0)
        self.assertEqual(summary['previous']['total'],1)
        self.assertEqual(summary['previous']['completed'],1)
        self.assertEqual(cards[0]['id'],'legacy:50')
        self.assertNotIn('replacementCourseRef',cards[0])
        self.assertEqual(cards[0]['actualHours'],1)
        self.assertFalse(cards[0]['finalTestPassed'])

    def test_final_quiz_ignores_old_component_completion_hints(self):
        content=native([component('Q1',isQuiz=True,quizMeta={'quizId':1},previousLearning={'completed':True})])
        content['components'][0]['component']='Final test'
        cards,_=self.cards(content)
        self.assertEqual(cards[0]['completedActivityCount'],0)
        self.assertFalse(cards[0]['finalTestPassed'])

    def test_global_dedupe_and_empty_subjects(self):
        meta=metadata();meta['current_subjects'].append({'id':'M2','title':'Two'})
        content=native([component(),component(module='M2')])
        cards,summary=self.cards(content,meta=meta)
        self.assertEqual(summary['current']['total'],1)
        self.assertEqual(summary['current']['subjects'],2)

    def test_course_facts_preserve_verified_exclusions_and_typed_identity(self):
        course={'id':3,'source_course_ref':'50','verified_catalogue_scope':{'version':1,
            'basis':'verified-legacy-account-inventory','course_ref':'50','excluded_activity_refs':['material:8']}}
        definitions=[{'source_course_ref':'50','source_activity_id':ref,'source_activity_title':ref} for ref in ('material:7','quiz:7','material:8')]
        record={'id':1,'accepted':True,'actual_seconds':3600,'sources':[
            {'source_system':'old_lms','source_course_ref':'50','source_activity_id':'material:7'},
            {'source_system':'old_lms','source_course_ref':'50','source_activity_id':'quiz:7'}]}
        with patch.object(canonical,'query',return_value=definitions) as query:
            rows,done,started,hours,ids=learning.course_facts({'id':9},[record],[course])
        self.assertEqual(len(rows),2)
        self.assertEqual(done,{('50','material:7'),('50','quiz:7')})
        self.assertEqual(hours['50'],1)
        self.assertEqual(ids[('50','material:7')],{'1'})
        self.assertIn('a.source_course_id=ANY(%s)',query.call_args.args[0])
        self.assertNotIn('source_payload AS',query.call_args.args[0])


class MyLearningIdentityProjectionTests(SimpleTestCase):
    def test_my_learning_progress_excludes_deleted_evidence(self):
        from .weekly_learning import _progress
        profile=MagicMock()
        profile.progress_entries.filter.return_value.exclude.return_value.values_list.return_value=[]
        self.assertEqual(_progress(profile,active_only=True),([],[],[]))
        profile.progress_entries.filter.assert_called_once_with(deleted_at__isnull=True)

    def test_catalogue_facts_keep_live_types_and_mixed_idless_plan_without_lesson_bodies(self):
        from . import learner_detail
        cursor=MagicMock()
        cursor.fetchall.return_value=[('L1','W1','M1','live_session','Live','',
            {'sessionDate':'2026-10-25','sessionDateTimeUtc':'2026-10-25T10:00:00Z','teamsLiveSessionId':'S1'},None,0,None,False,None,False)]
        connection=MagicMock();connection.cursor.return_value.__enter__.return_value=cursor
        existing=[{'module':'Old CSV','week':'Legacy week','component':'Legacy lesson'}]
        legacy_weeks=[{'module':'Old CSV','week':'Legacy week'}]
        resolved={'module_titles':{'M1':'One'},'weeks':[('W1','M1','Week 1',1,0)],'quiz_links':{}}
        with patch.object(learner_detail,'connections',{'enrolment':connection}):
            titles,weeks,rows=learner_detail._resolve_from_master(['Old CSV'],legacy_weeks,existing,
                assigned_modules=[{'moduleId':'M1'}],compact=True,identities_only=True,catalogue_facts=True,
                resolved_metadata=resolved,live_session_ids=False,strict=True)
        self.assertEqual(titles,['One','Old CSV'])
        self.assertEqual(rows[0]['type'],'live_session')
        self.assertEqual(rows[0]['teamsLiveSessionId'],'S1')
        self.assertEqual(rows[-1]['component'],'Legacy lesson')
        sql=cursor.execute.call_args.args[0]
        self.assertIn("'extraTeamsLiveSessionId'",sql)
        self.assertNotIn('ksb_descriptions',sql)
        self.assertEqual(cursor.execute.call_count,1)

    def test_request_context_reuses_metadata_and_never_reads_unrelated_course_rows_for_detail(self):
        from . import models, weekly_learning, dashboard_training, teams_attendance, live_session_progress, subject_origins, previous_learning_groups, builder_activity_dates, student_activity
        for selected, personal in ((None, False), ('current:M1', False), (None, True)):
            source=SimpleNamespace(pk=7,id=7,aptem_id=7,programme='Programme',cohort='',group='')
            profile=SimpleNamespace(pk=9,enrolment_id=7)
            manager=MagicMock();manager.only.return_value.filter.return_value.first.return_value=profile
            content=native([component()])
            def modules(cur,ids,**kwargs):
                kwargs['identity_metadata'].update(module_titles={'M1':'One'},weeks=[],covers={},imported_courses={},live_credit_components=[])
                return {'M1':{'id':'M1','title':'One'}}
            with ExitStack() as stack:
                stack.enter_context(patch.object(models.LearnerProfile,'objects',manager))
                stack.enter_context(patch.object(learning,'connections',fake_connections()))
                stack.enter_context(patch.object(learning,'effective_training_plan',return_value=[{'moduleId':'M1'}]))
                read=stack.enter_context(patch.object(weekly_learning,'build_learning_content_summary',return_value=content))
                entries=stack.enter_context(patch.object(canonical,'entries_for',return_value=[]))
                stack.enter_context(patch.object(canonical,'owned_source_courses',return_value=[{'id':3,'source_course_ref':'50'}]))
                query=stack.enter_context(patch.object(canonical,'query',return_value=[]))
                module_read=stack.enter_context(patch.object(learning,'catalogue_module_rows',side_effect=modules))
                builder=stack.enter_context(patch.object(student_activity,'_builder_subject_metadata',return_value=({}, {'current:M1':{'id':'M1','title':'One'}})))
                stack.enter_context(patch.object(teams_attendance,'annotate_attendance_completion',side_effect=lambda rows,*args:rows))
                credits=stack.enter_context(patch.object(live_session_progress,'read_live_credits',return_value=[]))
                dates=stack.enter_context(patch.object(builder_activity_dates,'read_builder_activity_dates',return_value={}))
                import_read=stack.enter_context(patch.object(subject_origins,'read_imported_courses',return_value={}))
                replacements=stack.enter_context(patch.object(subject_origins,'read_replacement_courses',return_value={}))
                stack.enter_context(patch.object(previous_learning_groups,'read_previous_learning_groups',return_value={}))
                learning.load_context(source,{'id':9},selected,
                    **({'include_personal_replacements': True} if personal else {}))
            self.assertEqual(replacements.call_args.kwargs, {'include_personal': True} if personal else {})
            entries.assert_called_once_with({'id':9},lineage_only=True,monthly_summary=True,**({'catalogue_summary':True} if selected is None else {'dashboard_metadata':True}))
            self.assertEqual(read.call_args.kwargs['assigned_modules'],[{'moduleId':'M1'}])
            if selected is None:
                module_read.assert_called_once();builder.assert_not_called()
                import_read.assert_not_called()
                credits.assert_called_once_with(source,components=[])
                self.assertEqual(read.call_args.kwargs['resolved_metadata']['module_titles'],{'M1':'One'})
            else:
                module_read.assert_not_called();dates.assert_not_called();credits.assert_not_called();query.assert_not_called()

    def test_offset_instants_preserve_dst_and_do_not_use_machine_time(self):
        self.assertEqual(learning.session_instant('2026-10-25T10:00:00+01:00'),learning.session_instant('2026-10-25T09:00:00Z'))
        self.assertIsNone(learning.session_instant('invalid'))


class MyLearningModuleTests(SimpleTestCase):
    def setUp(self):
        self.source=SimpleNamespace(pk=7,id=7,email='synthetic@example.test',programme='Programme',cohort='',group='',_case_file_profile=SimpleNamespace(pk=9))
        self.owner={'id':9,'name':'Synthetic learner'}
        self.assigned=[{'moduleId':'M1'},{'moduleId':'M2'}]
        self.native=native([component(),component('OTHER','M2')])
        self.native['quizAttempts']=[{'componentId':'OTHER','quizId':2,'passed':True}]
        self.meta=metadata();self.meta['current_subjects'].append({'id':'M2','title':'Two'})
        self.context=(self.assigned,['M1','M2'],[],self.native,[],[],set(),set(),{},self.meta,[])

    def test_native_detail_reads_only_selected_content_and_metadata(self):
        from . import weekly_learning, dashboard_training, training_plan_dashboard, live_session_progress, teams_attendance, builder_activity_dates
        detail=native([component()]);detail['id']='7';detail['week']=[]
        with ExitStack() as stack:
            stack.enter_context(patch.object(learning,'load_context',return_value=self.context))
            stack.enter_context(patch.object(learning,'connections',fake_connections()))
            read=stack.enter_context(patch.object(weekly_learning,'build_learning_content_summary',return_value=detail))
            modules=stack.enter_context(patch.object(dashboard_training,'module_rows',return_value={}))
            sessions=stack.enter_context(patch.object(training_plan_dashboard,'plan_sessions',return_value=[]))
            stack.enter_context(patch.object(live_session_progress,'read_live_credits',return_value=[]))
            stack.enter_context(patch.object(teams_attendance,'annotate_attendance_completion',side_effect=lambda rows,*args:rows))
            dates=stack.enter_context(patch.object(builder_activity_dates,'read_builder_activity_dates',return_value={}))
            full=stack.enter_context(patch.object(canonical,'source_subjects',side_effect=AssertionError('Unrelated historical content read')))
            result=learning.read_module(self.source,'commercial',self.owner,'current:M1')
        self.assertEqual(read.call_args.kwargs['assigned_modules'],[{'moduleId':'M1'}])
        self.assertEqual(read.call_args.args[0].training_plan,[{'moduleId':'M1'}])
        self.assertEqual(result['detail']['components'][0]['componentId'],'C1')
        self.assertEqual(result['detail']['quizAttempts'],[])
        self.assertNotIn('OTHER',json.dumps(result))
        self.assertEqual(modules.call_args.args[1],['M1'])
        self.assertEqual(sessions.call_args.args[2],['M1'])
        self.assertEqual(dates.call_args.args[1],['M1'])
        full.assert_not_called()

    def test_legacy_detail_reads_one_owned_course_without_current_activity_content(self):
        from . import weekly_learning, dashboard_training, training_plan_dashboard, live_session_progress, teams_attendance, builder_activity_dates, subject_store
        context=list(deepcopy(self.context))
        context[4]=[{'id':3,'source_course_ref':'50','source_course_title':'Old','curriculum_module_ref':'M1'},
                    {'id':4,'source_course_ref':'60','source_course_title':'Other'}]
        activity={'subjects':[{'id':50,'name':'Old'}], 'activities':[], 'progress_basis':'catalogue_activities'}
        with ExitStack() as stack:
            stack.enter_context(patch.object(learning,'load_context',return_value=tuple(context)))
            stack.enter_context(patch.object(learning,'connections',fake_connections()))
            read=stack.enter_context(patch.object(weekly_learning,'build_learning_content_summary',return_value=native()))
            full=stack.enter_context(patch.object(canonical,'source_subjects',return_value=activity))
            stack.enter_context(patch.object(dashboard_training,'module_rows',return_value={}))
            stack.enter_context(patch.object(training_plan_dashboard,'plan_sessions',return_value=[]))
            stack.enter_context(patch.object(live_session_progress,'read_live_credits',return_value=[]))
            stack.enter_context(patch.object(teams_attendance,'annotate_attendance_completion',side_effect=lambda rows,*args:rows))
            stack.enter_context(patch.object(builder_activity_dates,'read_builder_activity_dates',return_value={}))
            stack.enter_context(patch.object(subject_store,'covers_for',return_value={}))
            result=learning.read_module(self.source,'apprenticeship',self.owner,'legacy:50')
        self.assertEqual(read.call_args.kwargs['assigned_modules'],[])
        self.assertEqual(full.call_args.kwargs['course_ids'],['50'])
        self.assertEqual(full.call_args.kwargs['module_ids'],[])
        self.assertEqual(result['detail']['components'],[])
        self.assertNotIn('Other',json.dumps(result))
        self.assertEqual(result['metadata']['current_subjects'],[])

    def test_invalid_module_fails_before_any_content_reader(self):
        from . import weekly_learning
        with patch.object(learning,'load_context',return_value=self.context), patch.object(weekly_learning,'build_learning_content_summary') as content:
            with self.assertRaises(ServiceError) as failure:
                learning.read_module(self.source,'commercial',self.owner,'current:FOREIGN')
            self.assertEqual(failure.exception.status,404)
            content.assert_not_called()

    def test_read_context_never_fetches_unrelated_course_activity_facts_for_details(self):
        # The detail reader's source_subjects call is scoped after owned ID validation.
        import inspect
        self.assertIn("selected_courses = courses if subject_id is None and purpose == 'catalogue' else []",inspect.getsource(learning.load_context))


class MyLearningEndpointTests(SimpleTestCase):
    def test_search_and_upcoming_reject_foreign_learners_before_loading(self):
        for resource in ('search','upcoming'):
            with patch('login.permissions._auth_gate_enabled',return_value=True), patch('login.permissions.authenticate_request',return_value=SimpleNamespace(role='learner',subject_id=8)), patch.object(learning,'load_context') as load:
                response=learning.my_learning(RequestFactory().get('/?q=lesson'),kind='commercial',pk=7,resource=resource)
            self.assertEqual(response.status_code,404)
            load.assert_not_called()

    def test_search_contract_validation_and_both_kinds(self):
        for kind in ('commercial','apprenticeship'):
            model=Mock();model.DoesNotExist=type('Missing',(Exception,),{})
            model.all_learners.only.return_value.get.return_value=SimpleNamespace(pk=7)
            with patch.dict(learning.SOURCE_MODELS,{kind:model}), patch.object(canonical,'require_profile',return_value={'id':9}), patch.object(learning,'read_search',return_value={'matches':[{'id':'current:M1'}],'nextOffset':None}) as search:
                view=learning.my_learning.__wrapped__.__wrapped__.__wrapped__
                self.assertEqual(view(RequestFactory().get('/?q=lesson'),kind,7,resource='search').status_code,200)
                search.assert_called_once()
                for query in ('?q='+('x'*201),'?q=lesson&offset=-1','?q=lesson&offset=bad'):
                    self.assertEqual(view(RequestFactory().get('/'+query),kind,7,resource='search').status_code,400)

    def test_both_learner_kinds_use_guarded_narrow_source_and_private_response(self):
        for kind in ('commercial','apprenticeship'):
            model=Mock();model.DoesNotExist=type('Missing',(Exception,),{})
            model.all_learners.only.return_value.get.return_value=SimpleNamespace(pk=7)
            with patch.dict(learning.SOURCE_MODELS,{kind:model}), patch.object(canonical,'require_profile',return_value={'id':9}) as identity, patch.object(learning,'read_catalogue',return_value={'modules':[]}) as read:
                response=learning.my_learning.__wrapped__.__wrapped__.__wrapped__(RequestFactory().get('/'),kind,7)
            self.assertEqual(response.status_code,200)
            self.assertEqual(response['Cache-Control'],'private, no-store')
            model.all_learners.only.assert_called_once_with(*learning.SOURCE_FIELDS)
            identity.assert_called_once_with(7)
            read.assert_called_once()

    def test_foreign_learner_is_denied_before_any_projection(self):
        with patch('login.permissions._auth_gate_enabled',return_value=True), patch('login.permissions.authenticate_request',return_value=SimpleNamespace(role='learner',subject_id=8)), patch.object(learning,'read_catalogue') as read:
            response=learning.my_learning(RequestFactory().get('/'),kind='commercial',pk=7)
        self.assertEqual(response.status_code,404)
        read.assert_not_called()

    def test_post_is_rejected(self):
        response=learning.my_learning(RequestFactory().post('/'),kind='commercial',pk=7)
        self.assertEqual(response.status_code,405)


def fixture_responses():
    """Execute both production projections over one synthetic, mocked source."""
    from . import course_catalogue_display, training_plan_dashboard, weekly_learning, dashboard_training, teams_attendance, live_session_progress, builder_activity_dates, subject_store
    source=SimpleNamespace(pk=7,id=7,email='synthetic@example.test',username='Synthetic learner',programme='Example programme',cohort='',group='',aptem_id=7,_case_file_profile=SimpleNamespace(pk=9))
    owner={'id':9,'name':'Synthetic learner','programme':'Example programme','programme_planned_hours':20,'aptem_id':7}
    modules={mid:{'id':mid,'title':title,'description':'','start_date':'2026-01-01','end_date':'2026-12-31','tutor_name':'Example tutor','coach_name':'','total_otjh':10,'educational_session_count':2}
        for mid,title in [('M1','Example module'),('M2','Another module')]}
    content=native([component('C1',component='Example reading',hasReadingContent=True),component('Q1',component='Final test',type='quiz',isQuiz=True,quizMeta={'quizId':1,'questions':1}),component('C2','M2',hasReadingContent=True)])
    content.update(id='7',programme='Example programme',cohort='',group='',week=[],modules=['Example module','Another module'])
    for item in content['components']:
        item['module']=modules[item['moduleId']]['title']
    content['componentProgress']=[{'componentId':'C1','kind':'component'}]
    content['quizAttempts']=[{'componentId':'Q1','quizId':1,'passed':False,'grade':0}]
    course={'id':3,'source_course_ref':'50','source_course_title':'Previous course','curriculum_module_ref':None}
    definitions=[{'id':i,'source_course_id':3,'source_course_ref':'50','source_course_title':'Previous course','source_activity_id':kind+':'+str(i),
        'source_activity_title':'Previous '+kind+' '+str(i),'source_activity_type':'quiz' if kind=='quiz' else 'reading','source_payload':{},'position':i}
        for i,kind in ((1,'material'),(2,'material'),(3,'quiz'),(4,'material'))]
    records=[{'id':1,'accepted':True,'actual_seconds':3600,'kind':'component','component_ref':'C1','component_title':'Example reading','module_ref':'M1','ksbs':[]},
        {'id':2,'accepted':True,'actual_seconds':3600,'kind':'component','module_ref':'50','ksbs':[],'sources':[{'source_system':'old_lms','source_course_ref':'50','source_activity_id':'material:1'}]},
        {'id':3,'accepted':True,'actual_seconds':3600,'kind':'quiz','passed':True,'module_ref':'50','ksbs':[],'sources':[{'source_system':'old_lms','source_course_ref':'50','source_activity_id':'quiz:3'}]}]
    meta=metadata();meta['covers']={'current:M1':'https://assets.example.test/cover.png'}
    meta['current_subjects']=[{'id':mid,'title':row['title']} for mid,row in modules.items()]
    meta['builder_subjects']={f'current:{mid}':{'id':mid,'title':row['title']} for mid,row in modules.items()}
    meta['modules']=modules
    context=([{'moduleId':'M1'},{'moduleId':'M2'}],['M1','M2'],records,content,[course],definitions,
        {('50','material:1'),('50','quiz:3')},set(),{'50':2},meta,[])
    def query(sql,params):
        if 'learner_source_course_memberships' in sql:return [course]
        if 'FROM curriculum.source_activities' in sql:return definitions
        return []
    def selected_content(source,pk,**kwargs):
        selected={m['moduleId'] for m in kwargs['assigned_modules']}
        return {**{key:value for key,value in content.items() if not key.startswith('_')},
                'components':[c for c in content['components'] if c.get('moduleId') in selected]}
    with ExitStack() as stack:
        stack.enter_context(patch.object(learning,'load_context',side_effect=lambda *args,**kwargs:deepcopy(context)))
        stack.enter_context(patch.object(learning,'connections',fake_connections()))
        stack.enter_context(patch.object(canonical,'query',side_effect=query))
        stack.enter_context(patch.object(learning,'journal_enabled',return_value=True))
        stack.enter_context(patch.object(course_catalogue_display,'read_export_placements',return_value=[]))
        stack.enter_context(patch.object(training_plan_dashboard,'plan_sessions',return_value=[]))
        stack.enter_context(patch.object(dashboard_training,'module_rows',side_effect=lambda cur,ids,**kwargs:{mid:modules[mid] for mid in ids}))
        stack.enter_context(patch.object(subject_store,'covers_for',return_value={}))
        stack.enter_context(patch.object(teams_attendance,'annotate_attendance_completion',side_effect=lambda rows,*args:rows))
        stack.enter_context(patch.object(live_session_progress,'read_live_credits',return_value=[]))
        stack.enter_context(patch.object(builder_activity_dates,'read_builder_activity_dates',return_value={}))
        stack.enter_context(patch.object(weekly_learning,'build_learning_content_summary',side_effect=selected_content))
        result={'catalogue':learning.read_catalogue(source,'commercial',owner),
            'module':learning.read_module(source,'commercial',owner,'current:M1'),
            'legacyModule':learning.read_module(source,'commercial',owner,'legacy:50')}
    for key in ('module','legacyModule'):
        result[key]['schedule']['generatedAt']='2026-10-18T00:00:00+00:00'
    return result


class MyLearningSharedFixtureTests(SimpleTestCase):
    def test_production_contract_matches_shared_frontend_fixture_without_full_initial_responses(self):
        from pathlib import Path
        fixture=Path(__file__).parents[2]/'frontend/src/test/myLearningFixtures.json'
        actual=fixture_responses()
        self.assertEqual(actual,json.loads(fixture.read_text(encoding='utf-8')))
        catalogue=actual['catalogue']
        self.assertEqual(catalogue['summary']['current']['total'],3)
        self.assertEqual(catalogue['summary']['previous']['total'],4)
        self.assertEqual(catalogue['otjh'],{'actual':3,'planned':20})
        self.assertEqual(next(c for c in catalogue['modules'] if c['id']=='current:M1')['cover'],'https://assets.example.test/cover.png')
        for card in catalogue['modules']:
            self.assertFalse({'activities','components','weeks','quizAttempts','canonical_otjh_activities','searchText','acceptedHours','catalogueCount','catalogueProgress'} & set(card))
            if card['planModule']:
                self.assertFalse({'id','title'} & set(card['planModule']))
        self.assertFalse({'version','sessions','deadlines','verification_status'} & set(catalogue))
        self.assertNotIn('version',actual['module'])
        self.assertEqual({c['moduleId'] for c in actual['module']['detail']['components']},{'M1'})
        self.assertEqual(actual['legacyModule']['detail']['components'],[])


class MyLearningSearchTests(SimpleTestCase):
    def test_search_context_avoids_ledger_hours_covers_dates_and_attendance_reads(self):
        from . import models,weekly_learning,dashboard_training,teams_attendance,live_session_progress,subject_origins,previous_learning_groups,builder_activity_dates,student_activity
        source=SimpleNamespace(pk=7,id=7,aptem_id=7,programme='Programme',cohort='',group='')
        manager=MagicMock();manager.only.return_value.filter.return_value.first.return_value=SimpleNamespace(pk=9,enrolment_id=7)
        connection=fake_connections();connection['enrolment'].cursor.return_value.__enter__.return_value.fetchall.return_value=[('M1','One')]
        with ExitStack() as stack:
            stack.enter_context(patch.object(models.LearnerProfile,'objects',manager))
            stack.enter_context(patch.object(learning,'connections',connection))
            stack.enter_context(patch.object(learning,'effective_training_plan',return_value=[{'moduleId':'M1'}]))
            stack.enter_context(patch.object(weekly_learning,'build_learning_content_summary',return_value=native([component()])))
            stack.enter_context(patch.object(canonical,'owned_source_courses',return_value=[]))
            forbidden=[]
            for module,name in [(canonical,'entries_for'),(canonical,'query'),(dashboard_training,'module_rows'),(teams_attendance,'annotate_attendance_completion'),(live_session_progress,'read_live_credits'),(builder_activity_dates,'read_builder_activity_dates'),(student_activity,'_builder_subject_metadata')]:
                forbidden.append(stack.enter_context(patch.object(module,name,side_effect=AssertionError('Unneeded search read'))))
            for module,name in [(subject_origins,'read_imported_courses'),(subject_origins,'read_replacement_courses'),(previous_learning_groups,'read_previous_learning_groups')]:
                stack.enter_context(patch.object(module,name,return_value={}))
            context=learning.load_context(source,{'id':9},purpose='search')
        self.assertEqual(context[2],[])
        self.assertEqual(context[5],[])
        for reader in forbidden:reader.assert_not_called()

    def test_upcoming_expansion_ignores_old_completion_hints_and_skips_unneeded_reads(self):
        from . import subject_store,course_catalogue_display
        content=native([component('TASK',type='assignment',previousLearning={'completed':True})])
        meta=metadata();meta['modules']={'M1':{'id':'M1','title':'One'}}
        meta['activity_dates']={'TASK':{'due_timing':'End of week','week_end':'2099-01-02'}}
        context=([],[],[],content,[],[],set(),set(),{},meta,[])
        with patch.object(learning,'load_context',return_value=context),patch.object(course_catalogue_display,'read_export_placements',return_value=[]),patch.object(subject_store,'covers_for') as covers,patch.object(canonical,'programme_planned_hours') as planned:
            result=learning.read_catalogue(SimpleNamespace(pk=7),'commercial',{'id':9},upcoming_only=True)
        self.assertEqual(len(result['upcoming']),1)
        self.assertEqual(result['upcoming'][0]['href'],'/learner/component/commercial/7/TASK')
        covers.assert_not_called();planned.assert_not_called()

    def test_search_matches_each_title_and_preserves_owned_exclusions_without_full_historical_reads(self):
        courses=[{'id':3,'source_course_ref':'50','source_course_title':'Old',
            'verified_catalogue_scope':{'version':1,'basis':'verified-legacy-account-inventory','course_ref':'50','excluded_activity_refs':['material:8']}}]
        meta=metadata();meta['modules']={}
        context=([],[],[],native([component(component='Quiet lesson'),component('C2',component='Another activity')]),courses,[],set(),set(),__import__('collections').defaultdict(float),meta,[])
        definitions=[{'source_course_ref':'50'}]
        with patch.object(learning,'load_context',return_value=context) as load, patch.object(canonical,'query',return_value=definitions) as query:
            result=learning.read_search(SimpleNamespace(pk=7),{'id':9},'quiet',0)
        self.assertEqual({m['id'] for m in result['matches']},{'current:M1','legacy:50'})
        self.assertIsNone(result['nextOffset'])
        self.assertEqual(load.call_args.kwargs,{'purpose':'search'})
        sql,params=query.call_args.args
        self.assertIn('a.source_course_id=ANY(%s)',sql)
        self.assertEqual(params,[[3],'quiet',['50:material:8']])
        self.assertIn('SELECT DISTINCT c.source_course_ref',sql)
        self.assertIn('=ANY(%s)',sql)
        self.assertNotIn('source_payload',sql)
        with patch.object(learning,'load_context',return_value=context),patch.object(canonical,'query',return_value=[]):
            self.assertEqual(learning.read_search(SimpleNamespace(pk=7),{'id':9},'lesson another',0)['matches'],[])

    def test_search_pages_are_bounded_and_do_not_compute_display_hours_or_export_placements(self):
        from . import training_plan_dashboard,course_catalogue_display
        meta=metadata();meta['modules']={};meta['current_subjects']=[]
        rows=[component(f'C{i}',f'M{i}',component='Matched lesson') for i in range(61)]
        context=([],[],[],native(rows),[],[],set(),set(),{},meta,[])
        with patch.object(learning,'load_context',return_value=context),patch.object(training_plan_dashboard,'_canonical_module_progress') as hours,patch.object(course_catalogue_display,'read_export_placements') as placements:
            first=learning.read_search(SimpleNamespace(pk=7),{'id':9},'lesson',0)
            second=learning.read_search(SimpleNamespace(pk=7),{'id':9},'lesson',50)
        self.assertEqual(len(first['matches']),50);self.assertEqual(first['nextOffset'],50)
        self.assertEqual(len(second['matches']),11);self.assertIsNone(second['nextOffset'])
        hours.assert_not_called();placements.assert_not_called()

    def test_upcoming_omits_assignments_without_a_due_date(self):
        rows = native([component(ident, type='assignment')
                       for ident in ('UNDATED', 'NO_TIMING', 'MISSING', 'FUTURE')])
        meta = metadata()
        meta['activity_dates'] = {
            'UNDATED': {'due_timing': 'End of week', 'week_end': None},
            'NO_TIMING': {'due_timing': None, 'week_end': '2099-01-02'},
            'MISSING': {'due_timing': 'End of week'},
            'FUTURE': {'due_timing': 'End of week', 'week_end': '2099-01-02'},
        }
        for kind in ('commercial', 'apprenticeship'):
            for limit in (4, None):
                with self.subTest(kind=kind, limit=limit), patch.object(canonical, 'query', return_value=[]):
                    links = learning.upcoming_links(SimpleNamespace(pk=7), kind, ['M1'], rows,
                        meta, {'current:M1'}, limit=limit)
                self.assertEqual([link['id'] for link in links], ['deadline:native:FUTURE'])
                self.assertEqual(links[0]['date'], '2099-01-02')
                self.assertEqual(links[0]['href'], f'/learner/component/{kind}/7/FUTURE')

    def test_upcoming_is_narrow_future_bounded_and_keeps_component_action_links(self):
        source=SimpleNamespace(pk=7)
        rows=native([component('LIVE',type='live_session',teamsLiveSessionId='SERIES',sessionDateTimeUtc='2099-01-01T10:00:00Z'),
            component('TASK',type='assignment',component='Assignment')])
        meta=metadata();meta['activity_dates']={'TASK':{'due_timing':'End of week','week_end':'2099-01-02'}}
        sessions=[{'id':'OCC','series_id':'SERIES','module_id':'M1','title':'One','start':'2099-01-01T10:00:00Z','online':True}]
        with patch.object(canonical,'query',return_value=sessions) as query:
            links=learning.upcoming_links(source,'apprenticeship',['M1'],rows,meta,{'current:M1'},limit=4)
        self.assertEqual(len(links),2)
        self.assertIn('/learner/component/apprenticeship/7/LIVE?week=Week%201',links[0]['href'])
        self.assertEqual(links[1]['href'],'/learner/component/apprenticeship/7/TASK')
        sql,params=query.call_args.args
        self.assertIn('LIMIT %s',sql);self.assertEqual(params[-1],4)
        self.assertNotIn('attendance',sql)
        self.assertFalse({'joinUrl','minutes','attended'} & set(links[0]))
