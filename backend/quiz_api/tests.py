import json
from types import SimpleNamespace
from xml.etree import ElementTree

from django.test import SimpleTestCase

from .views import (
    _infer_quiz_component_link_ids,
    _infer_quiz_module_link_ids,
    _parse_questions_from_xml,
)


class QuizXmlImportTests(SimpleTestCase):
    def test_imports_all_supported_question_types(self):
        root = ElementTree.fromstring("""
            <quiz><questions>
              <question type="single_choice" points="2"><text>Single?</text>
                <option correct="false">No</option><option correct="true">Yes</option>
              </question>
              <question type="multiple_choice" points="3"><text>Multiple?</text>
                <option correct="true">A</option><option correct="true">B</option><option correct="false">C</option>
              </question>
              <question type="true_false"><text>True?</text>
                <option correct="true">True</option><option correct="false">False</option>
              </question>
              <question type="matching"><text>Match?</text><pairs>
                <pair><left>200</left><right>OK</right></pair>
                <pair><left>404</left><right>Not Found</right></pair>
              </pairs></question>
              <question type="image_matching"><text>Images?</text><pairs>
                <pair><image>https://example.com/circle.png</image><display>Circle image</display><right>Circle</right></pair>
              </pairs></question>
              <question type="keywords"><text>Keywords?</text><acceptedKeywords>
                <keyword>red</keyword><keyword>amber</keyword>
              </acceptedKeywords></question>
              <question type="fill_gap"><text>Fill _____.</text><acceptedAnswers>
                <answer>answer</answer><answer>answer key</answer>
              </acceptedAnswers></question>
              <question type="ordering"><text>Order?</text><items>
                <item id="1">First</item><item id="2">Second</item>
              </items><correctOrder>2,1</correctOrder></question>
            </questions></quiz>
        """)

        questions = _parse_questions_from_xml(root)

        self.assertEqual(
            [question["question_type"] for question in questions],
            ["single_choice", "multiple_choice", "true_false", "matching", "image_matching", "keywords", "fill_gap", "ordering"],
        )
        self.assertEqual(questions[0]["points"], 2)
        self.assertEqual([answer["is_correct"] for answer in questions[1]["answers"]], [True, True, False])
        self.assertEqual([answer["text"] for answer in questions[3]["answers"]], ["200 -> OK", "404 -> Not Found"])
        image_pair = json.loads(questions[4]["answers"][0]["text"])
        self.assertEqual(image_pair["imageUrl"], "https://example.com/circle.png")
        self.assertEqual(image_pair["label"], "Circle image")
        self.assertEqual(image_pair["match"], "Circle")
        self.assertEqual([answer["text"] for answer in questions[5]["answers"]], ["red", "amber"])
        self.assertTrue(all(answer["is_correct"] for answer in questions[5]["answers"]))
        self.assertEqual([answer["text"] for answer in questions[6]["answers"]], ["answer", "answer key"])
        self.assertEqual([answer["text"] for answer in questions[7]["answers"]], ["Second", "First"])

    def test_choice_questions_accept_answer_elements(self):
        root = ElementTree.fromstring("""
            <quiz><questions><question type="single_choice"><text>Choose</text><answers>
              <answer correct="false">Wrong</answer>
              <answer correct="true">Right</answer>
            </answers></question></questions></quiz>
        """)

        questions = _parse_questions_from_xml(root)

        self.assertEqual([answer["text"] for answer in questions[0]["answers"]], ["Wrong", "Right"])
        self.assertEqual([answer["is_correct"] for answer in questions[0]["answers"]], [False, True])


class QuizComponentLinkInferenceTests(SimpleTestCase):
    def test_linked_quiz_id_is_preferred_over_title_or_module_guessing(self):
        quiz = SimpleNamespace(id=68, title='Imported quiz', module='Fouda-Module', week_id='')
        options = [
            {'id': 'COMP-LINKED', 'linkedQuizId': '68', 'component': 'Weekly quiz', 'module': 'Fouda-Module', 'weekId': ''},
            {'id': 'COMP-OTHER', 'linkedQuizId': '99', 'component': 'Imported quiz', 'module': 'Fouda-Module', 'weekId': ''},
        ]

        self.assertEqual(_infer_quiz_component_link_ids(quiz, options), {'COMP-LINKED'})


class QuizModuleLinkInferenceTests(SimpleTestCase):
    def test_prefers_existing_module_ids_before_name_guessing(self):
        quiz = SimpleNamespace(
            id=92,
            title='Aya test 2',
            module='Risk Management',
            programme='Fouda-Programme',
            programme_id='PROG-1',
        )
        options = [
            {'id': 'MOD-RISK', 'module': 'Risk Management', 'programme': 'Fouda-Programme', 'programmeId': 'PROG-1'},
            {'id': 'MOD-OTHER', 'module': 'Fouda-Module', 'programme': 'Fouda-Programme', 'programmeId': 'PROG-1'},
        ]

        self.assertEqual(
            _infer_quiz_module_link_ids(quiz, options, preferred_ids={'MOD-RISK'}),
            {'MOD-RISK'},
        )

    def test_matches_exact_module_name_inside_scoped_programme(self):
        quiz = SimpleNamespace(
            id=92,
            title='Aya test 2',
            module='Risk Management',
            programme='Fouda-Programme',
            programme_id='PROG-1',
        )
        options = [
            {'id': 'MOD-RISK', 'module': 'Risk Management', 'programme': 'Fouda-Programme', 'programmeId': 'PROG-1'},
            {'id': 'MOD-OTHER', 'module': 'Fouda-Module', 'programme': 'Fouda-Programme', 'programmeId': 'PROG-1'},
        ]

        self.assertEqual(_infer_quiz_module_link_ids(quiz, options), {'MOD-RISK'})
