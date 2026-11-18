"""Question Bank pagination against PostgreSQL in the isolated quiz runner."""
import json
import unittest
from unittest.mock import patch
from uuid import uuid4

from django.conf import settings
from django.db import connection
from django.test import RequestFactory
from django.test.utils import CaptureQueriesContext

from . import views
from .models import QuizAnswer, QuizPackage, QuizQuestion


@unittest.skipUnless(getattr(settings, 'QUIZ_HISTORY_POSTGRES_TESTS', False), 'Use the isolated PostgreSQL runner')
class QuestionBankPostgresTests(unittest.TestCase):
    def setUp(self):
        self.prefix = uuid4().hex
        self.quiz = QuizPackage.objects.create(title='Alpha', programme='Programme A',
            programme_id='A', status='published', lesson_content='Large lesson ' * 10000)
        self.other = QuizPackage.objects.create(title='Beta', programme='Programme B', programme_id='B', status='draft')

    def question(self, quiz=None, **kwargs):
        row = QuizQuestion.objects.create(quiz=quiz or self.quiz,
            question_text=kwargs.pop('question_text', self.prefix+' question'), **kwargs)
        QuizAnswer.objects.create(question=row, answer_text='Correct option', is_correct=True)
        return row

    def read(self, **params):
        with patch.object(views, '_ensure_quiz_assessment_type_column'), patch.object(views, '_training_plan_programmes', return_value=[]):
            response = views.question_bank(RequestFactory().get('/quiz_api/question-bank/', {
                'page': 1, 'search': self.prefix, **params,
            }))
        self.assertEqual(response.status_code, 200)
        return json.loads(response.content)

    def test_pages_are_bounded_stable_and_keep_global_counts(self):
        for index in range(31):
            self.question(sort_order=index, question_text=f'{self.prefix} question {index}')
        self.question(self.other)
        self.question(is_archived=True)
        trash = QuizPackage.objects.create(title='Trash', status='trash')
        self.question(trash)
        first, second = self.read(), self.read(page=2)
        self.assertEqual((len(first['questions']), len(second['questions'])), (25, 7))
        self.assertEqual(first['totalQuestions'], 32)
        self.assertEqual(first['pagination'], {'page': 1, 'pageSize': 25, 'total': 32, 'totalPages': 2})
        self.assertFalse({q['id'] for q in first['questions']} & {q['id'] for q in second['questions']})
        self.assertEqual(sum(p['questionCount'] for p in first['programmes']), 32)

    def test_filters_and_tag_totals_apply_before_pagination(self):
        for _ in range(4):
            self.question(question_type='single_choice', explanation='K1 knowledge')
        wanted = self.question(self.other, question_type='true_false', explanation='KSB reference')
        data = self.read(programme='Programme B', type='true_false', status='draft', pageSize=1)
        self.assertEqual([q['id'] for q in data['questions']], [wanted.pk])
        self.assertEqual((data['pagination']['total'], data['ksbTaggedCount'], data['totalQuestions']), (1, 1, 5))
        self.assertEqual(data['statuses'], ['draft'])
        self.assertEqual(self.read(programme='Programme B', status='published')['pagination']['total'], 0)

    def test_linked_quizzes_include_matches_on_other_pages_but_not_other_programmes(self):
        self.question(question_text=self.prefix+' Shared   question')
        target = QuizPackage.objects.create(title='Copy', programme='Programme A', programme_id='A', status='draft')
        self.question(target, question_text=self.prefix+' shared question')
        self.question(self.other, question_text=self.prefix+' shared question')
        data = self.read(pageSize=1, programme='Programme A')
        self.assertEqual(len(data['questions']), 1)
        self.assertEqual({q['id'] for q in data['questions'][0]['linkedQuizzes']}, {self.quiz.pk, target.pk})
        self.assertEqual(data['questions'][0]['answers'][0]['text'], 'Correct option')

    def test_unassigned_and_identifier_only_programmes_remain_available(self):
        self.quiz.programme = ''
        self.quiz.programme_id = ''
        self.quiz.save()
        self.question()
        self.other.programme = ''
        self.other.save()
        self.question(self.other)
        data = self.read(programme='__unassigned__')
        self.assertEqual(data['questions'][0]['programme'], 'Unassigned')
        self.assertEqual({p['key'] for p in data['programmes']}, {'__unassigned__', 'B'})

    def test_reader_excludes_large_quiz_fields_and_bounds_invalid_page_values(self):
        self.question()
        with CaptureQueriesContext(connection) as captured:
            data = self.read(page=999, pageSize=10000)
        self.assertEqual(data['pagination'], {'page': 1, 'pageSize': 100, 'total': 1, 'totalPages': 1})
        self.assertTrue(all('lesson_content' not in item['sql'] for item in captured.captured_queries))
        self.assertEqual(self.read(page='bad', pageSize='bad')['pagination']['pageSize'], 25)

    def test_existing_unpaged_contract_is_retained(self):
        row = self.question()
        with patch.object(views, '_ensure_quiz_assessment_type_column'), patch.object(views, '_training_plan_programmes', return_value=[]):
            response = views.question_bank(RequestFactory().get('/quiz_api/question-bank/', {'search':self.prefix}))
        data = json.loads(response.content)
        self.assertNotIn('pagination', data)
        self.assertEqual([question['id'] for question in data['questions']], [row.pk])
