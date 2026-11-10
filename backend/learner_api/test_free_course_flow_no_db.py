"""DB-free contract and security tests for the assigned Free Courses flow."""
import json
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.db import DatabaseError
from django.test import RequestFactory, SimpleTestCase
from django.urls import resolve

from login import permissions

from . import free_course_selectors as selectors
from . import active_users
from . import free_courses_view as view
from . import learning_plan as learning_plan_module
from .models import LearnerFreeCourse, LearnerFreeCourseProgress, LearnerProfile


LEARNER = SimpleNamespace(role="learner", subject_id=19, subject_type="learner")
STAFF = SimpleNamespace(role="staff", subject_id=7, subject_type="staff")


def source(kind="commercial"):
    return SimpleNamespace(pk=501, enrolment_id=19, learner_type=kind)


def catalogue_rows():
    courses = {
        "FREE-1": {
            "id": "FREE-1", "course_name": "Canonical course",
            "description": "Canonical description", "cover_image_url": "/cover.png",
        },
    }
    weeks = [
        {"id": "W-1", "course_id": "FREE-1", "week_number": 1, "title": "Start", "display_order": 0,
         "status": "active", "legacy_copied_from_week_id": "NORMAL-WEEK-1"},
        {"id": "W-2", "course_id": "FREE-1", "week_number": 2, "title": "Next", "display_order": 1,
         "status": "active", "legacy_copied_from_week_id": None},
    ]
    components = [
        {"id": "C-1", "free_module_id": "W-1", "type": "reading", "title": "Read", "display_order": 0,
         "settings_json": {"readingContent": "<p>Read</p>"}},
        {"id": "C-2", "free_module_id": "W-2", "type": "video", "title": "Watch", "display_order": 0,
         "settings_json": {"videoUrl": "https://example.test/video"}},
    ]
    return courses, weeks, components


class AssignedFreeCourseReadTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.enterContext(patch.dict("os.environ", {"LEARNER_API_REQUIRE_AUTH": "1"}))

    def call(self, function, request, *, account=LEARNER, **kwargs):
        with patch.object(permissions, "authenticate_request", return_value=account):
            return function(request, **kwargs)

    def test_summary_route_returns_only_current_assigned_courses_without_component_settings(self):
        courses, weeks, components = catalogue_rows()
        summary_components = [
            {key: row[key] for key in ("id", "free_module_id", "type", "display_order")}
            for row in components
        ]
        scoped = Mock(return_value=(courses, weeks, summary_components))
        with patch.object(view, "_resolve_source", return_value=(source(), None)), \
             patch.object(view, "assigned_course_ids", return_value=["FREE-1", "MISSING"]), \
             patch.object(view, "_scoped_rows", scoped), \
             patch.object(view, "_completed_refs", return_value={("FREE-1", "C-1")}):
            response = self.call(
                view.free_courses,
                self.factory.get("/learner_api/free-courses/commercial/19/"),
                kind="commercial", pk=19,
            )
        self.assertEqual(response.status_code, 200)
        payload = json.loads(response.content)
        self.assertEqual([row["freeCourseId"] for row in payload["freeCourses"]], ["FREE-1"])
        self.assertEqual(payload["freeCourses"][0]["completedActivities"], 1)
        self.assertEqual(payload["freeCourses"][0]["activityCount"], 2)
        self.assertEqual(payload["freeCourses"][0]["progressPercentage"], 50)
        self.assertNotIn("weeks", payload["freeCourses"][0])
        self.assertFalse(scoped.call_args.kwargs["include_component_settings"])

    def test_commercial_learner_125_returns_nine_courses_and_126_completions(self):
        activity_counts = [24, 24, 9, 24, 24, 16, 32, 24, 24]
        completed_counts = [0, 18, 7, 18, 15, 8, 24, 18, 18]
        course_ids = [f"FREE-{index}" for index in range(1, 10)]
        courses = {
            course_id: {"id": course_id, "course_name": f"Course {index}"}
            for index, course_id in enumerate(course_ids, 1)
        }
        weeks = [
            {"id": f"W-{index}", "course_id": course_id}
            for index, course_id in enumerate(course_ids, 1)
        ]
        components = []
        completed = set()
        for index, (course_id, activity_count, completed_count) in enumerate(
            zip(course_ids, activity_counts, completed_counts, strict=True), 1,
        ):
            for component_number in range(activity_count):
                component_id = f"C-{index}-{component_number}"
                components.append({
                    "id": component_id,
                    "free_module_id": f"W-{index}",
                    "type": "reading",
                    "display_order": component_number,
                })
                if component_number < completed_count:
                    completed.add((course_id, component_id))

        learner_125 = SimpleNamespace(pk=125, enrolment_id=125, learner_type="commercial")
        with patch.object(view, "_resolve_source", return_value=(learner_125, None)), \
             patch.object(view, "assigned_course_ids", return_value=course_ids), \
             patch.object(view, "_scoped_rows", return_value=(courses, weeks, components)), \
             patch.object(view, "_completed_refs", return_value=completed):
            response = self.call(
                view.free_courses,
                self.factory.get("/learner_api/free-courses/commercial/125/"),
                account=SimpleNamespace(role="learner", subject_id=125, subject_type="learner"),
                kind="commercial", pk=125,
            )

        self.assertEqual(response.status_code, 200)
        cards = json.loads(response.content)["freeCourses"]
        self.assertEqual(len(cards), 9)
        self.assertEqual(sum(card["completedActivities"] for card in cards), 126)
        self.assertEqual(sum(card["activityCount"] for card in cards), 201)

    def test_apprenticeship_assigned_summary_uses_canonical_identity_and_progress(self):
        courses, weeks, components = catalogue_rows()
        summary_components = [
            {key: row[key] for key in ("id", "free_module_id", "type", "display_order")}
            for row in components
        ]
        apprentice = source("apprenticeship")
        with patch.object(view, "_resolve_source", return_value=(apprentice, None)) as resolve, \
             patch.object(view, "assigned_course_ids", return_value=["FREE-1"]) as assignments, \
             patch.object(view, "_scoped_rows", return_value=(courses, weeks, summary_components)), \
             patch.object(view, "_completed_refs", return_value={("FREE-1", "C-1")}) as progress:
            response = self.call(
                view.free_courses,
                self.factory.get("/learner_api/free-courses/apprenticeship/19/"),
                kind="apprenticeship", pk=19,
            )

        self.assertEqual(response.status_code, 200)
        card = json.loads(response.content)["freeCourses"][0]
        self.assertEqual(card["freeCourseId"], "FREE-1")
        self.assertEqual(card["completedActivities"], 1)
        self.assertEqual(card["progressPercentage"], 50)
        resolve.assert_called_once_with("apprenticeship", 19)
        assignments.assert_called_once_with(apprentice)
        progress.assert_called_once_with(apprentice.pk, ["FREE-1"])

    def test_detail_is_assignment_scoped_and_restores_historical_completion(self):
        with patch.object(view, "_resolve_source", return_value=(source("apprenticeship"), None)), \
             patch.object(view, "assigned_course_ids", return_value=["FREE-1", "MISSING"]), \
             patch.object(view, "_scoped_rows", return_value=catalogue_rows()), \
             patch.object(view, "_completed_refs", return_value={("FREE-1", "C-1")}):
            response = self.call(
                view.free_course_detail,
                self.factory.get("/learner_api/free-courses/apprenticeship/19/courses/FREE-1/"),
                kind="apprenticeship", pk=19, course_id="FREE-1",
            )
        self.assertEqual(response.status_code, 200)
        course = json.loads(response.content)["freeCourse"]
        self.assertEqual([week["freeCourseWeekId"] for week in course["weeks"]], ["W-1", "W-2"])
        self.assertEqual([week["weekId"] for week in course["weeks"]], ["NORMAL-WEEK-1", ""])
        self.assertEqual(course["weeks"][0]["legacyCopiedFromWeekId"], "NORMAL-WEEK-1")
        self.assertTrue(course["weeks"][0]["activities"][0]["completed"])
        self.assertFalse(course["weeks"][1]["activities"][0]["completed"])

    def test_unassigned_direct_course_url_is_hidden_before_catalogue_read(self):
        with patch.object(view, "_resolve_source", return_value=(source(), None)), \
             patch.object(view, "assigned_course_ids", return_value=["FREE-1"]), \
             patch.object(view, "_scoped_rows") as scoped:
            response = self.call(
                view.free_course_detail,
                self.factory.get("/learner_api/free-courses/commercial/19/courses/OTHER/"),
                kind="commercial", pk=19, course_id="OTHER",
            )
        self.assertEqual(response.status_code, 404)
        scoped.assert_not_called()

    def test_cross_learner_apprenticeship_list_is_hidden_before_identity_resolution(self):
        with patch.object(view, "_resolve_source") as resolve:
            response = self.call(
                view.free_courses,
                self.factory.get("/learner_api/free-courses/apprenticeship/19/"),
                account=SimpleNamespace(role="learner", subject_id=20, subject_type="learner"),
                kind="apprenticeship", pk=19,
            )
        self.assertEqual(response.status_code, 404)
        resolve.assert_not_called()

    def test_staff_can_preview_detail_but_cannot_use_missing_assignment(self):
        with patch.object(view, "_resolve_source", return_value=(source(), None)), \
             patch.object(view, "assigned_course_ids", return_value=["FREE-1"]), \
             patch.object(view, "_scoped_rows", return_value=catalogue_rows()), \
             patch.object(view, "_completed_refs", return_value=set()):
            response = self.call(
                view.free_course_detail,
                self.factory.get("/learner_api/free-courses/commercial/19/courses/FREE-1/"),
                account=STAFF, kind="commercial", pk=19, course_id="FREE-1",
            )
        self.assertEqual(response.status_code, 200)

    def test_catalogue_errors_are_sanitised(self):
        with patch.object(view, "_resolve_source", return_value=(source(), None)), \
             patch.object(view, "assigned_course_ids", return_value=["FREE-1"]), \
             patch.object(view, "_scoped_rows", side_effect=DatabaseError("secret-host")):
            response = self.call(
                view.free_course_detail,
                self.factory.get("/learner_api/free-courses/commercial/19/courses/FREE-1/"),
                kind="commercial", pk=19, course_id="FREE-1",
            )
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("secret-host", response.content.decode())

    def test_empty_canonical_assignment_returns_empty_list_without_catalogue_read(self):
        with patch.object(view, "_resolve_source", return_value=(source(), None)), \
             patch.object(view, "assigned_course_ids", return_value=[]), \
             patch.object(view, "_scoped_rows") as scoped:
            response = self.call(
                view.free_courses,
                self.factory.get("/learner_api/free-courses/commercial/19/"),
                kind="commercial", pk=19,
            )
        self.assertEqual(json.loads(response.content), {"freeCourses": []})
        scoped.assert_not_called()

    def test_progress_database_failure_is_not_disguised_as_no_progress(self):
        with patch.object(view, "_resolve_source", return_value=(source(), None)), \
             patch.object(view, "assigned_course_ids", return_value=["FREE-1"]), \
             patch.object(view, "_scoped_rows", return_value=catalogue_rows()), \
             patch.object(view, "_completed_refs", side_effect=DatabaseError("secret-progress")):
            response = self.call(
                view.free_courses,
                self.factory.get("/learner_api/free-courses/commercial/19/"),
                kind="commercial", pk=19,
            )
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("secret-progress", response.content.decode())

    def test_course_title_has_no_assignment_or_week_fallback(self):
        courses, weeks, components = catalogue_rows()
        courses["FREE-1"]["course_name"] = ""
        weeks[0]["course_name"] = "Legacy week title"
        with patch.object(view, "_resolve_source", return_value=(source(), None)), \
             patch.object(view, "assigned_course_ids", return_value=["FREE-1"]), \
             patch.object(view, "_scoped_rows", return_value=(courses, weeks, components)), \
             patch.object(view, "_completed_refs", return_value=set()):
            response = self.call(
                view.free_courses,
                self.factory.get("/learner_api/free-courses/commercial/19/"),
                kind="commercial", pk=19,
            )
        self.assertEqual(json.loads(response.content)["freeCourses"][0]["courseName"], "")

    def test_detail_route_resolves(self):
        match = resolve("/learner_api/free-courses/commercial/19/courses/FREE-1/")
        self.assertIs(match.func, view.free_course_detail)


class FreeCourseQueryShapeTests(SimpleTestCase):
    def test_scoped_queries_only_request_canonical_free_course_columns(self):
        """Guard the 42703 regression from legacy lifecycle column reads."""
        canonical = {
            view.free_course_catalogue.FREE_COURSES_TABLE: {
                "id", "course_name", "description", "cover_image_url",
                "display_order", "week_count", "component_count",
            },
            view.free_course_catalogue.FREE_COURSE_WEEKS_TABLE: {
                "id", "course_id", "week_number", "title", "summary",
                "learning_outcomes", "status", "holiday_note_enabled", "holiday_note",
                "legacy_copied_from_week_id", "display_order",
            },
            view.free_course_catalogue.FREE_COMPONENTS_TABLE: {
                "id", "free_module_id", "type", "title", "description",
                "display_order", "settings_json",
            },
        }
        rows = {
            view.free_course_catalogue.FREE_COURSES_TABLE: [{"id": "FREE-1", "course_name": "Course"}],
            view.free_course_catalogue.FREE_COURSE_WEEKS_TABLE: [{"id": "W-1", "course_id": "FREE-1"}],
            view.free_course_catalogue.FREE_COMPONENTS_TABLE: [
                {"id": "C-1", "free_module_id": "W-1", "type": "reading"},
            ],
        }

        def fetch_for(table):
            def fetch(**kwargs):
                self.assertEqual(set(kwargs["columns"]) - canonical[table], set())
                return rows[table]
            return fetch

        with patch.object(view.free_course_catalogue, "courses", side_effect=fetch_for("free_courses")), \
             patch.object(view.free_course_catalogue, "weeks", side_effect=fetch_for("free_course_weeks")), \
             patch.object(view.free_course_catalogue, "components", side_effect=fetch_for("free_programme_components")):
            courses, weeks, components = view._scoped_rows(["FREE-1"])
        self.assertEqual(set(courses), {"FREE-1"})
        self.assertEqual([row["id"] for row in weeks], ["W-1"])
        self.assertEqual([row["id"] for row in components], ["C-1"])

    def test_failed_query_diagnostic_is_stage_scoped_and_sanitised(self):
        driver = RuntimeError("private driver detail")
        driver.sqlstate = "42703"
        error = DatabaseError("private SQL and connection detail")
        error.__cause__ = driver

        with patch.object(view.free_course_catalogue, "courses", side_effect=error), \
             self.assertLogs(view.logger.name, level="ERROR") as logs, \
             self.assertRaises(DatabaseError):
            view._scoped_rows(["FREE-1"])

        diagnostic = "\n".join(logs.output)
        self.assertIn("stage=courses", diagnostic)
        self.assertIn("table=free_courses", diagnostic)
        self.assertIn("type=DatabaseError", diagnostic)
        self.assertIn("sqlstate=42703", diagnostic)
        self.assertNotIn("private driver detail", diagnostic)
        self.assertNotIn("private SQL and connection detail", diagnostic)

    def test_summary_query_omits_component_settings_and_media(self):
        courses = Mock(return_value=[{"id": "FREE-1", "course_name": "Course"}])
        weeks = Mock(return_value=[{"id": "W-1", "course_id": "FREE-1"}])
        components = Mock(return_value=[{"id": "C-1", "free_module_id": "W-1", "type": "reading"}])
        with patch.object(view.free_course_catalogue, "courses", courses), \
             patch.object(view.free_course_catalogue, "weeks", weeks), \
             patch.object(view.free_course_catalogue, "components", components):
            view._scoped_rows(["FREE-1"], include_component_settings=False)
        component_columns = components.call_args.kwargs["columns"]
        self.assertNotIn("settings_json", component_columns)
        self.assertNotIn("cover_image_url", component_columns)
        self.assertEqual(components.call_args.kwargs["week_ids"], ["W-1"])

    def test_inactive_week_is_hidden_without_touching_historical_progress(self):
        course_rows, week_rows, component_rows = catalogue_rows()
        week_rows[1]["status"] = "inactive"
        completed = {("FREE-1", "C-1"), ("FREE-1", "C-2")}
        with patch.object(view.free_course_catalogue, "courses", return_value=list(course_rows.values())), \
             patch.object(view.free_course_catalogue, "weeks", return_value=week_rows), \
             patch.object(view.free_course_catalogue, "components", return_value=component_rows):
            courses, visible_weeks, visible_components = view._scoped_rows(["FREE-1"])

        detail = view._course_detail("FREE-1", courses["FREE-1"], visible_weeks, visible_components, completed)
        self.assertEqual([week["freeCourseWeekId"] for week in detail["weeks"]], ["W-1"])
        self.assertTrue(detail["weeks"][0]["activities"][0]["completed"])
        self.assertIn(("FREE-1", "C-2"), completed)


class CanonicalAssignmentSelectorTests(SimpleTestCase):
    def test_enrolment_id_and_kind_resolve_the_canonical_profile(self):
        for kind in ("commercial", "apprenticeship"):
            with self.subTest(kind=kind):
                profile = source(kind)
                only = Mock()
                only.get.return_value = profile
                with patch.object(selectors.LearnerProfile.objects, "only", return_value=only):
                    resolved = selectors.canonical_learner(kind, 19)
                self.assertIs(resolved, profile)
                only.get.assert_called_once_with(enrolment_id=19, learner_type=kind)

    def test_assignments_use_position_then_primary_key_order(self):
        manager_filter = Mock()
        ordered = Mock()
        ordered.values_list.return_value = ["FREE-2", "FREE-1"]
        manager_filter.order_by.return_value = ordered
        with patch.object(selectors.LearnerFreeCourse.objects, "filter", return_value=manager_filter) as query:
            result = selectors.assigned_course_ids(source())
        self.assertEqual(result, ["FREE-2", "FREE-1"])
        query.assert_called_once_with(learner_id=501)
        manager_filter.order_by.assert_called_once_with("position", "id")
        ordered.values_list.assert_called_once_with("free_course_ref", flat=True)


class CanonicalFreeCourseModelTests(SimpleTestCase):
    def test_assignment_and_progress_refs_are_required(self):
        self.assertFalse(LearnerFreeCourse._meta.get_field("free_course_ref").null)
        self.assertFalse(LearnerFreeCourseProgress._meta.get_field("free_course_ref").null)

    def test_progress_owner_is_the_canonical_learner_fk(self):
        owner = LearnerFreeCourseProgress._meta.get_field("learner")
        self.assertIs(owner.remote_field.model, LearnerProfile)
        self.assertEqual(owner.column, "learner_id")

    def test_completed_at_remains_required_without_an_application_default(self):
        completed_at = LearnerFreeCourseProgress._meta.get_field("completed_at")
        self.assertFalse(completed_at.null)
        self.assertFalse(completed_at.has_default())


class LearningPlanCanonicalFreeCourseReadTests(SimpleTestCase):
    def test_learning_plan_read_uses_canonical_ids_and_course_name(self):
        enrolment = SimpleNamespace(
            pk=19,
            learner_type="commercial",
            free_courses=[{"freeCourseId": "LEGACY", "courseName": "Legacy title"}],
        )
        with patch.object(learning_plan_module, "canonical_learner", return_value=source()), \
             patch.object(learning_plan_module, "assigned_course_ids", return_value=["FREE-2", "FREE-1"]), \
             patch("curriculum_api.free_course_catalogue.courses", return_value=[
                 {"id": "FREE-1", "course_name": "Canonical one"},
                 {"id": "FREE-2", "course_name": "Canonical two"},
             ]):
            result = learning_plan_module._canonical_free_course_assignments(enrolment)
        self.assertEqual(result, [
            {"freeCourseId": "FREE-2", "courseName": "Canonical two", "addedAt": ""},
            {"freeCourseId": "FREE-1", "courseName": "Canonical one", "addedAt": ""},
        ])
        self.assertNotIn("LEGACY", json.dumps(result))

    def test_missing_canonical_course_is_retained_for_explicit_staff_review(self):
        enrolment = SimpleNamespace(pk=19, learner_type="commercial")
        with patch.object(learning_plan_module, "canonical_learner", return_value=source()), \
             patch.object(learning_plan_module, "assigned_course_ids", return_value=["MISSING"]), \
             patch("curriculum_api.free_course_catalogue.courses", return_value=[]):
            result = learning_plan_module._canonical_free_course_assignments(enrolment)
        self.assertEqual(result, [{
            "freeCourseId": "MISSING",
            "courseName": "",
            "addedAt": "",
            "unavailable": True,
        }])


class CanonicalAssignmentWriteProtectionTests(SimpleTestCase):
    def setUp(self):
        self.learner = SimpleNamespace(
            pk=19,
            learner_type="commercial",
            programme="",
            group="",
            free_courses=[{"freeCourseId": "LEGACY", "courseName": "Legacy title"}],
            save=Mock(),
        )

    def test_matching_snapshot_is_a_no_op_for_legacy_ui_compatibility(self):
        with patch.object(
            learning_plan_module,
            "_canonical_free_course_assignment_ids",
            return_value=["FREE-2", "FREE-1"],
        ):
            error = learning_plan_module._validate_free_course_assignment_snapshot(
                self.learner,
                [
                    {"freeCourseId": "FREE-2", "courseName": "Stale client title"},
                    {"freeCourseId": "FREE-1", "courseName": "Another stale title"},
                ],
            )
        self.assertIsNone(error)
        self.learner.save.assert_not_called()

    def test_legacy_json_cannot_replace_or_reorder_canonical_assignments(self):
        for submitted in (
            [{"freeCourseId": "LEGACY"}],
            [{"freeCourseId": "FREE-1"}, {"freeCourseId": "FREE-2"}],
            [],
        ):
            with self.subTest(submitted=submitted), patch.object(
                learning_plan_module,
                "_canonical_free_course_assignment_ids",
                return_value=["FREE-2", "FREE-1"],
            ):
                response = learning_plan_module._validate_free_course_assignment_snapshot(
                    self.learner,
                    submitted,
                )
            self.assertEqual(response.status_code, 409)
            self.assertNotIn("LEGACY", response.content.decode())
        self.learner.save.assert_not_called()

    def test_malformed_assignment_snapshot_fails_before_canonical_lookup(self):
        invalid = (
            None,
            ["FREE-1"],
            [{}],
            [{"freeCourseId": "FREE-1"}, {"freeCourseId": "FREE-1"}],
        )
        for submitted in invalid:
            with self.subTest(submitted=submitted), patch.object(
                learning_plan_module,
                "_canonical_free_course_assignment_ids",
            ) as lookup:
                response = learning_plan_module._validate_free_course_assignment_snapshot(
                    self.learner,
                    submitted,
                )
            self.assertEqual(response.status_code, 400)
            lookup.assert_not_called()

    def test_learning_plan_patch_cannot_silently_delete_official_assignments(self):
        request = RequestFactory().patch(
            "/learner_api/learning-plan/19/",
            data=json.dumps({"modules": [], "freeCourses": []}),
            content_type="application/json",
        )
        endpoint = learning_plan_module.learning_plan
        while hasattr(endpoint, "__wrapped__"):
            endpoint = endpoint.__wrapped__
        with patch.object(
            learning_plan_module.EnrolmentUser.all_learners,
            "get",
            return_value=self.learner,
        ), patch.object(
            learning_plan_module,
            "_canonical_free_course_assignment_ids",
            return_value=["FREE-1"],
        ), patch.object(
            learning_plan_module,
            "_all_modules",
            side_effect=AssertionError("catalogue must not run after assignment conflict"),
        ), patch.object(
            learning_plan_module,
            "sync_learning_plan_mirror",
        ) as sync:
            response = endpoint(request, pk=19)
        self.assertEqual(response.status_code, 409)
        self.learner.save.assert_not_called()
        sync.assert_not_called()

    def test_matching_snapshot_allows_module_save_without_writing_legacy_json(self):
        request = RequestFactory().patch(
            "/learner_api/learning-plan/19/",
            data=json.dumps({
                "modules": [],
                "freeCourses": [{"freeCourseId": "FREE-1", "courseName": "Client title"}],
            }),
            content_type="application/json",
        )
        endpoint = learning_plan_module.learning_plan
        while hasattr(endpoint, "__wrapped__"):
            endpoint = endpoint.__wrapped__
        with patch.object(
            learning_plan_module.EnrolmentUser.all_learners,
            "get",
            return_value=self.learner,
        ), patch.object(
            learning_plan_module,
            "_canonical_free_course_assignment_ids",
            return_value=["FREE-1"],
        ), patch.object(learning_plan_module, "_all_modules", return_value=[]), \
             patch.object(learning_plan_module, "_plan_entries", return_value=[]), \
             patch.object(learning_plan_module, "learner_programme_modules", return_value=[]), \
             patch.object(learning_plan_module, "learner_group_module_ids", return_value=[]), \
             patch.object(learning_plan_module, "training_plan_field", return_value="training_plan"), \
             patch.object(learning_plan_module, "sync_learning_plan_mirror") as sync, \
             patch.object(learning_plan_module, "advance_learner"), \
             patch.object(learning_plan_module, "_serialize", return_value={"freeCourses": []}):
            response = endpoint(request, pk=19)
        self.assertEqual(response.status_code, 200)
        self.learner.save.assert_called_once_with(update_fields=["training_plan"])
        self.assertEqual(
            self.learner.free_courses,
            [{"freeCourseId": "LEGACY", "courseName": "Legacy title"}],
        )
        sync.assert_called_once_with(self.learner)

    def test_legacy_rebuild_hook_is_removed_and_progress_is_not_touched(self):
        self.assertFalse(hasattr(active_users, "replace_free_courses"))
        with patch.object(
            learning_plan_module,
            "_canonical_free_course_assignment_ids",
            return_value=["FREE-1"],
        ), patch.object(LearnerFreeCourseProgress, "objects") as progress:
            error = learning_plan_module._validate_free_course_assignment_snapshot(
                self.learner,
                [{"freeCourseId": "FREE-1"}],
            )
        self.assertIsNone(error)
        progress.assert_not_called()


class FreeCourseCompletionIsolationTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.enterContext(patch.dict("os.environ", {"LEARNER_API_REQUIRE_AUTH": "1"}))

    def test_completion_writes_only_the_isolated_free_course_store(self):
        progress = Mock()
        request = self.factory.post(
            "/learner_api/free-courses/commercial/19/complete/",
            data=json.dumps({"componentId": "C-1"}), content_type="application/json",
        )
        with patch.object(permissions, "authenticate_request", return_value=LEARNER), \
             patch.object(view, "_resolve_source", return_value=(source(), None)), \
             patch.object(view, "assigned_course_ids", return_value=["FREE-1"]), \
             patch.object(view, "_scoped_rows", return_value=catalogue_rows()) as scoped, \
             patch.object(view.LearnerFreeCourseProgress.objects, "get_or_create", progress):
            response = view.complete_free_course_activity(request, kind="commercial", pk=19)
        self.assertEqual(response.status_code, 200)
        progress.assert_called_once()
        self.assertEqual(progress.call_args.kwargs["learner_id"], 501)
        self.assertEqual(progress.call_args.kwargs["component_ref"], "C-1")
        self.assertFalse(scoped.call_args.kwargs["include_component_settings"])

    def test_generic_completion_cannot_bypass_quiz_grading(self):
        courses, weeks, components = catalogue_rows()
        components[0]["type"] = "quiz"
        progress = Mock()
        request = self.factory.post(
            "/learner_api/free-courses/commercial/19/complete/",
            data=json.dumps({"componentId": "C-1"}), content_type="application/json",
        )
        with patch.object(permissions, "authenticate_request", return_value=LEARNER), \
             patch.object(view, "_resolve_source", return_value=(source(), None)), \
             patch.object(view, "assigned_course_ids", return_value=["FREE-1"]), \
             patch.object(view, "_scoped_rows", return_value=(courses, weeks, components)), \
             patch.object(view.LearnerFreeCourseProgress.objects, "get_or_create", progress):
            response = view.complete_free_course_activity(
                request, kind="commercial", pk=19,
            )
        self.assertEqual(response.status_code, 409)
        self.assertIn("passing the quiz", response.content.decode())
        progress.assert_not_called()

