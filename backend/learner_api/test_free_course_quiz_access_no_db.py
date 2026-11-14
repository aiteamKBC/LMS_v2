"""DB-free endpoint security tests for assigned Free Course quiz reads."""
import json
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, patch

from django.db import DatabaseError
from django.test import RequestFactory, SimpleTestCase
from django.urls import resolve

from login import permissions

from . import free_courses_view, learner_detail, mobile, quizzes


def account(role, subject_id, subject_type="learner"):
    return SimpleNamespace(role=role, subject_id=subject_id, subject_type=subject_type)


LEARNER_19 = account("learner", 19)
LEARNER_20 = account("learner", 20)
STAFF = account("staff", 7, "staff")


def source():
    return SimpleNamespace(pk=501, enrolment_id=19, learner_type="commercial")


def scoped_rows(*, quiz_id="7", component_id="FREECOMP-1", include_course=True):
    courses = {"FREE-1": {"id": "FREE-1", "course_name": "Assigned"}} if include_course else {}
    weeks = [{"id": "FREEWEEK-1", "course_id": "FREE-1"}]
    components = [{
        "id": component_id,
        "free_module_id": "FREEWEEK-1",
        "type": "quiz",
        "settings_json": {"linkedQuizId": quiz_id},
    }]
    return courses, weeks, components


QUIZ = {"id": 7, "title": "Safe quiz", "questions": []}
GRADEABLE_QUIZ = {
    "id": 7,
    "title": "Safe quiz",
    "passingGrade": 100,
    "questions": [{
        "id": 101,
        "text": "Pick the correct answer",
        "type": "single_choice",
        "points": 1,
        "explanation": "This explains the answer key.",
        "answers": [
            {"id": 1001, "text": "Correct", "isCorrect": True, "sortOrder": 1},
            {"id": 1002, "text": "Incorrect", "isCorrect": False, "sortOrder": 2},
        ],
    }],
}


class FreeCourseQuizReadAccessTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.enterContext(patch.dict("os.environ", {"LEARNER_API_REQUIRE_AUTH": "1"}))

    def request(self):
        return self.factory.get("/learner_api/free-courses/commercial/19/quiz/FREECOMP-1/")

    def test_assigned_component_route_resolves_to_the_secured_view(self):
        match = resolve("/learner_api/free-courses/commercial/19/quiz/FREECOMP-1/")
        self.assertIs(match.func, free_courses_view.free_course_quiz)

    def call(self, resolved_account, *, kind="commercial", **patches):
        with ExitStack() as stack:
            stack.enter_context(patch.object(permissions, "authenticate_request", return_value=resolved_account))
            for name, value in patches.items():
                stack.enter_context(patch.object(free_courses_view, name, value))
            return free_courses_view.free_course_quiz(
                self.request(), kind=kind, pk=19, component_id="FREECOMP-1",
            )

    def allowed_patches(self):
        return {
            "_resolve_source": lambda *_: (source(), None),
            "assigned_course_ids": lambda *_: ["FREE-1"],
            "_scoped_rows": lambda *_: scoped_rows(),
            "_quiz_owner_is_valid": lambda *_: True,
            "_fetch_quiz": lambda *_: QUIZ,
            "_scrub_answer_key": lambda quiz: quiz,
        }

    def test_unauthenticated_access_is_rejected_before_catalogue_reads(self):
        with patch.object(free_courses_view, "_resolve_source") as resolve:
            response = self.call(None)
        self.assertEqual(response.status_code, 401)
        resolve.assert_not_called()

    def test_assigned_course_learner_can_read_the_linked_quiz(self):
        for kind in ("commercial", "apprenticeship"):
            with self.subTest(kind=kind):
                response = self.call(LEARNER_19, kind=kind, **self.allowed_patches())
                self.assertEqual(response.status_code, 200)
                self.assertEqual(json.loads(response.content), QUIZ)
                self.assertEqual(response["Cache-Control"], "private, no-store")

    def test_unassigned_course_learner_is_rejected(self):
        response = self.call(
            LEARNER_19,
            _resolve_source=lambda *_: (source(), None),
            assigned_course_ids=lambda *_: [],
            _fetch_quiz=lambda *_: self.fail("quiz lookup must not run"),
        )
        self.assertEqual(response.status_code, 404)

    def test_cross_learner_access_is_existence_hiding(self):
        for kind in ("commercial", "apprenticeship"):
            with self.subTest(kind=kind), \
                 patch.object(free_courses_view, "_resolve_source") as resolve:
                response = self.call(LEARNER_20, kind=kind)
            self.assertEqual(response.status_code, 404)
            resolve.assert_not_called()

    def test_authorized_staff_preview_can_read_the_assigned_quiz(self):
        response = self.call(STAFF, **self.allowed_patches())
        self.assertEqual(response.status_code, 200)

    def test_invalid_component_or_quiz_association_is_rejected(self):
        response = self.call(
            LEARNER_19,
            _resolve_source=lambda *_: (source(), None),
            assigned_course_ids=lambda *_: ["FREE-1"],
            _scoped_rows=lambda *_: scoped_rows(component_id="OTHER"),
            _fetch_quiz=lambda *_: self.fail("quiz lookup must not run"),
        )
        self.assertEqual(response.status_code, 404)

    def test_missing_canonical_course_is_not_eligible(self):
        response = self.call(
            LEARNER_19,
            _resolve_source=lambda *_: (source(), None),
            assigned_course_ids=lambda *_: ["FREE-1"],
            _scoped_rows=lambda *_: scoped_rows(include_course=False),
            _fetch_quiz=lambda *_: self.fail("quiz lookup must not run"),
        )
        self.assertEqual(response.status_code, 404)

    def test_database_failures_return_no_internal_details(self):
        response = self.call(
            LEARNER_19,
            _resolve_source=lambda *_: (source(), None),
            assigned_course_ids=lambda *_: ["FREE-1"],
            _scoped_rows=lambda *_: scoped_rows(),
            _quiz_owner_is_valid=lambda *_: True,
            _fetch_quiz=lambda *_: (_ for _ in ()).throw(DatabaseError("secret-host")),
        )
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("secret-host", response.content.decode())

    def test_read_never_exposes_answer_keys_or_explanations(self):
        patches = self.allowed_patches()
        patches["_fetch_quiz"] = lambda *_: GRADEABLE_QUIZ
        patches.pop("_scrub_answer_key")
        response = self.call(LEARNER_19, **patches)
        self.assertEqual(response.status_code, 200)
        body = json.loads(response.content)
        serialised = json.dumps(body)
        self.assertNotIn("isCorrect", serialised)
        self.assertNotIn("explanation", serialised)
        self.assertNotIn("This explains the answer key.", serialised)


class FreeCourseQuizStatusTests(SimpleTestCase):
    def owner_result(self, status):
        database = MagicMock()
        cursor = database.cursor.return_value.__enter__.return_value
        cursor.fetchone.return_value = ("FREEWEEK-1", None, status, 1, 1)
        with patch.object(free_courses_view, "connections", {"enrolment": database}):
            result = free_courses_view._quiz_owner_is_valid(7, "FREE-1", "FREEWEEK-1")
        return result, cursor.execute.call_args.args[0]

    def test_only_published_canonical_quiz_is_available(self):
        published, sql = self.owner_result("published")
        draft, _ = self.owner_result("draft")
        self.assertTrue(published)
        self.assertFalse(draft)
        self.assertIn("q.status", sql)


class GenericQuizCompatibilityTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.enterContext(patch.dict("os.environ", {"LEARNER_API_REQUIRE_AUTH": "1"}))

    def request(self, method="get"):
        path = "/learner_api/quizzes/7/?kind=commercial&learnerId=19&componentId=PROGRAMME-Q1"
        if method == "get":
            return self.factory.get(path)
        return self.factory.post(path, data=json.dumps({"answers": {}}), content_type="application/json")

    def call_detail(self, context_result):
        with patch.object(permissions, "authenticate_request", return_value=LEARNER_19), \
             patch.object(quizzes, "_programme_quiz_context", return_value=context_result), \
             patch.object(quizzes, "_fetch_quiz", return_value=QUIZ), \
             patch.object(quizzes, "_scrub_answer_key", return_value={"id": 7, "questions": []}):
            return quizzes.quiz_detail(self.request(), 7)

    def test_bare_quiz_id_cannot_read_a_free_course_quiz(self):
        denied = free_courses_view._error("Quiz not found.", 404)
        with patch.object(permissions, "authenticate_request", return_value=LEARNER_19), \
             patch.object(quizzes, "_programme_quiz_context", return_value=(source(), None, denied)), \
             patch.object(quizzes, "_fetch_quiz") as fetch:
            response = quizzes.quiz_detail(self.request(), 7)
        self.assertEqual(response.status_code, 404)
        fetch.assert_not_called()

    def test_real_missing_activity_failure_becomes_generic_quiz_404(self):
        """Reproduce the runtime failure raised by the Programme projection.

        The endpoint used to let ``ActivityComponentNotFound`` escape as an
        unhandled ServiceError when the supplied id belonged to Free Courses.
        Exercise the real activity selector and the complete endpoint context,
        rather than replacing ``_programme_quiz_context`` with a canned 404.
        """
        source_row = source()
        missing = type("Missing", (Exception,), {})
        model = SimpleNamespace(
            objects=SimpleNamespace(get=lambda **_kwargs: source_row),
            DoesNotExist=missing,
        )

        def programme_projection(*_args, activity_component_id=None, **_kwargs):
            learner_detail._activity_module_components([], activity_component_id)

        with patch.object(permissions, "authenticate_request", return_value=LEARNER_19), \
             patch.dict(quizzes.SOURCE_MODELS, {"commercial": model}), \
             patch.object(learner_detail, "build_learner_detail", side_effect=programme_projection), \
             patch.object(quizzes, "_fetch_quiz") as fetch:
            response = quizzes.quiz_detail(self.request(), 7)

        self.assertEqual(response.status_code, 404)
        self.assertEqual(json.loads(response.content), {"error": "Quiz not found."})
        fetch.assert_not_called()

    def test_unexpected_programme_projection_service_error_is_not_swallowed(self):
        source_row = source()
        missing = type("Missing", (Exception,), {})
        model = SimpleNamespace(
            objects=SimpleNamespace(get=lambda **_kwargs: source_row),
            DoesNotExist=missing,
        )
        unexpected = learner_detail.ServiceError(
            "Synthetic unrelated service failure.", code="unavailable", status=503,
        )

        with patch.object(permissions, "authenticate_request", return_value=LEARNER_19), \
             patch.dict(quizzes.SOURCE_MODELS, {"commercial": model}), \
             patch.object(learner_detail, "build_learner_detail", side_effect=unexpected), \
             self.assertRaises(learner_detail.ServiceError) as raised:
            quizzes.quiz_detail(self.request(), 7)

        self.assertIs(raised.exception, unexpected)

    def test_shared_quiz_id_keeps_legitimate_programme_access(self):
        component = {"componentId": "PROGRAMME-Q1", "isQuiz": True, "quizMeta": {"quizId": 7}}
        response = self.call_detail((source(), component, None))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content), {"id": 7, "questions": []})

    def test_generic_response_strips_answer_key_fields(self):
        component = {"componentId": "PROGRAMME-Q1", "isQuiz": True, "quizMeta": {"quizId": 7}}
        quiz = {
            "id": 7,
            "title": "Safe quiz",
            "questions": [{
                "id": 1,
                "text": "Pick one",
                "type": "single_choice",
                "explanation": "A reveals the answer.",
                "answers": [
                    {"id": 10, "text": "A", "isCorrect": True},
                    {"id": 11, "text": "B", "isCorrect": False},
                ],
            }],
        }
        with patch.object(permissions, "authenticate_request", return_value=LEARNER_19), \
             patch.object(quizzes, "_programme_quiz_context", return_value=(source(), component, None)), \
             patch.object(quizzes, "_fetch_quiz", return_value=quiz):
            response = quizzes.quiz_detail(self.request(), 7)
        self.assertEqual(response.status_code, 200)
        body = json.loads(response.content)
        self.assertNotIn("isCorrect", json.dumps(body))
        self.assertNotIn("explanation", json.dumps(body))
        self.assertEqual({answer["id"] for answer in body["questions"][0]["answers"]}, {10, 11})

    def test_programme_context_uses_component_assignment_not_global_quiz_identity(self):
        source_row = source()
        missing = type("Missing", (Exception,), {})
        model = SimpleNamespace(objects=SimpleNamespace(get=lambda **_kwargs: source_row), DoesNotExist=missing)
        components = [
            {"componentId": "PROGRAMME-Q1", "isQuiz": True, "quizMeta": {"quizId": 7}},
        ]
        with patch.dict(quizzes.SOURCE_MODELS, {"commercial": model}), \
             patch("learner_api.learner_detail.build_learner_detail", return_value={"components": components}):
            resolved_source, component, error = quizzes._programme_quiz_context(
                "commercial", "19", 7, "PROGRAMME-Q1",
            )
        self.assertIs(resolved_source, source_row)
        self.assertEqual(component["componentId"], "PROGRAMME-Q1")
        self.assertIsNone(error)

    def test_programme_context_resolves_commercial_learner_through_all_learners(self):
        source_row = source()
        missing = type("Missing", (Exception,), {})
        default_manager = Mock()
        all_learners = Mock()
        all_learners.get.return_value = source_row
        model = SimpleNamespace(objects=default_manager, all_learners=all_learners, DoesNotExist=missing)
        components = [{"componentId": "PROGRAMME-Q1", "isQuiz": True, "quizMeta": {"quizId": 7}}]
        with patch.dict(quizzes.SOURCE_MODELS, {"commercial": model}), \
             patch("learner_api.learner_detail.build_learner_detail", return_value={"components": components}):
            resolved_source, component, error = quizzes._programme_quiz_context(
                "commercial", "19", 7, "PROGRAMME-Q1",
            )
        self.assertIs(resolved_source, source_row)
        self.assertEqual(component["componentId"], "PROGRAMME-Q1")
        self.assertIsNone(error)
        all_learners.get.assert_called_once_with(pk="19")
        default_manager.get.assert_not_called()

    def test_generic_access_check_failure_is_safe_and_fail_closed(self):
        with patch.object(permissions, "authenticate_request", return_value=LEARNER_19), \
             patch.object(quizzes, "_programme_quiz_context", side_effect=DatabaseError("secret-host")):
            response = quizzes.quiz_detail(self.request(), 7)
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("secret-host", response.content.decode())

    def test_generic_submit_rejects_unassigned_quiz_before_fetch_or_grading(self):
        denied = free_courses_view._error("Quiz not found.", 404)
        with patch.object(permissions, "authenticate_request", return_value=LEARNER_19), \
             patch.object(quizzes, "_programme_quiz_context", return_value=(source(), None, denied)), \
             patch.object(quizzes, "_fetch_quiz") as fetch:
            response = quizzes.submit_quiz_attempt(self.request("post"), 7)
        self.assertEqual(response.status_code, 404)
        fetch.assert_not_called()


class StaffPreviewWriteTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.enterContext(patch.dict("os.environ", {"LEARNER_API_REQUIRE_AUTH": "1"}))

    def test_staff_preview_cannot_mark_material_or_submit_quiz(self):
        requests = (
            (free_courses_view.complete_free_course_activity, self.factory.post(
                "/learner_api/free-courses/commercial/19/complete/",
                data=json.dumps({"componentId": "FREECOMP-1"}), content_type="application/json",
            ), {}),
            (free_courses_view.submit_free_course_quiz, self.factory.post(
                "/learner_api/free-courses/commercial/19/quiz/FREECOMP-1/submit/",
                data=json.dumps({"answers": {}}), content_type="application/json",
            ), {"component_id": "FREECOMP-1"}),
        )
        with patch.object(permissions, "authenticate_request", return_value=STAFF), \
             patch.object(free_courses_view, "_resolve_source") as resolve:
            for view, request, extra in requests:
                with self.subTest(view=view.__name__):
                    response = view(request, kind="commercial", pk=19, **extra)
                    self.assertEqual(response.status_code, 403)
        resolve.assert_not_called()


class FreeCourseQuizSubmissionTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.enterContext(patch.dict("os.environ", {"LEARNER_API_REQUIRE_AUTH": "1"}))

    def request(self, answer_id=1001):
        return self.factory.post(
            "/learner_api/free-courses/commercial/19/quiz/FREECOMP-1/submit/",
            data=json.dumps({"answers": {"101": answer_id}}),
            content_type="application/json",
        )

    def call(self, resolved_account, *, kind="commercial", answer_id=1001, progress=None,
             assigned=True):
        progress = progress or Mock(return_value=(SimpleNamespace(), True))
        with patch.object(permissions, "authenticate_request", return_value=resolved_account), \
             patch.object(free_courses_view, "_resolve_source", return_value=(source(), None)), \
             patch.object(
                 free_courses_view,
                 "assigned_course_ids",
                 return_value=["FREE-1"] if assigned else [],
             ), \
             patch.object(free_courses_view, "_scoped_rows", return_value=scoped_rows()), \
             patch.object(free_courses_view, "_quiz_owner_is_valid", return_value=True), \
             patch.object(free_courses_view, "_fetch_quiz", return_value=GRADEABLE_QUIZ), \
             patch.object(
                 free_courses_view.LearnerFreeCourseProgress.objects,
                 "get_or_create",
                 progress,
             ):
            response = free_courses_view.submit_free_course_quiz(
                self.request(answer_id),
                kind=kind,
                pk=19,
                component_id="FREECOMP-1",
            )
        return response, progress

    def test_assigned_commercial_and_apprenticeship_learners_can_submit(self):
        for kind in ("commercial", "apprenticeship"):
            with self.subTest(kind=kind):
                response, progress = self.call(LEARNER_19, kind=kind)
                self.assertEqual(response.status_code, 200)
                self.assertTrue(json.loads(response.content)["passed"])
                progress.assert_called_once()

    def test_unauthenticated_and_cross_learner_submissions_are_rejected(self):
        for caller, status in ((None, 401), (LEARNER_20, 404)):
            with self.subTest(status=status), \
                 patch.object(permissions, "authenticate_request", return_value=caller), \
                 patch.object(free_courses_view, "_resolve_source") as resolve, \
                 patch.object(
                     free_courses_view.LearnerFreeCourseProgress.objects,
                     "get_or_create",
                 ) as progress:
                response = free_courses_view.submit_free_course_quiz(
                    self.request(),
                    kind="commercial",
                    pk=19,
                    component_id="FREECOMP-1",
                )
            self.assertEqual(response.status_code, status)
            resolve.assert_not_called()
            progress.assert_not_called()

    def test_unassigned_course_is_denied_before_quiz_fetch_or_progress(self):
        with patch.object(permissions, "authenticate_request", return_value=LEARNER_19), \
             patch.object(free_courses_view, "_resolve_source", return_value=(source(), None)), \
             patch.object(free_courses_view, "assigned_course_ids", return_value=[]), \
             patch.object(free_courses_view, "_fetch_quiz") as fetch, \
             patch.object(
                 free_courses_view.LearnerFreeCourseProgress.objects,
                 "get_or_create",
             ) as progress:
            response = free_courses_view.submit_free_course_quiz(
                self.request(), kind="commercial", pk=19, component_id="FREECOMP-1",
            )
        self.assertEqual(response.status_code, 404)
        fetch.assert_not_called()
        progress.assert_not_called()

    def test_failed_quiz_does_not_complete(self):
        response, progress = self.call(LEARNER_19, answer_id=1002)
        self.assertEqual(response.status_code, 200)
        self.assertFalse(json.loads(response.content)["passed"])
        progress.assert_not_called()

    def test_passed_quiz_completion_uses_canonical_owner_and_is_idempotent(self):
        progress = Mock(side_effect=[
            (SimpleNamespace(status="active"), True),
            (SimpleNamespace(status="active"), False),
        ])
        first, _ = self.call(LEARNER_19, progress=progress)
        second, _ = self.call(LEARNER_19, progress=progress)
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertTrue(json.loads(first.content)["passed"])
        self.assertTrue(json.loads(second.content)["passed"])
        self.assertEqual(progress.call_count, 2)
        for call in progress.call_args_list:
            self.assertEqual(call.kwargs["learner_id"], 501)
            self.assertEqual(call.kwargs["component_ref"], "FREECOMP-1")
            self.assertEqual(call.kwargs["defaults"]["free_course_ref"], "FREE-1")
            self.assertIn("completed_at", call.kwargs["defaults"])

    def test_progress_database_error_is_sanitised(self):
        progress = Mock(side_effect=DatabaseError("private SQL details"))
        response, _ = self.call(LEARNER_19, progress=progress)
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("private SQL details", response.content.decode())


class MobileProgrammeQuizScopeTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.component = {
            "componentId": "PROGRAMME-Q1",
            "mobileMode": "quiz",
        }

    @staticmethod
    def inner(view):
        while hasattr(view, "__wrapped__"):
            view = view.__wrapped__
        return view

    def test_mobile_quiz_read_delegates_component_scope(self):
        request = self.factory.get("/learner_api/mobile/components/PROGRAMME-Q1/quiz/")
        delegated = Mock(return_value=SimpleNamespace(status_code=200))
        with patch.object(mobile, "_component", return_value=self.component), \
             patch.object(mobile, "_quiz_id", return_value=7), \
             patch.object(mobile, "_delegate", delegated):
            response = self.inner(mobile.quiz)(request, "PROGRAMME-Q1")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(delegated.call_args.kwargs["query"], {"componentId": "PROGRAMME-Q1"})

    def test_mobile_quiz_submit_delegates_component_scope(self):
        request = self.factory.post(
            "/learner_api/mobile/components/PROGRAMME-Q1/quiz/submit/",
            data=json.dumps({"answers": {"1": 10}}),
            content_type="application/json",
        )
        delegated = Mock(return_value=SimpleNamespace(status_code=200))
        payload = {"answers": {"1": 10}}
        with patch.object(mobile, "_require_active_profile"), \
             patch.object(mobile, "_component", return_value=self.component), \
             patch.object(mobile, "_quiz_id", return_value=7), \
             patch.object(mobile, "_completion_payload", return_value=payload), \
             patch.object(quizzes, "_fetch_quiz", return_value=QUIZ), \
             patch.object(mobile, "_validated_quiz_answers", return_value={"1": 10}), \
             patch.object(mobile, "_delegate", delegated):
            response = self.inner(mobile.submit_quiz)(request, "PROGRAMME-Q1")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(delegated.call_args.kwargs["payload"]["componentId"], "PROGRAMME-Q1")
