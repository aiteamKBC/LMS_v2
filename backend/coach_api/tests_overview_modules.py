"""Learner/coach source parity without database access or repair writes."""
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase
from learner_api.journal_sources import enabled
from old_otjh.service import ServiceError
from .overview_modules import project_module_overview, read_overview_modules


class OverviewModuleSourcesTests(SimpleTestCase):
    def read(self, *, history=True, fail=False, owner_id=101):
        context = SimpleNamespace(source=SimpleNamespace(pk=201),
                                  profile=SimpleNamespace(pk=101, enrolment_id=201))
        owner = {'id': owner_id, 'enrolment_id': 201}
        detail = {'studentActivityAvailable': history, 'modules': ['Native'],
                  'components': [{'moduleId': 'M1'}], 'quizAttempts': []}
        activity = {'subjects': [{'id': 50, 'name': 'Historical'}],
                    'activities': [{'group_id': 51, 'activity_id': 'A1'}]}
        schedule = {'modules': [], 'sessions': [], 'moduleLinks': {}, 'actual': [], 'actualAvailable': False}
        def learner_read(value):
            def read(*args, **kwargs):
                self.assertTrue(enabled(), 'Coach card must read the same journal as the learner')
                if fail:
                    raise RuntimeError('Source unavailable')
                return value
            return read
        with ExitStack() as stack:
            def mock(path, **kwargs):
                return stack.enter_context(patch(path, **kwargs))
            mock('coach_api.overview_modules.canonical_learning.require_profile', return_value=owner)
            mock('coach_api.overview_modules.connections', new={'enrolment': MagicMock()})
            native = mock('learner_api.learner_detail.build_learner_detail', side_effect=learner_read(detail))
            historical = mock('coach_api.overview_modules.canonical_learning.source_subjects', side_effect=learner_read(activity))
            mock('learner_api.student_activity._effective_current_subjects', side_effect=learner_read([{'id': 'M2', 'title': 'Empty'}]))
            metadata = mock('learner_api.student_activity._builder_subject_metadata', side_effect=learner_read(({}, {})))
            mock('learner_api.builder_activity_dates.read_builder_activity_dates', side_effect=learner_read({}))
            dashboard = mock('learner_api.training_plan_dashboard.read_dashboard', side_effect=learner_read(schedule))
            result = read_overview_modules(context)
            native.assert_called_once_with(context.source, 201, compact=True, read_only=True, quiz_view=True)
            dashboard.assert_called_once_with(context.source, section='overview')
            self.assertEqual(context.source._canonical_profile, owner)
            if history:
                self.assertEqual(historical.call_args.args[0], 201)
                self.assertEqual(historical.call_args.kwargs['owner'], owner)
                self.assertEqual(metadata.call_args.args[1], ['current:M1', 'current:M2', 'legacy:50', 'legacy:51'])
            else:
                historical.assert_not_called()
        return result

    def test_reads_native_historical_and_empty_assigned_modules_in_learner_scope(self):
        self.assertFalse(enabled())
        result = self.read()
        self.assertFalse(enabled())
        self.assertEqual(result['learning']['activity']['subjects'], [{'id': 50, 'name': 'Historical'}])
        self.assertEqual(result['learning']['metadata']['current_subjects'], [{'id': 'M2', 'title': 'Empty'}])

    def test_history_availability_matches_the_learner(self):
        self.assertIsNone(self.read(history=False)['learning']['activity'])
        self.assertFalse(enabled())

    def test_source_failure_is_not_reported_as_empty_progress_and_restores_scope(self):
        with self.assertRaisesRegex(RuntimeError, 'Source unavailable'):
            self.read(fail=True)
        self.assertFalse(enabled())

    def test_rejects_a_different_canonical_learner_before_reading_progress(self):
        with self.assertRaises(ServiceError):
            self.read(owner_id=999)
        self.assertFalse(enabled())

    def test_projection_retains_progress_inputs_but_excludes_content_and_personal_data(self):
        component = {'moduleId': 'M1', 'componentId': 'C1', 'expectedOtjh': 2, 'ksbMappings': []}
        attempt = {'quizId': 7, 'passed': True, 'grade': 1}
        historical = {'activity_id': 'A1', 'group_id': 50, 'completed': True}
        progress = {'M1': {'attendance': {'attended': 1, 'total': 2}, 'hours': {'actual': 2}, 'ksb': None}}
        result = project_module_overview(
            {'email': 'private@example.test', 'modules': ['Native'],
             'components': [{**component, 'contentHtml': 'private'}],
             'retiredQuizComponents': [{**component, 'description': 'private'}],
             'quizAttempts': [{**attempt, 'questions': ['private']}]},
            {'progress_basis': 'catalogue_activities', 'aptem_id': 999,
             'subjects': [{'id': 50, 'name': 'Historical', 'module_id': 'M1'}],
             'activities': [{**historical, 'record_ids': ['private']}]},
            {'covers': {'private': 'url'}, 'current_subjects': []},
            {'modules': [{'id': 'M1', 'total_otjh': 83, 'description': 'private'}],
             'sessions': [{'id': 'S1', 'moduleId': 'M1', 'joinUrl': 'private'}],
             'moduleLinks': {'legacy:50': {'id': 'M1'}}, 'actual': [],
             'actualAvailable': False, 'moduleProgress': progress, 'reviews': ['private']})
        learning = result['learning']
        self.assertEqual(learning['detail']['components'], [component])
        self.assertEqual(learning['detail']['retiredQuizComponents'], [component])
        self.assertEqual(learning['detail']['quizAttempts'], [attempt])
        self.assertEqual(learning['activity']['activities'], [historical])
        self.assertNotIn('email', learning['detail'])
        self.assertNotIn('aptem_id', learning['activity'])
        self.assertEqual(learning['metadata']['covers'], {})
        self.assertEqual(result['sessions'], [{'id': 'S1', 'moduleId': 'M1'}])
        self.assertEqual(result['moduleProgress'], progress)
        self.assertNotIn('reviews', result)
