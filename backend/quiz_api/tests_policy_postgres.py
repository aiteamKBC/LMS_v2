"""Submission rules, per-quiz settings and retained best scores on real PostgreSQL."""
from copy import deepcopy
from importlib import import_module
import json
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from django.conf import settings
from django.db import connections, transaction
from django.test import RequestFactory

from learner_api import quizzes
from learner_api.models import LearnerProgressEntry
from . import views
from .models import QuizPackage, QuizAnswer
from .policy import attempt_stats, default_settings, visible_learner_attempts
from .tests_history_postgres import QuizHistoryPostgresTests as History, execute


@unittest.skipUnless(getattr(settings, 'QUIZ_HISTORY_POSTGRES_TESTS', False), 'Use the isolated PostgreSQL runner')
class QuizPolicyPostgresTests(unittest.TestCase):
    setUp = History.setUp
    record = History.record
    save = History.save
    snapshot = History.snapshot
    submission_context = History.submission_context
    submit = History.submit
    concurrent = History.concurrent

    def test_forward_removal_with_present_and_absent_table_preserves_all_quiz_data(self):
        from django.db.migrations.loader import MigrationLoader
        connection = connections['default']
        loader = MigrationLoader(connection)
        before = list(QuizPackage.objects.order_by('pk').values())
        old = import_module('quiz_api.migrations.0006_quiz_policies')
        new = import_module('quiz_api.migrations.0007_remove_quiz_defaults')
        for present in (True, False):
            with self.subTest(present=present), transaction.atomic():
                with connection.schema_editor() as editor:
                    if present:
                        editor.execute('''CREATE TABLE curriculum.quiz_defaults (
                            id integer PRIMARY KEY, general jsonb, grades jsonb)''')
                        editor.execute("INSERT INTO curriculum.quiz_defaults VALUES(1,'{}','{}')")
                    state = loader.project_state([('quiz_api', '0006_quiz_policies')])
                    state = new.Migration('0007_remove_quiz_defaults', 'quiz_api').apply(state, editor)
                self.assertNotIn(('quiz_api', 'quizdefaults'), state.models)
                self.assertIsNone(execute("SELECT to_regclass('curriculum.quiz_defaults')")[0][0])
                self.assertEqual(list(QuizPackage.objects.order_by('pk').values()), before)

    def test_fresh_policy_install_followed_by_removal_keeps_per_quiz_columns(self):
        from django.db.migrations.loader import MigrationLoader
        connection = connections['default']
        state = MigrationLoader(connection).project_state([('quiz_api', '0005_learner_question_foreign_key')])
        with transaction.atomic():
            execute('ALTER TABLE curriculum.quizzes DROP COLUMN policy_enabled, DROP COLUMN attempt_limit, DROP COLUMN grade_settings')
            with connection.schema_editor() as editor:
                for name in ('0006_quiz_policies', '0007_remove_quiz_defaults'):
                    migration = import_module('quiz_api.migrations.' + name).Migration(name, 'quiz_api')
                    state = migration.apply(state, editor)
                    self.assertIsNone(execute("SELECT to_regclass('curriculum.quiz_defaults')")[0][0])
            self.assertNotIn(('quiz_api', 'quizdefaults'), state.models)
            self.assertIsNone(execute("SELECT to_regclass('curriculum.quiz_defaults')")[0][0])
            self.assertEqual(execute('SELECT policy_enabled,attempt_limit,grade_settings FROM curriculum.quizzes WHERE id=%s', [self.quiz.pk]), [(False, 3, None)])
            transaction.set_rollback(True)

    def test_retired_api_is_not_routable(self):
        from django.urls import Resolver404, resolve
        with self.assertRaises(Resolver404):
            resolve('/defaults/', urlconf='quiz_api.urls')

    def enable(self, **values):
        QuizPackage.objects.filter(pk=self.quiz.pk).update(policy_enabled=True, **values)

    def test_one_remaining_attempt_is_enforced_inside_the_learner_lock(self):
        self.enable(limit_attempts=True, attempt_limit=1, retake_after_pass=True)
        view = self.submission_context()
        barrier = threading.Barrier(2)
        save = quizzes.save_progress_record

        def competing(*args, **kwargs):
            barrier.wait(timeout=10)
            return save(*args, **kwargs)

        with patch.object(quizzes, 'save_progress_record', side_effect=competing):
            replies = self.concurrent(lambda _: self.submit(view), range(2))
        self.assertEqual(sorted(code for code, _ in replies), [200, 409])
        rejected = next(data for code, data in replies if code == 409)
        self.assertEqual(rejected['code'], 'quiz_attempt_limit')
        self.assertEqual(LearnerProgressEntry.objects.filter(learner=self.learner).count(), 1)
        self.audit.assert_called_once()
        self.award.assert_called_once()
        self.learner.refresh_from_db()
        self.assertEqual(self.learner.completed_hours, 12)

    def test_retake_after_pass_is_blocked_without_mutating_history(self):
        self.enable(retake_after_pass=False)
        view = self.submission_context()
        self.assertEqual(self.submit(view)[0], 200)
        before = self.snapshot()
        status, reply = self.submit(view)
        self.assertEqual((status, reply['code']), (409, 'quiz_already_passed'))
        self.assertEqual(self.snapshot(), before)

    def test_lower_retake_keeps_best_score_and_both_original_grades(self):
        self.enable(retake_after_pass=True)
        view = self.submission_context()
        self.assertEqual(self.submit(view)[0], 200)
        first = LearnerProgressEntry.objects.get(learner=self.learner)
        original = LearnerProgressEntry.objects.filter(pk=first.pk).values().get()
        wrong = QuizAnswer.objects.get(question=self.question, is_correct=False)
        status, reply = self.submit(view, payload={'answers': {str(self.question.pk): wrong.pk}})
        self.assertEqual((status, reply['grade'], reply['quizPolicy']['bestGrade']), (200, 0, 1))
        self.assertTrue(reply['quizPolicy']['passed'])
        self.assertEqual(LearnerProgressEntry.objects.filter(pk=first.pk).values().get(), original)
        self.assertEqual(list(LearnerProgressEntry.objects.filter(learner=self.learner)
                              .order_by('attempt').values_list('grade', flat=True)), [1, 0])

    def test_legacy_rules_are_not_activated_by_an_unrelated_edit(self):
        QuizPackage.objects.filter(pk=self.quiz.pk).update(limit_attempts=True, attempt_limit=1, retake_after_pass=False)
        response = views.quiz_detail(RequestFactory().patch('/quiz/', json.dumps({'title': 'Retained quiz'}),
                                     content_type='application/json'), self.quiz.pk)
        self.assertEqual(response.status_code, 200)
        self.quiz.refresh_from_db()
        self.assertFalse(self.quiz.policy_enabled)
        view = self.submission_context()
        self.assertEqual([self.submit(view)[0] for _ in range(2)], [200, 200])

    def test_explicit_enable_applies_rules_to_future_attempts_only(self):
        self.save()
        before = self.snapshot()
        response = views.quiz_detail(RequestFactory().patch('/quiz/', json.dumps({
            'policyEnabled': True, 'limitAttempts': True, 'attemptLimit': 1, 'retakeAfterPass': True}),
            content_type='application/json'), self.quiz.pk)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.submit(self.submission_context())[0], 409)
        self.assertEqual(self.snapshot(), before)

    def test_inactive_profile_cannot_return_false_submission_success(self):
        view = self.submission_context()
        before = self.snapshot()
        with patch.object(quizzes, 'learner_profile_for_source', return_value=None):
            self.assertEqual(self.submit(view)[0], 409)
        self.assertEqual(self.snapshot(), before)
        self.audit.assert_not_called()

    def test_hidden_answer_keys_are_not_returned_but_are_retained_for_staff(self):
        self.enable(show_correct_answer=False, retake_after_pass=True)
        status, reply = self.submit(self.submission_context())
        self.assertEqual(status, 200)
        self.assertIsNone(reply['breakdown'][0]['correctAnswer'])
        self.assertNotIn('correctText', reply['attempt']['questions'][0])
        self.assertNotIn('correctAnswerId', reply['attempt']['questions'][0])
        self.assertEqual(self.learner.training_plan_progress[0]['questions'][0]['correctText'], 'Four')

    def test_manual_creation_saves_settings_questions_and_creator_together(self):
        payload = {'title': 'New configured quiz', 'status': 'published', 'duration': 15,
                   'passingGrade': 0, 'limitAttempts': True, 'attemptLimit': 2, 'retakeAfterPass': True,
                   'gradeSettings': default_settings()['grades'], 'initialQuestions': [
                       {'text': 'Choose', 'questionType': 'single_choice', 'answers': [
                           {'text': 'Yes', 'isCorrect': True}, {'text': 'No', 'isCorrect': False}]}]}
        request = RequestFactory().post('/quiz/', json.dumps(payload), content_type='application/json')
        request.login_account = SimpleNamespace(role='staff', display_name='Synthetic creator', email='staff@example.invalid')
        with patch.object(views, '_match_programme_catalogue_id', return_value=''), \
             patch.object(views, '_sync_quiz_assignment_count', side_effect=lambda quiz: quiz):
            response = views.create_quiz_with_questions(request)
        self.assertEqual(response.status_code, 201, response.content)
        saved = QuizPackage.objects.get(pk=json.loads(response.content)['id'])
        self.assertEqual((saved.duration, saved.passing_grade, saved.attempt_limit), (15, 0, 2))
        self.assertTrue(saved.policy_enabled)
        self.assertEqual(saved.retake_points_cut, 0)
        self.assertEqual(saved.author, 'Synthetic creator')
        self.assertEqual(saved.quiz_questions.count(), 1)

    def test_invalid_settings_are_rejected_without_partial_updates(self):
        before = QuizPackage.objects.values().get(pk=self.quiz.pk)
        for values in ({'attemptLimit': 0}, {'passingGrade': 101}, {'limitAttempts': 'false'},
                       {'retakePointsCut': 5}, {'gradeSettings': {'rows': []}}):
            request = RequestFactory().patch('/quiz/', json.dumps({'title': 'Must not save', **values}),
                                             content_type='application/json')
            self.assertEqual(views.quiz_detail(request, self.quiz.pk).status_code, 400)
            self.assertEqual(QuizPackage.objects.values().get(pk=self.quiz.pk), before)

    def test_learner_history_visibility_does_not_modify_staff_evidence(self):
        self.save()
        self.enable(show_correct_answer=False, attempt_history=True)
        detail = {'quizAttempts': self.learner.training_plan_progress}
        original = deepcopy(detail)
        redacted = visible_learner_attempts(detail)
        self.assertNotIn('correctText', redacted['quizAttempts'][0]['questions'][0])
        self.assertNotIn('correctAnswerId', redacted['quizAttempts'][0]['questions'][0])
        self.assertEqual(detail, original)
        self.enable(attempt_history=False)
        hidden = visible_learner_attempts(detail)
        self.assertEqual(hidden['quizAttempts'][0]['questions'], [])
        self.assertEqual(hidden['quizAttempts'][0]['grade'], original['quizAttempts'][0]['grade'])
        self.assertEqual(detail, original)

    def test_best_grade_compares_legacy_percent_and_decimal_without_rewriting(self):
        first = self.save()
        LearnerProgressEntry.objects.filter(pk=first.pk).update(grade=85)
        second = self.save()
        LearnerProgressEntry.objects.filter(pk=second.pk).update(grade=.9)
        before = self.snapshot()
        self.assertEqual(attempt_stats(self.learner, self.quiz.pk)['best'], .9)
        self.assertEqual(self.snapshot(), before)

    def test_new_draft_cannot_be_submitted(self):
        self.enable(status='draft')
        status, reply = self.submit(self.submission_context())
        self.assertEqual((status, reply['code']), (409, 'quiz_not_published'))
        self.assertFalse(LearnerProgressEntry.objects.filter(learner=self.learner).exists())

    def test_configured_answer_order_is_preserved_without_exposing_the_key(self):
        quiz = {'policyEnabled': True, 'randomizeAnswers': False, 'questions': [
            {'id': 1, 'text': 'Choose', 'type': 'single_choice', 'points': 1, 'answers': [
                {'id': 11, 'text': 'First', 'isCorrect': True},
                {'id': 12, 'text': 'Second', 'isCorrect': False}]}]}
        with patch.object(quizzes.random, 'shuffle') as shuffle:
            safe = quizzes._scrub_answer_key(quiz)
        self.assertEqual(safe['questions'][0]['answers'], [{'id': 11, 'text': 'First'}, {'id': 12, 'text': 'Second'}])
        shuffle.assert_not_called()

    def test_new_quiz_uses_local_initial_settings_without_global_table(self):
        self.assertIsNone(execute("SELECT to_regclass('curriculum.quiz_defaults')")[0][0])
        request = RequestFactory().post('/quiz/', json.dumps({'title': 'Local settings', 'attemptLimit': 2}), content_type='application/json')
        request.login_account = SimpleNamespace(role='admin', display_name='Synthetic admin', email='admin@example.invalid')
        with patch.object(views, '_match_programme_catalogue_id', return_value=''), \
             patch.object(views, '_sync_quiz_assignment_count', side_effect=lambda quiz: quiz):
            response = views.quizzes(request)
        self.assertEqual(response.status_code, 201, response.content)
        created = QuizPackage.objects.get(pk=json.loads(response.content)['id'])
        self.assertEqual((created.policy_enabled, created.limit_attempts, created.attempt_limit, created.retake_after_pass), (True, False, 2, True))
        self.assertEqual(created.grade_settings, default_settings()['grades'])
        response = views.quiz_detail(RequestFactory().patch('/quiz/', json.dumps({'title': 'Renamed'}), content_type='application/json'), created.pk)
        self.assertEqual(response.status_code, 200)
        created.refresh_from_db()
        self.assertEqual(created.attempt_limit, 2)
        self.quiz.refresh_from_db()
        self.assertFalse(self.quiz.policy_enabled)

    def test_mobile_projection_redacts_learner_answers_without_touching_saved_evidence(self):
        from learner_api import mobile
        self.save()
        self.enable(show_correct_answer=False, attempt_history=True)
        detail = {'quizAttempts': self.learner.training_plan_progress}
        original = deepcopy(detail)
        request = SimpleNamespace(mobile_context=(None, SimpleNamespace(pk=1), 'commercial', self.learner))
        with patch.object(mobile, 'build_learner_detail', return_value=detail):
            result = mobile._detail(request)
        self.assertNotIn('correctText', result['quizAttempts'][0]['questions'][0])
        self.assertEqual(detail, original)

    def test_legacy_unlimited_duration_and_explicit_empty_text_are_preserved(self):
        request = RequestFactory().patch('/quiz/', json.dumps({'duration': 0, 'lessonContent': None,
            'shortDescription': None}), content_type='application/json')
        response = views.quiz_detail(request, self.quiz.pk)
        self.assertEqual(response.status_code, 200)
        self.quiz.refresh_from_db()
        self.assertEqual((self.quiz.duration, self.quiz.lesson_content, self.quiz.short_description), (0, '', ''))
        self.assertFalse(self.quiz.policy_enabled)
