from types import SimpleNamespace

from django.test import SimpleTestCase

from .views import _infer_quiz_component_link_ids, _infer_quiz_module_link_ids


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
