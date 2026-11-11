"""Transfer rehearsal isolation, visible provenance and read-only content access."""
from copy import deepcopy
from collections import defaultdict
from contextlib import nullcontext
import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase
from old_otjh.service import ServiceError
from . import progress_demo as demo, student_activity as views, student_activity_data as data
from . import my_learning as learning
from . import tests_my_learning_no_db as catalogue_tests
from .tests_my_learning_no_db import component, metadata, native
from .tests_progress_transfer_no_db import item, saved
from .progress_transfer_policy import public_item
from . import progress_transfer as transfer, progress_transfer_store as store


def demo_course():
    return {'id':3, 'source_course_ref':'50', 'source_course_title':'Synthetic old module',
            'curriculum_module_ref':'M1', 'demo_progress':{'kind':'owner_requested_simulation',
            'percent':40, 'hours':0, 'excluded_activity_refs':['material:2']}}


class DemoIsolationTests(SimpleTestCase):
    def test_only_explicit_owned_admin_created_rehearsals_are_loaded(self):
        with patch.object(demo.canonical, 'query', return_value=[demo_course()]) as query:
            self.assertEqual(demo.courses_for({'id':9, 'enrolment_id':7}), [demo_course()])
        sql, params = query.call_args.args
        self.assertEqual(params, [9, 7])
        for gate in ('m.learner_id=%s', 'm.enrolment_id=%s', 'm.deleted_at IS NULL',
                     'owner_requested_simulation', 'verified_source_replacement', 'a."Role"=\'admin\''):
            self.assertIn(gate, sql)
        with patch.object(demo.canonical, 'query', return_value=[]):
            self.assertEqual(demo.courses_for({'id':10, 'enrolment_id':8}), [])

    def test_invalid_credit_cannot_introduce_hours_or_nonfinite_progress(self):
        for values in ({'percent':float('nan')}, {'percent':101}, {'percent':True}, {'hours':2}):
            row = demo_course(); row['demo_progress'].update(values)
            with self.subTest(values=values), patch.object(demo.canonical, 'query', return_value=[row]):
                with self.assertRaises(ServiceError): demo.courses_for({'id':9, 'enrolment_id':7})

    def test_activity_access_rejects_other_courses_exclusions_and_identity_conflicts(self):
        source = SimpleNamespace(pk=7, email='demo@example.test')
        owner = {'id':9, 'enrolment_id':7, 'email':source.email}
        with patch.object(demo.canonical, 'require_profile', return_value=owner), patch.object(demo, 'courses_for', return_value=[demo_course()]):
            self.assertEqual(demo.require_activity(source, 50, 1), owner)
            for group, activity in ((51,1), (50,2)):
                with self.assertRaises(LookupError): demo.require_activity(source, group, activity)
            source.email = 'someone-else@example.test'
            with self.assertRaises(LookupError): demo.require_activity(source, 50, 1)

    def test_rehearsal_exclusions_do_not_change_another_course(self):
        rows = [{'source_course_ref':course, 'source_activity_id':ref} for course in ('50','51')
                for ref in ('material:1','material:2')]
        original = deepcopy(rows)
        result = demo.catalogue([demo_course()], rows)
        self.assertEqual(len(result), 3)
        self.assertIn({'source_course_ref':'51','source_activity_id':'material:2'}, result)
        self.assertEqual(rows, original)

    def test_demo_percentage_is_retained_as_history_not_current_component_completion(self):
        harness = catalogue_tests.MyLearningAggregateTests()
        meta = metadata(); meta['replacement_courses'] = {'current:M1':'legacy:50'}
        definitions = [{'source_course_ref':'50','source_activity_id':'material:1','source_activity_title':'Old reading'}]
        content = native([component(str(i)) for i in range(10)])
        cards, _ = harness.cards(deepcopy(content), [demo_course()], definitions, meta=meta)
        self.assertEqual((cards[0]['id'],cards[0]['progress'],cards[0]['actualHours']), ('legacy:50',40,0))
        self.assertTrue(cards[0]['demoProgress']); self.assertEqual(cards[0]['completedActivityCount'],0)
        transfer = item(demoProgress=True, baselineCompletedIds=[]); transfer['hours'] = 0
        meta['progress_transfers'] = saved('approved', [transfer])['items']
        content['componentProgress'] = [{'componentId':'0','kind':'component'}]
        cards, _ = harness.cards(content, [demo_course()], definitions, meta=meta)
        self.assertEqual((cards[0]['id'],cards[0]['progress'],cards[0]['completedActivityCount']), ('current:M1',10,1))
        self.assertEqual(cards[0]['transferredProgress'], 40)
        self.assertTrue(cards[0]['demoProgress']); self.assertTrue(public_item(transfer)['demoProgress'])

    def test_demo_material_reader_keeps_membership_and_enrolment_scopes(self):
        cursor = MagicMock()
        with patch.object(data, '_dict_rows', return_value=[]):
            self.assertIsNone(data.read_student_material(cursor, None, 50, 1, demo_enrolment_id=7))
        sql, params = cursor.execute.call_args.args
        self.assertEqual(params, [1,7,50,'material:1'])
        self.assertIn('l.enrolment_id = %s', sql)
        self.assertIn('membership.learner_id=l.id', sql)
        self.assertIn('owner_requested_simulation', sql)
        with patch.object(data, '_dict_rows', return_value=[]): data.read_student_material(cursor, 20, 50, 1)
        self.assertIn('l.aptem_id = %s', cursor.execute.call_args.args[0])
        self.assertEqual(cursor.execute.call_args.args[1], [1,20,50,'material:1'])

    def test_search_excludes_unavailable_demo_content_in_the_owned_course_only(self):
        meta = metadata(); meta['modules'] = {}
        context = ([], [], [], native([]), [demo_course()], [], set(), set(), defaultdict(float), meta, [])
        with patch.object(learning, 'load_context', return_value=context), patch.object(demo.canonical,'query',return_value=[]) as query:
            self.assertEqual(learning.read_search(SimpleNamespace(pk=7), {'id':9}, 'missing', 0)['matches'], [])
        self.assertEqual(query.call_args.args[1], [[3], 'missing', ['50:material:2']])

    def test_learner_request_snapshots_demo_provenance_and_zero_hours(self):
        meta = metadata(); meta['current_subjects'] = [{'id':'M1','title':'New module'}]
        meta['record_ids'] = {}; meta['modules'] = {}
        context = ([], ['M1'], [], native([]), [demo_course()], [], set(), set(), {}, meta, [])
        card = {'id':'legacy:50','title':'Old module','progress':40,'actualHours':0,
                'activityCount':10,'completedActivityCount':0,'demoProgress':True}
        pending = saved(modules=[{**item(demoProgress=True),'hours':0}])
        cursor = MagicMock()
        with patch.object(store,'lock_learner',return_value=nullcontext(cursor)), \
                patch.object(store,'read_state',side_effect=[{'items':[]},pending]), \
                patch.object(transfer.canonical,'entries_for',return_value=[]), \
                patch.object(transfer,'available',return_value=(context,{'current:M1':'legacy:50'})), \
                patch.object(transfer,'uuid4',return_value=pending['items'][0]['requestId']), \
                patch.object(learning,'assemble_cards',return_value=([card],{})):
            result = transfer.create_request(SimpleNamespace(pk=7),'commercial',{'id':9},SimpleNamespace(id=20))
        snapshot = json.loads(cursor.execute.call_args_list[1].args[1][-1])
        self.assertEqual((snapshot['percent'],snapshot['hours'],snapshot['recordIds']), (40,0,[]))
        self.assertTrue(snapshot['demoProgress']); self.assertTrue(result['modules'][0]['demoProgress'])

    def test_preview_access_does_not_enable_attempt_writes_without_aptem(self):
        model = SimpleNamespace(all_learners=MagicMock(), DoesNotExist=LookupError)
        model.all_learners.only.return_value.get.return_value = SimpleNamespace(pk=7, aptem_id=None, email='demo@example.test')
        cursor = MagicMock(); connection = MagicMock(); connection.cursor.return_value.__enter__.return_value = cursor
        with patch.dict(views.SOURCE_MODELS, {'commercial':model}), patch.object(demo,'require_activity') as check, \
                patch.object(views,'_connection',return_value=connection), patch.object(views,'read_student_material',return_value={'title':'Demo'}) as read:
            with self.assertRaises(LookupError): views._owned_material('commercial',7,50,1)
            read.assert_not_called(); check.assert_not_called()
            self.assertEqual(views._owned_material('commercial',7,50,1,demo_preview=True), (None,{'title':'Demo'}))
            check.assert_called_once()
            read.assert_called_once_with(cursor,None,50,1,include_source=True,demo_enrolment_id=7)
            check.side_effect = LookupError('Not assigned')
            with self.assertRaises(LookupError): views._owned_material('commercial',8,50,1,demo_preview=True)
            self.assertEqual(read.call_count,1)
