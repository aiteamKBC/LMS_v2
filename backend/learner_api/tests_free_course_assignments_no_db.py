"""DB-free regressions for canonical Free Course catalogue and assignments."""
import json
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.db import DatabaseError
from django.test import RequestFactory, SimpleTestCase

from . import free_course_assignments as assignments
from . import free_course_catalogue as catalogue
from . import free_courses_view as view
from .models import LearnerFreeCourse


ROW = {
    "id": "FREE-1",
    "course_name": "Standalone skills",
    "description": "Canonical content",
    "cover_image_url": "/cover.png",
    "week_count": 2,
    "component_count": 4,
    "total_otjh": 6,
}
COURSE = {
    "freeCourseId": "FREE-1",
    "moduleId": "",
    "courseName": "Standalone skills",
    "description": "Canonical content",
    "coverImageUrl": "/cover.png",
    "weekCount": 2,
    "activityCount": 4,
    "hours": 6.0,
    "weeks": [],
}


class CanonicalFreeCourseCatalogueTests(SimpleTestCase):
    def test_reader_uses_canonical_course_ids_and_preserves_api_fields(self):
        with patch.object(catalogue.free_course_catalogue, "courses", return_value=[ROW]) as courses:
            result = catalogue.builder_free_courses(["FREE-1", "FREE-1"])
        self.assertEqual(result, [COURSE])
        call = courses.call_args.kwargs
        self.assertEqual(call["course_ids"], ["FREE-1"])
        self.assertIn("id", call["columns"])
        self.assertNotIn("module_catalogue_id", call["columns"])
        self.assertNotIn("content_ref", call["columns"])
        self.assertNotIn("storage_version", call["columns"])

    def test_empty_scope_skips_the_catalogue_query(self):
        with patch.object(catalogue.free_course_catalogue, "courses") as courses:
            self.assertEqual(catalogue.builder_free_courses([]), [])
        courses.assert_not_called()

    def test_plan_picker_omits_large_content_fields(self):
        with patch.object(catalogue.free_course_catalogue, "courses", return_value=[]) as courses:
            catalogue.builder_free_courses(include_content=False)
        columns = courses.call_args.kwargs["columns"]
        self.assertNotIn("description", columns)
        self.assertNotIn("cover_image_url", columns)


class CanonicalLearnerFreeCourseListTests(SimpleTestCase):
    def setUp(self):
        self.source = SimpleNamespace(
            pk=7,
            training_plan=[{"moduleId": "NORMAL-1"}],
            learning_plan=[{"moduleId": "NORMAL-2"}],
        )
        self.enterContext(patch.object(view, "_resolve_source", return_value=(self.source, None)))
        self.auth = self.enterContext(patch(
            "login.permissions.authenticate_request",
            return_value=SimpleNamespace(role="learner", subject_id=7),
        ))
        self.enterContext(patch("login.permissions._auth_gate_enabled", return_value=True))

    def read(self, pk=7):
        request = RequestFactory().get(f"/learner_api/free-courses/commercial/{pk}/")
        return view.free_courses(request, kind="commercial", pk=pk)

    def test_normal_learning_plan_modules_are_not_free_course_entitlements(self):
        with patch.object(view, "assigned_course_ids", return_value=[]), \
             patch.object(view, "_scoped_rows") as scoped:
            response = self.read()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content), {"freeCourses": []})
        scoped.assert_not_called()

    def test_canonical_assignments_use_the_canonical_tree(self):
        course = {"id": "FREE-1", "course_name": "Course", "description": "", "cover_image_url": ""}
        week = {"id": "W-1", "course_id": "FREE-1", "status": "active"}
        component = {"id": "C-1", "free_module_id": "W-1", "type": "reading"}
        with patch.object(view, "assigned_course_ids", return_value=["FREE-1"]), \
             patch.object(view, "_scoped_rows", return_value=({"FREE-1": course}, [week], [component])), \
             patch.object(view, "_completed_refs", return_value=set()):
            response = self.read()
        body = json.loads(response.content)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(body["freeCourses"][0]["freeCourseId"], "FREE-1")
        self.assertNotIn("moduleId", body["freeCourses"][0])

    def test_database_failure_is_visible(self):
        with patch.object(view, "assigned_course_ids", side_effect=DatabaseError("synthetic")):
            response = self.read()
        self.assertEqual(response.status_code, 503)

    def test_cross_learner_access_is_rejected_before_reads(self):
        with patch.object(view, "assigned_course_ids") as assigned:
            response = self.read(pk=8)
        self.assertEqual(response.status_code, 404)
        assigned.assert_not_called()


class CanonicalAssignmentMappingTests(SimpleTestCase):
    def test_model_maps_only_actual_assignment_columns(self):
        fields = {field.name for field in LearnerFreeCourse._meta.concrete_fields}
        self.assertEqual(fields, {"id", "learner", "position", "free_course_ref"})

    def test_reconciliation_preserves_existing_ids_and_updates_only_order(self):
        first = SimpleNamespace(pk=11, free_course_ref="FREE-1", position=2)
        second = SimpleNamespace(pk=12, free_course_ref="FREE-2", position=1)
        manager = Mock()
        manager.select_for_update.return_value.filter.return_value = [first, second]
        with patch.object(assignments.LearnerFreeCourse.objects, "using", return_value=manager):
            assignments._replace_assignment_rows(
                7, ["FREE-1", "FREE-3"], {"FREE-1": "One", "FREE-3": "Three"},
            )
        manager.bulk_update.assert_called_once_with([first], ["position"])
        created = manager.bulk_create.call_args.args[0]
        self.assertEqual([(row.free_course_ref, row.position) for row in created], [("FREE-3", 2)])
        manager.filter.assert_called_once_with(pk__in=[12])
        manager.filter.return_value.delete.assert_called_once_with()

    def test_reconciliation_does_not_recreate_unchanged_rows(self):
        row = SimpleNamespace(pk=11, free_course_ref="FREE-1", position=1)
        manager = Mock()
        manager.select_for_update.return_value.filter.return_value = [row]
        with patch.object(assignments.LearnerFreeCourse.objects, "using", return_value=manager):
            assignments._replace_assignment_rows(7, ["FREE-1"], {"FREE-1": "One"})
        manager.bulk_update.assert_not_called()
        manager.bulk_create.assert_not_called()
        manager.filter.assert_not_called()
