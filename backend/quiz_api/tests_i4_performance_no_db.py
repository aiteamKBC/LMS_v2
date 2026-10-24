import json
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import RequestFactory, SimpleTestCase
from django.db.models.query import ModelIterable

from quiz_api import views


class QuizStudentsQueryShapeTests(SimpleTestCase):
    databases = set()

    def setUp(self):
        self.factory = RequestFactory()

    @patch("quiz_api.views._quiz_question_lookup", return_value=({}, {}))
    @patch("quiz_api.views.LearnerProgressEntry.objects")
    @patch("quiz_api.views.LearnerProfile.objects")
    @patch("quiz_api.views.QuizPackage.objects")
    def test_quiz_students_filters_profiles_and_prefetch_to_requested_quiz(
        self, quiz_packages, profiles, progress_entries, _question_lookup,
    ):
        quiz_packages.get.return_value = SimpleNamespace(
            id=17, title="Safe quiz", module="Module", programme="Programme",
            programme_id="PROG-1", version="v1", questions=1,
            default_question_type="single_choice", status="published", package_type="xml",
            file_name="", file_size=0, schema_valid=True, validation_message="",
            mapped_components=0, author="Team", linked_courses=0,
            short_description="", lesson_content="", duration=60,
            time_unit="minutes", quiz_style="default", randomize_questions=True,
            randomize_answers=False, show_correct_answer=True,
            attempt_history=False, retake_after_pass=False, limit_attempts=False,
            passing_grade=65, retake_points_cut=5, published_at=None,
            created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
            updated_at=datetime(2026, 1, 2, tzinfo=timezone.utc),
            assessment_type="quiz", week_id="",
        )
        progress_queryset = MagicMock(name="progress_queryset")
        filtered_progress = MagicMock(name="filtered_progress")
        filtered_progress._iterable_class = ModelIterable
        progress_entries.filter.side_effect = [progress_queryset, MagicMock(name="matching_progress")]
        progress_queryset.prefetch_related.return_value = filtered_progress

        learner = SimpleNamespace(
            id=91, username="Learner One", email="learner@example.test",
            programme="Programme", cohort="Cohort", group="Group",
            training_plan_progress=[{
                "kind": "quiz", "quizId": 17, "attempt": 1, "grade": 0.8,
                "passed": True, "submittedAt": "2026-10-01T10:00:00+00:00",
            }],
        )
        profile_queryset = MagicMock(name="profile_queryset")
        profiles.filter.return_value = profile_queryset
        profile_queryset.annotate.return_value.filter.return_value.only.return_value.prefetch_related.return_value = [learner]

        response = views.quiz_students(self.factory.get("/quiz_api/quizzes/17/students/"), 17)
        payload = json.loads(response.content)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(set(payload), {"quiz", "summary", "students"})
        self.assertEqual(payload["quiz"]["id"], 17)
        self.assertEqual(payload["summary"], {
            "students": 1, "attempts": 1, "passed": 1, "averageBest": 80.0,
        })
        self.assertEqual(payload["students"][0]["id"], 91)
        requested_filters = [call.kwargs for call in progress_entries.filter.call_args_list]
        self.assertTrue(all(filters["quiz_ref"] == "17" for filters in requested_filters))
        self.assertTrue(all(filters["deleted_at__isnull"] is True for filters in requested_filters))
        prefetch = profile_queryset.annotate.return_value.filter.return_value.only.return_value.prefetch_related.call_args.args[0]
        self.assertEqual(prefetch.prefetch_through, "progress_entries")
        self.assertIs(prefetch.queryset, filtered_progress)


class QuestionBankProjectionTests(SimpleTestCase):
    databases = set()

    @patch("quiz_api.views._ensure_quiz_assessment_type_column")
    @patch("quiz_api.views._training_plan_programmes", return_value=[])
    @patch("quiz_api.views.prefetch_related_objects")
    @patch("quiz_api.views.QuizAnswer.objects")
    @patch("quiz_api.views.QuizPackage.objects")
    @patch("quiz_api.views.QuizQuestion.objects")
    def test_selected_programme_prefetches_only_returned_question_answers(
        self, question_objects, package_objects, answer_objects, prefetch_objects,
        _programmes, _schema_gate,
    ):
        quiz_a = SimpleNamespace(id=1, programme="Alpha", programme_id="A", module="M1", title="Quiz A", status="published", questions=1)
        quiz_b = SimpleNamespace(id=2, programme="Beta", programme_id="B", module="M2", title="Quiz B", status="published", questions=1)
        answer_a = SimpleNamespace(id=11, answer_text="One", is_correct=True)
        answer_b = SimpleNamespace(id=12, answer_text="Two", is_correct=False)
        question_a = SimpleNamespace(id=101, question_text="Alpha question", question_type="single_choice", image_url="", explanation="", quiz=quiz_a, quiz_id=1, answers=SimpleNamespace(all=lambda: [answer_a]))
        question_b = SimpleNamespace(id=102, question_text="Beta question", question_type="single_choice", image_url="", explanation="", quiz=quiz_b, quiz_id=2, answers=SimpleNamespace(all=lambda: [answer_b]))

        base = MagicMock(name="question_queryset")
        question_objects.filter.return_value.exclude.return_value.select_related.return_value.only.return_value = base
        base.order_by.return_value = [question_a, question_b]
        package_objects.exclude.return_value.only.return_value.order_by.return_value = [quiz_a, quiz_b]
        answer_projection = MagicMock(name="answer_projection")
        answer_projection._iterable_class = ModelIterable
        answer_objects.only.return_value = answer_projection

        response = views.question_bank(RequestFactory().get("/quiz_api/question-bank/", {"programme": "Alpha"}))
        payload = json.loads(response.content)

        self.assertEqual(response.status_code, 200)
        self.assertEqual([row["id"] for row in payload["questions"]], [101])
        self.assertEqual(payload["totalQuestions"], 2)
        self.assertEqual(prefetch_objects.call_args.args[0], [question_a])
        selected_prefetch = prefetch_objects.call_args.args[1]
        self.assertEqual(selected_prefetch.prefetch_through, "answers")

