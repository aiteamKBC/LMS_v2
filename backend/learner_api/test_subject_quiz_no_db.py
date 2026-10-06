"""Isolated regression tests: no database or external services."""
import sys
import json
import unittest
from pathlib import Path
from unittest.mock import Mock
from copy import deepcopy
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from django.conf import settings
settings.configure()
from learner_api.subject_quiz import imported_quiz
from learner_api.subject_content import quiz_definition, public_quiz, grade_quiz

class ImportedQuizTests(unittest.TestCase):
    def setUp(self):
        self.material = {'passing_grade_percent': 80, 'quiz_definition': {'question_count': 1, 'questions': [
            {'question_id': 12, 'question_text': 'Example?', 'question_type': 'single_choice',
             'answer_options': [{'option_order': 1, 'option_text': 'Yes'}, {'option_order': 2, 'option_text': 'No'}],
             'correct_answers': ['Yes']}]}}
        self.cursor = Mock()
        self.cursor.fetchall.return_value = [(self.material,)]

    def test_exact_lineage_and_server_side_grading(self):
        quiz = quiz_definition(imported_quiz(self.cursor, 50, 60))
        self.assertEqual(self.cursor.execute.call_args.args[1], [50, '60'])
        self.assertTrue(quiz['ready'])
        self.assertNotIn('solution_ids', public_quiz(quiz)['questions'][0])
        self.assertTrue(grade_quiz({'quiz': quiz}, {'12': ['1']})['passed'])
        self.assertFalse(grade_quiz({'quiz': quiz}, {'12': ['2']})['passed'])

    def test_missing_questions_stays_blocked(self):
        self.material['quiz_definition']['question_count'] = 2
        self.assertIsNone(imported_quiz(self.cursor, 50, 60))

    def test_django_json_text_matches_decoded_export(self):
        expected = imported_quiz(self.cursor, 50, 60)
        self.cursor.fetchall.return_value = [(json.dumps(self.material),)]
        actual = imported_quiz(self.cursor, 50, 60)
        self.assertEqual(actual, expected)
        quiz = quiz_definition(actual)
        self.assertTrue(quiz['ready'])
        self.assertTrue(grade_quiz({'quiz': quiz}, {'12': ['1']})['passed'])
        self.assertNotIn('solution_ids', public_quiz(quiz)['questions'][0])

    def test_invalid_export_shape_stays_unavailable(self):
        for material in ('invalid JSON', 'null', '[]', '42', None, [], 42):
            with self.subTest(material=material):
                self.cursor.fetchall.return_value = [(material,)]
                self.assertIsNone(imported_quiz(self.cursor, 50, 60))

    def test_missing_answers_stays_blocked(self):
        self.material['quiz_definition']['questions'][0]['correct_answers'] = []
        self.assertIsNone(imported_quiz(self.cursor, 50, 60))

    def test_missing_course_match_never_uses_title(self):
        self.cursor.fetchall.return_value = []
        self.assertIsNone(imported_quiz(self.cursor, 51, 60))

    def test_conflicting_exports_are_not_selected(self):
        other = deepcopy(self.material)
        other['passing_grade_percent'] = 90
        self.cursor.fetchall.return_value = [(self.material,), (other,)]
        self.assertIsNone(imported_quiz(self.cursor, 50, 60))

if __name__ == '__main__':
    unittest.main()
