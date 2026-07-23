from types import SimpleNamespace

from django.test import SimpleTestCase

from .views import _infer_quiz_component_link_ids


class QuizComponentLinkInferenceTests(SimpleTestCase):
    def test_linked_quiz_id_is_preferred_over_title_or_module_guessing(self):
        quiz = SimpleNamespace(id=68, title='Imported quiz', module='Fouda-Module', week_id='')
        options = [
            {'id': 'COMP-LINKED', 'linkedQuizId': '68', 'component': 'Weekly quiz', 'module': 'Fouda-Module', 'weekId': ''},
            {'id': 'COMP-OTHER', 'linkedQuizId': '99', 'component': 'Imported quiz', 'module': 'Fouda-Module', 'weekId': ''},
        ]

        self.assertEqual(_infer_quiz_component_link_ids(quiz, options), {'COMP-LINKED'})
