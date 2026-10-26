import json
from datetime import datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.db.models.query import ModelIterable
from django.test import RequestFactory, SimpleTestCase

from quiz_api import views


def quiz_record(pk=7):
    return views.QuizPackage(
        id=pk,
        title="Bounded quiz",
        programme_id="P1",
        programme="Programme",
        module="Module",
        week_id="W1",
        questions=12,
        status="published",
        assessment_type="quiz",
        duration=30,
        passing_grade=80,
        lesson_content="Editor content",
        created_at=datetime(2026, 10, 17, tzinfo=timezone.utc),
        updated_at=datetime(2026, 10, 18, tzinfo=timezone.utc),
    )


class PaginationContractTests(SimpleTestCase):
    databases = set()

    def setUp(self):
        self.factory = RequestFactory()

    def test_invalid_page_is_explicit_instead_of_silently_clamped(self):
        pagination, error = views._pagination_request(
            self.factory.get("/quiz_api/quizzes/", {"page": "zero"}),
            default_page_size=10,
        )

        self.assertIsNone(pagination)
        self.assertEqual(error.status_code, 400)
        self.assertEqual(
            json.loads(error.content),
            {"error": "page and pageSize must be whole numbers."},
        )

    @patch("quiz_api.views._ensure_quiz_assessment_type_column")
    @patch("quiz_api.views._sync_quiz_assignment_counts")
    @patch("quiz_api.views.QuizPackage.objects")
    def test_quiz_list_slices_before_assignment_projection(
        self, package_objects, sync_counts, _schema_gate,
    ):
        quiz = quiz_record()
        queryset = MagicMock(name="filtered_quizzes")
        queryset.filter.return_value = queryset
        queryset.exclude.return_value = queryset
        queryset.aggregate.return_value = {
            "total": 3,
            "published": 2,
            "draft": 1,
            "validation_issues": 0,
            "total_questions": 25,
        }
        ordered = MagicMock(name="ordered_quizzes")
        ordered.__getitem__.return_value = [quiz]
        queryset.order_by.return_value = ordered
        package_objects.all.return_value = queryset
        sync_counts.return_value = [quiz]

        response = views.quizzes(self.factory.get(
            "/quiz_api/quizzes/",
            {"page": "2", "pageSize": "1", "assessmentType": "quiz"},
        ))
        payload = json.loads(response.content)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload["pagination"], {
            "page": 2,
            "pageSize": 1,
            "total": 3,
            "totalPages": 3,
            "hasNext": True,
            "hasPrevious": True,
        })
        self.assertEqual(payload["summary"]["totalQuestions"], 25)
        ordered.__getitem__.assert_called_once_with(slice(1, 2, None))
        sync_counts.assert_called_once_with([quiz])

    @patch("quiz_api.views._training_plan_programmes", return_value=[])
    @patch("quiz_api.views.prefetch_related_objects")
    @patch("quiz_api.views.QuizAnswer.objects")
    @patch("quiz_api.views.QuizPackage.objects")
    @patch("quiz_api.views.QuizQuestion.objects")
    def test_question_bank_prefetches_answers_for_one_page_only(
        self, question_objects, package_objects, answer_objects,
        prefetch_objects, _programmes,
    ):
        quiz = SimpleNamespace(
            id=1, programme="Programme", programme_id="P1", module="Module",
            title="Quiz", status="published", questions=2,
        )
        answer = SimpleNamespace(id=11, answer_text="Answer", is_correct=True)
        question = SimpleNamespace(
            id=101, question_text="Question", question_type="single_choice",
            image_url="", explanation="", quiz=quiz, quiz_id=1,
            answers=SimpleNamespace(all=lambda: [answer]),
        )
        base = MagicMock(name="question_bank_base")
        base.values.return_value.annotate.return_value = [{
            "quiz__programme": "Programme",
            "quiz__programme_id": "P1",
            "question_count": 2,
            "quiz_count": 1,
        }]
        ordered = MagicMock(name="ordered_question_bank")
        ordered.__getitem__.return_value = [question]
        base.order_by.return_value = ordered

        answer_projection = MagicMock(name="answer_projection")
        answer_projection._iterable_class = ModelIterable
        answer_objects.only.return_value = answer_projection

        signature_queryset = MagicMock(name="signature_queryset")
        question_objects.filter.return_value.exclude.return_value.filter.return_value.select_related.return_value.only.return_value.order_by.return_value = [question]
        package_objects.exclude.return_value.filter.return_value.only.return_value.order_by.return_value = [quiz]

        response = views._paginated_question_bank(
            self.factory.get("/quiz_api/question-bank/", {
                "page": "1", "pageSize": "1", "questionType": "all",
                "quizStatus": "all",
            }),
            base,
            {"page": 1, "pageSize": 1},
            "all",
        )
        payload = json.loads(response.content)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload["pagination"]["total"], 2)
        self.assertEqual([row["id"] for row in payload["questions"]], [101])
        ordered.count.assert_not_called()
        ordered.__getitem__.assert_called_once_with(slice(0, 1, None))
        self.assertEqual(prefetch_objects.call_args.args[0], [question])

    @patch("quiz_api.views.ArrayAgg", side_effect=lambda value, **kwargs: ("array_agg", value, kwargs))
    @patch("quiz_api.views.Max", side_effect=lambda value: ("max", value))
    @patch("quiz_api.views.Count", side_effect=lambda value, **kwargs: ("count", value, kwargs))
    @patch("quiz_api.views.LearnerProfile.objects")
    @patch("quiz_api.views.LearnerProgressEntry.objects")
    def test_quiz_students_slices_profiles_before_loading_attempt_graph(
        self, progress_objects, profile_objects, _count, _max, array_agg,
    ):
        quiz = quiz_record(pk=17)
        summary_base = MagicMock(name="summary_base")
        summary_values = MagicMock(name="summary_values")
        summary_base.values.return_value = summary_values
        summary_values.annotate.return_value = [{
            "learner_id": 91,
            "attempt_count": 1,
            "best_grade": Decimal("0.8"),
            "passed_by_recency": [True],
        }]
        progress_base = MagicMock(name="progress_base")
        progress_projection = MagicMock(name="progress_projection")
        progress_projection._iterable_class = ModelIterable
        progress_base.prefetch_related.return_value = progress_projection
        progress_objects.filter.side_effect = [
            summary_base, progress_base,
        ]

        learner = SimpleNamespace(
            id=91,
            username="Learner One",
            email="learner@example.test",
            programme="Programme",
            cohort="Cohort",
            group="Group",
            training_plan_progress=[{
                "kind": "quiz", "quizId": 17, "attempt": 1, "grade": 0.8,
                "passed": True, "submittedAt": "2026-10-01T10:00:00+00:00",
            }],
        )
        profile_queryset = MagicMock(name="profile_queryset")
        paged_profiles = MagicMock(name="paged_profiles")
        paged_profiles.__getitem__.return_value = [learner]
        profile_objects.filter.return_value = profile_queryset
        profile_queryset.annotate.return_value.only.return_value.order_by.return_value.prefetch_related.return_value = paged_profiles

        response = views._paginated_quiz_students(
            self.factory.get("/quiz_api/quizzes/17/students/", {"page": "1", "pageSize": "1"}),
            quiz,
            {"page": 1, "pageSize": 1},
            {},
            {},
        )
        payload = json.loads(response.content)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload["summary"]["students"], 1)
        self.assertEqual(payload["summary"]["averageBest"], 80.0)
        self.assertEqual(payload["students"][0]["id"], 91)
        profile_objects.filter.assert_called_once_with(
            lifecycle_status="active",
            progress_entries__kind="quiz",
            progress_entries__quiz_ref="17",
            progress_entries__deleted_at__isnull=True,
        )
        profile_queryset.annotate.assert_called_once_with(
            latest_quiz_submitted=("max", "progress_entries__submitted_at"),
        )
        self.assertEqual(array_agg.call_count, 1)
        paged_profiles.__getitem__.assert_called_once_with(slice(0, 1, None))

