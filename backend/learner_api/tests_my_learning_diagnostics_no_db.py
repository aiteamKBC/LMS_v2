"""Local diagnostic privacy, isolation and response parity with no DB/network."""
from contextlib import contextmanager, ExitStack
from copy import deepcopy
import os
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, patch
from uuid import uuid4

from django.test import SimpleTestCase, RequestFactory, override_settings

from . import projection_performance as perf, my_learning as learning
from .tests_my_learning_no_db import fixture_responses
from . import live_session_progress as live


class LocalProjectionDiagnosticsTests(SimpleTestCase):
    def request(self, **meta):
        request=RequestFactory().get('/learner_api/my-learning/commercial/7/',
            HTTP_HOST='127.0.0.1:8000',SERVER_NAME='127.0.0.1',REMOTE_ADDR='127.0.0.1',**meta)
        request.request_id=str(uuid4())
        return request

    @override_settings(DEBUG=True)
    def test_opt_in_requires_local_debug_runserver_and_cannot_be_enabled_by_request(self):
        request=self.request()
        with patch.dict(os.environ,{},clear=True),patch.object(perf.sys,'argv',['manage.py','runserver']):
            self.assertFalse(perf._local_trace_allowed(request))
            request.GET=request.GET.copy();request.GET['trace']='1'
            self.assertFalse(perf._local_trace_allowed(request))
        with patch.dict(os.environ,{'LMS_MY_LEARNING_TRACE':'1'}),patch.object(perf.sys,'argv',['manage.py','runserver']):
            self.assertTrue(perf._local_trace_allowed(request))
            for key,value in [('REMOTE_ADDR','203.0.113.2'),('SERVER_NAME','example.test'),('HTTP_HOST','example.test'),('REMOTE_ADDR','invalid')]:
                changed=self.request();changed.META[key]=value
                self.assertFalse(perf._local_trace_allowed(changed))
            with override_settings(DEBUG=False):self.assertFalse(perf._local_trace_allowed(request))
        with patch.dict(os.environ,{'LMS_MY_LEARNING_TRACE':'1'}),patch.object(perf.sys,'argv',['gunicorn']):
            self.assertFalse(perf._local_trace_allowed(request))

    def test_disabled_path_uses_no_timers_wrappers_or_logs(self):
        handler=Mock(return_value='unchanged')
        with patch.dict(os.environ,{'LMS_MY_LEARNING_TRACE':'0'}),patch.object(perf,'perf_counter',side_effect=AssertionError('Timer')),patch.object(perf,'connections') as connections,patch.object(perf.log,'info') as info:
            self.assertEqual(perf.local_catalogue_trace(handler)(self.request()),'unchanged')
            with perf.projection_stage('source'):pass
        handler.assert_called_once();connections.all.assert_not_called();info.assert_not_called()

    def test_nested_stages_are_exclusive_and_never_retain_private_sql_or_parameters(self):
        measurement=perf.LocalProjectionPerformance(uuid4())
        wall=[0.0];cpu=[0.0]
        with patch.object(perf,'perf_counter',side_effect=lambda:wall[0]),patch.object(perf,'thread_time',side_effect=lambda:cpu[0]):
            with measurement.stage('ledger'):
                wall[0]+=1;cpu[0]+=.1
                with measurement.stage('ledger_read'):
                    def execute(*args):wall[0]+=2;cpu[0]+=.02;return 'result'
                    self.assertEqual(measurement.execute_for('enrolment',execute,'SELECT private@example.test',{'token':'secret'},False,{}),'result')
                wall[0]+=1;cpu[0]+=.1
        self.assertAlmostEqual(measurement.rows['ledger']['elapsed'],2)
        self.assertAlmostEqual(measurement.rows['ledger_read']['elapsed'],2)
        self.assertEqual(measurement.rows['ledger_read']['database']['enrolment']['calls'],1)
        with patch.object(perf.log,'info') as info:measurement.emit()
        payload=info.call_args.args[1]
        self.assertNotIn('private',str(payload));self.assertNotIn('secret',str(payload))
        rows={r['stage']:r for r in payload['stages']}
        self.assertEqual(rows['ledger_read']['processing_cpu_ms'],0)
        self.assertEqual(rows['ledger_read']['connection_acquisition_ms'],'UNMEASURED')
        self.assertEqual(rows['ledger_read']['postgresql_server_execution_ms'],'UNMEASURED')

    def test_failure_restores_context_and_emits_once_without_exception_text(self):
        request=self.request()
        def fail(request):
            with perf.projection_stage('ledger_read'):raise ValueError('private secret response')
        with patch.object(perf,'_local_trace_allowed',return_value=True),patch.object(perf,'connections') as connections,patch.object(perf.log,'info') as info:
            connections.all.return_value=[]
            with self.assertRaises(ValueError):perf.local_catalogue_trace(fail)(request)
        self.assertIsNone(perf._local_projection.get())
        self.assertEqual(info.call_count,1)
        self.assertNotIn('private',str(info.call_args))
        self.assertEqual(info.call_args.args[1]['serialization_ms'],'UNMEASURED')

    def test_trace_contexts_are_request_local_and_stage_names_are_bounded(self):
        first=perf.LocalProjectionPerformance(uuid4());second=perf.LocalProjectionPerformance(uuid4())
        token=perf._local_projection.set(first)
        try:
            with perf.projection_stage('source'):pass
            nested=perf._local_projection.set(second)
            try:
                for index in range(100):
                    with perf.projection_stage(f'untrusted-stage-{index}'):pass
            finally:perf._local_projection.reset(nested)
            with perf.projection_stage('owner'):pass
        finally:perf._local_projection.reset(token)
        self.assertEqual(set(first.rows),{'source','owner'})
        self.assertEqual(set(second.rows),{'other'})

    def test_selected_resources_do_not_install_diagnostics(self):
        handler=Mock(return_value='ok')
        with patch.object(perf,'_local_trace_allowed',return_value=True),patch.object(perf,'connections') as connections:
            decorated=perf.local_catalogue_trace(handler)
            decorated(self.request(),subject_id='current:M1')
            decorated(self.request(),resource='search')
        connections.all.assert_not_called()

    def test_enabled_catalogue_has_identical_json_and_reader_calls(self):
        fixture=fixture_responses()['catalogue']
        class FakeConnection:
            alias='enrolment'
            wrapper=None
            calls=0
            @contextmanager
            def execute_wrapper(self,wrapper):
                self.wrapper=wrapper
                try:yield
                finally:self.wrapper=None
            def query(self):
                self.calls+=1
                if self.wrapper:self.wrapper(lambda *args:None,'SELECT sensitive', ['private@example.test'],False,{})
        connection=FakeConnection()
        model=Mock();model.DoesNotExist=type('Missing',(Exception,),{})
        source=SimpleNamespace(pk=7)
        def read_source(**kwargs):connection.query();return source
        model.all_learners.only.return_value.get.side_effect=read_source
        def read_owner(pk):connection.query();return {'id':9}
        def read_catalogue(*args):connection.query();return deepcopy(fixture)
        # Keep the real authorization decorator present; its deliberate bypass
        # is local to this mocked test and unchanged between both runs.
        with patch('login.permissions._auth_gate_enabled',return_value=False),patch.dict(learning.SOURCE_MODELS,{'commercial':model}),patch.object(learning.canonical,'require_profile',side_effect=read_owner),patch.object(learning,'read_catalogue',side_effect=read_catalogue) as read,patch.object(perf,'connections') as connections,patch.object(perf.log,'info') as info:
            connections.all.return_value=[connection]
            with patch.object(perf,'_local_trace_allowed',return_value=False):
                before=learning.my_learning(self.request(),kind='commercial',pk=7)
            before_calls=connection.calls;connection.calls=0
            with patch.object(perf,'_local_trace_allowed',return_value=True):
                after=learning.my_learning(self.request(),kind='commercial',pk=7)
            self.assertEqual(after.content,before.content)
            self.assertEqual(connection.calls,before_calls)
            self.assertEqual(read.call_count,2)
        self.assertEqual(info.call_count,1)
        payload=info.call_args.args[1]
        self.assertEqual(sum(db['sql_calls'] for stage in payload['stages'] for db in stage['database']),3)
        self.assertIn('serialize',{stage['stage'] for stage in payload['stages']})
        self.assertFalse(any(key in payload for key in ('learner_id','kind','email','sql','params','body')))


class SafeCatalogueReductionTests(SimpleTestCase):
    def load_replacement_context(self, transfers=None, components=None):
        from . import models,weekly_learning,subject_origins,previous_learning_groups,builder_activity_dates,teams_attendance
        from .tests_my_learning_no_db import native,component
        source=SimpleNamespace(pk=7,id=7,aptem_id=7,programme='Programme',cohort='',group='')
        manager=MagicMock();manager.only.return_value.filter.return_value.first.return_value=SimpleNamespace(pk=9,enrolment_id=7)
        cur=MagicMock();cur.fetchall.return_value=[('C1',{'legacySettings':{'sourceLessonId':7,'sourceMaterialKey':'reading-7'}})]
        conn=MagicMock();conn.cursor.return_value.__enter__.return_value=cur
        def module_rows(cur,ids,identity_metadata):
            identity_metadata.update(module_titles={'M1':'Module'},weeks=[],covers={},
                imported_courses={'current:M1':'legacy:50'},live_credit_components=[])
            return {'M1':{'id':'M1','title':'Module'}}
        with ExitStack() as stack:
            stack.enter_context(patch.object(models.LearnerProfile,'objects',manager))
            stack.enter_context(patch.object(learning,'connections',{'enrolment':conn}))
            stack.enter_context(patch.object(learning,'effective_training_plan',return_value=[{'moduleId':'M1'}]))
            stack.enter_context(patch.object(learning,'catalogue_module_rows',side_effect=module_rows))
            stack.enter_context(patch.object(learning.canonical,'entries_for',return_value=[]))
            stack.enter_context(patch.object(learning.canonical,'owned_source_courses',return_value=[]))
            stack.enter_context(patch.object(weekly_learning,'build_learning_content_summary',return_value=native(components or [component()])))
            imports=stack.enter_context(patch.object(subject_origins,'read_imported_courses',side_effect=AssertionError('Repeated import query')))
            stack.enter_context(patch.object(subject_origins,'read_replacement_courses',return_value={'current:M1':'legacy:50'}))
            stack.enter_context(patch.object(previous_learning_groups,'read_previous_learning_groups',return_value={}))
            stack.enter_context(patch.object(builder_activity_dates,'read_builder_activity_dates',return_value={}))
            stack.enter_context(patch.object(teams_attendance,'annotate_attendance_completion',side_effect=lambda rows,*args:rows))
            stack.enter_context(patch.object(live,'read_live_credits',return_value=[]))
            state=stack.enter_context(patch('learner_api.progress_transfer_store.read_state',return_value={'items':transfers or []}))
            context=learning.load_context(source,{'id':9,'progress_transfer_active':transfers is not None})
        self.assertEqual(state.call_count, int(transfers is not None))
        imports.assert_not_called()
        return context,cur

    def test_cached_imports_and_scoped_replacement_settings_avoid_repeated_metadata_reads(self):
        context,cur=self.load_replacement_context()
        self.assertEqual(cur.execute.call_count,1)
        sql,params=cur.execute.call_args.args
        self.assertIn('AND id=ANY(%s)',sql)
        self.assertIn("'sourceMaterialKey'",sql)
        self.assertIn("ELSE settings_json->'legacySettings' END",sql)
        self.assertEqual(params,[['M1'],['C1']])
        self.assertEqual(context[9]['imported_courses'],{'current:M1':'legacy:50'})

    def test_percentage_only_approval_skips_lineage_without_losing_transfer_credit(self):
        transfer={'moduleId':'M1','status':'approved','matchedComponents':{},'percent':40}
        context,cur=self.load_replacement_context([transfer])
        cur.execute.assert_not_called()
        self.assertEqual(context[9]['progress_transfers'],[transfer])
        self.assertEqual(context[9]['replacement_settings'],{})

    def test_pending_transfer_keeps_lineage_reads_for_later_approval(self):
        _,cur=self.load_replacement_context([{'moduleId':'M1','status':'pending','matchedComponents':{}}])
        self.assertEqual(cur.execute.call_args.args[1],[['M1'],['C1']])

    def test_approved_matches_keep_unmatched_identities_for_duplicate_detection(self):
        from .tests_my_learning_no_db import component
        transfer={'moduleId':'M1','status':'approved','matchedComponents':{'C1':{'completed':True}}}
        _,cur=self.load_replacement_context([transfer],
            [component('C1'),component('C2'),component('OTHER','M2')])
        self.assertEqual(cur.execute.call_args.args[1],[['M1'],['C1','C2']])

    def test_live_credit_supplement_visits_records_once_and_preserves_corrections_and_duplicates(self):
        class CountedList(list):
            visits=0
            def __iter__(self):
                for row in super().__iter__():self.visits+=1;yield row
        records=CountedList([{'component_ref':'C1','accepted':True,'actual_seconds':3600},
            {'component_ref':'C2','accepted':False,'actual_seconds':0,'actual_basis':'staff:module-progress'},
            {'component_ref':'C3','accepted':False,'actual_seconds':7200}])
        metrics={'M1':{'hours':{'actual':1.0}}}
        credits=[{'componentId':f'C{i}','moduleId':'M1','hours':2} for i in (1,2,3,1)]
        saved=deepcopy(metrics)
        self.assertEqual(live.supplement_module_hours(metrics,records,credits)['M1']['hours']['actual'],4)
        self.assertEqual(records.visits,3);self.assertEqual(metrics,saved)
        records.visits=0
        self.assertEqual(live.supplement_module_hours(metrics,records,[]),saved)
        self.assertEqual(records.visits,0)
        self.assertEqual(live.supplement_module_hours(metrics,records,iter(credits))['M1']['hours']['actual'],4)
