"""Frozen-source result/HTTP/cache parity for the reporting query boundary."""
from curriculum_api.catalogue.tests.parity.composition_test_support import composition_fixture
from contextlib import ExitStack, contextmanager, nullcontext
from copy import deepcopy
import json
from pathlib import Path
from types import FunctionType
import unittest
from unittest.mock import Mock, patch

from django.http import HttpResponse
from django.test import RequestFactory, SimpleTestCase
from curriculum_api import views
from curriculum_api.reporting.tests import test_achievement_performance_no_db as achievement_fixtures
from curriculum_api.reporting.tests import test_ksb_coverage_parts_no_db as coverage_fixtures
from curriculum_api.reporting.tests import test_coverage_summary_no_db as summary_fixtures
from curriculum_api.reporting.tests import test_coverage_mapped_components_no_db as mapped_fixtures
from curriculum_api.reporting.application import queries, achievement, supplementary

SNAPSHOT=json.loads((Path(__file__).parents[2]/'reporting/tests/fixtures/legacy_snapshots/delivery_snapshot.json').read_text(encoding='utf-8'))


@contextmanager
def original_delivery():
    with ExitStack() as stack:
        for name, entry in SNAPSHOT.items():
            if isinstance(getattr(views,name),Mock):
                continue
            namespace=dict(vars(views))
            exec(compile(entry['source'],'<original-report-delivery>','exec'),namespace)
            fn=namespace[name]
            fn=FunctionType(fn.__code__,vars(views),name,fn.__defaults__)
            fn.__kwdefaults__=namespace[name].__kwdefaults__
            for decorator in reversed(entry['decorators']):
                fn=eval(decorator,vars(views))(fn)
            stack.enter_context(composition_fixture(views,name,fn))
        yield


def value(result):
    if isinstance(result,HttpResponse):return ('http',result.status_code,result.content,dict(result.items()))
    if isinstance(result,dict):return {k:value(v) for k,v in result.items()}
    if isinstance(result,(tuple,list)):return type(result)(value(v) for v in result)
    return deepcopy(result)


@contextmanager
def capture():
    results=[]
    def record(name,fn):
        def call(*args,**kwargs):
            result=fn(*args,**kwargs)
            results.append((name,value(result)))
            return result
        return call
    with ExitStack() as stack:
        for name in SNAPSHOT:
            stack.enter_context(composition_fixture(views,name,record(name,getattr(views,name))))
        yield results


class DeliveryFixtureParity(SimpleTestCase):
    """Compare actual old/new output traces, not a rewritten oracle."""


def parity_case(case,method):
    def test(self):
        def run():
            with capture() as records:
                result=unittest.TestResult()
                case(method).run(result)
            self.assertTrue(result.wasSuccessful(),str(result.errors+result.failures))
            self.assertEqual(result.skipped,[])
            return records
        current=run()
        with original_delivery():original=run()
        self.assertEqual(current,original)
        self.assertTrue(current)
    return test


for case in (achievement_fixtures.AchievementReadTests,coverage_fixtures.CoveragePartTests,
             coverage_fixtures.CoverageEntryTests,summary_fixtures.CoverageSummaryTests,
             mapped_fixtures.CoverageAsksForMappedComponentsTests):
    for method in unittest.defaultTestLoader.getTestCaseNames(case):
        if case is summary_fixtures.CoverageSummaryTests and method=='test_grouped_summary_matches_full_weights_occurrences_and_sources':
            continue  # Pure coverage arithmetic is run separately; it invokes no extracted query.
        setattr(DeliveryFixtureParity,'test_'+case.__name__+'_'+method[5:],parity_case(case,method))
del case,method


class ReportQueryContracts(SimpleTestCase):
    def setUp(self):
        self.factory=RequestFactory()
        self.stack=self.enterContext(ExitStack())
        self.learners=[{'id':1,'sourceKind':'learner','sourceId':1,'group':'G','cohort':'C','groupId':'G1','cohortId':'C1'},
                       {'id':2,'sourceKind':'learner','sourceId':2,'group':'G','cohort':'C','groupId':'G1','cohortId':'C1'}]
        self.modules=[{'module_catalogue_id':'M','group_name':'G'}]
        self.components=[{'id':'ACT','module_catalogue_id':'M','expected_otjh':3}]
        self.required=[{'code':'K1','source_type':'standard','source_id':'STD','description':'Synthetic definition'}]
        self.progress=[{'learnerId':1,'progressId':6,'code':'K1','weight':20,'componentId':'ACT',
                        'moduleRef':'M','scopeStatus':'in_scope','scopeBasis':'component','countsTowardAchievement':True,
                        'expectedOtjh':3,'submittedAt':'2028-01-01T00:00:00+00:00'}]
        self.outside=[{**self.progress[0],'progressId':7,'scopeStatus':'out_of_scope'}]
        self.reflections=[{'learnerId':1,'progressEntryId':6,'submissionId':'R','code':'K1','weight':20,
                           'actualOtjh':2.5,'actualTimeHours':2.5,'scopeStatus':'in_scope',
                           'activityCountsTowardAchievement':True}]
        for name,result in {
            'scope_placement_lineage':{'found':True,'programmeId':'P','placementBasis':'group'},
            'authoring_scope_data':(self.modules,[],self.components,[]),
            'required_ksbs_for_request':self.required,
            'assigned_learners_for_scope':self.learners,
            'learner_progress_ksb_consumption':({1:{'K1':20}},self.progress,self.outside),
            'reflection_submission_ksb_consumption':({1:{'K1':20}},self.reflections,[],[]),
            'progress_evidence_index':{'6':[{'evidenceId':'E','fileName':'synthetic.pdf'}]},
            'out_of_scope_progress_count':3,
        }.items():
            self.stack.enter_context(composition_fixture(views,name,side_effect=lambda *a,_value=result,**kw:deepcopy(_value)))
        self.stack.enter_context(composition_fixture(views,'mappings_with_inferred_sources',side_effect=lambda rows,modules:rows))
        self.stack.enter_context(composition_fixture(views,'annotate_coverage_sources',side_effect=lambda data:data))
        self.stack.enter_context(composition_fixture(views,'connection',Mock(vendor='postgresql')))

    def compare(self,call):
        current=value(call())
        with original_delivery():old=value(call())
        self.assertEqual(current,old)
        return current

    def test_scope_impact_results_match_for_all_supported_scope_modes(self):
        for scope in ('programme','cohort','group','module','week','component'):
            for query in ({},{'moduleProgress':'1','learnerStatus':'all'},{'status':'inactive'}):
                with self.subTest(scope=scope,query=query):
                    result=self.compare(lambda:views._scope_learner_ksb_impact_payload(self.factory.get('/',query),scope,'M'))
                    self.assertIsNone(result[1])
                    self.assertEqual('learnerActivityPlan' in result[0],query.get('moduleProgress')=='1')

    def test_scope_missing_target_preserves_http_error_and_skips_learner_reads(self):
        with composition_fixture(views,'scope_placement_lineage',return_value={'found':False}), \
             composition_fixture(views,'authoring_scope_data',return_value=([],[],[],[])), \
             composition_fixture(views,'assigned_learners_for_scope') as reader:
            result=self.compare(lambda:views._scope_learner_ksb_impact_payload(self.factory.get('/'),'module','missing'))
            self.assertEqual(result[1][1],404)
            reader.assert_not_called()

    def test_roster_filters_compact_identity_and_order_match(self):
        for query in ({},{'compact':'1'},{'cohort':'C','group':'G'},{'group':'elsewhere'},{'status':'all'}):
            with self.subTest(query=query):
                result=self.compare(lambda:views._scope_learner_roster_payload_uncached(self.factory.get('/',query),'group','G1'))
                self.assertFalse(result['editable'])
                if query.get('compact'):
                    self.assertEqual(set(result['assignedLearners'][0]),{'id','name','email','cohort','group','cohortId','groupId'})

    def test_roster_cache_key_ttl_scope_and_encoded_body_match(self):
        def run():
            calls=[]
            def build(key,callback,**options):
                calls.append((key,options));return callback()
            with composition_fixture(views,'cached_curriculum_value',side_effect=build):
                result=views.scope_learner_roster_entry(self.factory.get('/?compact=1&status=ALL&cohort=C&group=G'),'programme','P')
            return result,calls
        self.compare(run)

    def test_actual_application_owner_receives_values_without_http_request(self):
        with patch.object(queries,'_scope_learner_ksb_impact_payload',wraps=queries._scope_learner_ksb_impact_payload) as owner:
            request=self.factory.get('/?status=all')
            views._scope_learner_ksb_impact_payload(request,'module','M')
            self.assertIs(owner.call_args.args[0],request.GET)
            self.assertNotIn(request,owner.call_args.args)


class SupplementaryFailureContracts(SimpleTestCase):
    def test_compact_reader_loading_errors_are_not_swallowed(self):
        def unavailable():raise ImportError('synthetic unavailable reader')
        with self.assertRaises(ImportError):
            supplementary.learner_progress_ksb_totals([1],['K1'],compact=True,
                progress_source_available=lambda:True,coverage_normalise_code=views.coverage_normalise_code,
                compact_progress_totals=unavailable,progress_total_rows=Mock(),logger=Mock(),
                clean_str=views.clean_str,progress_counts_as_achieved=views.progress_counts_as_achieved,
                float_weight=views.float_weight)

    def test_progress_total_read_errors_keep_existing_empty_contract(self):
        with composition_fixture(views,'connection',Mock(vendor='postgresql')), \
             composition_fixture(views,'learner_schema_table_exists',return_value=True), \
             composition_fixture(views,'logger'):
            views.connection.cursor.side_effect=RuntimeError('synthetic unavailable')
            current=views.learner_progress_ksb_totals([1],['K1'])
            with original_delivery():old=views.learner_progress_ksb_totals([1],['K1'])
            self.assertEqual(current,old)
            self.assertEqual(current,{})
