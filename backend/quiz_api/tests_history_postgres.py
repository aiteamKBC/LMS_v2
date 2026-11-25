"""Real FK, rollback and competing-connection coverage; use the isolated runner."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack
from datetime import timedelta
import json
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from uuid import uuid4

from django.conf import settings
from django.db import DatabaseError, IntegrityError, connections, transaction
from django.test import RequestFactory
from django.utils import timezone
from psycopg import sql

from learner_api import active_users, quizzes
from learner_api.models import (LearnerProfile, LearnerProgressEntry, LearnerProgressKsb,
                               LearnerQuizAnswer, LearnerQuizChosenAnswer, LearnerQuizCorrectAnswer)
from . import views
from .history import is_question_reference_violation
from .models import QuizPackage, QuizQuestion, QuizAnswer
from curriculum_api.management.commands import import_mba_quizzes as importer


MODELS = (QuizPackage, QuizQuestion, QuizAnswer, LearnerProfile, LearnerProgressEntry,
          LearnerProgressKsb, LearnerQuizAnswer, LearnerQuizChosenAnswer, LearnerQuizCorrectAnswer)


def execute(statement, params=(), alias='default'):
    with connections[alias].cursor() as cursor:
        cursor.execute(statement, params)
        return cursor.fetchall() if cursor.description else []


def prepare_database():
    """Only called after the runner verifies an empty disposable database."""
    execute('CREATE SCHEMA curriculum; CREATE SCHEMA "Learner"; CREATE SCHEMA enrolment')
    # Provision current unmanaged model columns without their unrelated foreign
    # tables. Install the two actual constraints exercised below explicitly.
    for model in MODELS:
        fields = [field for field in model._meta.local_fields if getattr(field, 'db_constraint', False)]
        try:
            for field in fields:
                field.db_constraint = False
            with connections['default'].schema_editor() as editor:
                editor.create_model(model)
        finally:
            for field in fields:
                field.db_constraint = True
    for model in (QuizPackage, QuizQuestion, QuizAnswer):
        for field in model._meta.local_fields:
            if field.primary_key or field.is_relation:
                continue
            if getattr(field, 'auto_now', False) or getattr(field, 'auto_now_add', False):
                default = sql.SQL('CURRENT_TIMESTAMP')
            elif field.has_default() or field.empty_strings_allowed:
                default = sql.Literal(field.get_default())
            else:
                continue
            execute(sql.SQL('ALTER TABLE {} ALTER COLUMN {} SET DEFAULT {}').format(
                sql.SQL(model._meta.db_table), sql.Identifier(field.column), default))
    execute('''ALTER TABLE "Learner".learner_quiz_answers ADD CONSTRAINT test_progress_history_fk
        FOREIGN KEY(progress_id) REFERENCES "Learner".learner_progress_entries(id) ON DELETE CASCADE;
        CREATE INDEX learner_quiz_answers_question_idx ON "Learner".learner_quiz_answers(question_ref);
        CREATE UNIQUE INDEX learner_progress_tracking_session_uq
        ON "Learner".learner_progress_entries(time_tracking_session_ref)
        WHERE time_tracking_session_ref <> '';
        ALTER TABLE "Learner".learner_progress_entries
            ADD COLUMN source_payload jsonb,
            ADD COLUMN source_system text,
            ADD COLUMN actual_basis text,
            ADD COLUMN reporting_month text;
        CREATE TABLE enrolment."Created_users"(id bigint PRIMARY KEY);
        CREATE TABLE curriculum.coaches(id text PRIMARY KEY,name text,email text);
        CREATE TABLE curriculum.components(id text PRIMARY KEY,module_catalogue_id text,settings_json jsonb,deleted_at timestamptz,is_programme_deleted boolean);
        CREATE TABLE curriculum.modules(module_catalogue_id text PRIMARY KEY,deleted_at timestamptz);
        CREATE TABLE curriculum.weeks(id text PRIMARY KEY,module_catalogue_id text,deleted_at timestamptz,is_programme_deleted boolean);
        CREATE TABLE curriculum.week_template_components(settings_json jsonb);
        CREATE TABLE curriculum.quiz_component_links(id bigserial PRIMARY KEY,quiz_id bigint,component_id text);
        CREATE TABLE curriculum.quiz_course_links(id bigserial PRIMARY KEY,quiz_id bigint,module_catalogue_id text,week_id text)''')
    from .tests_question_fk_migration_postgres import apply_migration
    apply_migration()
    from importlib import import_module
    with connections['default'].schema_editor() as editor:
        import_module('quiz_api.migrations.0007_remove_quiz_defaults').remove_defaults(None, editor)


@unittest.skipUnless(getattr(settings, 'QUIZ_HISTORY_POSTGRES_TESTS', False), 'Use the isolated PostgreSQL runner')
class QuizHistoryPostgresTests(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.object(views, '_ensure_quiz_assessment_type_column'))
        self.stack.enter_context(patch.object(active_users, '_component_learning_context', return_value={}))
        self.stack.enter_context(patch.object(active_users, 'component_reference_state', return_value=('active', '')))
        self.stack.enter_context(patch.object(active_users, 'current_component_fk', return_value=None))
        self.stack.enter_context(patch('learner_api.activity_time_history.attendance_baseline', return_value=0))
        # Points are an external post-commit consumer, not a prerequisite for saving quiz history.
        self.award = self.stack.enter_context(patch('engagement_api.hooks.award_for_progress'))
        self.audit = self.stack.enter_context(patch.object(quizzes, 'record_quiz_attempt'))
        self.quiz = QuizPackage.objects.create(title='Synthetic quiz', status='published')
        self.question = QuizQuestion.objects.create(quiz=self.quiz, question_text='Two plus two?', question_type='single_choice')
        self.answer = QuizAnswer.objects.create(question=self.question, answer_text='Four', is_correct=True)
        QuizAnswer.objects.create(question=self.question, answer_text='Five', is_correct=False)
        self.learner = LearnerProfile.objects.create(full_name='Synthetic learner',
            email=uuid4().hex+'@example.invalid', lifecycle_status='active', completed_hours=12)
        self.learner.enrolment_id = self.learner.pk + 1000000
        self.learner.save(update_fields=['enrolment_id'])
        execute('INSERT INTO enrolment."Created_users" VALUES(%s)', [self.learner.enrolment_id])

    def record(self, *, session=None):
        return {'kind':'quiz', 'quizId':self.quiz.pk, 'attempt':999,
                'passed':True, 'grade':1.0, 'achievedScore':1, 'totalScore':1,
                'timeTaken':'00:05:00', 'verifiedSeconds':300, 'claimedSeconds':300,
                'reportedTime':'5 minutes', 'timeTrackingSessionId':session or uuid4().hex,
                'submittedAt':timezone.now().isoformat(),
                'questions':[{'questionId':self.question.pk, 'questionText':'Two plus two?',
                              'type':'single_choice', 'possible':1, 'chosenText':'Four',
                              'correctText':'Four', 'chosenAnswerId':self.answer.pk,
                              'correctAnswerId':[self.answer.pk], 'correct':True, 'earned':1}]}

    def save(self, **kwargs):
        record = self.record(**kwargs)
        progress = active_users.save_progress_record(self.learner, record)
        self.assertEqual(record['attempt'], progress.attempt)
        return progress

    def snapshot(self):
        return {model._meta.db_table:list(model.objects.order_by().values()) for model in
                (LearnerProfile, LearnerProgressEntry, LearnerProgressKsb, LearnerQuizAnswer,
                 LearnerQuizChosenAnswer, LearnerQuizCorrectAnswer)}

    def remove_questions(self, questions=()):
        request = RequestFactory().post('/questions/', json.dumps({'removeMissing':True, 'questions':list(questions)}),
                                        content_type='application/json')
        # Existing publication validation requires at least one active question.
        QuizPackage.objects.filter(pk=self.quiz.pk).update(status='draft')
        return views.quiz_questions(request, self.quiz.pk)

    def test_remove_archives_referenced_and_deletes_only_unused_questions(self):
        self.save()
        unused = QuizQuestion.objects.create(quiz=self.quiz, question_text='Unused')
        other = QuizQuestion.objects.create(quiz=QuizPackage.objects.create(title='Other'), question_text='Other')
        before = self.snapshot()
        response = self.remove_questions()
        self.assertEqual(response.status_code, 200)
        self.question.refresh_from_db()
        self.assertTrue(self.question.is_archived)
        self.assertTrue(QuizAnswer.objects.filter(pk=self.answer.pk).exists())
        self.assertFalse(QuizQuestion.objects.filter(pk=unused.pk).exists())
        self.assertTrue(QuizQuestion.objects.filter(pk=other.pk).exists())
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(quizzes._fetch_quiz(self.quiz.pk)['questions'], [])

    def test_unused_question_removal_still_hard_deletes(self):
        self.assertEqual(self.remove_questions().status_code, 200)
        self.assertFalse(QuizQuestion.objects.filter(pk=self.question.pk).exists())

    def test_used_quiz_delete_is_409_even_with_archived_question(self):
        self.save()
        QuizQuestion.objects.filter(pk=self.question.pk).update(is_archived=True)
        before = self.snapshot()
        response = views.quiz_detail(RequestFactory().delete('/quiz/'), self.quiz.pk)
        self.assertEqual(response.status_code, 409)
        self.assertTrue(QuizPackage.objects.filter(pk=self.quiz.pk).exists())
        self.assertEqual(self.snapshot(), before)

    def test_unused_quiz_delete_still_deletes_content(self):
        response = views.quiz_detail(RequestFactory().delete('/quiz/'), self.quiz.pk)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content), {'deleted':True})
        self.assertFalse(QuizPackage.objects.filter(pk=self.quiz.pk).exists())
        self.assertFalse(QuizQuestion.objects.filter(pk=self.question.pk).exists())

    def command(self):
        command = importer.Command()
        command.stats = dict.fromkeys(('quizzes','updated','questions','answers','historical_quiz'), 0)
        command.problems = []
        command.programme_id = 'SYNTHETIC'
        command.dry_run = command.skip_existing = False
        command.component_row = lambda _: {'id':'TEST','week_id':'W1','settings':{}}
        command.existing_quiz = lambda _: (self.quiz.pk, importer.AUTHOR)
        command.link_component = self.stack.enter_context(patch.object(command, 'link_component'))
        return command

    def material(self):
        return {'component_id':'TEST','title':'Replacement quiz','quiz_definition':{'questions':[
            {'question_text':'Replacement?', 'question_type':'single_choice',
             'answer_options':[{'option_text':'Yes','is_correct':True}, {'option_text':'No','is_correct':False}]}]}}

    def test_reimport_retains_used_quiz_questions_answers_and_history(self):
        self.save()
        before = self.snapshot()
        content = list(QuizQuestion.objects.filter(quiz=self.quiz).values())
        command = self.command()
        command.import_one(self.material(), 'M1','Module','Programme')
        self.assertEqual(command.stats['historical_quiz'], 1)
        self.assertEqual(command.stats['updated'], 0)
        self.assertTrue(command.problems)
        command.link_component.assert_not_called()
        self.assertEqual(list(QuizQuestion.objects.filter(quiz=self.quiz).values()), content)
        self.assertEqual(self.snapshot(), before)
        self.quiz.refresh_from_db()
        self.assertEqual(self.quiz.title, 'Synthetic quiz')

    def test_reimport_unused_quiz_keeps_existing_functionality(self):
        command = self.command()
        command.import_one(self.material(), 'M1','Module','Programme')
        self.assertEqual(command.stats['updated'], 1)
        self.assertFalse(QuizQuestion.objects.filter(pk=self.question.pk).exists())
        self.assertEqual(list(QuizQuestion.objects.filter(quiz=self.quiz).values_list('question_text',flat=True)), ['Replacement?'])
        command.link_component.assert_called_once()

    def submission_context(self):
        self.stack.enter_context(patch.object(quizzes, '_programme_quiz_context', return_value=(SimpleNamespace(pk=77), {'componentId':''}, None)))
        self.stack.enter_context(patch.object(quizzes, 'learner_profile_for_source', return_value=self.learner))
        self.stack.enter_context(patch.object(quizzes, 'resolve_completion_instants', return_value=(None, '')))
        self.stack.enter_context(patch.object(quizzes, 'verify_tracking_session', side_effect=lambda token, **kwargs: {
            'sessionId':token, 'startedAt':timezone.now()-timedelta(minutes=5), 'claimedSeconds':300,
            'verifiedSeconds':300,'serverSessionSeconds':300,'source':'server','calculation':'synthetic'}))
        view = quizzes.submit_quiz_attempt
        while hasattr(view, '__wrapped__'):
            view = view.__wrapped__
        return view

    def submit(self, view, token=None, *, kind='commercial', learner_id=77, payload=None):
        request = RequestFactory().post(f'/quiz/?kind={kind}&learnerId={learner_id}',
            json.dumps({'answers':{str(self.question.pk):self.answer.pk}, 'trackingToken':token or uuid4().hex,
                        'timeTakenSeconds':300, **(payload or {})}), content_type='application/json')
        response = view(request, self.quiz.pk)
        return response.status_code, json.loads(response.content)

    def concurrent(self, fn, values):
        start = threading.Barrier(len(values))
        def worker(value):
            try:
                start.wait(timeout=10)
                return fn(value)
            finally:
                connections.close_all()
        with ThreadPoolExecutor(max_workers=len(values)) as pool:
            return list(pool.map(worker, values))

    def test_concurrent_submissions_use_fresh_persisted_numbers_and_audit(self):
        view = self.submission_context()
        # Both requests finish their pre-save checks with the same history.
        barrier = threading.Barrier(2)
        original = quizzes.save_progress_record
        def competing(*args, **kwargs):
            barrier.wait(timeout=10)
            return original(*args, **kwargs)
        with patch.object(quizzes, 'save_progress_record', side_effect=competing):
            replies = self.concurrent(lambda _: self.submit(view), range(2))
        self.assertEqual([code for code, _ in replies], [200, 200])
        self.assertEqual(sorted(data['attempt']['attempt'] for _, data in replies), [1,2])
        self.assertEqual(sorted(call.kwargs['attempt_number'] for call in self.audit.call_args_list), [1,2])
        self.assertEqual(list(LearnerProgressEntry.objects.filter(learner=self.learner).order_by('attempt').values_list('attempt',flat=True)), [1,2])
        self.learner.refresh_from_db()
        self.assertEqual(self.learner.completed_hours, 12)

    def test_concurrent_and_later_retry_write_once(self):
        view = self.submission_context()
        token = uuid4().hex
        barrier = threading.Barrier(2)
        original = quizzes.save_progress_record
        def competing(*args, **kwargs):
            barrier.wait(timeout=10)
            return original(*args, **kwargs)
        with patch.object(quizzes, 'save_progress_record', side_effect=competing):
            replies = self.concurrent(lambda _: self.submit(view, token), range(2))
        self.assertEqual(sorted(code for code, _ in replies), [200,409])
        before = self.snapshot()
        self.assertEqual(self.submit(view, token)[0], 409)
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(LearnerProgressEntry.objects.filter(learner=self.learner).count(), 1)
        self.assertEqual(self.award.call_count, 1)

    def test_two_learners_and_duplicate_submission_keep_results_separate(self):
        first = self.save()
        original = LearnerProgressEntry.objects.filter(pk=first.pk).values().get()
        other = LearnerProfile.objects.create(full_name='Other synthetic learner',
            email=uuid4().hex+'@example.invalid', lifecycle_status='active', completed_hours=7,
            enrolment_id=self.learner.enrolment_id + 1)
        execute('INSERT INTO enrolment."Created_users" VALUES(%s)', [other.enrolment_id])
        incorrect = QuizAnswer.objects.get(question=self.question, is_correct=False)
        view = self.submission_context()
        learners = {'77': self.learner, '88': other}
        self.award.reset_mock()
        barrier = threading.Barrier(3)
        original_save = quizzes.save_progress_record

        def competing(*args, **kwargs):
            # All requests pass the early duplicate check before any save.
            barrier.wait(timeout=10)
            return original_save(*args, **kwargs)

        token = uuid4().hex
        requests = [
            {'token': token}, {'token': token},
            {'kind': 'apprenticeship', 'learner_id': 88,
             'payload': {'answers': {str(self.question.pk): incorrect.pk}}},
        ]
        with patch.object(quizzes, '_programme_quiz_context', side_effect=lambda kind, ident, *args:
                          (SimpleNamespace(pk=int(ident)), {'componentId': ''}, None)), \
             patch.object(quizzes, 'learner_profile_for_source', side_effect=lambda source, ident, **kwargs: learners[ident]), \
             patch.object(quizzes, 'save_progress_record', side_effect=competing):
            replies = self.concurrent(lambda values: self.submit(view, **values), requests)

        self.assertEqual(sorted(code for code, _ in replies[:2]), [200, 409])
        own_reply = next(data for code, data in replies[:2] if code == 200)
        self.assertEqual((own_reply['attempt']['attempt'], own_reply['grade']), (2, 1))
        self.assertEqual((replies[2][0], replies[2][1]['attempt']['attempt'], replies[2][1]['grade']), (200, 1, 0))
        own = LearnerProgressEntry.objects.get(learner=self.learner, attempt=2)
        other_progress = LearnerProgressEntry.objects.get(learner=other)
        self.assertEqual((own.grade, other_progress.grade), (1, 0))
        for progress, answer_id, correct in ((own, self.answer.pk, True), (other_progress, incorrect.pk, False)):
            answer = LearnerQuizAnswer.objects.get(progress=progress)
            self.assertEqual((answer.question_ref, answer.chosen_answer_ref, answer.is_correct),
                             (self.question.pk, answer_id, correct))
            self.assertEqual(progress.verified_seconds, 300)
        self.assertEqual(LearnerProgressEntry.objects.filter(learner=self.learner).count(), 2)
        self.assertEqual(LearnerProgressEntry.objects.filter(pk=first.pk).values().get(), original)
        self.assertCountEqual([(call.kwargs['learner_id'], call.kwargs['attempt_number'])
                               for call in self.audit.call_args_list], [('77', 2), ('88', 1)])
        self.assertEqual(self.award.call_count, 2)
        self.learner.refresh_from_db()
        other.refresh_from_db()
        self.assertEqual((self.learner.completed_hours, other.completed_hours), (12, 7))

    def test_failed_save_releases_session_and_attempt_number_for_retry(self):
        self.save()
        self.award.reset_mock()
        before = self.snapshot()
        view = self.submission_context()
        token = uuid4().hex
        # Fail after both the progress row and its answer have been inserted.
        with patch.object(LearnerQuizCorrectAnswer.objects, 'bulk_create', side_effect=DatabaseError('Synthetic failure')):
            self.assertEqual(self.submit(view, token)[0], 503)
        self.assertEqual(self.snapshot(), before)
        self.award.assert_not_called()
        self.audit.assert_not_called()

        status, reply = self.submit(view, token)
        self.assertEqual((status, reply['attempt']['attempt']), (200, 2))
        self.assertEqual(LearnerProgressEntry.objects.filter(time_tracking_session_ref=token).count(), 1)
        after = self.snapshot()
        self.assertEqual(self.submit(view, token)[0], 409)
        self.assertEqual(self.snapshot(), after)
        self.award.assert_called_once()
        self.audit.assert_called_once()

    def test_concurrent_retake_time_additions_recheck_saved_time_under_lock(self):
        first = self.save()
        original = LearnerProgressEntry.objects.filter(pk=first.pk).values().get()
        self.award.reset_mock()
        view = self.submission_context()
        barrier = threading.Barrier(2)
        original_save = quizzes.save_progress_record

        def competing(*args, **kwargs):
            barrier.wait(timeout=10)
            try:
                return original_save(*args, **kwargs)
            except DatabaseError as exc:
                raise AssertionError('Concurrent retake persistence failed') from exc

        with patch('learner_api.manual_time_corrections.require_activity_time_month'), \
             patch.object(quizzes, 'save_progress_record', side_effect=competing):
            replies = self.concurrent(lambda _: self.submit(view, payload={
                'retakeTimeChoice': 'add', 'retakePreviousSeconds': 300}), range(2))
        self.assertEqual(sorted(code for code, _ in replies), [200, 409])
        success = next(data for code, data in replies if code == 200)
        conflict = next(data for code, data in replies if code == 409)
        self.assertEqual((success['attempt']['attempt'], success['attempt']['countedSeconds']), (2, 600))
        self.assertEqual((conflict['code'], conflict['previousSeconds']), ('activity_time_conflict', 600))
        self.assertEqual(list(LearnerProgressEntry.objects.filter(learner=self.learner)
                              .order_by('attempt').values_list('attempt', flat=True)), [1, 2])
        self.assertEqual(LearnerProgressEntry.objects.filter(pk=first.pk).values().get(), original)
        saved_choice = execute('SELECT source_payload FROM "Learner".learner_progress_entries '
                               'WHERE learner_id=%s AND attempt=2', [self.learner.pk])[0][0]
        if isinstance(saved_choice, str):
            saved_choice = json.loads(saved_choice)
        self.assertEqual(saved_choice, {'retakeTimeChoice': 'add', 'retakePreviousSeconds': 300})
        self.learner.refresh_from_db()
        self.assertEqual(self.learner.completed_hours, 12)
        self.award.assert_called_once()
        self.audit.assert_called_once()

    def test_numbering_preserves_duplicate_and_deleted_history_and_scope(self):
        for attempt, deleted in ((1,False),(1,False),(8,True)):
            LearnerProgressEntry.objects.create(learner=self.learner, entry_order=attempt, kind='quiz',
                quiz_ref=str(self.quiz.pk), attempt=attempt, deleted_at=timezone.now() if deleted else None)
        LearnerProgressEntry.objects.create(learner=self.learner, entry_order=9, kind='quiz', quiz_ref='other', attempt=100)
        original = list(LearnerProgressEntry.objects.filter(learner=self.learner).order_by('id').values())
        self.assertEqual(self.save().attempt, 9)
        self.assertEqual(list(LearnerProgressEntry.objects.filter(id__in=[p['id'] for p in original]).order_by('id').values()), original)

    def test_normal_load_submission_grading_and_snapshot(self):
        loaded = quizzes._fetch_quiz(self.quiz.pk)
        self.assertEqual(loaded['questions'][0]['id'], self.question.pk)
        status, reply = self.submit(self.submission_context())
        self.assertEqual(status, 200)
        self.assertTrue(reply['passed'])
        self.assertEqual((reply['grade'],reply['achievedScore'],reply['totalScore']), (1,1,1))
        answer = LearnerQuizAnswer.objects.get(progress__learner=self.learner)
        self.assertEqual(answer.result_snapshot['questionText'], 'Two plus two?')

    def test_question_deleted_after_loading_returns_409_and_rolls_back_everything(self):
        view = self.submission_context()
        fetch = quizzes._fetch_quiz
        def deleted_after_load(quiz_id):
            loaded = fetch(quiz_id)
            QuizQuestion.objects.filter(pk=self.question.pk).delete()
            return loaded
        before = self.snapshot()
        with patch.object(quizzes, '_fetch_quiz', side_effect=deleted_after_load):
            status, _ = self.submit(view)
        self.assertEqual(status, 409)
        self.assertEqual(self.snapshot(), before)
        self.award.assert_not_called()
        self.audit.assert_not_called()

    def test_failed_answer_insert_recognises_only_the_specific_fk(self):
        record = self.record()
        record['questions'][0]['questionId'] = 9223372036854775806
        before = self.snapshot()
        with self.assertRaises(IntegrityError) as caught:
            active_users.save_progress_record(self.learner, record)
        self.assertTrue(is_question_reference_violation(caught.exception, using='enrolment'))
        self.assertEqual(self.snapshot(), before)
        self.award.assert_not_called()
        with self.assertRaises(IntegrityError) as unrelated:
            with transaction.atomic():
                QuizQuestion.objects.create(quiz=self.quiz, question_text=None)
        self.assertFalse(is_question_reference_violation(unrelated.exception))

    def test_delete_fk_race_is_controlled_and_content_is_rolled_back(self):
        self.save()
        before = self.snapshot()
        with patch.object(views, 'referenced_question_ids', return_value=set()):
            response = views.quiz_detail(RequestFactory().delete('/quiz/'), self.quiz.pk)
        self.assertEqual(response.status_code, 409)
        self.assertTrue(QuizAnswer.objects.filter(pk=self.answer.pk).exists())
        self.assertEqual(self.snapshot(), before)

    def test_edit_fk_race_rolls_back_entire_batch(self):
        self.save()
        before = self.snapshot()
        with patch.object(views, 'referenced_question_ids', return_value=set()):
            response = self.remove_questions([{'text':'Uncommitted question'}])
        self.assertEqual(response.status_code, 409)
        self.assertEqual(list(QuizQuestion.objects.filter(quiz=self.quiz).values_list('id',flat=True)), [self.question.pk])
        self.assertEqual(self.snapshot(), before)

    def test_import_fk_race_reports_skip_and_rolls_back(self):
        self.save()
        before = self.snapshot()
        command = self.command()
        with patch.object(importer, 'referenced_question_ids', return_value=set()):
            command.import_with_retry(self.material(), 'M1','Module','Programme')
        self.assertEqual(command.stats['historical_quiz'], 1)
        self.assertEqual(command.stats['updated'], 0)
        self.quiz.refresh_from_db()
        self.assertEqual(self.quiz.title, 'Synthetic quiz')
        self.assertTrue(QuizAnswer.objects.filter(pk=self.answer.pk).exists())
        self.assertEqual(self.snapshot(), before)

    def test_unrelated_integrity_errors_are_not_misreported_as_history(self):
        with patch.object(views, '_quiz_detail_locked', side_effect=IntegrityError('unrelated')):
            with self.assertRaises(IntegrityError):
                views.quiz_detail(RequestFactory().delete('/quiz/'), self.quiz.pk)
        with patch.object(views, '_quiz_questions_locked', side_effect=IntegrityError('unrelated')):
            with self.assertRaises(IntegrityError):
                self.remove_questions()

    def test_unrelated_fk_on_learner_answers_is_not_a_question_conflict(self):
        with self.assertRaises(IntegrityError) as caught:
            with transaction.atomic(using='enrolment'):
                LearnerQuizAnswer.objects.create(progress_id=9223372036854775806,
                    position=1, question_ref=self.question.pk)
        self.assertFalse(is_question_reference_violation(caught.exception, using='enrolment'))

    def test_import_dry_run_reports_history_without_modifying_content(self):
        self.save()
        before = self.snapshot()
        command = self.command()
        command.dry_run = True
        command.import_one(self.material(), 'M1','Module','Programme')
        self.assertEqual(command.stats['historical_quiz'], 1)
        self.assertEqual(command.stats['updated'], 0)
        self.assertEqual(self.snapshot(), before)

    def test_in_progress_removed_question_keeps_existing_stale_submission_guard(self):
        view = self.submission_context()
        self.save()
        before = self.snapshot()
        self.assertEqual(self.remove_questions().status_code, 200)
        status, _ = self.submit(view)
        self.assertEqual(status, 409)
        self.assertEqual(self.snapshot(), before)

    def test_sequential_retake_preserves_existing_results_and_time_evidence(self):
        view = self.submission_context()
        self.assertEqual(self.submit(view)[0], 200)
        first = LearnerProgressEntry.objects.get(learner=self.learner)
        original = LearnerProgressEntry.objects.filter(pk=first.pk).values().get()
        status, reply = self.submit(view)
        self.assertEqual(status, 200)
        self.assertEqual(reply['attempt']['attempt'], 2)
        self.assertEqual(LearnerProgressEntry.objects.filter(pk=first.pk).values().get(), original)
        self.assertEqual(list(LearnerProgressEntry.objects.filter(learner=self.learner)
                              .values_list('verified_seconds',flat=True)), [300,300])

    def test_free_course_shared_editor_handles_real_fk_conflict(self):
        from curriculum_api.catalogue.api import free_course_quiz_views as free
        self.save()
        before = self.snapshot()
        self.quiz.free_course_week_id = 'FREEWEEK-TEST'
        self.quiz.status = 'draft'
        self.quiz.save(update_fields=['free_course_week_id','status'])
        view = free.detail
        while hasattr(view, '__wrapped__'):
            view = view.__wrapped__
        request = RequestFactory().patch('/free-quiz/', json.dumps({
            'componentId':'FREECOMP-TEST','removeMissing':True,'questions':[],
            'expectedRevision':'fcv1:'+'a'*64}), content_type='application/json')
        with patch.object(free, 'require_mode'), patch.object(free, '_catalogue_lock'), \
             patch.object(free, '_document', return_value={'revision':'fcv1:'+'a'*64}), \
             patch.object(free, '_quiz_owner', return_value=self.quiz), \
             patch.object(free, '_owned_component', return_value={'componentId':'FREECOMP-TEST','type':'quiz','settings':{'linkedQuizId':str(self.quiz.pk)}}), \
             patch.object(free, '_history_count', return_value=0), \
             patch.object(views, 'referenced_question_ids', return_value=set()):
            response = view(request, 'FREE-TEST', self.quiz.pk)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(json.loads(response.content)['code'], 'quiz_has_history')
        self.assertEqual(self.snapshot(), before)
        self.assertTrue(QuizAnswer.objects.filter(pk=self.answer.pk).exists())

    def test_different_learners_submit_concurrently_with_independent_numbers(self):
        other = LearnerProfile.objects.create(full_name='Other synthetic learner',
            email=uuid4().hex+'@example.invalid', lifecycle_status='active', completed_hours=7)
        def submit(learner):
            return active_users.save_progress_record(learner, self.record())
        rows = self.concurrent(submit, [self.learner, other])
        self.assertEqual([row.attempt for row in rows], [1,1])
        self.assertEqual({row.learner_id for row in rows}, {self.learner.pk,other.pk})
        other.refresh_from_db()
        self.assertEqual(other.completed_hours, 7)
