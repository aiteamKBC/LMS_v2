"""Run with python -I: actual gateway/helper, synthetic data, no DB/network."""
import ast
import copy
import importlib.util
from pathlib import Path
import re
import sys
import types
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).parent
spec = importlib.util.spec_from_file_location('personal_baseline_tests', ROOT/'test_personal_learning_no_db.py')
baseline = importlib.util.module_from_spec(spec)
spec.loader.exec_module(baseline)


class CompactPersonalTests(unittest.TestCase):
    def setUp(self):
        baseline.PersonalLearningTests.setUp(self)
        self.detail['name'] = 'Synthetic Admin'
        self.detail['personalLearning'] = {'mode':'study', 'moduleId':'MOD-A', 'contentOnly':True}
        self.metadata = {'covers': {'current:MOD-A':'https://example.invalid/cover.png'},
                         'current_subjects':[{'id':'MOD-A','title':'Module A'}], 'activity_dates':{}}
        self.schedule = {'modules':[{'id':'MOD-A','title':'Module A','start_date':'2027-06-07'}], 'moduleLinks':{},'generatedAt':''}
        personal = types.ModuleType('learner_api.personal_learning')
        personal.metadata = Mock(return_value=self.metadata)
        personal.progress = self.ns['progress']
        reads = types.ModuleType('learner_api.personal_learning_reads')
        reads.learning_schedule = Mock(return_value=self.schedule)
        helper = types.ModuleType('learner_api.personal_learning_catalogue')
        helper.__dict__.update(__package__='learner_api', re=re)
        baseline.functions('personal_learning_catalogue.py', helper.__dict__)
        activity = types.ModuleType('learner_api.personal_learning_activities')
        activity.handle_activity_request = Mock(return_value=None)
        policy = types.ModuleType('learner_api.personal_learning_policy')
        policy.component_for = baseline.policy.component_for
        patcher = patch.dict(sys.modules, {'learner_api.personal_learning':personal,
            'learner_api.personal_learning_catalogue':helper, 'learner_api.personal_learning_reads':reads,
            'learner_api.personal_learning_policy':policy, 'learner_api.personal_learning_activities':activity})
        patcher.start()
        self.addCleanup(patcher.stop)
        self.request.method = 'GET'

    def get(self, route='', mode='study', query=''):
        identity = f'pl.7.{mode}.MOD-A'
        self.detail['id'] = identity
        self.detail['personalLearning']['mode'] = mode
        self.request.GET = {'path': f'/learner_api/my-learning/commercial/{identity}/' + route + query}
        return self.ns['learner_request'](self.request,self.account,identity)

    def test_preview_all_learner_preview_and_saved_study_contract(self):
        for mode in ('all','preview','study'):
            with self.subTest(mode=mode):
                result = self.get('modules/current:MOD-A/',mode)
                self.assertEqual(result['subjectId'],'current:MOD-A')
                self.assertEqual(result['detail']['id'],f'pl.7.{mode}.MOD-A')
                self.assertEqual(result['detail']['components'],self.detail['components'])
                self.assertEqual(result['detail']['personalLearning']['mode'],mode)
                self.assertEqual(result['schedule'],self.schedule)
                self.assertEqual(result['metadata'],self.metadata)
                self.assertEqual(result['sessions'],[])
                self.assertIsNone(result['activity'])
                self.assertEqual(self.writes,0)
                self.cursor.execute.assert_not_called()

    def test_catalogue_uses_existing_personal_progress_and_identity(self):
        self.detail['componentProgress']=[{'componentId':'C1','passed':True}]
        result=self.get()
        self.assertEqual(result['learner']['id'],'pl.7.study.MOD-A')
        self.assertEqual(result['summary']['current'],{'subjects':1,'total':1,'completed':1,'percent':100.0})
        self.assertEqual(result['modules'][0]['status'],'Completed')
        self.assertEqual(result['modules'][0]['planModule']['start_date'],'2027-06-07')
        self.assertEqual(result['otjh'],{'actual':None,'planned':None})
        self.assertEqual(self.writes,0)

    def test_access_gates_are_returned_unchanged(self):
        self.detail['learningAccess']={'blocked':True,'startDate':'2027-06-07'}
        result=self.get('modules/current:MOD-A/','preview')
        self.assertEqual(result['detail']['learningAccess'],self.detail['learningAccess'])
        self.assertEqual(self.writes,0)

    def test_activity_deep_link_uses_exact_owned_component(self):
        self.assertEqual(self.get('modules/activity:C1/')['subjectId'],'current:MOD-A')
        for route in ('modules/activity:OTHER/', 'modules/current:MOD-B/', 'modules/legacy:10/'):
            with self.subTest(route=route), self.assertRaises(LookupError):
                self.get(route)

    def test_cross_account_role_identity_and_learner_kind_stay_forbidden(self):
        for role in ('staff','learner','employer'):
            self.account.role=role
            with self.assertRaises(PermissionError): self.get()
        self.account.role='admin'
        for path in ('/learner_api/my-learning/commercial/pl.8.all.MOD-A/',
                     '/learner_api/my-learning/commercial/pl.7.all.MOD-B/'):
            self.request.GET={'path':path}
            with self.assertRaises(PermissionError):
                self.ns['learner_request'](self.request,self.account,'pl.7.all.MOD-A')
        self.request.GET={'path':'/learner_api/my-learning/apprenticeship/pl.7.all.MOD-A/'}
        with self.assertRaises(LookupError):
            self.ns['learner_request'](self.request,self.account,'pl.7.all.MOD-A')

    def test_search_scope_pagination_and_validation(self):
        self.assertEqual(self.get('search/',query='?q=read')['matches'],[{'id':'current:MOD-A'}])
        self.assertEqual(self.get('search/',query='?q=read&offset=1')['matches'],[])
        self.assertEqual(self.get('search/',query='?q=another')['matches'],[])
        for query in ('?q=read&offset=-1','?q=read&offset=x','?q='+('x'*201)):
            with self.assertRaises(ValueError):self.get('search/',query=query)

    def test_forbidden_routes_and_writes_remain_rejected(self):
        for route in ('sync/','book/','modules/current:MOD-A/delete/'):
            with self.assertRaises(LookupError):self.get(route)
        for method in ('POST','PATCH','DELETE'):
            self.request.method=method
            with self.assertRaises(LookupError):self.get()
        self.assertEqual(self.writes,0)
        self.cursor.execute.assert_not_called()

    def test_upcoming_read_never_creates_live_participation(self):
        self.assertEqual(self.get('upcoming/'),{'upcoming':[]})
        self.assertEqual(self.writes,0)
        self.cursor.execute.assert_not_called()


if __name__=='__main__':
    if not sys.flags.isolated:
        raise RuntimeError('Use python -I for this isolated test')
    unittest.main()
