"""Transfer workflow contracts with all persistence/authentication mocked."""
from contextlib import nullcontext
from copy import deepcopy
from datetime import datetime, timezone
import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase, RequestFactory
from old_otjh.service import ServiceError
from . import progress_transfer as api, progress_transfer_store as store
from .progress_transfer_policy import eligible_pairs, frozen_records, merged_percent
from . import tests_my_learning_no_db as catalogue_tests
from .tests_my_learning_no_db import component, native, metadata


def item(course='50', module='M1', **extra):
    return dict(courseRef=f'legacy:{course}', moduleId=module, oldTitle='Old module', newTitle='New module',
                percent=40, hours=2, activityCount=10, completedActivityCount=4, recordIds=['1'], **extra)


def saved(status='pending', modules=None):
    return {'records': [], 'items': [dict(row, requestId='00000000-0000-0000-0000-000000000001', status=status,
        requestedAt='2026-10-19T09:00:00+00:00', approvedAt=None if status == 'pending' else '2026-10-19T10:00:00+00:00')
        for row in (modules or [item()])]}


class TransferPolicyTests(SimpleTestCase):
    def test_same_component_completed_in_both_systems_is_never_credited_twice(self):
        self.assertEqual(merged_percent(['shared', 'shared'], 10), 10)
        self.assertEqual(merged_percent(['shared', 'new', 'new'], 10), 20)

    def test_disjoint_completions_add_but_overlapping_completions_only_count_once(self):
        matched = list(map(str, range(6)))
        self.assertEqual(merged_percent([*matched, '6', '7'], 10), 80)
        self.assertEqual(merged_percent([*matched, '0', '1'], 10), 60)
        self.assertEqual(merged_percent([*matched, '0', '1', 'new'], 10), 70)

    def test_only_owned_assigned_unambiguous_courses_without_previous_transfer(self):
        links = {'current:M1': 'legacy:50', 'current:M2': 'legacy:51', 'current:M3': 'legacy:51',
                 'current:M4': 'legacy:52', 'current:M5': 'legacy:53'}
        self.assertEqual(eligible_pairs({}, links, {'legacy:50', 'legacy:51', 'legacy:53'}, {'M1','M2','M3','M4'}),
                         {'current:M1': 'legacy:50'})
        self.assertEqual(eligible_pairs({}, links, {'legacy:50'}, {'M1'}, [item()]), {})

    def test_current_total_controls_the_percentage_and_empty_modules_are_not_complete(self):
        self.assertEqual(merged_percent(['before'], 10), 10)
        self.assertEqual(merged_percent(['before', 'new'], 10), 20)
        self.assertEqual(merged_percent(['before', 'new'], 20), 10)
        self.assertEqual(merged_percent(['before', *map(str, range(9))], 10), 100)
        self.assertEqual(merged_percent([], 0), 0)
        self.assertEqual(merged_percent([], 10), 0)

    def test_freeze_preserves_history_and_other_courses_and_excludes_later_imports(self):
        def record(ident, course, **values):
            return dict(id=ident, source_system='old_lms', actual_seconds=3600, completed=False,
                        sources=[{'source_system':'old_lms', 'source_course_ref':course}], **values)
        snapshot = record(1, '50', reporting_month='2026-09')
        later = {**snapshot, 'actual_seconds':7200, 'completed':True}
        new_old = record(2, '50')
        other = record(3, '51')
        current = {**record(4, '50'), 'source_system':'new_lms', 'actual_seconds':300}
        state = {'items':[item()], 'records':[snapshot]}
        before = deepcopy([later,new_old,other,current,state])
        result = frozen_records([later,new_old,other,current], state)
        self.assertEqual(result,[snapshot,other,current])
        self.assertEqual([later,new_old,other,current,state],before)
        self.assertEqual(frozen_records([other],state,entry_ids=[3]),[other])
        self.assertEqual(frozen_records([],state),[snapshot])

    def test_local_legacy_attempts_freeze_but_native_saves_remain_independent(self):
        attempt = {'id':'subject:50:9', 'completed':True, 'accepted':False,
                   'sources':[{'source_system':'old_lms','source_course_ref':'50'}]}
        state={'items':[item()], 'records':[attempt]}
        native_save={'id':99, 'component_ref':'NEW', 'completed':True}
        later={**attempt, 'id':'subject:50:10'}
        self.assertEqual(frozen_records([later,native_save],state),[native_save,attempt])

    def test_later_import_with_only_explicit_source_reference_is_excluded(self):
        record={'id':2,'source_system':'old_lms','source_payload':'{"original_source_ref":"la:50:9"}'}
        self.assertEqual(frozen_records([record],{'items':[item()],'records':[]}),[])

    def test_canonical_reads_reapply_frozen_facts_after_current_attempt_projection(self):
        canonical=api.canonical
        snapshot={'id':1,'source_system':'old_lms','accepted':True,'actual_seconds':3600,'completed':False,
                  'sources':[{'source_system':'old_lms','source_course_ref':'50'}]}
        imported={**snapshot,'actual_seconds':7200,'completed':True}
        native_save={'id':3,'component_ref':'NEW','completed':True}
        state={'items':[item()],'records':[snapshot]}
        with patch.object(canonical,'query',return_value=[{'payload':imported,'sources':snapshot['sources']}]), \
             patch.object(canonical,'_ksb_not_excluded',return_value='TRUE'), \
             patch.object(store,'read_state',return_value=state), \
             patch.object(canonical,'current_records',return_value=[]) as current, \
             patch.object(canonical,'progress_records_with_completion',return_value=[imported,native_save]):
            result=canonical.entries_for({'id':9,'enrolment_id':7,'progress_transfer_active':True})
        self.assertEqual(current.call_args.args[1],[snapshot])
        self.assertEqual(result,[snapshot,native_save])
        self.assertEqual(sum(r.get('actual_seconds',0) for r in result),3600)


class TransferEndpointTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()

    def request(self, method='get', body=None, csrf=False):
        request = getattr(self.factory,method)('/learner_api/progress-transfer/commercial/7/',
            data=json.dumps(body or {'confirm':True}) if method == 'post' else {}, content_type='application/json')
        request._dont_enforce_csrf_checks = not csrf
        return request

    def test_only_own_learner_can_request_for_both_learner_types(self):
        for kind in ('commercial','apprenticeship'):
            with self.subTest(kind=kind), patch.object(api,'authenticate_request',return_value=SimpleNamespace(role='learner',subject_id=7,id=11)), \
                 patch.object(api,'source_owner',return_value=('source','owner')), patch.object(api,'create_request',return_value={'status':'pending'}) as create:
                response = api.learner_request(self.request('post'),kind=kind,pk=7)
                self.assertEqual(response.status_code,200)
                self.assertEqual(create.call_args.args[:3],('source',kind,'owner'))
                response = api.learner_request(self.request('post'),kind=kind,pk=8)
                self.assertEqual(response.status_code,404)
                self.assertEqual(create.call_count,1)

    def test_staff_employer_admin_cannot_submit_on_behalf_of_learner(self):
        for role in ('staff','employer','admin'):
            with patch.object(api,'authenticate_request',return_value=SimpleNamespace(role=role,subject_id=7)), patch.object(api,'create_request') as create:
                self.assertEqual(api.learner_request(self.request('post'),kind='commercial',pk=7).status_code,403)
                create.assert_not_called()

    def test_approval_is_admin_only_and_requires_csrf_and_confirmation(self):
        for role in ('learner','staff','employer'):
            with patch.object(api,'authenticate_request',return_value=SimpleNamespace(role=role)), patch.object(api,'approve_request') as approve:
                self.assertEqual(api.admin_requests(self.request('post'),request_id='id').status_code,403)
                approve.assert_not_called()
        with patch.object(api,'authenticate_request',return_value=SimpleNamespace(role='admin',id=9)), patch.object(api,'approve_request',return_value={'status':'approved'}) as approve:
            self.assertEqual(api.admin_requests(self.request('post',csrf=True),request_id='id').status_code,403)
            self.assertEqual(api.admin_requests(self.request('post',{'confirm':True,'learnerId':8}),request_id='id').status_code,400)
            approve.assert_not_called()
            self.assertEqual(api.admin_requests(self.request('post'),request_id='id').status_code,200)
            approve.assert_called_once()

    def test_anonymous_and_database_failure_never_report_success(self):
        with patch.object(api,'authenticate_request',return_value=None):
            self.assertEqual(api.learner_request(self.request(),kind='commercial',pk=7).status_code,401)
        with patch.object(api,'authenticate_request',return_value=SimpleNamespace(role='learner',subject_id=7)), \
             patch.object(api,'source_owner',side_effect=api.DatabaseError('private connection detail')):
            response = api.learner_request(self.request(),kind='commercial',pk=7)
            self.assertEqual(response.status_code,503)
            self.assertNotIn('private connection',response.content.decode())

    def test_component_review_is_admin_only_and_learner_cannot_supply_mappings(self):
        for role in ('learner', 'staff', 'employer'):
            with patch.object(api, 'authenticate_request', return_value=SimpleNamespace(role=role)), \
                    patch.object(api, 'review_request') as review:
                self.assertEqual(api.admin_requests(self.request(), request_id='R1').status_code, 403)
                review.assert_not_called()
        with patch.object(api, 'authenticate_request', return_value=SimpleNamespace(role='admin')), \
                patch.object(api, 'review_request', return_value={'reviewToken': 'token', 'modules': []}) as review:
            response = api.admin_requests(self.request(), request_id='R1')
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response['Cache-Control'], 'private, no-store')
            self.assertEqual(json.loads(response.content)['reviewToken'], 'token')
            review.assert_called_once_with('R1')
        with patch.object(api, 'authenticate_request', return_value=SimpleNamespace(role='learner', subject_id=7)), \
                patch.object(api, 'create_request') as create:
            self.assertEqual(api.learner_request(self.request('post', {'confirm': True, 'mappings': []}), kind='commercial', pk=7).status_code, 400)
            create.assert_not_called()


class TransferWorkflowTests(SimpleTestCase):
    def setUp(self):
        self.source = SimpleNamespace(pk=7,learner_type='commercial')
        self.owner = {'id':9,'enrolment_id':7}
        self.account = SimpleNamespace(id=11)

    def test_selected_module_freezes_only_its_old_records_and_retries_without_writes(self):
        for kind in ('commercial', 'apprenticeship'):
            with self.subTest(kind=kind):
                pending = saved()
                cursor = MagicMock()
                meta = metadata()
                meta.update(current_subjects=[{'id': 'M1', 'title': 'New'}, {'id': 'M2', 'title': 'Other'}],
                            record_ids={('50', 'material:1'): {'1'}, ('51', 'material:2'): {'2'}}, modules={})
                records = [{'id': 1, 'source_system': 'old_lms'}, {'id': 2, 'source_system': 'old_lms'},
                           {'id': 3, 'source_system': 'new_lms', 'module_ref': 'M1', 'completed': True}]
                context = ([], ['M1', 'M2'], records, native(), [], [],
                           {('50', 'material:1'), ('51', 'material:2')}, set(), {}, meta, [])
                card = dict(id='legacy:50', title='Old', progress=40, actualHours=1,
                            activityCount=10, completedActivityCount=1)
                with patch.object(store, 'lock_learner', return_value=nullcontext(cursor)), \
                     patch.object(store, 'read_state', side_effect=[{'items': []}, pending, pending]), \
                     patch.object(api.canonical, 'entries_for', return_value=records), \
                     patch.object(api, 'available', return_value=(context, {'current:M1': 'legacy:50', 'current:M2': 'legacy:51'})), \
                     patch('learner_api.my_learning.assemble_cards', return_value=([card], {})), \
                     patch.object(api, 'uuid4', return_value=pending['items'][0]['requestId']):
                    result = api.create_request(self.source, kind, self.owner, self.account, module_ids={'M1'})
                    self.assertEqual([row['moduleId'] for row in result['modules']], ['M1'])
                    self.assertEqual(cursor.execute.call_count, 2)
                    self.assertEqual(json.loads(cursor.execute.call_args_list[0].args[1][-1]), [records[0]])
                    snapshot = json.loads(cursor.execute.call_args_list[1].args[1][-1])
                    self.assertEqual(snapshot['completedSourceActivities'], ['material:1'])
                    self.assertEqual(api.create_request(self.source, kind, self.owner, self.account, module_ids={'M1'}), result)
                    self.assertEqual(cursor.execute.call_count, 2)

    def test_selected_ineligible_module_and_different_pending_request_never_write(self):
        for state, selected, message in [({'items': []}, {'FOREIGN'}, 'not eligible'),
                                         (saved(), {'M2'}, 'different modules'),
                                         ({'items': []}, set(), 'Choose eligible')]:
            with self.subTest(selected=selected):
                cursor = MagicMock()
                with patch.object(store, 'lock_learner', return_value=nullcontext(cursor)), \
                     patch.object(store, 'read_state', return_value=state), \
                     patch.object(api.canonical, 'entries_for', return_value=[]), \
                     patch.object(api, 'available', return_value=((), {'current:M1': 'legacy:50'})):
                    with self.assertRaisesMessage(ServiceError, message):
                        api.create_request(self.source, 'commercial', self.owner, self.account, module_ids=selected)
                    cursor.execute.assert_not_called()

    def test_one_request_snapshots_all_modules_and_retry_does_not_write(self):
        pending = saved(modules=[item(),item('51','M2')])
        cursor = MagicMock()
        meta = metadata()
        meta.update(current_subjects=[{'id':'M1','title':'New module'},{'id':'M2','title':'Second'}],
                    record_ids={('50','material:1'):{'1'},('51','material:2'):{'2'}},modules={})
        records = [{'id':1,'source_system':'old_lms','actual_seconds':3600},
                   {'id':2,'source_system':'old_lms','actual_seconds':7200}]
        context = ([],['M1','M2'],records,native(),[],[],{('50','material:1'),('99','material:8')},set(),{},meta,[])
        cards = [{'id':f'legacy:{course}','title':'Old module','progress':40,'actualHours':hours,'activityCount':10,'completedActivityCount':4}
                 for course,hours in [('50',1),('51',2)]]
        with patch.object(store,'lock_learner',return_value=nullcontext(cursor)), \
             patch.object(store,'read_state',side_effect=[{'items':[]},pending,pending]), \
             patch.object(api.canonical,'entries_for',return_value=records) as entries, \
             patch.object(api,'available',return_value=(context,{'current:M1':'legacy:50','current:M2':'legacy:51'})) as available, \
             patch('learner_api.my_learning.assemble_cards',return_value=(cards,{})), \
             patch.object(api,'uuid4',return_value=pending['items'][0]['requestId']):
            result = api.create_request(self.source,'commercial',self.owner,self.account)
            self.assertEqual(len(result['modules']),2)
            self.assertEqual(cursor.execute.call_count,3)
            payload = json.loads(cursor.execute.call_args_list[0].args[1][-1])
            self.assertEqual(payload,records)
            snapshots = [json.loads(call.args[1][-1]) for call in cursor.execute.call_args_list[1:]]
            self.assertEqual([snapshot['completedSourceActivities'] for snapshot in snapshots], [['material:1'], []])
            self.assertEqual(api.create_request(self.source,'commercial',self.owner,self.account),result)
            self.assertEqual(cursor.execute.call_count,3)
            entries.assert_called_once_with(self.owner)
            self.assertIs(available.call_args.kwargs['records'],records)

    def test_admin_approval_is_all_or_nothing_on_changed_mapping_and_idempotent(self):
        cursor = MagicMock(); cursor.fetchone.return_value=(7,'commercial')
        connection = MagicMock(); connection.cursor.return_value.__enter__.return_value=cursor
        meta=metadata(); meta['replacement_courses']={'current:M1':'legacy:50'}
        native_rows=native([component('BEFORE'),component('AFTER')]); native_rows['componentProgress']=[{'componentId':'BEFORE','kind':'component'}]
        meta['replacement_settings'] = {'AFTER': {'legacySettings': {'sourceLessonId': 7}}}
        context=([],['M1'],[],native_rows,[{'source_course_ref':'50'}],[],{('50','material:7')},set(),{},meta,[])
        pending=saved(); approved=saved('approved'); request_id=pending['items'][0]['requestId']
        with patch.object(api,'connections',{'enrolment':connection}),patch.object(store,'lock_learner',return_value=nullcontext(cursor)), \
             patch.object(store,'read_state',side_effect=[pending,approved,approved]), \
             patch.object(api,'source_owner',return_value=(self.source,self.owner)),patch('learner_api.my_learning.load_context',return_value=context):
            result=api.approve_request(request_id,self.account)
            self.assertEqual(result['status'],'approved')
            update=next(call for call in cursor.execute.call_args_list if call.args[0].startswith('UPDATE') and 'snapshot=' in call.args[0])
            self.assertEqual(json.loads(update.args[1][0])['baselineCompletedIds'],['BEFORE'])
            self.assertEqual(json.loads(update.args[1][0])['matchedComponents']['AFTER']['activityId'], 'catalogue:50:material:7')
            calls=cursor.execute.call_count
            self.assertEqual(api.approve_request(request_id,self.account),result)
            self.assertEqual(cursor.execute.call_count,calls+1)  # ownership lookup only
        cursor.reset_mock(); cursor.fetchone.return_value=(7,'commercial')
        meta['replacement_courses']={'current:M1':'legacy:51'}
        with patch.object(api,'connections',{'enrolment':connection}),patch.object(store,'lock_learner',return_value=nullcontext(cursor)), \
             patch.object(store,'read_state',return_value=pending),patch.object(api,'source_owner',return_value=(self.source,self.owner)), \
             patch('learner_api.my_learning.load_context',return_value=context):
            with self.assertRaisesMessage(ServiceError,'mapping changed'):
                api.approve_request(request_id,self.account)
            self.assertEqual(cursor.execute.call_count,1)

    def test_legacy_write_guard_is_scoped_to_the_learner_and_course(self):
        cursor=MagicMock();cursor.fetchone.return_value=(1,)
        with self.assertRaisesMessage(ServiceError,'stopped'):
            store.assert_legacy_writable(cursor,7,50)
        self.assertEqual(cursor.execute.call_args.args[1],[7,'legacy:50'])
        cursor.fetchone.return_value=None
        store.assert_legacy_writable(cursor,8,50)

    def test_approval_matches_only_completions_frozen_at_request_not_later_source_results(self):
        cursor = MagicMock(); cursor.fetchone.return_value = (7, 'commercial')
        connection = MagicMock(); connection.cursor.return_value.__enter__.return_value = cursor
        meta = metadata(); meta['replacement_courses'] = {'current:M1': 'legacy:50'}
        meta['replacement_settings'] = {key: {'legacySettings': {'sourceLessonId': ident}}
                                        for key, ident in [('FROZEN', 7), ('LATER', 8)]}
        context = ([], ['M1'], [], native([component('FROZEN'), component('LATER')]),
                   [{'source_course_ref': '50'}], [], {('50', 'material:8')}, set(), {}, meta, [])
        for refs, expected in [(['material:7'], ['FROZEN']), ([], [])]:
            with self.subTest(refs=refs):
                pending = saved(modules=[item(completedSourceActivities=refs)])
                cursor.reset_mock()
                with patch.object(api, 'connections', {'enrolment': connection}), \
                     patch.object(store, 'lock_learner', return_value=nullcontext(cursor)), \
                     patch.object(store, 'read_state', side_effect=[pending, saved('approved')]), \
                     patch.object(api, 'source_owner', return_value=(self.source, self.owner)), \
                     patch('learner_api.my_learning.load_context', return_value=context):
                    api.approve_request(pending['items'][0]['requestId'], self.account)
                update = next(call for call in cursor.execute.call_args_list if 'SET snapshot=' in call.args[0])
                snapshot = json.loads(update.args[1][0])
                self.assertEqual(sorted(snapshot['matchedComponents']), expected)
                self.assertEqual((snapshot['percent'], snapshot['hours']), (40, 2))
                self.assertTrue(all('INSERT' not in call.args[0] for call in cursor.execute.call_args_list))

    def test_confirmation_snapshots_the_same_journal_rules_as_the_learner_screen(self):
        from .journal_sources import enabled
        with patch.object(store,'lock_learner',return_value=nullcontext(MagicMock())), \
             patch.object(store,'read_state',return_value={'items':[]}), \
             patch.object(api.canonical,'entries_for',side_effect=lambda owner: self.assertTrue(enabled()) or []), \
             patch.object(api,'available',return_value=(None,{})):
            with self.assertRaises(ServiceError):
                api.create_request(self.source,'commercial',self.owner,self.account)
        self.assertFalse(enabled())

    def test_legacy_start_and_finish_enforce_freeze_inside_the_shared_lock(self):
        from . import subject_store
        cursor=MagicMock(); connection=MagicMock()
        connection.cursor.return_value.__enter__.return_value=cursor
        with patch.object(store,'lock_learner',return_value=nullcontext(cursor)) as lock, \
             patch.object(store,'assert_legacy_writable',side_effect=ServiceError('stopped','progress_transfer_locked',409)) as guard, \
             patch.object(subject_store,'connections',{'enrolment':connection}):
            with self.assertRaises(ServiceError):
                subject_store.start(7,8,50,1,{'available':True})
            with self.assertRaises(ServiceError):
                subject_store.finish(7,8,50,1,'attempt',{},True)
        self.assertEqual(lock.call_count,2)
        self.assertEqual(guard.call_count,2)
        cursor.execute.assert_not_called()

    def test_subject_panel_receives_only_approved_aggregate_credit(self):
        meta=metadata();meta['modules']={}
        context=([],[],[],native(),[],[],set(),set(),{},meta,[])
        with patch.object(store,'read_state',return_value=saved('approved')), \
             patch.object(api.canonical,'require_profile',return_value={'learner_type':'commercial'}), \
             patch.object(api,'source_owner',return_value=(self.source,self.owner)), \
             patch('learner_api.my_learning.load_context',return_value=context), \
             patch('learner_api.my_learning.assemble_cards',return_value=([{'id':'current:M1','progress':50,'actualHours':3,'transferredProgress':40}],{})):
            result=api.cover_transfer_metadata(7)
        self.assertEqual(result,{'approved_transfers':{'current:M1':'legacy:50'},
            'module_credits':{'current:M1':{'progress':50,'actualHours':3,'transferredProgress':40}}})


class TransferCatalogueTests(SimpleTestCase):
    def test_merge_keeps_a_started_native_attempt_in_progress_without_marking_it_complete(self):
        meta = metadata()
        meta['progress_transfers'] = saved('approved', [item(matchedComponents={})])['items']
        content = native([component('QUIZ', isQuiz=True, quizMeta={'quizId': 9})])
        attempt = {'componentId': 'QUIZ', 'quizId': 9, 'passed': False, 'grade': 0.2}
        content['quizAttempts'] = [attempt]
        cards, _ = catalogue_tests.MyLearningAggregateTests().cards(content, [], [], meta=meta)
        self.assertEqual((cards[0]['progress'], cards[0]['completedActivityCount'], cards[0]['status']), (0, 0, 'In progress'))
        self.assertEqual(content['quizAttempts'], [attempt])

    def test_merge_keeps_disjoint_native_progress_and_deduplicates_overlap_without_rewriting_history(self):
        harness = catalogue_tests.MyLearningAggregateTests()
        old = [{'source_course_ref': '50', 'source_course_title': 'Old'}]
        matched = {str(i): {'courseRef': 'legacy:50', 'activityId': f'catalogue:50:material:{i + 1}',
                           'sourceActivityId': i + 1, 'catalogueKind': 'material', 'completed': True}
                   for i in range(6)}
        for native_ids, expected in [(['6', '7'], 80), (['0', '1'], 60), (['0', '1', '6'], 70)]:
            with self.subTest(native_ids=native_ids):
                meta = metadata()
                meta['replacement_courses'] = {'current:M1': 'legacy:50'}
                meta['replacement_settings'] = {str(i): {'legacySettings': {'sourceLessonId': i + 1}} for i in range(6)}
                snapshot = item(matchedComponents=matched, baselineCompletedIds=native_ids, baselinePercent=20)
                snapshot['percent'] = 60
                original = deepcopy(snapshot)
                meta['progress_transfers'] = saved('approved', [snapshot])['items']
                content = native([*[component(str(i)) for i in range(10)], component('0'), component('OTHER', module='M2')])
                content['componentProgress'] = [{'componentId': ident, 'kind': 'component'} for ident in [*native_ids, 'OTHER']]
                cards, _ = harness.cards(content, old, [], meta=meta)
                card = next(row for row in cards if row['id'] == 'current:M1')
                self.assertEqual((card['progress'], card['activityCount'], card['completedActivityCount']), (expected, 10, expected // 10))
                self.assertEqual((card['transferredProgress'], card['actualHours']), (60, 2))
                self.assertEqual(next(row for row in cards if row['id'] == 'current:M2')['progress'], 100)
                self.assertEqual(snapshot, original)

    def test_old_components_before_approval_and_aggregate_credit_after_approval(self):
        harness=catalogue_tests.MyLearningAggregateTests()
        meta=metadata();meta['replacement_courses']={'current:M1':'legacy:50'}
        definitions=[{'source_course_ref':'50','source_activity_id':'material:1','source_activity_title':'Original reading'}]
        courses=[{'id':3,'source_course_ref':'50','source_course_title':'Old'}]
        content=native([component(str(i)) for i in range(10)])
        cards,_=harness.cards(deepcopy(content),courses,definitions,meta=meta)
        self.assertEqual([card['id'] for card in cards],['legacy:50'])
        meta['progress_transfers']=saved()['items']
        cards,_=harness.cards(deepcopy(content),courses,definitions,meta=meta)
        self.assertEqual(cards[0]['progress'],40)
        self.assertTrue(cards[0]['transferPending'])
        meta['progress_transfers']=saved('approved',[item(baselineCompletedIds=[])])['items']
        content['componentProgress']=[{'componentId':'0','kind':'component'}]
        cards,summary=harness.cards(content,courses,definitions,meta=meta)
        self.assertEqual([card['id'] for card in cards],['current:M1'])
        self.assertEqual(cards[0]['completedActivityCount'],1)
        self.assertEqual(cards[0]['progress'],10)
        self.assertEqual(cards[0]['transferredProgress'],40)
        self.assertEqual(cards[0]['actualHours'],2)
        self.assertEqual(summary['current']['percent'],10)
        self.assertFalse(any('previousLearning' in row for row in content['components']))
