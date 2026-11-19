"""Read-only quiz counters and actual assignment writes on isolated PostgreSQL."""
from contextlib import ExitStack
from datetime import datetime, timezone
import json
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from uuid import uuid4

from django.conf import settings
from django.db import connection
from django.test import RequestFactory
from django.test.utils import CaptureQueriesContext

from . import views
from .models import QuizPackage, QuizQuestion, QuizAnswer
from .tests_history_postgres import execute


@unittest.skipUnless(getattr(settings, 'QUIZ_HISTORY_POSTGRES_TESTS', False), 'Use the isolated PostgreSQL runner')
class QuizReadPostgresTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Match the real assignment table's conflict key for PATCH coverage.
        execute('CREATE UNIQUE INDEX IF NOT EXISTS quiz_read_assignment_uq ON curriculum.quiz_course_links(quiz_id,module_catalogue_id)')

    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.module_id = 'read-module-'+uuid4().hex
        self.week_id = 'read-week-'+uuid4().hex
        self.options = [{'id':self.module_id,'programmeId':'P','programme':'Sample programme',
                         'module':'Sample module','weeks':[{'id':self.week_id}],'groups':['Sample group']},
                        {'id':self.module_id+'-other','programmeId':'P','programme':'Sample programme',
                         'module':'Another module','weeks':[],'groups':[]}]
        for name, value in (
            ('_ensure_quiz_assessment_type_column',None),
            ('_ensure_quiz_course_links_table',None),
            ('_ensure_quiz_component_links_table',None),
            ('_first_existing_curriculum_table',None),
            ('_quiz_module_options',self.options),
            ('_merge_quiz_component_options',[]),
            ('_linked_component_module_ids_for_quiz',set()),
        ):
            self.stack.enter_context(patch.object(views,name,return_value=value))
        self.stack.enter_context(patch.object(views,'_curriculum_table_exists',
            side_effect=lambda name:name in {'quiz_course_links','quiz_component_links'}))
        self.quiz = QuizPackage.objects.create(title='Read check '+uuid4().hex,
            programme='Sample programme', programme_id='P', linked_courses=9)
        self.other = QuizPackage.objects.create(title='Unrelated quiz', linked_courses=7)
        self.old_time = datetime(2020,1,1,tzinfo=timezone.utc)
        QuizPackage.objects.filter(pk__in=[self.quiz.pk,self.other.pk]).update(updated_at=self.old_time)
        execute('INSERT INTO curriculum.quiz_course_links(quiz_id,module_catalogue_id,week_id) VALUES(%s,%s,%s)',
                [self.quiz.pk,self.module_id,''])

    def assert_stored_unchanged(self):
        self.quiz.refresh_from_db()
        self.other.refresh_from_db()
        self.assertEqual((self.quiz.linked_courses,self.quiz.updated_at),(9,self.old_time))
        self.assertEqual((self.other.linked_courses,self.other.updated_at),(7,self.old_time))

    def test_repeated_list_reads_return_current_counts_without_saving(self):
        with CaptureQueriesContext(connection) as queries:
            for _ in range(2):
                response = views.quizzes(RequestFactory().get('/quizzes/',{'search':self.quiz.title}))
                self.assertEqual(response.status_code,200)
                self.assertEqual(json.loads(response.content)['results'][0]['linkedCourses'],1)
        self.assertFalse(any(row['sql'].lstrip().upper().startswith('UPDATE ') for row in queries.captured_queries))
        self.assert_stored_unchanged()

    def test_archive_list_keeps_history_timestamp_and_stored_count(self):
        QuizPackage.objects.filter(pk=self.quiz.pk).update(status='trash')
        response = views.quizzes(RequestFactory().get('/quizzes/',{'search':self.quiz.title,'status':'trash'}))
        self.assertEqual(response.status_code,200)
        self.assertEqual(json.loads(response.content)['results'][0]['linkedCourses'],1)
        self.assert_stored_unchanged()

    def test_course_links_get_returns_assignments_without_saving(self):
        response = views.quiz_course_links(RequestFactory().get('/course-links/'),self.quiz.pk)
        self.assertEqual(response.status_code,200)
        data = json.loads(response.content)
        self.assertEqual(data['selectedModuleCatalogueIds'],[self.module_id])
        self.assertEqual(data['quiz']['linkedCourses'],1)
        self.assert_stored_unchanged()

    def test_assignment_patch_still_persists_only_the_target_quiz(self):
        response = views.quiz_course_links(RequestFactory().patch('/course-links/',
            data=json.dumps({'moduleAssignments':[]}),content_type='application/json'),self.quiz.pk)
        self.assertEqual(response.status_code,200)
        self.quiz.refresh_from_db()
        self.other.refresh_from_db()
        self.assertEqual(self.quiz.linked_courses,0)
        self.assertGreater(self.quiz.updated_at,self.old_time)
        self.assertEqual(execute('SELECT count(*) FROM curriculum.quiz_course_links WHERE quiz_id=%s',[self.quiz.pk])[0][0],0)
        self.assertEqual((self.other.linked_courses,self.other.updated_at),(7,self.old_time))

    def test_assignment_patch_still_inserts_module_links(self):
        execute('DELETE FROM curriculum.quiz_course_links WHERE quiz_id=%s',[self.quiz.pk])
        question = QuizQuestion.objects.create(quiz=self.quiz,
            question_text='Which option is correct?', question_type='single_choice')
        QuizAnswer.objects.create(question=question, answer_text='Correct', is_correct=True)
        QuizAnswer.objects.create(question=question, answer_text='Other', is_correct=False)
        response = views.quiz_course_links(RequestFactory().patch('/course-links/',
            data=json.dumps({'moduleAssignments':[{'moduleCatalogueId':self.module_id,'weekId':self.week_id}]}),
            content_type='application/json'),self.quiz.pk)
        self.assertEqual(response.status_code,200,response.content.decode())
        self.quiz.refresh_from_db()
        self.assertEqual((self.quiz.linked_courses,self.quiz.module),(1,'Sample module'))
        self.assertEqual(execute('SELECT module_catalogue_id FROM curriculum.quiz_course_links WHERE quiz_id=%s',[self.quiz.pk]),[(self.module_id,)])

    def test_write_callers_keep_the_default_persistence_contract(self):
        self.quiz.refresh_from_db()
        views._sync_quiz_assignment_count(self.quiz)
        self.quiz.refresh_from_db()
        self.assertEqual(self.quiz.linked_courses,1)
        self.assertGreater(self.quiz.updated_at,self.old_time)

    def test_new_quiz_persists_the_creator_from_each_session(self):
        for name in ('First creator', 'Second creator'):
            request = RequestFactory().post('/quizzes/',
                data=json.dumps({'title': 'New authored quiz', 'author': 'Forged name'}),
                content_type='application/json')
            request.login_account = SimpleNamespace(role='staff', display_name=name, email='creator@example.invalid')
            with patch.object(views, '_match_programme_catalogue_id', return_value=''), \
                 patch.object(views, '_build_week_id', return_value=''):
                response = views.quizzes(request)
            self.assertEqual(response.status_code, 201, response.content.decode())
            saved = QuizPackage.objects.get(pk=json.loads(response.content)['id'])
            self.assertEqual(saved.author, name)
        self.assert_stored_unchanged()

    def test_complete_creation_persists_creator_and_questions_together(self):
        request = RequestFactory().post('/quizzes/create-with-questions/', data=json.dumps({
            'title': 'Complete authored quiz', 'author': 'Forged name', 'initialQuestions': [
                {'text': 'Choose', 'questionType': 'single_choice', 'answers': [
                    {'text': 'Right', 'isCorrect': True}, {'text': 'Wrong', 'isCorrect': False}]}]}),
            content_type='application/json')
        request.login_account = SimpleNamespace(role='admin', display_name='Admin creator', email='admin@example.invalid')
        with patch.object(views, '_match_programme_catalogue_id', return_value=''), \
             patch.object(views, '_build_week_id', return_value=''):
            response = views.create_quiz_with_questions(request)
        self.assertEqual(response.status_code, 201, response.content.decode())
        saved = QuizPackage.objects.get(pk=json.loads(response.content)['id'])
        self.assertEqual((saved.author, saved.questions), ('Admin creator', 1))
        self.assertEqual(saved.quiz_questions.count(), 1)
        self.assertEqual(QuizAnswer.objects.filter(question__quiz=saved).count(), 2)

    def test_edit_preserves_historic_creator_and_rejects_reassignment(self):
        QuizPackage.objects.filter(pk=self.quiz.pk).update(author='Historic creator')
        request = RequestFactory().patch('/quiz/', data=json.dumps({'duration': 45}), content_type='application/json')
        request.login_account = SimpleNamespace(role='staff', display_name='Another editor', email='editor@example.invalid')
        self.assertEqual(views.quiz_detail(request, self.quiz.pk).status_code, 200)
        self.quiz.refresh_from_db()
        self.assertEqual((self.quiz.author, self.quiz.duration), ('Historic creator', 45))
        edited_at = self.quiz.updated_at
        request = RequestFactory().patch('/quiz/', data=json.dumps({'author': 'Another editor', 'duration': 90}),
                                         content_type='application/json')
        self.assertEqual(views.quiz_detail(request, self.quiz.pk).status_code, 400)
        self.quiz.refresh_from_db()
        self.assertEqual((self.quiz.author, self.quiz.duration, self.quiz.updated_at), ('Historic creator', 45, edited_at))
