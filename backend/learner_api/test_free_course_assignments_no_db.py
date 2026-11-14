"""DB-free security and transaction tests for canonical assignment writes."""
import json
from contextlib import contextmanager, nullcontext
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.db import DatabaseError
from django.middleware.csrf import get_token
from django.test import RequestFactory, SimpleTestCase
from django.urls import resolve

from login import permissions

from . import free_course_assignments as api, learning_plan
from .constants import ACCESS_CURRICULUM, ACCESS_ENROLMENT
from .free_course_selectors import assignment_version
from .models import LearnerFreeCourseProgress


STAFF = SimpleNamespace(role="staff", subject_type="staff", subject_id=7)
LEARNER = SimpleNamespace(role="learner", subject_type="learner", subject_id=19)


class AssignmentServiceTests(SimpleTestCase):
    def update(self, current, requested, *, learner_type="commercial", names=None):
        profile = SimpleNamespace(pk=501)
        names = names if names is not None else {course_id: f"Course {course_id}" for course_id in requested}
        replace = Mock()
        with patch.object(api.transaction, "atomic", return_value=nullcontext()), \
             patch.object(api, "_locked_profile", return_value=profile) as locked_profile, \
             patch.object(api, "_locked_assignment_ids", return_value=current), \
             patch.object(api, "_canonical_course_names", return_value=names), \
             patch.object(api, "_replace_assignment_rows", replace), \
             patch.object(LearnerFreeCourseProgress, "objects") as progress:
            result = api._update_assignments(
                19,
                learner_type,
                requested,
                assignment_version(profile.pk, current),
            )
        locked_profile.assert_called_once_with(19, learner_type)
        progress.assert_not_called()
        return result, replace

    def test_assign_unassign_and_reorder_preserve_requested_position(self):
        cases = (
            ([], ["A", "B"]),
            (["A", "B"], ["A"]),
            (["A", "B"], ["B", "A"]),
        )
        for current, requested in cases:
            with self.subTest(current=current, requested=requested):
                result, replace = self.update(current, requested)
                self.assertEqual(result.course_ids, tuple(requested))
                replace.assert_called_once_with(501, requested, result.course_names)

    def test_commercial_and_apprenticeship_use_the_same_canonical_identity_path(self):
        for kind in ("commercial", "apprenticeship"):
            with self.subTest(kind=kind):
                result, _replace = self.update([], ["A"], learner_type=kind)
                self.assertEqual(result.learner_id, 501)

    def test_stale_version_conflicts_before_validation_or_write(self):
        with patch.object(api.transaction, "atomic", return_value=nullcontext()), \
             patch.object(api, "_locked_profile", return_value=SimpleNamespace(pk=501)), \
             patch.object(api, "_locked_assignment_ids", return_value=["A"]), \
             patch.object(api, "_canonical_course_names") as catalogue, \
             patch.object(api, "_replace_assignment_rows") as replace, \
             self.assertRaises(api.AssignmentConflict):
            api._update_assignments(19, "commercial", ["B"], "stale")
        catalogue.assert_not_called()
        replace.assert_not_called()

    def test_invalid_course_rejects_the_whole_replacement(self):
        with patch.object(api.transaction, "atomic", return_value=nullcontext()), \
             patch.object(api, "_locked_profile", return_value=SimpleNamespace(pk=501)), \
             patch.object(api, "_locked_assignment_ids", return_value=[]), \
             patch.object(api, "_canonical_course_names", return_value={"A": "Course A"}), \
             patch.object(api, "_replace_assignment_rows") as replace, \
             self.assertRaises(api.InvalidCourses):
            api._update_assignments(
                19, "commercial", ["A", "MISSING"], assignment_version(501, []),
            )
        replace.assert_not_called()

    def test_failure_exits_the_atomic_block_with_the_original_error(self):
        state = {"rolled_back": False}

        @contextmanager
        def atomic_probe(*_args, **_kwargs):
            try:
                yield
            except DatabaseError:
                state["rolled_back"] = True
                raise

        with patch.object(api.transaction, "atomic", side_effect=atomic_probe), \
             patch.object(api, "_locked_profile", return_value=SimpleNamespace(pk=501)), \
             patch.object(api, "_locked_assignment_ids", return_value=[]), \
             patch.object(api, "_canonical_course_names", return_value={"A": "Course A"}), \
             patch.object(api, "_replace_assignment_rows", side_effect=DatabaseError("private SQL")), \
             self.assertRaises(DatabaseError):
            api._update_assignments(19, "commercial", ["A"], assignment_version(501, []))
        self.assertTrue(state["rolled_back"])

    def test_row_builder_uses_one_based_positions_and_never_progress(self):
        manager = Mock()
        manager.select_for_update.return_value.filter.return_value = []
        with patch.object(api.LearnerFreeCourse.objects, "using", return_value=manager), \
             patch.object(LearnerFreeCourseProgress, "objects") as progress:
            api._replace_assignment_rows(501, ["B", "A"], {"A": "Alpha", "B": "Beta"})
        rows = manager.bulk_create.call_args.args[0]
        self.assertEqual([(row.free_course_ref, row.position) for row in rows], [("B", 1), ("A", 2)])
        manager.select_for_update.return_value.filter.assert_called_once_with(learner_id=501)
        manager.filter.assert_not_called()
        progress.assert_not_called()


class AssignmentEndpointTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.enterContext(patch.dict("os.environ", {"LEARNER_API_REQUIRE_AUTH": "1"}))

    def request(self, body=None, *, csrf=True):
        request = self.factory.put(
            "/learner_api/learning-plan/19/free-courses/",
            data=json.dumps(body or {"courseIds": ["A"], "expectedVersion": "v1"}),
            content_type="application/json",
        )
        if csrf:
            token = get_token(request)
            request.COOKIES["csrftoken"] = request.META["CSRF_COOKIE"]
            request.META["HTTP_X_CSRFTOKEN"] = token
        return request

    def call(self, account, *, accesses=frozenset({ACCESS_ENROLMENT}), body=None, csrf=True,
             update=None, learner_type="commercial"):
        result = update or api.AssignmentResult(501, ("A",), {"A": "Alpha"}, "v2")
        manager = Mock()
        manager.using.return_value.only.return_value.get.return_value = SimpleNamespace(
            pk=19, learner_type=learner_type,
        )
        with patch.object(permissions, "authenticate_request", return_value=account), \
             patch.object(permissions, "_accesses_of", return_value=accesses), \
             patch.object(api.EnrolmentUser, "all_learners", manager), \
             patch.object(api, "_update_assignments", return_value=result) as write, \
             patch.object(api, "bump_learner") as bump:
            response = api.free_course_assignments(self.request(body, csrf=csrf), pk=19)
        return response, write, bump

    def test_route_and_csrf_protection_are_active(self):
        self.assertIs(
            resolve("/learner_api/learning-plan/19/free-courses/").func,
            api.free_course_assignments,
        )
        response, write, _bump = self.call(STAFF, csrf=False)
        self.assertEqual(response.status_code, 403)
        write.assert_not_called()

    def test_learning_plan_read_establishes_the_browser_csrf_cookie(self):
        manager = Mock()
        manager.get.return_value = SimpleNamespace(pk=19)
        request = self.factory.get("/learner_api/learning-plan/19/")
        with patch.object(permissions, "authenticate_request", return_value=STAFF), \
             patch.object(learning_plan.EnrolmentUser, "all_learners", manager), \
             patch.object(learning_plan, "_serialize", return_value={"freeCourses": []}):
            response = learning_plan.learning_plan(request, pk=19)
        self.assertEqual(response.status_code, 200)
        self.assertIn("csrftoken", response.cookies)

    def test_enrolment_staff_can_replace_and_cache_is_invalidated(self):
        response, write, bump = self.call(STAFF, learner_type="apprenticeship")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content)["freeCourses"][0]["courseName"], "Alpha")
        write.assert_called_once_with(19, "apprenticeship", ["A"], "v1")
        bump.assert_called_once_with("apprenticeship", 19)

    def test_learner_cross_learner_and_ungranted_staff_writes_are_denied(self):
        cases = (
            (LEARNER, frozenset()),
            (STAFF, frozenset({ACCESS_CURRICULUM})),
        )
        for account, accesses in cases:
            with self.subTest(account=account, accesses=accesses):
                response, write, _bump = self.call(account, accesses=accesses)
                self.assertEqual(response.status_code, 403)
                write.assert_not_called()

    def test_conflict_invalid_course_and_database_error_are_safe(self):
        errors = (
            (api.AssignmentConflict(), 409),
            (api.InvalidCourses(), 400),
            (DatabaseError("private SQL and host"), 503),
        )
        for error, status in errors:
            with self.subTest(status=status), patch.object(
                api,
                "_update_assignments",
                side_effect=error,
            ), patch.object(permissions, "authenticate_request", return_value=STAFF), \
                 patch.object(permissions, "_accesses_of", return_value=frozenset({ACCESS_ENROLMENT})), \
                 patch.object(api.EnrolmentUser, "all_learners") as manager:
                manager.using.return_value.only.return_value.get.return_value = SimpleNamespace(
                    pk=19, learner_type="commercial",
                )
                response = api.free_course_assignments(self.request(), pk=19)
            self.assertEqual(response.status_code, status)
            self.assertNotIn("private SQL", response.content.decode())

    def test_duplicate_ids_are_rejected_before_any_write(self):
        response, write, _bump = self.call(
            STAFF,
            body={"courseIds": ["A", "A"], "expectedVersion": "v1"},
        )
        self.assertEqual(response.status_code, 400)
        write.assert_not_called()
