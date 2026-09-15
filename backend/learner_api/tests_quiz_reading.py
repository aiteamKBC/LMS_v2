import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase, override_settings

from .active_users import completed_hours_value_from_progress
from .quiz_reading import _apply_reading_time_mode, _attempt_analysis, _generate_material, _reading_shape


class Related(list):
    def all(self):
        return self


class QuizReadingTests(SimpleTestCase):
    def test_reading_depth_scales_with_question_count(self):
        short = _reading_shape(1)
        medium = _reading_shape(12)
        large = _reading_shape(56)

        self.assertLess(short["targetWords"], medium["targetWords"])
        self.assertLess(medium["targetWords"], large["targetWords"])
        self.assertLess(short["targetSections"], large["targetSections"])
        self.assertEqual(large, {
            "targetWords": 2970,
            "targetSections": 12,
            "targetTakeaways": 12,
        })

    def test_analysis_only_sends_missed_questions_to_the_reading_generator(self):
        quiz = {
            "questions": [
                {"id": 1, "text": "Missed", "explanation": "Explain", "answers": [{"id": 10, "text": "A"}, {"id": 11, "text": "B"}]},
                {"id": 2, "text": "Correct", "explanation": "", "answers": [{"id": 20, "text": "C"}]},
            ]
        }
        missed = SimpleNamespace(
            question_ref=1, is_correct=False, chosen_answer_ref=10,
            chosen_answers=Related(), correct_answers=Related([SimpleNamespace(answer_ref=11)]),
        )
        correct = SimpleNamespace(
            question_ref=2, is_correct=True, chosen_answer_ref=20,
            chosen_answers=Related(), correct_answers=Related([SimpleNamespace(answer_ref=20)]),
        )
        attempt = SimpleNamespace(quiz_answers=Related([missed, correct]))

        self.assertEqual(_attempt_analysis(quiz, attempt), [{
            "question": "Missed", "learnerAnswer": ["A"],
            "correctAnswer": ["B"], "explanation": "Explain",
        }])

    @override_settings(OPENAI_API_KEY="test", OPENAI_REFLECTION_MODEL="test-model")
    @patch("learner_api.quiz_reading._openai_client")
    def test_generator_requests_structured_remedial_reading(self, openai_client):
        material = {
            "title": "Focused revision", "summary": "Review this concept.",
            "sections": [{"heading": "Concept", "paragraphs": ["Explanation one.", "Explanation two.", "Explanation three."]}],
            "keyTakeaways": ["Use it in context."],
        }
        client = MagicMock()
        client.responses.create.return_value.output_text = json.dumps(material)
        openai_client.return_value = client
        attempt = SimpleNamespace(
            grade=0.5, passed=False,
            quiz_answers=Related([SimpleNamespace(
                question_ref=1, is_correct=False, chosen_answer_ref=10,
                chosen_answers=Related(), correct_answers=Related([SimpleNamespace(answer_ref=11)]),
            )]),
        )
        quiz = {
            "title": "Quiz", "questions": [{
                "id": 1, "text": "Question", "explanation": "Why",
                "answers": [{"id": 10, "text": "Wrong"}, {"id": 11, "text": "Right"}],
            }],
        }

        generated = _generate_material(quiz, attempt)
        self.assertEqual({key: generated[key] for key in material}, material)
        self.assertEqual(generated["_generationVersion"], 4)
        request = client.responses.create.call_args.kwargs
        self.assertEqual(request["model"], "test-model")
        self.assertEqual(request["text"]["format"]["type"], "json_schema")
        self.assertEqual(request["text"]["format"]["schema"]["properties"]["sections"]["minItems"], 3)
        paragraphs = request["text"]["format"]["schema"]["properties"]["sections"]["items"]["properties"]["paragraphs"]
        self.assertEqual(paragraphs["minItems"], 3)
        self.assertEqual(paragraphs["maxItems"], 3)
        self.assertGreaterEqual(request["max_output_tokens"], 2500)

    def test_reading_time_is_added_to_quiz_time_instead_of_deduplicated(self):
        hours = completed_hours_value_from_progress([
            {"kind": "quiz", "quizId": 7, "attempt": 1, "verifiedSeconds": 120},
            {"kind": "quiz_reading", "quizId": 7, "attempt": 1, "verifiedSeconds": 180},
        ])
        self.assertAlmostEqual(hours, 300 / 3600)

    def test_manual_reading_time_uses_the_full_learner_entry(self):
        tracking = {
            "claimedSeconds": 1800,
            "serverSessionSeconds": 48,
            "verifiedSeconds": 48,
            "source": "signed_session_capped_visible_page",
            "calculation": "min(client_active_seconds, signed_server_session_seconds)",
        }

        manual = _apply_reading_time_mode(tracking, "manual")

        self.assertEqual(manual["verifiedSeconds"], 1800)
        self.assertEqual(manual["source"], "learner_entered_reading_time")
        self.assertEqual(manual["calculation"], "learner_entered_seconds")
        self.assertEqual(_apply_reading_time_mode(tracking, "timer"), tracking)
