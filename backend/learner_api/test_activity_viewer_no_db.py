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
        identity.assert_called_once_with(source, 7, heal=False)

    def test_legacy_title_does_not_select_a_native_module_with_the_same_title(self):
        legacy = {'componentId': 'OLD', 'module': 'Same title'}
        native = {'componentId': 'NEW', 'module': 'Same title', 'moduleId': 'M1'}
        self.assertEqual(reader._activity_module_components([legacy, native], 'OLD'), [legacy])

    def project(self, selected='LIVE'):
        components = [
            {'componentId': 'LIVE', 'moduleId': 'M1', 'module': 'Module', 'type': 'live_session'},
            {'componentId': 'READ', 'moduleId': 'M1', 'module': 'Module', 'type': 'reading'},
            {'componentId': 'OTHER', 'moduleId': 'M2', 'module': 'Module', 'type': 'live_session'},
        ]
        detail = {'id': '7', 'modules': ['Module'], 'week': [], 'components': components, 'componentProgress': []}
        source = SimpleNamespace(programme='Programme')
        with ExitStack() as stack:
            def mock(name, **kwargs):
                return stack.enter_context(patch(name, **kwargs))
            prefix = 'learner_api.learner_detail.'
            writes = [mock(prefix + name) for name in ('advance_learner', 'hydrate_source_training_plan', 'persist_live_otjh_snapshot')]
            snapshot = mock(prefix + '_live_otjh_snapshot')
            mock(prefix + 'effective_training_plan', return_value=[])
            profile_read = mock(prefix + '_active_profile_for_source', return_value=SimpleNamespace(ksbs=['K1']))
            mock(prefix + 'to_learner_detail', return_value=detail)
            mock(prefix + 'access_gate', return_value={})
            mock(prefix + 'learning_access', return_value={})
            mock(prefix + '_apply_cohort_schedule')
            mock(prefix + '_resolve_from_master', return_value=(detail['modules'], [], components))
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
            profile_read.assert_called_once_with(source, 7, heal=False)
            self.assertEqual([row['componentId'] for row in attendance.call_args.args[0]], ['LIVE', 'READ'])
            self.assertEqual([row['componentId'] for row in credits.call_args.kwargs['components']], ['LIVE', 'READ'])
            self.assertEqual([row['componentId'] for row in result['components']], ['LIVE', 'READ', 'OTHER'])
            self.assertTrue(result['components'][0]['attendanceCompleted'])
            self.assertNotIn('attendanceCompleted', result['components'][2])
            return result

    def test_only_selected_module_attendance_and_no_programme_totals_or_writes(self):
        self.project()

    def test_unknown_component_is_not_replaced_with_another_activity(self):
        with self.assertRaises(ServiceError) as caught:
            self.project('MISSING')
        self.assertEqual(caught.exception.status, 404)

    def test_activity_read_returns_selected_reading_in_the_same_response(self):
        source = SimpleNamespace()
        model = SimpleNamespace(all_learners=SimpleNamespace(get=lambda **kwargs: source), DoesNotExist=LookupError)
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
