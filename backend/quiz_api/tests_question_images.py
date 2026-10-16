import base64
import io
import json
from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from PIL import Image
from django.test import RequestFactory, SimpleTestCase

from . import views
from .models import QuizPackage, QuizQuestion
from .question_images import MAX_IMAGE_BYTES, validate_question_image
from learner_api import quizzes
from learner_api.models import LearnerProfile, LearnerProgressEntry, LearnerQuizAnswer


def image_data(colour="blue", format="PNG", mime="image/png"):
    output = io.BytesIO()
    Image.new("RGB", (4, 3), colour).save(output, format=format)
    return f"data:{mime};base64," + base64.b64encode(output.getvalue()).decode()


class QuestionImageTests(SimpleTestCase):
    def test_validates_supported_images_and_explicit_removal(self):
        for format, mime in (("PNG", "image/png"), ("JPEG", "image/jpeg"), ("GIF", "image/gif"), ("WEBP", "image/webp")):
            with self.subTest(format=format):
                value = image_data(format=format, mime=mime)
                self.assertEqual(validate_question_image(value), value)
        self.assertEqual(validate_question_image(None), "")
        self.assertEqual(validate_question_image(""), "")

    def test_rejects_invalid_mismatched_and_oversized_files(self):
        for value in (
            "https://example.com/image.png", "data:image/svg+xml;base64,PHN2Zy8+",
            "data:image/png;base64,broken", "data:image/png;base64,aGVsbG8=", 123,
            image_data().replace("image/png", "image/jpeg"),
            "data:image/png;base64," + "A" * (4 * ((MAX_IMAGE_BYTES + 2) // 3) + 4),
        ):
            with self.subTest(value_type=type(value).__name__), self.assertRaises(ValueError):
                validate_question_image(value)

    def save_questions(self, payload, existing=None):
        quiz = QuizPackage(id=7, title="Diagram quiz")
        question_manager = MagicMock()
        question_manager.filter.return_value.prefetch_related.return_value = [existing] if existing else []
        question_manager.filter.return_value.count.return_value = 1
        question_manager.create.side_effect = lambda **values: QuizQuestion(id=21, **values)
        request = RequestFactory().post("/quiz_api/quizzes/7/questions/", json.dumps({"questions": payload}), content_type="application/json")
        with patch.object(views, "_ensure_quiz_assessment_type_column"), \
             patch.object(QuizPackage.objects, "get", return_value=quiz), \
             patch.object(QuizPackage.objects, "select_for_update", return_value=QuizPackage.objects), \
             patch.object(QuizPackage, "save"), patch.object(QuizPackage, "refresh_from_db"), \
             patch.object(views.QuizQuestion, "objects", question_manager), \
             patch.object(views.QuizAnswer.objects, "create") as answer_create, \
             patch.object(views.transaction, "atomic", side_effect=nullcontext), \
             patch.object(views, "_quiz_preview_payload", return_value={}):
            response = views.quiz_questions(request, 7)
        question_manager.answer_create = answer_create
        return response, question_manager

    def test_creates_an_image_for_every_question_type(self):
        for question_type in views.AI_GENERATION_QUESTION_TYPES:
            with self.subTest(question_type=question_type):
                image = image_data()
                response, manager = self.save_questions([{"text": "Read the diagram", "questionType": question_type, "imageUrl": image, "answers": []}])
                self.assertEqual(response.status_code, 200)
                self.assertEqual(manager.create.call_args.kwargs["image_url"], image)
                self.assertEqual(manager.create.call_args.kwargs["question_type"], question_type)

    def test_omitted_image_is_preserved_and_explicit_image_can_replace_or_remove_it(self):
        original = image_data()
        replacement = image_data("red")
        for patch_value, expected in (({}, original), ({"imageUrl": replacement}, replacement), ({"imageUrl": ""}, ""), ({"imageUrl": None}, "")):
            with self.subTest(present="imageUrl" in patch_value):
                question = MagicMock(id=21, image_url=original)
                response, manager = self.save_questions([{"id": 21, "text": "Unchanged", "questionType": "true_false", "answers": [], **patch_value}], question)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(question.image_url, expected)
                manager.create.assert_not_called()
                self.assertEqual("image_url" in question.save.call_args.kwargs["update_fields"], "imageUrl" in patch_value)

    def test_invalid_image_rejects_whole_batch_before_writes(self):
        response, manager = self.save_questions([
            {"text": "Valid", "imageUrl": image_data()}, {"text": "Invalid", "imageUrl": "not an image"},
        ])
        self.assertEqual(response.status_code, 400)
        manager.filter.assert_not_called()
        manager.create.assert_not_called()

    def test_editing_a_diagram_preserves_answer_ids_in_its_quiz(self):
        image = image_data()
        question = MagicMock(id=21, image_url=image)
        question.answers.all.return_value.__iter__.return_value = iter([
            SimpleNamespace(id=41, answer_text="Yes", is_correct=True, sort_order=1),
        ])
        response, manager = self.save_questions([{
            "id": 21, "text": "Read the diagram", "questionType": "single_choice", "imageUrl": image_data("red"),
            "answers": [{"id": 41, "text": "Yes", "isCorrect": True}],
        }], question)
        self.assertEqual(response.status_code, 200)
        question.answers.all.return_value.delete.assert_not_called()
        manager.answer_create.assert_not_called()
        self.assertEqual(manager.filter.call_args_list[0].kwargs, {"quiz_id": 7})

    def test_image_only_payload_preserves_other_authored_fields_and_answers(self):
        question = MagicMock(id=21, image_url=image_data(), question_text="Keep text",
                             question_type="true_false", explanation="Keep feedback", is_archived=True)
        response, manager = self.save_questions([{"id": 21, "imageUrl": ""}], question)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(question.question_text, "Keep text")
        self.assertEqual(question.question_type, "true_false")
        self.assertEqual(question.explanation, "Keep feedback")
        self.assertTrue(question.is_archived)
        question.answers.all.return_value.delete.assert_not_called()
        manager.answer_create.assert_not_called()

    def test_preview_and_staff_review_keep_the_question_image(self):
        image = image_data()
        question = QuizQuestion(id=21, quiz_id=7, question_text="Diagram?", image_url=image)
        with patch.object(views.QuizQuestion.objects, "filter") as query, \
             patch.object(views, "_serialize_quiz", return_value={}), \
             patch.object(views.QuizAnswer.objects, "all"):
            # Prefetch is already represented by the in-memory answer list.
            question._prefetched_objects_cache = {"answers": []}
            query.return_value.filter.return_value.prefetch_related.return_value = [question]
            preview = views._quiz_preview_payload(QuizPackage(id=7))
        self.assertEqual(preview["questions"][0]["imageUrl"], image)
        for snapshot in (image, ""):
            attempt = views._serialize_attempt_for_student(
                {"questions": [{"questionId": 21, "imageUrl": snapshot}]},
                {21: {"imageUrl": image_data("red")}}, {},
            )
            self.assertEqual(attempt["questions"][0]["imageUrl"], snapshot)

    def test_learner_fetch_includes_diagram_without_exposing_correct_choices(self):
        image = image_data()
        cursor = MagicMock()
        cursor.fetchone.return_value = (7, "Quiz", "Module", "Programme", "W1", 10, "minutes", 65, False, False, "single_choice")
        cursor.fetchall.side_effect = [[(21, "Diagram?", "single_choice", 1, 0, "", image)], [(22, 21, "Yes", True, 0)]]
        with patch.object(quizzes, "_conn") as connection:
            connection.return_value.cursor.return_value.__enter__.return_value = cursor
            result = quizzes._scrub_answer_key(quizzes._fetch_quiz(7))
        self.assertEqual(result["questions"][0]["imageUrl"], image)
        self.assertNotIn("isCorrect", result["questions"][0]["answers"][0])

    def test_historical_projection_keeps_snapshot_and_distinguishes_legacy_attempts(self):
        for snapshot in (None, "", image_data()):
            profile = LearnerProfile(id=19)
            progress = LearnerProgressEntry(id=1, learner=profile, kind="quiz", quiz_ref="7", passed=True)
            answer = LearnerQuizAnswer(id=2, progress=progress, question_ref=21, question_image_url=snapshot)
            answer._prefetched_objects_cache = {"chosen_answers": [], "correct_answers": []}
            progress._prefetched_objects_cache = {"ksb_links": [], "quiz_answers": [answer]}
            profile._prefetched_objects_cache = {"progress_entries": [progress]}
            projected = profile.training_plan_progress[0]["questions"][0]
            if snapshot is None:
                self.assertNotIn("imageUrl", projected)
            else:
                self.assertEqual(projected["imageUrl"], snapshot)
