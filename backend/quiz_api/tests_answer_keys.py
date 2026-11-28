import io
import json
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.test import RequestFactory, SimpleTestCase

from . import views
from .answer_keys import choice_key_error, quiz_submission_error
from learner_api.quizzes import _grade_question, _scrub_answer_key


def choice(kind="single_choice"):
    return {"id": 1, "text": "Choose a platform", "type": kind, "points": 1, "answers": [
        {"id": 11, "text": "TikTok", "isCorrect": True, "sortOrder": 0},
        {"id": 12, "text": "YouTube", "isCorrect": False, "sortOrder": 1},
        {"id": 13, "text": "TikTok", "isCorrect": False, "sortOrder": 2},
    ]}


class QuizAnswerKeyTests(SimpleTestCase):
    def test_identical_visible_choice_is_correct_for_either_id(self):
        for value in (11, 13, "13"):
            result = _grade_question(choice(), value)
            self.assertTrue(result["correct"])
            self.assertEqual(result["earned"], 1)
            self.assertEqual(result["chosenAnswer"], result["correctAnswer"])
        self.assertFalse(_grade_question(choice(), 12)["correct"])

    def test_duplicate_options_are_hidden_without_leaking_key(self):
        quiz = {"id": 7, "questions": [choice()]}
        safe = _scrub_answer_key(quiz)
        self.assertEqual(sorted(a["text"] for a in safe["questions"][0]["answers"]), ["TikTok", "YouTube"])
        self.assertNotIn("isCorrect", json.dumps(safe))
        self.assertEqual(len(quiz["questions"][0]["answers"]), 3)

    def test_multi_choice_requires_all_correct_labels_and_no_extra_or_foreign_id(self):
        question = choice("multiple_choice")
        question["answers"].append({"id": 14, "text": "LinkedIn", "isCorrect": True, "sortOrder": 3})
        for selected in ([11, 14], [13, 14], [14, "13"], [11, 13, 14]):
            self.assertTrue(_grade_question(question, selected)["correct"])
        for selected in ([11], [11, 12, 14], [11, 14, 999], []):
            self.assertFalse(_grade_question(question, selected)["correct"])

    def test_twenty_correct_questions_earn_twenty_points(self):
        results = [_grade_question(choice(), 13) for _ in range(20)]
        self.assertEqual(sum(r["earned"] for r in results), 20)
        self.assertEqual(sum(r["possible"] for r in results), 20)
        self.assertEqual(sum(r["correct"] for r in results), 20)

    def test_true_false_text_normalisation_and_unknown_ids(self):
        question = choice("true_false")
        question["answers"][2]["text"] = "  TIKTOK  "
        self.assertTrue(_grade_question(question, 13)["correct"])
        self.assertFalse(_grade_question(question, 999)["correct"])

    def test_other_types_keep_structural_and_partial_scoring(self):
        cases = [
            ("fill_gap", ["A response"], " a RESPONSE ", 2),
            ("keywords", ["red", "blue"], ["red"], 1),
            ("matching", ["One -> First", "Two -> Second"], {"1": "First", "2": "Second"}, 2),
            ("image_matching", [json.dumps({"kind": "image_matching_pair", "imageUrl": "https://example.invalid/circle.png", "label": "Circle", "match": "round"})], {"1": "round"}, 2),
            ("ordering", ["First", "Second"], [1, 2], 2),
        ]
        for kind, labels, submitted, earned in cases:
            with self.subTest(kind=kind):
                question = {"type": kind, "points": 2, "answers": [
                    {"id": i, "text": text, "sortOrder": i, "isCorrect": True} for i, text in enumerate(labels, 1)
                ]}
                self.assertEqual(_grade_question(question, submitted)["earned"], earned)

    def test_invalid_key_or_stale_answers_cannot_be_submitted(self):
        question = choice()
        quiz = {"questions": [question]}
        self.assertIsNone(quiz_submission_error(quiz, {"1": 13}))
        for submitted in ({"1": 999}, {"8": 13}, {"1": {"bad": True}}, []):
            self.assertIsNotNone(quiz_submission_error(quiz, submitted))
        for answer in question["answers"]:
            answer["isCorrect"] = False
        self.assertIn("answer key reviewed", quiz_submission_error(quiz, {"1": 13}))
        question["answers"][0]["isCorrect"] = True
        question["answers"][1]["isCorrect"] = True
        self.assertIn("answer key reviewed", quiz_submission_error(quiz, {"1": 13}))

    def test_authoring_rejects_duplicates_but_can_save_incomplete_drafts(self):
        self.assertIsNotNone(choice_key_error("single_choice", choice()["answers"], strict_duplicates=True))
        self.assertIsNone(choice_key_error("single_choice", [], require_key=False))
        self.assertIsNotNone(choice_key_error("single_choice", []))

    def test_identical_ordering_labels_are_interchangeable_but_reusing_one_id_is_not(self):
        question = {"type": "ordering", "points": 1, "answers": [
            {"id": 1, "text": "Repeat", "sortOrder": 0}, {"id": 2, "text": "Repeat", "sortOrder": 1},
        ]}
        self.assertTrue(_grade_question(question, [2, 1])["correct"])
        self.assertFalse(_grade_question(question, [1, 1])["correct"])

    def test_free_course_submissions_use_the_same_guard_and_duplicate_grader(self):
        from learner_api import free_courses_view as free
        view = free.submit_free_course_quiz
        while hasattr(view, "__wrapped__"):
            view = view.__wrapped__
        for kind in ("commercial", "apprenticeship"):
            for valid in (True, False):
                with self.subTest(kind=kind, valid=valid):
                    quiz = {"id": 7, "passingGrade": 70, "questions": [choice()]}
                    if not valid:
                        quiz["questions"][0]["answers"][0]["isCorrect"] = False
                    request = RequestFactory().post("/quiz/", json.dumps({"answers": {"1": 13}}), content_type="application/json")
                    with patch.object(free, "_resolve_source", return_value=(SimpleNamespace(pk=19), None)), \
                         patch.object(free, "_resolve_quiz_component", return_value=(7, "FREE-1", None)), \
                         patch.object(free, "_fetch_quiz", return_value=quiz), \
                         patch.object(free.LearnerFreeCourseProgress.objects, "get_or_create") as save:
                        response = view(request, kind, 19, "COMP-1")
                    self.assertEqual(response.status_code, 200 if valid else 409)
                    if valid:
                        self.assertEqual(json.loads(response.content)["grade"], 100)
                        save.assert_called_once()
                    else:
                        save.assert_not_called()

    def test_result_snapshot_survives_profile_projection(self):
        from learner_api.models import LearnerProfile, LearnerProgressEntry, LearnerQuizAnswer
        profile = LearnerProfile(id=19)
        progress = LearnerProgressEntry(id=1, learner=profile, kind="quiz", quiz_ref="7", passed=True)
        snapshot = {"questionText": "Original question", "type": "fill_gap", "possible": 2, "chosenText": "Answer", "correctText": "Answer / Alternative"}
        answer = LearnerQuizAnswer(id=2, progress=progress, question_ref=1, earned=2, is_correct=True, result_snapshot=snapshot)
        answer._prefetched_objects_cache = {"chosen_answers": [], "correct_answers": []}
        progress._prefetched_objects_cache = {"ksb_links": [], "quiz_answers": [answer]}
        profile._prefetched_objects_cache = {"progress_entries": [progress]}
        result = profile.training_plan_progress[0]["questions"][0]
        self.assertEqual({key: result[key] for key in snapshot}, snapshot)
        self.assertTrue(result["correct"])


class QuizImportKeyTests(SimpleTestCase):
    def test_letter_key_does_not_mark_words_starting_with_that_letter(self):
        question = views._question_from_parts("Q", ["The correct response", "A private internal memo", "X (Twitter)"], "A")
        self.assertEqual([a["is_correct"] for a in question["answers"]], [True, False, False])
        self.assertEqual([a["text"] for a in question["answers"]], ["The correct response", "A private internal memo", "X (Twitter)"])

    def test_full_answer_text_with_punctuation_is_matched_before_splitting(self):
        for answer in ("Revenue, leads and sales", "Paid / organic", "A rise in calls", "X (Twitter)"):
            with self.subTest(answer=answer):
                question = views._question_from_parts("Q", ["Wrong", answer], answer)
                self.assertEqual([a["is_correct"] for a in question["answers"]], [False, True])

    def test_unknown_key_never_defaults_to_first_answer(self):
        question = views._question_from_parts("Q", ["One", "Two"], "Not an option")
        self.assertFalse(any(a["is_correct"] for a in question["answers"]))

    def test_blank_option_does_not_shift_letter_or_number_keys(self):
        for key in ("C", "3"):
            question = views._question_from_parts("Q", ["One", "", "Three"], key)
            self.assertEqual([a["is_correct"] for a in question["answers"]], [False, True])

    def test_explicit_markers_and_multiple_keys(self):
        question = views._question_from_parts("Q", ["A. First", "B) Second", "C: Third"], "B;C", question_type="multiple_choice")
        self.assertEqual([a["text"] for a in question["answers"]], ["First", "Second", "Third"])
        self.assertEqual([a["is_correct"] for a in question["answers"]], [False, True, True])

    def test_csv_import_uses_same_key_resolution(self):
        file = io.BytesIO(b'question,option_a,option_b,correct_answer\nQ,Right,A wrong answer,A\n')
        questions, _, _ = views._extract_csv_questions(file)
        self.assertEqual([a["is_correct"] for a in questions[0]["answers"]], [True, False])

    def test_generated_text_key_does_not_add_first_option_as_correct(self):
        for key, flags in [("Right, with detail", [False, True]), ("unknown", [False, False]), ("", [False, False])]:
            with self.subTest(key=key):
                result = views._normalise_generated_questions({"questions": [{"question": "Q", "options": ["Wrong", "Right, with detail"], "correct_answer": key}]})
                self.assertEqual([a["isCorrect"] for a in result[0]["answers"]], flags)

    def test_author_save_rejects_duplicate_options_before_mutations(self):
        from .tests_question_images import QuestionImageTests
        response, manager = QuestionImageTests().save_questions([{
            "text": "Q", "questionType": "single_choice", "answers": [
                {"text": "TikTok", "isCorrect": True}, {"text": " tiktok ", "isCorrect": False},
            ],
        }])
        self.assertEqual(response.status_code, 400)
        manager.create.assert_not_called()
        manager.answer_create.assert_not_called()


class QuizAnswerIdentityTests(SimpleTestCase):
    def test_editing_one_option_preserves_other_ids_and_key_edits(self):
        old = [SimpleNamespace(id=i, answer_text=text, save=Mock()) for i, text in [(11, "Yes"), (12, "No")]]
        question = Mock()
        with patch.object(views.QuizAnswer.objects, "create") as create:
            views._update_question_answers(question, [{"id": 11, "text": "Yes", "isCorrect": True}, {"id": 12, "text": "Maybe", "isCorrect": False}], old)
        old[0].save.assert_called_once()
        old[1].save.assert_not_called()
        create.assert_called_once()
        question.answers.filter.assert_called_once_with(id__in=[12])

    def test_clients_without_answer_ids_preserve_unchanged_options(self):
        old = [SimpleNamespace(id=11, answer_text="Yes", save=Mock())]
        question = Mock()
        with patch.object(views.QuizAnswer.objects, "create") as create:
            views._update_question_answers(question, [{"text": "Yes", "isCorrect": True}], old)
        create.assert_not_called()
        question.answers.filter.assert_not_called()
        old[0].save.assert_called_once()

    def test_review_uses_snapshot_after_live_question_changes(self):
        result = views._serialize_attempt_for_student({"questions": [{
            "questionId": 1, "questionText": "Original question", "chosenText": "Original answer", "correctText": "Original answer",
            "correct": True, "earned": 2, "possible": 2,
        }]}, {1: {"text": "Changed question", "possible": 5}}, {})["questions"][0]
        self.assertEqual((result["text"], result["chosenAnswer"], result["correctAnswer"], result["possible"]), ("Original question", "Original answer", "Original answer", 2))
