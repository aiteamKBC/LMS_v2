"""DB-free tests for assigned-standard KSB progress."""
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase

from .ksb_progress import calculate_ksb_progress


def assigned_profile(codes=('K1', 'S2', 'S3'), source_id='standard:st0845-v1-0'):
    version = SimpleNamespace(source_profile_id=source_id, programme='Programme')
    return SimpleNamespace(
        ksb_assignment=SimpleNamespace(profile_version=version),
        ksbs=[{'code': code} for code in codes],
    )


def component(component_id, codes, *, quiz_id=None):
    return {
        'componentId': component_id,
        'type': 'quiz' if quiz_id is not None else 'video',
        'isQuiz': quiz_id is not None,
        'quizMeta': {'quizId': quiz_id} if quiz_id is not None else {},
        'ksbMappings': [{'code': code} for code in codes],
    }


class KsbProgressTests(SimpleTestCase):
    def calculate(self, components, progress, profile=None):
        return calculate_ksb_progress(
            profile or assigned_profile(), {'components': components}, progress,
        )

    def test_completed_component_achieves_its_required_ksb(self):
        result = self.calculate(
            [component('C1', ['K1'])], [{'componentId': 'C1', 'kind': 'component'}],
        )
        self.assertEqual(result['actual'], 1)
        self.assertEqual(result['planned'], 3)

    def test_same_ksb_on_multiple_completed_components_counts_once(self):
        result = self.calculate(
            [component('C1', ['K1']), component('C2', ['K1'])],
            [{'componentId': 'C1'}, {'componentId': 'C2'}],
        )
        self.assertEqual(result['actual'], 1)

    def test_existing_parent_code_normalisation_is_shared_with_coach_totals(self):
        result = self.calculate(
            [component('C1', ['K1.2'])], [{'componentId': 'C1'}],
        )
        self.assertEqual(result['achievedCodes'], ['K1'])

    def test_incomplete_component_does_not_achieve_its_ksb(self):
        self.assertEqual(self.calculate([component('C1', ['K1'])], [])['actual'], 0)

    def test_failed_quiz_does_not_achieve_linked_ksb(self):
        result = self.calculate(
            [component(None, ['K1'], quiz_id=42)],
            [{'kind': 'quiz', 'quizId': 42, 'passed': False}],
        )
        self.assertEqual(result['actual'], 0)

    def test_passed_quiz_uses_the_existing_completion_rule(self):
        result = self.calculate(
            [component(None, ['K1'], quiz_id=42)],
            [{'kind': 'quiz', 'quizId': 42, 'passed': True}],
        )
        self.assertEqual(result['actual'], 1)

    def test_codes_outside_assigned_required_set_are_excluded(self):
        result = self.calculate(
            [component('C1', ['K1', 'X99'])], [{'componentId': 'C1'}],
        )
        self.assertEqual(result['actual'], 1)
        self.assertNotIn('X99', result['achievedCodes'])

    def test_denominator_is_the_unique_assigned_profile(self):
        profile = assigned_profile(('K1', 'K1', 'S2'))
        result = self.calculate([component('C1', ['K1'])], [{'componentId': 'C1'}], profile)
        self.assertEqual(result['planned'], 2)
        self.assertEqual(result['actualPercent'], 50)
        self.assertEqual(result['expectedPercent'], 100)

    def test_missing_assigned_profile_is_unavailable_not_zero(self):
        profile = SimpleNamespace(ksbs=[])
        result = self.calculate([], [], profile)
        self.assertFalse(result['available'])
        self.assertIsNone(result['actualPercent'])

    def test_dynamic_standard_title_uses_assigned_standard_metadata(self):
        standard = {
            'name': 'Project controls professional',
            'version': '1.0',
            'level': 'Level 6',
        }
        with patch('curriculum_api.views.find_skills_england_standard', return_value=standard):
            result = self.calculate([], [])
        self.assertEqual(
            result['title'],
            'Project controls professional Apprenticeship Standard (v1.0) (Level 6)',
        )

