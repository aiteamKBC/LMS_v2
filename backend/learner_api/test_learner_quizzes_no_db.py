"""Quiz catalogue regressions; no database writes or external services."""
import json
import os
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.db import DatabaseError
from django.test import RequestFactory, SimpleTestCase

from . import learner_detail, learner_quizzes as quizzes


class QuizListTests(SimpleTestCase):
    def test_owned_import_lineage_restores_slot_without_rewriting_attempt_evidence(self):
        detail = {'components': [{'componentId': 'Q1', 'moduleId': 'M', 'isQuiz': True}],
                  'quizAttempts': [{'quizId': 'quiz:21', 'componentId': 'quiz:21', 'passed': True,
                                    'grade': None, 'startedAt': '2026-01-02', 'submittedAt': ''}]}
        before = deepcopy(detail)
        cursor = MagicMock()
        cursor.fetchall.return_value = [('quiz:21', 'Q1', 'M')]
        with patch.object(quizzes.connections['enrolment'], 'cursor') as connection:
            connection.return_value.__enter__.return_value = cursor
            quizzes.retain_imported_quiz_progress(detail, SimpleNamespace(id=7))
        self.assertEqual(detail['quizAttempts'], [{**before['quizAttempts'][0], 'componentId': 'Q1'}])
        self.assertEqual(detail['components'], before['components'])
        sql, params = cursor.execute.call_args.args
        self.assertEqual(params, [7, ['Q1'], ['quiz:21']])
        self.assertIn('membership.learner_id=s.learner_id', sql)
        self.assertIn("module.source_type='mba-legacy' AND module.source_id=c.source_course_ref", sql)
        self.assertIn('p.learner_id=s.learner_id', sql)
        self.assertIn('p.deleted_at IS NULL', sql)

    def test_unowned_unassigned_or_ambiguous_imports_cannot_award_a_slot(self):
        for rows in ([], [('quiz:21', 'FOREIGN', 'M')], [('quiz:21', 'Q1', 'OTHER')],
                     [('quiz:21', 'Q1', 'M'), ('quiz:21', 'Q2', 'M')]):
            with self.subTest(rows=rows):
                detail = {'components': [{'componentId': cid, 'moduleId': 'M', 'isQuiz': True} for cid in ('Q1', 'Q2')],
                          'quizAttempts': [{'quizId': 'quiz:21', 'componentId': 'quiz:21', 'passed': True}]}
                before = deepcopy(detail)
                with patch.object(quizzes.connections['enrolment'], 'cursor') as connection:
                    connection.return_value.__enter__.return_value.fetchall.return_value = rows
                    quizzes.retain_imported_quiz_progress(detail, SimpleNamespace(id=7))
                self.assertEqual(detail, before)

    def test_failed_and_already_linked_attempts_do_not_request_import_history(self):
        detail = {'components': [{'componentId': 'Q1', 'moduleId': 'M', 'isQuiz': True}],
                  'quizAttempts': [{'quizId': 'quiz:21', 'componentId': 'quiz:21', 'passed': False},
                                   {'quizId': 'quiz:22', 'componentId': 'quiz:22', 'passed': None},
                                   {'quizId': 'quiz:23', 'componentId': 'Q1', 'passed': True}]}
        before = deepcopy(detail)
        with patch.object(quizzes.connections['enrolment'], 'cursor') as connection:
            quizzes.retain_imported_quiz_progress(detail, SimpleNamespace(id=7))
            connection.assert_not_called()
        self.assertEqual(detail, before)

    def test_import_lookup_failure_remains_visible(self):
        detail = {'components': [{'componentId': 'Q1', 'moduleId': 'M', 'isQuiz': True}],
                  'quizAttempts': [{'quizId': 'quiz:21', 'componentId': 'quiz:21', 'passed': True}]}
        with patch.object(quizzes.connections['enrolment'], 'cursor', side_effect=DatabaseError('unavailable')):
            with self.assertRaises(DatabaseError):
                quizzes.retain_imported_quiz_progress(detail, SimpleNamespace(id=7))

    def test_catalogue_reads_only_active_owned_progress_without_hours_or_answers(self):
        source = SimpleNamespace(pk=17, username='Synthetic learner', programme='Programme', cohort='C')
        entries = MagicMock()
        entries.filter.return_value.exclude.return_value.values_list.return_value = [
            ('quiz', True, 'Q1', '21', None, None, None),
            ('quiz', False, 'Q2', '22', .2, None, None),
            ('quiz', None, 'Q3', '23', None, None, None)]
        components = [{'componentId': f'Q{i}', 'moduleId': 'M', 'module': 'Module',
                       'week': 'Week 1', 'component': f'Quiz {i}', 'isQuiz': True,
                       'quizMeta': {'quizId': 20+i, 'questions': 5},
                       'contentHtml': 'private body'} for i in range(1, 4)]
        components.append({'componentId': 'R1', 'moduleId': 'M', 'component': 'Reading', 'isQuiz': False})
        snapshot = {'module': 'Historical snapshot'}
        with patch.object(quizzes, 'effective_training_plan', return_value=[{'moduleId': 'M'}]), \
             patch.object(quizzes, 'request_preset_cache', return_value={}), \
             patch.object(quizzes, 'get_training_plan', return_value=[{'moduleId': 'M'}, snapshot]), \
             patch.object(quizzes, 'flatten_training_plan', return_value=([], [], [])) as flatten, \
             patch.object(learner_detail, '_resolve_from_master', return_value=(['Module'], [], components)) as master, \
             patch.object(learner_detail, '_append_week_quizzes', return_value=([], components)), \
             patch.object(quizzes, 'learner_profile_for_source', return_value=SimpleNamespace(progress_entries=entries)) as identity, \
             patch.object(learner_detail, '_live_otjh_snapshot', side_effect=AssertionError('hours read')), \
             patch.object(learner_detail, 'build_learner_detail', side_effect=AssertionError('full detail')):
            result = quizzes.read_quiz_list(source, 17)
        identity.assert_called_once_with(source, 17, heal=False, fields=('id', 'enrolment_id'))
        flatten.assert_called_once_with([snapshot])
        self.assertTrue(master.call_args.kwargs['identities_only'])
        self.assertTrue(master.call_args.kwargs['catalogue_facts'])
        self.assertFalse(master.call_args.kwargs['live_session_ids'])
        self.assertFalse(master.call_args.kwargs['expected_otjh'])
        entries.filter.assert_called_once_with(deleted_at__isnull=True)
        fields = entries.filter.return_value.exclude.return_value.values_list.call_args.args
        self.assertNotIn('answers', fields)
        self.assertNotIn('source_payload', fields)
        self.assertEqual([a['passed'] for a in result['quizAttempts']], [True, False, None])
        self.assertIsNone(result['quizAttempts'][0]['grade'])
        self.assertEqual(len(result['components']), 3)
        self.assertNotIn('contentHtml', result['components'][0])
        self.assertNotIn('actualOtjh', result)

    def test_endpoint_preserves_role_and_learner_scope_for_both_kinds(self):
        from login import permissions
        source = SimpleNamespace(pk=17)
        model = MagicMock()
        model.DoesNotExist = type('MissingLearner', (Exception,), {})
        model.all_learners.get.return_value = source
        for kind in ('commercial', 'apprenticeship'):
            for role, subject, status in (('learner', 17, 200), ('learner', 18, 404),
                                          ('staff', 3, 200), ('employer', 3, 403)):
                with self.subTest(kind=kind, role=role, subject=subject), \
                     patch.dict(os.environ, {'LEARNER_API_REQUIRE_AUTH': '1'}), \
                     patch.object(permissions, 'authenticate_request', return_value=SimpleNamespace(role=role, subject_id=subject)), \
                     patch.dict(learner_detail.SOURCE_MODELS, {kind: model}), \
                     patch.object(quizzes, 'read_quiz_list', return_value={'id': '17', 'components': [], 'quizAttempts': []}) as read, \
                     patch.object(learner_detail, 'build_learner_detail', side_effect=AssertionError('full detail')):
                    response = learner_detail.learner_detail(RequestFactory().get('/', {'content': 'quiz-list'}), kind=kind, pk=17)
                    self.assertEqual(response.status_code, status)
                    self.assertEqual(read.call_count, int(status == 200))
                    if status == 200:
                        self.assertEqual(response['Cache-Control'], 'private, no-store')
                        self.assertEqual(json.loads(response.content)['id'], '17')

    def test_database_failure_is_not_returned_as_an_empty_success(self):
        model = MagicMock()
        model.DoesNotExist = type('MissingLearner', (Exception,), {})
        with patch.dict(os.environ, {'LEARNER_API_REQUIRE_AUTH': '0'}), \
             patch.dict(learner_detail.SOURCE_MODELS, {'commercial': model}), \
             patch.object(quizzes, 'read_quiz_list', side_effect=DatabaseError('unavailable')):
            response = learner_detail.learner_detail(RequestFactory().get('/', {'content': 'quiz-list'}), kind='commercial', pk=17)
        self.assertEqual(response.status_code, 502)
