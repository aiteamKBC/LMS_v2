"""Activity projection guards; all persistence and network work is mocked."""
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase, RequestFactory
from old_otjh.service import ServiceError
from . import learner_detail as reader


class ActivityViewerProjectionTests(SimpleTestCase):
    def test_sidebar_learning_schedule_does_not_read_unused_programme_targets(self):
        from . import training_plan_dashboard as schedule
        source = SimpleNamespace(pk=7, email='', _canonical_profile={'id': 1})
        connection = MagicMock()
        with patch.object(schedule, 'connections', {'enrolment': connection}), \
             patch.object(schedule, 'plan_module_ids', return_value=([], {})), \
             patch.object(schedule.canonical_learning, 'targets_for') as targets, \
             patch.object(schedule.canonical_learning, 'entries_for') as ledger, \
             patch.object(schedule, 'plan_sessions') as sessions:
            result = schedule.read_dashboard(source, section='learning')
        self.assertEqual(result['modules'], [])
        self.assertEqual(result['moduleLinks'], {})
        for unused in (targets, ledger, sessions):
            unused.assert_not_called()

    def test_read_only_profile_resolution_does_not_heal_identity_links(self):
        source = SimpleNamespace()
        with patch.object(reader, 'learner_profile_for_source', return_value=None) as identity:
            self.assertIsNone(reader._active_profile_for_source(source, 7, heal=False))
        expected_fields = tuple(
            field.name for field in reader.LearnerProfile._meta.concrete_fields
            if field.name != 'programme'
        )
        identity.assert_called_once_with(
            source, 7, fields=expected_fields, heal=False,
        )

    def test_legacy_title_does_not_select_a_native_module_with_the_same_title(self):
        legacy = {'componentId': 'OLD', 'module': 'Same title'}
        native = {'componentId': 'NEW', 'module': 'Same title', 'moduleId': 'M1'}
        self.assertEqual(reader._activity_module_components([legacy, native], 'OLD'), [legacy])

    def test_activity_scope_is_constrained_to_the_assigned_module(self):
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchone.return_value = ('M1',)
        cursor.fetchall.return_value = [('LIVE',), ('READ',)]
        plan = [
            {'moduleId': 'M1', 'weeks': []},
            {'moduleId': 'M2', 'weeks': []},
        ]
        with patch.object(reader, 'connections', {'enrolment': connection}):
            scoped, module_ids, component_ids = reader._activity_plan_scope(plan, 'LIVE')
        self.assertEqual(scoped, [plan[0]])
        self.assertEqual(module_ids, ['M1'])
        self.assertEqual(component_ids, ['LIVE', 'READ'])
        self.assertEqual(cursor.execute.call_args_list[0].args[1], ['LIVE', ['M1', 'M2']])
        self.assertEqual(cursor.execute.call_args_list[1].args[1], ['M1'])

    def test_activity_scope_rejects_a_component_outside_assigned_modules(self):
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchone.return_value = None
        with patch.object(reader, 'connections', {'enrolment': connection}), \
             self.assertRaises(ServiceError) as caught:
            reader._activity_plan_scope([{'moduleId': 'M1', 'weeks': []}], 'OTHER')
        self.assertEqual(caught.exception.status, 404)
        self.assertEqual(cursor.execute.call_count, 1)

    def test_activity_scope_preserves_an_exact_legacy_snapshot(self):
        legacy = {
            'moduleTitle': 'Legacy',
            'weeks': [{'components': [{'componentId': 'OLD'}, {'componentId': 'NEXT'}]}],
        }
        with patch.object(reader, 'connections') as connections:
            scoped, module_ids, component_ids = reader._activity_plan_scope([legacy], 'OLD')
        self.assertEqual(scoped, [legacy])
        self.assertEqual(module_ids, [])
        self.assertEqual(component_ids, ['NEXT', 'OLD'])
        connections.__getitem__.assert_not_called()

    def test_quiz_scope_keeps_every_assigned_module_that_exposes_the_target(self):
        plan = [{'moduleId': 'M1'}, {'moduleId': 'M2'}, {'moduleId': 'M3'}]
        identity = {'components': [
            {'moduleId': 'M1', 'quizMeta': {'quizId': 77}},
            {'moduleId': 'M2', 'quizMeta': {'quizId': 77}},
            {'moduleId': 'M3', 'quizMeta': {'quizId': 78}},
        ]}
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchall.return_value = [('C1',), ('C2',)]
        with patch('learner_api.weekly_learning.build_learning_content_summary', return_value=identity) as content, \
             patch.object(reader, 'connections', {'enrolment': connection}):
            scoped, module_ids, component_ids = reader._quiz_plan_scope(
                SimpleNamespace(), 7, plan, 77,
            )
        self.assertEqual(scoped, plan[:2])
        self.assertEqual(module_ids, ['M1', 'M2'])
        self.assertEqual(component_ids, ['C1', 'C2'])
        self.assertEqual(content.call_args.kwargs['quiz_id'], 77)
        self.assertEqual(content.call_args.kwargs['progress'], ([], [], []))
        self.assertEqual(cursor.execute.call_args.args[1], [['M1', 'M2']])

    def test_quiz_scope_rejects_an_unassigned_quiz_without_progress_or_attendance(self):
        with patch('learner_api.weekly_learning.build_learning_content_summary',
                   return_value={'components': []}), \
             patch.object(reader, 'connections') as connections, \
             self.assertRaises(ServiceError) as caught:
            reader._quiz_plan_scope(SimpleNamespace(), 7, [{'moduleId': 'M1'}], 77)
        self.assertEqual(caught.exception.status, 404)
        connections.__getitem__.assert_not_called()

    def project(self, selected='LIVE'):
        components = [
            {'componentId': 'LIVE', 'moduleId': 'M1', 'module': 'Module', 'type': 'live_session'},
            {'componentId': 'READ', 'moduleId': 'M1', 'module': 'Module', 'type': 'reading'},
            {'componentId': 'OTHER', 'moduleId': 'M2', 'module': 'Module', 'type': 'live_session'},
        ]
        scoped_components = components[:2]
        detail = {'id': '7', 'modules': ['Module'], 'week': [], 'components': scoped_components, 'componentProgress': []}
        source = SimpleNamespace(programme='Programme')
        with ExitStack() as stack:
            def mock(name, **kwargs):
                return stack.enter_context(patch(name, **kwargs))
            prefix = 'learner_api.learner_detail.'
            writes = [mock(prefix + name) for name in ('advance_learner', 'hydrate_source_training_plan', 'persist_live_otjh_snapshot')]
            snapshot = mock(prefix + '_live_otjh_snapshot')
            mock(prefix + 'effective_training_plan', return_value=[{'moduleId': 'M1'}, {'moduleId': 'M2'}])
            scope = mock(prefix + '_activity_plan_scope',
                         return_value=([{'moduleId': 'M1'}], ['M1'], ['LIVE', 'READ']))
            profile_read = mock(prefix + '_active_profile_for_source', return_value=SimpleNamespace(ksbs=['K1']))
            detail_mapper = mock(prefix + 'to_learner_detail', return_value=detail)
            mock(prefix + 'access_gate', return_value={})
            mock(prefix + 'learning_access', return_value={})
            mock(prefix + '_apply_cohort_schedule')
            mock(prefix + '_resolve_from_master', return_value=(detail['modules'], [], scoped_components))
            mock(prefix + '_apply_programme_assignment_template', side_effect=lambda rows, programme: rows)
            mock(prefix + '_annotate_otjh', side_effect=lambda rows: (rows, 0))
            mock(prefix + '_append_week_quizzes', side_effect=lambda weeks, rows, **kwargs: (weeks, rows))
            mock(prefix + 'retain_quiz_progress')
            attendance = mock('learner_api.teams_attendance.annotate_attendance_completion',
                              side_effect=lambda rows, profile: [{**row, 'attendanceCompleted': True} for row in rows])
            mock('learner_api.replacement_learning.annotate_replacement_learning', side_effect=lambda rows, pk: rows)
            credits = mock('learner_api.live_session_progress.read_live_credits', return_value=[])
            mock('learner_api.live_session_progress.supplement_component_progress', side_effect=lambda rows, credits: rows)
            result = reader.build_learner_detail(source, 7, compact=True, read_only=True,
                                                activity_component_id=selected)
            for operation in [*writes, snapshot]:
                operation.assert_not_called()
            scope.assert_called_once_with([{'moduleId': 'M1'}, {'moduleId': 'M2'}], selected)
            profile_read.assert_called_once_with(
                source, 7, heal=False,
                progress_module_ids=['M1'], progress_component_ids=['LIVE', 'READ'],
            )
            detail_mapper.assert_called_once_with(
                source, profile_read.return_value, training_plan=[{'moduleId': 'M1'}],
            )
            self.assertEqual([row['componentId'] for row in attendance.call_args.args[0]], ['LIVE', 'READ'])
            self.assertEqual([row['componentId'] for row in credits.call_args.kwargs['components']], ['LIVE', 'READ'])
            self.assertEqual([row['componentId'] for row in result['components']], ['LIVE', 'READ'])
            self.assertTrue(result['components'][0]['attendanceCompleted'])
            return result

    def test_only_selected_module_attendance_and_no_programme_totals_or_writes(self):
        self.project()

    def test_unknown_component_is_not_replaced_with_another_activity(self):
        with self.assertRaises(ServiceError) as caught:
            self.project('MISSING')
        self.assertEqual(caught.exception.status, 404)

    def test_activity_read_returns_selected_reading_in_the_same_response(self):
        source = SimpleNamespace()
        sources = MagicMock()
        sources.defer.return_value = sources
        sources.get.return_value = source
        model = SimpleNamespace(all_learners=sources, DoesNotExist=LookupError)
        detail = {'id': '7', 'components': [{'componentId': 'R1', 'type': 'reading'}]}
        request = RequestFactory().get('/learner_api/learner-detail/commercial/7/',
                                       {'content': 'activity', 'component_id': 'R1'})
        with patch.dict(reader.SOURCE_MODELS, {'commercial': model}), \
             patch.object(reader, 'build_learner_detail', return_value=detail) as build, \
             patch.object(reader, '_reading_content', return_value={'componentId': 'R1', 'contentHtml': '<p>Reading</p>'}):
            response = reader.learner_detail.__wrapped__(request, 'commercial', 7)
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, '<p>Reading</p>')
        self.assertEqual(build.call_args.kwargs, {'compact': True, 'read_only': True, 'activity_component_id': 'R1'})
