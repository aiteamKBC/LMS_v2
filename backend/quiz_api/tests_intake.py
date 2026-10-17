"""Synthetic imports/generation only: no learner database or paid provider calls."""
import csv
import io
import json
from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import Mock, patch
from xml.etree import ElementTree

from django.test import SimpleTestCase
from . import views, tests_publication as publication, tests_generate_golden as golden
from .intake import intake_error, key_indexes
from learner_api.quizzes import _grade_question


class IntakeConversionTests(SimpleTestCase):
    def generated(self, kind, options, key):
        return views._normalise_generated_questions({'questions': [
            {'question': 'Synthetic question', 'type': kind, 'options': options, 'correct_answer': key}]})[0]

    def test_all_eight_types_have_gradeable_canonical_rows(self):
        samples = [
            ('single_choice', ['Wrong', 'A correct response'], 'B'),
            ('multiple_choice', ['One', 'Two', 'Wrong'], 'A,B'),
            ('true_false', ['True', 'False'], 'False'),
            ('matching', ['One -> First', 'Two -> Second'], ''),
            ('image_matching', ['https://example.test/one.png -> First', 'https://example.test/two.png -> Second'], ''),
            ('keywords', ['One', 'Two'], ''),
            ('fill_gap', ['Wrong', 'Right'], 'B'),
            ('ordering', ['Last', 'First', 'Middle'], 'B,C,A'),
        ]
        for kind, options, key in samples:
            with self.subTest(kind=kind):
                q = self.generated(kind, options, key)
                self.assertIsNone(intake_error([{**q, 'type': kind}]))

    def test_fill_gap_never_accepts_a_generated_distractor(self):
        q = self.generated('fill_gap', ['Wrong', 'Right'], 'B')
        gradeable = {**q, 'type': 'fill_gap', 'points': 1}
        self.assertFalse(_grade_question(gradeable, 'Wrong')['correct'])
        self.assertTrue(_grade_question(gradeable, 'Right')['correct'])

    def test_ordering_uses_the_declared_key_not_display_order(self):
        q = self.generated('ordering', ['Last', 'First', 'Middle'], 'B,C,A')
        self.assertEqual([a['text'] for a in q['answers']], ['First', 'Middle', 'Last'])
        q = {**q, 'type': 'ordering', 'points': 1, 'answers': [
            {**a, 'sortOrder': i} for i, a in enumerate(q['answers'])]}
        self.assertTrue(_grade_question(q, [a['id'] for a in q['answers']])['correct'])
        self.assertFalse(_grade_question(q, [a['id'] for a in reversed(q['answers'])])['correct'])

    def test_unknown_or_partial_keys_never_fall_back_to_first_option(self):
        for key in ('Z', 'A,Z', 'B - Wrong label'):
            with self.subTest(key=key):
                self.assertEqual(key_indexes(['One', 'Two'], key, multiple=True), [])
        self.assertEqual(key_indexes(['One', 'A private memo'], 'B - A private memo'), [1])
        self.assertEqual(key_indexes(['One', 'A private memo'], 'A'), [0])

    def test_invalid_ordering_permutations_are_rejected(self):
        for key in ('A,A', 'B', 'A,C', ''):
            q = self.generated('ordering', ['One', 'Two'], key)
            self.assertIsNotNone(intake_error([{**q, 'type': 'ordering'}]))

    def test_incomplete_matching_and_unknown_types_are_rejected(self):
        for kind, options in [('matching', ['One -> ']), ('image_matching', ['fake-image -> Answer']), ('unsupported', ['One'])]:
            q = self.generated(kind, options, '')
            self.assertIsNotNone(intake_error([{**q, 'type': kind}]))

    def test_csv_and_excel_use_the_same_type_and_key_resolution(self):
        from openpyxl import Workbook
        rows = [
            ['question_type', 'question', 'option_a', 'option_b', 'option_c', 'correct_answer'],
            ['single_choice', 'Choose', 'One', 'A private memo', '', 'B - A private memo'],
            ['multiple_choice', 'Choose two', 'One', 'Two', 'Wrong', 'A,B'],
            ['true_false', 'True?', 'True', 'False', '', 'A'],
            ['matching', 'Match', 'One -> First', 'Two -> Second', '', ''],
            ['image_matching', 'Match images', 'https://example.test/1.png -> First', 'https://example.test/2.png -> Second', '', ''],
            ['keywords', 'Terms', 'One', 'Two', '', ''],
            ['fill_gap', 'Complete ____', 'Wrong', 'Right', '', 'B'],
            ['ordering', 'Order', 'Last', 'First', 'Middle', 'B,C,A'],
        ]
        text = io.StringIO(); csv.writer(text).writerows(rows)
        csv_questions, _, _ = views._extract_csv_questions(io.BytesIO(text.getvalue().encode()))
        workbook = Workbook()
        for row in rows: workbook.active.append(row)
        excel = io.BytesIO(); workbook.save(excel); workbook.close()
        excel_questions, _, _ = views._extract_excel_questions(excel)
        self.assertEqual(excel_questions, csv_questions)
        self.assertEqual(len(csv_questions), 8)
        for q in csv_questions:
            self.assertIsNone(intake_error([{'text': q['text'], 'type': q['question_type'], 'answers': [
                {'text': a['text'], 'isCorrect': a['is_correct']} for a in q['answers']]}]))

    def test_xml_cannot_silently_drop_bad_pairs_or_repair_a_partial_order(self):
        for body in ('<question type="matching"><text>Match</text><pairs><pair><left>One</left></pair></pairs></question>',
                     '<question type="ordering"><text>Order</text><item id="1">One</item><item id="2">Two</item><correctOrder>1,1</correctOrder></question>'):
            result = views._validate_xml(io.BytesIO(('<quiz>' + body + '</quiz>').encode()))
            self.assertFalse(result[0])

    def test_xml_fill_gap_respects_explicit_correct_markers(self):
        q = views._parse_questions_from_xml(ElementTree.fromstring('<quiz><question type="fill_gap"><text>Complete ____</text><option correct="false">Wrong</option><option correct="true">Right</option></question></quiz>'))[0]
        self.assertEqual([a['text'] for a in q['answers']], ['Right'])

    def test_csv_preserves_quoted_multiline_text_and_rejects_extra_columns(self):
        raw = b'question,option_a,option_b,correct_answer\n"Line one\nLine two",One,Two,B\n'
        questions, _, _ = views._extract_csv_questions(io.BytesIO(raw))
        self.assertEqual(questions[0]['text'], 'Line one\nLine two')
        with self.assertRaisesRegex(ValueError, 'Too many columns'):
            views._extract_csv_questions(io.BytesIO(b'question,option_a,option_b,correct_answer\nUnquoted,comma,One,Two,B\n'))

    def test_grouped_rows_cannot_silently_change_the_question_or_use_unknown_flags(self):
        for tail in ('1,Other,Two,false', '1,Q,Two,maybe'):
            raw = ('question_id,question_text,option_text,is_correct\n1,Q,One,true\n'+tail+'\n').encode()
            with self.assertRaises(ValueError):
                views._extract_csv_questions(io.BytesIO(raw))

    def test_grouped_keyword_distractors_are_not_accepted_terms(self):
        raw = b'question_id,question_text,question_type,option_text,is_correct\n1,Terms,keywords,Right,true\n1,Terms,keywords,Wrong,false\n'
        questions, _, _ = views._extract_csv_questions(io.BytesIO(raw))
        self.assertEqual([a['text'] for a in questions[0]['answers']], ['Right'])

    def test_labelled_letter_keys_select_the_matching_explanation(self):
        self.assertEqual(views._correct_answer_index('C - Third'), 2)


class IntakeEndpointTests(SimpleTestCase):
    setUp = publication.PublicationTests.setUp
    request = publication.PublicationTests.request

    def test_atomic_endpoint_never_falls_back_to_empty_shell_creation(self):
        from django.urls import resolve
        self.assertEqual(resolve('/quiz_api/quizzes/create-with-questions/').func, views.create_quiz_with_questions)
        for payload in ({'title': 'Incomplete'}, {'initialQuestions': None}, {'initialQuestions': []},
                        {'status': 'published', 'initialQuestions': None}):
            response = views.create_quiz_with_questions(self.request('post', payload))
            self.assertEqual(response.status_code, 400)
        self.packages.create.assert_not_called()

    def test_bad_draft_upload_is_rejected_before_package_or_question_writes(self):
        uploaded = io.BytesIO(b'question,option_a,option_b,correct_answer\nQ,One,Two,Z\n')
        request = self.factory.post('/quiz_api/quizzes/', {'file': uploaded, 'status': 'draft'})
        request.FILES['file'].name = 'synthetic.csv'
        with patch.object(views, '_match_programme_catalogue_id', return_value=''), \
             patch.object(views, '_build_week_id', return_value=''):
            response = views.quizzes(request)
        self.assertEqual(response.status_code, 400)
        self.packages.create.assert_not_called(); self.questions.create.assert_not_called()

    def test_invalid_initial_questions_create_no_empty_quiz(self):
        response = views.quizzes(self.request('post', {'title': 'AI', 'initialQuestions': [
            {'text': 'Choose', 'questionType': 'single_choice', 'answers': [
                {'text': 'One', 'isCorrect': True}, {'text': 'Two', 'isCorrect': True}]}]}))
        self.assertEqual(response.status_code, 400)
        self.packages.create.assert_not_called()

    def test_creation_and_every_question_write_share_one_transaction(self):
        active = []
        @contextmanager
        def atomic():
            active.append(True)
            try: yield
            finally: active.pop()
        self.packages.create.side_effect = lambda **kwargs: self.quiz if active else self.fail('Creation outside transaction')
        self.questions.create.side_effect = lambda **kwargs: SimpleNamespace(id=21) if active else self.fail('Questions outside transaction')
        with patch.object(views.transaction, 'atomic', side_effect=atomic), \
             patch.object(views.QuizAnswer.objects, 'create') as answers, \
             patch.object(views, '_match_programme_catalogue_id', return_value=''), \
             patch.object(views, '_build_week_id', return_value=''), \
             patch.object(views, '_sync_quiz_assignment_count', side_effect=lambda q:q):
            answers.side_effect = lambda **kwargs: None if active else self.fail('Answers outside transaction')
            response = views.quizzes(self.request('post', {'title': 'AI', 'status': 'published', 'initialQuestions': [
                {'text': 'Choose', 'questionType': 'single_choice', 'answers': [
                    {'text': 'One', 'isCorrect': True}, {'text': 'Two', 'isCorrect': False}]}]}))
        self.assertEqual(response.status_code, 201)
        self.assertEqual(self.packages.create.call_args.kwargs['questions'], 1)
        self.assertIsNotNone(self.packages.create.call_args.kwargs['published_at'])
        self.assertEqual(answers.call_count, 2)

    def test_bad_second_initial_question_does_not_create_a_partial_quiz(self):
        questions = [{'text': 'Valid', 'questionType': 'single_choice', 'answers': [
            {'text': 'One', 'isCorrect': True}, {'text': 'Two', 'isCorrect': False}]},
            {'text': 'Invalid', 'questionType': 'matching', 'answers': [{'text': 'One -> ', 'isCorrect': True}]}]
        response = views.quizzes(self.request('post', {'initialQuestions': questions}))
        self.assertEqual(response.status_code, 400)
        self.packages.create.assert_not_called(); self.questions.create.assert_not_called()

    def test_ai_bad_keys_return_502_instead_of_usable_preview(self):
        output = {'questions': [{'question': 'Choose', 'type': 'single_choice', 'options': ['One', 'Two'], 'correct_answer': 'A,B'}]}
        with patch.dict('sys.modules', {'openai': SimpleNamespace(OpenAI=golden._FakeOpenAI)}), \
             patch.object(golden, 'MODEL_OUTPUT', output), \
             self.settings(OPENAI_API_KEY='synthetic', OPENAI_MODEL='synthetic'):
            response = views.generate_ai_questions(self.request('post', {'topic': 'Synthetic'}))
        self.assertEqual(response.status_code, 502)
        self.assertIn('Question 1', json.loads(response.content)['error'])
