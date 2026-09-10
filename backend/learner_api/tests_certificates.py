from django.test import SimpleTestCase

from .certificates import _learner_progress


class LearnerCertificateProgressTests(SimpleTestCase):
    def test_counts_imported_video_from_generic_component_progress(self):
        detail = {
            "components": [{
                "componentId": "VIDEO-1",
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
