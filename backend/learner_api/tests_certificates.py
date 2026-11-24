from django.test import SimpleTestCase

from .certificates import (
    _learner_progress,
    _template_summary,
    issue_learner_certificate,
    issue_learner_module_certificate,
)


class LearnerCertificateProgressTests(SimpleTestCase):
    def test_catalogue_template_summary_omits_embedded_artwork(self):
        template = {
            'id': 1, 'version': 2, 'title': 'Completion', 'minimumProgress': 100,
            'requireFinalTest': True, 'layoutConfig': {'backgroundDataUrl': 'data:image/png;base64,large'},
            'bodyText': 'Body',
        }
        self.assertEqual(_template_summary(template), {
            'id': 1, 'version': 2, 'title': 'Completion', 'minimumProgress': 100,
            'requireFinalTest': True,
        })

    def test_certificate_issue_endpoints_require_django_csrf_validation(self):
        self.assertFalse(getattr(issue_learner_certificate, 'csrf_exempt', False))
        self.assertFalse(getattr(issue_learner_module_certificate, 'csrf_exempt', False))

    def test_counts_imported_video_from_generic_component_progress(self):
        detail = {
            "components": [{
                "componentId": "VIDEO-1",
                "expectedOtjh": 1,
                "component": "Lesson video",
                "type": "video",
                "videoUrl": "https://example.test/video",
            }],
            "videoProgress": [],
            "componentProgress": [{"componentId": "VIDEO-1", "passed": None}],
            "quizAttempts": [],
        }

        self.assertEqual(_learner_progress(detail)["trackableDone"], 1)

    def test_failed_quiz_attempt_does_not_count_as_certificate_progress(self):
        detail = {
            "components": [{
                "componentId": "QUIZ-COMP-1",
                "expectedOtjh": 1,
                "component": "Knowledge quiz",
                "type": "quiz",
                "isQuiz": True,
                "quizMeta": {"quizId": 7, "questions": 2},
            }],
            "videoProgress": [],
            "componentProgress": [],
            "quizAttempts": [{"quizId": 7, "passed": False}],
        }

        self.assertEqual(_learner_progress(detail)["trackableDone"], 0)

    def test_any_passed_quiz_attempt_preserves_completion(self):
        detail = {
            "components": [{
                "componentId": "QUIZ-COMP-1",
                "expectedOtjh": 1,
                "component": "Knowledge quiz",
                "type": "quiz",
                "isQuiz": True,
                "quizMeta": {"quizId": 7, "questions": 2},
            }],
            "videoProgress": [],
            "componentProgress": [],
            "quizAttempts": [
                {"quizId": 7, "passed": True},
                {"quizId": 7, "passed": False},
            ],
        }

        self.assertEqual(_learner_progress(detail)["trackableDone"], 1)

    def test_optional_quiz_pass_does_not_complete_required_sibling(self):
        detail = {'components': [
            {'componentId': 'REQUIRED', 'expectedOtjh': 1, 'isQuiz': True, 'quizMeta': {'quizId': 7}},
            {'componentId': 'OPTIONAL', 'expectedOtjh': 0, 'isQuiz': True, 'quizMeta': {'quizId': 7}}],
            'quizAttempts': [{'componentId': 'OPTIONAL', 'quizId': 7, 'passed': True}]}
        result = _learner_progress(detail)
        self.assertEqual((result['trackableTotal'], result['trackableDone'], result['progressPercent']), (1, 0, 0))

    def test_missing_required_content_is_not_silently_removed(self):
        result = _learner_progress({'components': [
            {'componentId': 'REQUIRED', 'expectedOtjh': 1, 'type': 'reading'},
            {'componentId': 'OPTIONAL', 'expectedOtjh': 0, 'type': 'reading'}],
            'componentProgress': [{'componentId': 'OPTIONAL', 'passed': True}]})
        self.assertEqual((result['trackableTotal'], result['trackableDone']), (1, 0))
