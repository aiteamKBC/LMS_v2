"""Module-open regressions; all persistence and external services are mocked."""
from contextlib import ExitStack
from copy import deepcopy
import inspect
import json
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, patch

from django.test import SimpleTestCase, RequestFactory

from . import my_learning as learning
from . import canonical_learning as canonical
from .tests_my_learning_no_db import component, fake_connections, metadata, native
from .tests_progress_transfer_no_db import item, saved


class ModuleContextScopeTests(SimpleTestCase):
    def context(self, selected, kind, *, transfers=None, component_settings=None, imported_links=None):
        from . import (models, weekly_learning, student_activity, subject_origins,
                       previous_learning_groups, progress_transfer_store)
        plan = [{'moduleId': f'M{i}', 'moduleTitle': f'Module {i}',
                 'weeks': [{'components': [{'componentId': f'C{i}-{j}'} for j in range(80)]}]}
                for i in range(100)]
        plan.append({'moduleTitle': 'Historical CSV', 'weeks': []})
        source = SimpleNamespace(pk=7, id=7, aptem_id=7, learner_type=kind,
            programme='Programme', cohort='', group='',
            training_plan=deepcopy(plan) if kind == 'commercial' else None,
            learning_plan=deepcopy(plan) if kind == 'apprenticeship' else None)
        original = deepcopy((source.training_plan, source.learning_plan))
        manager = MagicMock()
        manager.only.return_value.filter.return_value.first.return_value = SimpleNamespace(pk=9, enrolment_id=7)
        builders = {f'current:M{i}': {'id': f'M{i}', 'title': f'Module {i}'} for i in range(100)}
        links = {'current:M1': 'legacy:50', 'current:M2': 'legacy:50'} if imported_links is None else imported_links
        connections = fake_connections()
        cursor = connections['enrolment'].cursor.return_value.__enter__.return_value
        cursor.fetchall.return_value = list((component_settings or {}).items())

        def content(selected_source, pk, **kwargs):
            assigned = kwargs['assigned_modules']
            # The selected source's snapshots must also be bounded, not only
            # the master-table query's assignment list.
            if selected and not selected.startswith('activity:'):
                from .mappers import get_training_plan
                self.assertEqual(get_training_plan(selected_source), assigned)
            return native([component(f"C{row['moduleId'][1:]}", row['moduleId'])
                           for row in assigned if row.get('moduleId')])

        with ExitStack() as stack:
            stack.enter_context(patch.object(models.LearnerProfile, 'objects', manager))
            stack.enter_context(patch.object(learning, 'connections', connections))
            stack.enter_context(patch.object(learning, 'effective_training_plan', return_value=plan))
            reader = stack.enter_context(patch.object(weekly_learning, 'build_learning_content_summary', side_effect=content))
            stack.enter_context(patch.object(canonical, 'entries_for', return_value=[]))
            stack.enter_context(patch.object(canonical, 'owned_source_courses', return_value=[
                {'id': 3, 'source_course_ref': '50', 'source_course_title': 'Old'}]))
            stack.enter_context(patch.object(student_activity, '_builder_subject_metadata', return_value=({}, builders)))
            stack.enter_context(patch.object(subject_origins, 'read_imported_courses', return_value=links))
            stack.enter_context(patch.object(subject_origins, 'read_replacement_courses', return_value={}))
            stack.enter_context(patch.object(previous_learning_groups, 'read_previous_learning_groups', return_value={}))
            stack.enter_context(patch.object(progress_transfer_store, 'read_state', return_value=transfers if transfers is not None else saved('approved')))
            result = learning.load_context(source, {'id': 9, 'progress_transfer_active': True}, selected)
        self.assertEqual((source.training_plan, source.learning_plan), original)
        return result, reader

    def test_imported_module_settings_are_loaded_for_pending_and_approved_matches(self):
        from .progress_transfer_matching import build_review, manual_completion
        from .replacement_learning import project_approved_learning
        settings = {'C1': {'legacySettings': {'sourceLessonId': 7, 'sourceMaterialKey': 'reading-7'}}}
        for kind in ('commercial', 'apprenticeship'):
            pending = saved(modules=[item(completedSourceActivities=['material:7'])])
            context, _ = self.context('current:M1', kind, transfers=pending,
                                     component_settings=settings, imported_links={'current:M1': 'legacy:50'})
            self.assertEqual(context[9]['replacement_settings'], settings)
            review = build_review(pending['items'][0]['requestId'], pending['items'], context)
            self.assertEqual(review['modules'][0]['sources'][0]['automaticTargetId'], 'C1')
            # A manually chosen target can carry different source provenance.
            transfer = saved('approved', modules=[item(completedSourceActivities=['material:8'])])
            transfer['items'][0]['matchedComponents'] = {'C1': manual_completion(
                transfer['items'][0], 'material:8', review['modules'][0]['targets'][0])}
            for links in ({'current:M1': 'legacy:50'}, {}):
                with self.subTest(kind=kind, links=links):
                    approved, _ = self.context('current:M1', kind, transfers=transfer,
                                              component_settings=settings, imported_links=links)
                    self.assertEqual(approved[9]['replacement_settings'], settings)
                    projected = project_approved_learning(approved[3]['components'],
                        approved[9]['replacement_settings'], transfer['items'])
                    self.assertTrue(projected[0]['previousLearning']['completed'])

    def test_current_module_reads_one_assignment_even_in_large_plans_for_both_kinds(self):
        for kind in ('commercial', 'apprenticeship'):
            for selected in ('current:M1', 'M1'):
                with self.subTest(kind=kind, selected=selected):
                    result, reader = self.context(selected, kind)
                    self.assertEqual(len(result[3]['components']), 1)
                    self.assertEqual([row['moduleId'] for row in reader.call_args.kwargs['assigned_modules']], ['M1'])
                    # Global membership/mapping stays intact for authorization
                    # and ambiguity checks before choosing old vs new content.
                    self.assertEqual(len(result[1]), 100)
                    self.assertEqual(result[9]['imported_courses'],
                        {'current:M1': 'legacy:50', 'current:M2': 'legacy:50'})
                    self.assertEqual(len(result[9]['progress_transfers']), 1)

    def test_old_course_opens_without_loading_any_new_course_components(self):
        result, reader = self.context('legacy:50', 'commercial')
        self.assertEqual(reader.call_args.kwargs['assigned_modules'], [])
        self.assertEqual(result[3]['components'], [])
        self.assertEqual(result[4][0]['source_course_ref'], '50')

    def test_unknown_module_cannot_load_unrelated_native_content(self):
        result, reader = self.context('current:FOREIGN', 'apprenticeship')
        self.assertEqual(reader.call_args.kwargs['assigned_modules'], [])
        self.assertNotIn('FOREIGN', result[1])

    def test_unlinked_course_keeps_only_its_own_snapshot(self):
        _, reader = self.context('unlinked:Historical CSV', 'apprenticeship')
        self.assertEqual(reader.call_args.kwargs['assigned_modules'],
                         [{'moduleTitle': 'Historical CSV', 'weeks': []}])

    def test_activity_deep_link_still_resolves_identity_across_the_full_plan(self):
        result, reader = self.context('activity:C1', 'commercial')
        self.assertEqual(len(reader.call_args.kwargs['assigned_modules']), 101)
        self.assertEqual(len(result[3]['components']), 100)


class TransferredModuleOpenTests(SimpleTestCase):
    def open_module(self, kind, status, *, new_completion=False, http=False, overlap=False, duplicate=False):
        from . import (weekly_learning, dashboard_training, training_plan_dashboard, live_session_progress,
                       teams_attendance, builder_activity_dates, subject_store)
        source = SimpleNamespace(pk=7, id=7, email='learner@example.test', programme='Programme',
            cohort='', group='', _case_file_profile=SimpleNamespace(pk=9))
        old = {'id': 3, 'source_course_ref': '50', 'source_course_title': 'Old'}
        components = [component(f'C{i}') for i in range(10)]
        if duplicate:
            components.append(component('C0'))
        snapshot = {'courseRef': 'legacy:50', 'activityId': 'catalogue:50:material:7',
            'sourceActivityId': 7, 'catalogueKind': 'material', 'completed': True}
        transfers = saved(status, [item(
            matchedComponents={'C0': snapshot}, baselineCompletedIds=[], baselinePercent=0)])
        content = native(components, id='7', week=[])
        if new_completion:
            content['componentProgress'] = [{'componentId': 'C1', 'kind': 'component'}]
        if overlap:
            content['componentProgress'].append({'componentId': 'C0', 'kind': 'component'})
        meta = metadata()
        meta.update(imported_courses={'current:M1': 'legacy:50'}, progress_transfers=transfers['items'],
                    replacement_settings={'C0': {'legacySettings': {'sourceLessonId': 7}}})
        context = ([{'moduleId': 'M1'}], ['M1'], [], content, [old], [], set(), set(), {}, meta, [])
        with ExitStack() as stack:
            stack.enter_context(patch.object(learning, 'load_context', return_value=context))
            stack.enter_context(patch.object(learning, 'connections', fake_connections()))
            stack.enter_context(patch.object(weekly_learning, 'build_learning_content_summary',
                side_effect=lambda *a, **kw: deepcopy(content) if kw['assigned_modules'] else native([], id='7', week=[])))
            historical = stack.enter_context(patch.object(canonical, 'source_subjects',
                return_value={'activities': [], 'subjects': [{'id': 50, 'name': 'Old'}]}))
            stack.enter_context(patch.object(dashboard_training, 'module_rows', return_value={'M1': {'id': 'M1', 'title': 'One'}}))
            stack.enter_context(patch.object(training_plan_dashboard, 'plan_sessions', return_value=[]))
            stack.enter_context(patch.object(live_session_progress, 'read_live_credits', return_value=[]))
            stack.enter_context(patch.object(teams_attendance, 'annotate_attendance_completion', side_effect=lambda rows, *a: rows))
            stack.enter_context(patch.object(builder_activity_dates, 'read_builder_activity_dates', return_value={}))
            stack.enter_context(patch.object(subject_store, 'covers_for', return_value={}))
            owner = {'id': 9, 'name': 'Synthetic'}
            if http:
                model = Mock()
                model.DoesNotExist = type('MissingLearner', (Exception,), {})
                model.all_learners.only.return_value.get.return_value = source
                stack.enter_context(patch.dict(learning.SOURCE_MODELS, {kind: model}))
                stack.enter_context(patch.object(canonical, 'require_profile', return_value=owner))
                # Exercise the real endpoint and Django JSON encoder. Only the
                # authentication wrapper is outside this isolated read fixture.
                response = inspect.unwrap(learning.my_learning)(RequestFactory().get('/'),
                    kind=kind, pk=7, subject_id='current:M1')
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response['Cache-Control'], 'private, no-store')
                result = json.loads(response.content)
            else:
                result = learning.read_module(source, kind, owner, 'current:M1')
        return result, historical

    def test_current_progress_deduplicates_overlap_and_placements_but_keeps_old_snapshot(self):
        for kind in ('commercial', 'apprenticeship'):
            result, _ = self.open_module(kind, 'approved', new_completion=True, overlap=True, duplicate=True, http=True)
            credit = result['metadata']['module_credits']['current:M1']
            self.assertEqual((credit['progress'], credit['transferredProgress'], credit['actualHours']), (20, 40, 2))
            self.assertEqual(result['detail']['componentProgress'], [
                {'componentId': 'C1', 'kind': 'component'}, {'componentId': 'C0', 'kind': 'component'}])

    def test_transferred_module_http_response_is_serializable_with_completion_credit(self):
        for kind in ('commercial', 'apprenticeship'):
            for completed, expected in ((False, 10), (True, 20)):
                with self.subTest(kind=kind, new_completion=completed):
                    result, _ = self.open_module(kind, 'approved', new_completion=completed, http=True)
                    self.assertNotIn('_completion', result['detail'])
                    self.assertEqual(result['metadata']['module_credits']['current:M1']['progress'], expected)
                    self.assertEqual(len(result['detail']['components']), 10)
                    self.assertTrue(result['detail']['components'][0]['previousLearning']['completed'])

    def test_pending_module_http_response_keeps_historical_content(self):
        for kind in ('commercial', 'apprenticeship'):
            with self.subTest(kind=kind):
                result, _ = self.open_module(kind, 'pending', http=True)
                self.assertEqual(result['subjectId'], 'legacy:50')
                self.assertTrue(result['metadata']['module_credits']['legacy:50']['transferPending'])

    def test_pending_transfer_still_opens_owned_old_course_for_both_kinds(self):
        for kind in ('commercial', 'apprenticeship'):
            result, historical = self.open_module(kind, 'pending')
            self.assertEqual(result['subjectId'], 'legacy:50')
            self.assertEqual(result['detail']['components'], [])
            self.assertEqual(historical.call_args.kwargs['course_ids'], ['50'])
            self.assertTrue(result['metadata']['module_credits']['legacy:50']['transferPending'])

    def test_approved_opens_new_content_and_matched_progress_without_counting_twice(self):
        for kind in ('commercial', 'apprenticeship'):
            for new_completion, expected in ((False, 10), (True, 20)):
                with self.subTest(kind=kind, new_completion=new_completion):
                    result, historical = self.open_module(kind, 'approved', new_completion=new_completion)
                    self.assertEqual(result['subjectId'], 'current:M1')
                    historical.assert_not_called()
                    self.assertEqual(len(result['detail']['components']), 10)
                    self.assertTrue(result['detail']['components'][0]['previousLearning']['completed'])
                    self.assertNotIn('previousLearning', result['detail']['components'][1])
                    self.assertEqual(result['detail']['quizAttempts'], [])
                    self.assertEqual(result['metadata']['module_credits']['current:M1']['progress'], expected)
