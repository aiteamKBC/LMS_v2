import json
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.db import DatabaseError
from django.test import RequestFactory, SimpleTestCase

from . import quizzes
from .assessments import permissions, selectors


def _account(role="learner", subject_id=17):
    return SimpleNamespace(role=role, subject_id=subject_id)


def _context(kind="apprenticeship", enrolment_id=17, profile_id=901):
    return selectors.QuizLearnerContext(
        source=SimpleNamespace(pk=enrolment_id, id=enrolment_id, learner_type=kind),
        profile=SimpleNamespace(pk=profile_id, id=profile_id, enrolment_id=enrolment_id),
        enrolment_id=enrolment_id,
        kind=kind,
    )


class QuizEntitlementSelectorTests(SimpleTestCase):
    def test_identity_uses_the_enrolment_bridge_not_equal_primary_keys(self):
        source = SimpleNamespace(
            pk=17, id=17, learner_type="commercial",
            _weekly_training_plan=[{"moduleId": "M1"}],
            _weekly_learning_plan=None,
        )
        profile = SimpleNamespace(pk=901, id=901, enrolment_id=17, lifecycle_status="active")
        source_manager = Mock()
        source_manager.using.return_value.only.return_value.filter.return_value.first.return_value = source
        profile_manager = Mock()
        profile_manager.using.return_value.only.return_value.filter.return_value.first.return_value = profile

        with patch.object(selectors.EnrolmentUser, "all_learners", source_manager), \
             patch.object(selectors, "assignment_projection", side_effect=lambda query: query), \
             patch.object(selectors.LearnerProfile, "objects", profile_manager):
            result = selectors.resolve_quiz_learner(17)

        self.assertEqual((result.enrolment_id, result.profile.pk, result.kind), (17, 901, "commercial"))
        source_manager.using.return_value.only.assert_called_once_with(*selectors.QUIZ_SOURCE_FIELDS)
        source_manager.using.return_value.only.return_value.filter.assert_called_once_with(pk=17)
        profile_manager.using.return_value.only.return_value.filter.assert_called_once_with(
            enrolment_id=17,
            lifecycle_status__iexact="active",
        )

    def test_null_or_missing_bridge_fails_closed_for_both_learner_kinds(self):
        for kind in ("commercial", "apprenticeship"):
            with self.subTest(kind=kind):
                source = SimpleNamespace(
                    pk=17, id=17, learner_type=kind,
                    _weekly_training_plan=[{"moduleId": "M1"}],
                    _weekly_learning_plan=None,
                )
                source_manager = Mock()
                source_manager.using.return_value.only.return_value.filter.return_value.first.return_value = source
                profile_manager = Mock()
                profile_manager.using.return_value.only.return_value.filter.return_value.first.return_value = None
                with patch.object(selectors.EnrolmentUser, "all_learners", source_manager), \
                     patch.object(selectors, "assignment_projection", side_effect=lambda query: query), \
                     patch.object(selectors.LearnerProfile, "objects", profile_manager):
                    self.assertIsNone(selectors.resolve_quiz_learner(17))

    def test_entitlement_reuses_the_effective_plan_projection(self):
        context = _context()
        plan = [{"moduleId": "MOD-1"}]
        content = {"components": [{"quizMeta": {"quizId": 77}}]}
        with patch.object(selectors, "effective_training_plan", return_value=plan), \
             patch.object(selectors, "request_preset_cache", return_value={}), \
             patch.object(selectors, "build_learning_content_summary", return_value=content) as build:
            self.assertTrue(selectors.learner_has_quiz_entitlement(context, 77))
            self.assertFalse(selectors.learner_has_quiz_entitlement(context, 78))

        self.assertEqual(build.call_count, 2)
        self.assertEqual(build.call_args.kwargs["progress"], ([], [], []))
        self.assertTrue(build.call_args.kwargs["strict"])
        self.assertTrue(build.call_args.kwargs["identities_only"])
        self.assertTrue(build.call_args.kwargs["preserve_legacy"])
        self.assertEqual(build.call_args.kwargs["quiz_id"], 78)


class QuizPermissionTests(SimpleTestCase):
    def setUp(self):
        self.request = RequestFactory().get("/learner_api/quizzes/77/")

    def test_assigned_commercial_and_apprenticeship_learners_are_allowed(self):
        for kind in ("commercial", "apprenticeship"):
            context = _context(kind=kind)
            with self.subTest(kind=kind), \
                 patch.object(permissions, "authenticate_request", return_value=_account()), \
                 patch.object(permissions, "resolve_quiz_learner", return_value=context), \
                 patch.object(permissions, "learner_has_quiz_entitlement", return_value=True):
                result = permissions.authorize_quiz_access(self.request, 77, kind=kind)
                self.assertIs(result, context)

    def test_manipulated_learner_id_is_hidden_before_identity_lookup(self):
        with patch.object(permissions, "authenticate_request", return_value=_account(subject_id=17)), \
             patch.object(permissions, "resolve_quiz_learner") as resolve:
            with self.assertRaises(permissions.QuizAccessDenied) as raised:
                permissions.authorize_quiz_access(self.request, 77, learner_id="18")
        self.assertEqual((raised.exception.status, raised.exception.message), (404, "Quiz not found."))
        resolve.assert_not_called()

    def test_unassigned_wrong_kind_and_unresolved_identity_fail_closed(self):
        context = _context(kind="commercial")
        cases = (
            (context, False, None),
            (context, True, "apprenticeship"),
            (None, True, None),
        )
        for resolved, entitled, kind in cases:
            with self.subTest(resolved=resolved is not None, entitled=entitled, kind=kind), \
                 patch.object(permissions, "authenticate_request", return_value=_account()), \
                 patch.object(permissions, "resolve_quiz_learner", return_value=resolved), \
                 patch.object(permissions, "learner_has_quiz_entitlement", return_value=entitled):
                with self.assertRaises(permissions.QuizAccessDenied) as raised:
                    permissions.authorize_quiz_access(self.request, 77, kind=kind)
                self.assertEqual(raised.exception.status, 404)

    def test_staff_and_admin_preview_keep_existing_read_access(self):
        for role in ("staff", "admin"):
            with self.subTest(role=role), \
                 patch.object(permissions, "authenticate_request", return_value=_account(role=role)), \
                 patch.object(permissions, "resolve_quiz_learner") as resolve:
                result = permissions.authorize_quiz_access(
                    self.request,
                    77,
                    allow_staff_preview=True,
                )
                self.assertIsNone(result)
                resolve.assert_not_called()


class QuizEndpointAuthorizationTests(SimpleTestCase):
    QUIZ = {
        "id": 77,
        "title": "Assigned quiz",
        "module": "Module 1",
        "programme": "Programme 1",
        "weekId": "W1",
        "duration": 30,
        "timeUnit": "minutes",
        "passingGrade": 50,
        "randomizeQuestions": False,
        "randomizeAnswers": False,
        "questions": [{
            "id": 1,
            "text": "Question",
            "type": "single_choice",
            "points": 1,
            "sortOrder": 1,
            "explanation": None,
            "imageUrl": "",
            "answers": [{"id": 10, "text": "A", "isCorrect": True, "sortOrder": 1}],
        }],
    }

    def setUp(self):
        self.factory = RequestFactory()

    def test_authorized_detail_preserves_response_and_scrubs_answer_key(self):
        request = self.factory.get("/learner_api/quizzes/77/")
        with patch.object(quizzes, "authorize_quiz_access", return_value=_context()), \
             patch.object(quizzes, "_fetch_quiz", return_value=self.QUIZ):
            response = quizzes.quiz_detail(request, 77)
        body = json.loads(response.content)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(body["id"], 77)
        self.assertEqual(body["title"], "Assigned quiz")
        self.assertNotIn("isCorrect", body["questions"][0]["answers"][0])

    def test_unassigned_detail_is_hidden_and_never_fetches_the_quiz(self):
        request = self.factory.get("/learner_api/quizzes/77/")
        denied = permissions.QuizAccessDenied("Quiz not found.", 404)
        with patch.object(quizzes, "authorize_quiz_access", side_effect=denied), \
             patch.object(quizzes, "_fetch_quiz") as fetch:
            response = quizzes.quiz_detail(request, 77)
        self.assertEqual(response.status_code, 404)
        self.assertEqual(json.loads(response.content), {"error": "Quiz not found."})
        fetch.assert_not_called()

    def test_missing_quiz_keeps_the_existing_404_contract(self):
        request = self.factory.get("/learner_api/quizzes/404/")
        with patch.object(quizzes, "authorize_quiz_access", return_value=_context()), \
             patch.object(quizzes, "_fetch_quiz", return_value=None):
            response = quizzes.quiz_detail(request, 404)
        self.assertEqual(response.status_code, 404)
        self.assertEqual(json.loads(response.content), {"error": "Quiz not found."})

    def test_database_detail_error_is_safe_and_logged_without_exception_text(self):
        request = self.factory.get("/learner_api/quizzes/77/")
        with patch.object(quizzes, "authorize_quiz_access", return_value=_context()), \
             patch.object(quizzes, "_fetch_quiz", side_effect=DatabaseError("secret SQL detail")), \
             patch.object(quizzes.logger, "error") as logged:
            response = quizzes.quiz_detail(request, 77)
        body = json.loads(response.content)
        self.assertEqual(response.status_code, 502)
        self.assertEqual(body, {"error": "Quiz service is temporarily unavailable. Please try again."})
        self.assertNotIn("secret SQL detail", response.content.decode())
        logged.assert_called_once()
        self.assertNotIn("secret SQL detail", str(logged.call_args))

    def test_unassigned_submit_stops_before_grading_or_persistence(self):
        request = self.factory.post(
            "/learner_api/quizzes/77/submit/?kind=apprenticeship&learnerId=17",
            data=json.dumps({"answers": {"1": 10}}),
            content_type="application/json",
        )
        denied = permissions.QuizAccessDenied("Quiz not found.", 404)
        view = quizzes.submit_quiz_attempt
        while hasattr(view, "__wrapped__"):
            view = view.__wrapped__
        with patch.object(quizzes, "authorize_quiz_access", side_effect=denied), \
             patch.object(quizzes, "_fetch_quiz") as fetch, \
             patch.object(quizzes, "save_progress_record") as save:
            response = view(request, 77)
        self.assertEqual(response.status_code, 404)
        fetch.assert_not_called()
        save.assert_not_called()

    def test_decorated_submit_rejects_a_different_learner_before_quiz_policy(self):
        request = self.factory.post(
            "/learner_api/quizzes/77/submit/?kind=apprenticeship&learnerId=18",
            data=json.dumps({"answers": {"1": 10}}),
            content_type="application/json",
        )
        account = _account(subject_id=17)
        with patch("login.permissions.authenticate_request", return_value=account), \
             patch.object(quizzes, "authorize_quiz_access") as authorize:
            response = quizzes.submit_quiz_attempt(request, 77)
        self.assertEqual(response.status_code, 404)
        self.assertEqual(json.loads(response.content), {"error": "Not found."})
        authorize.assert_not_called()

    def test_submission_lookup_error_is_safe(self):
        request = self.factory.post(
            "/learner_api/quizzes/77/submit/?kind=apprenticeship&learnerId=17",
            data=json.dumps({"answers": {}}),
            content_type="application/json",
        )
        view = quizzes.submit_quiz_attempt
        while hasattr(view, "__wrapped__"):
            view = view.__wrapped__
        with patch.object(quizzes, "authorize_quiz_access", return_value=_context()), \
             patch.object(quizzes, "resolve_completion_instants", return_value=(None, "")), \
             patch.object(quizzes, "_fetch_quiz", side_effect=DatabaseError("private relation")), \
             patch.object(quizzes.logger, "error"):
            response = view(request, 77)
        self.assertEqual(response.status_code, 502)
        self.assertNotIn("private relation", response.content.decode())

    def test_invalid_json_does_not_return_decoder_internals(self):
        request = self.factory.post(
            "/learner_api/quizzes/77/submit/?kind=apprenticeship&learnerId=17",
            data="{broken",
            content_type="application/json",
        )
        view = quizzes.submit_quiz_attempt
        while hasattr(view, "__wrapped__"):
            view = view.__wrapped__
        with patch.object(quizzes, "authorize_quiz_access", return_value=_context()):
            response = view(request, 77)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(json.loads(response.content), {"error": "Invalid JSON body."})
