import inspect
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase
from django.urls import resolve

from learner_api import learning_plan
from learner_api.training_plan_writes import empty_training_plan_version


MODULE = {
    "moduleId": "M-GROUP",
    "moduleTitle": "Group suggestion",
    "groupName": "Group A",
    "programmeId": "P-1",
    "programmeName": "Programme",
    "hours": 10.0,
    "startDate": "",
    "endDate": "",
    "learnerRosterMode": "inherited",
    "isFreeCourse": False,
}


class CanonicalTrainingPlanEditorNoDatabaseTests(SimpleTestCase):
    def learner(self, kind="apprenticeship"):
        return SimpleNamespace(
            id=101,
            pk=101,
            username="Synthetic learner",
            programme="Programme",
            cohort="Cohort",
            group="Group A",
            programme_status="Active",
            learner_type=kind,
        )

    @patch("learner_api.free_course_catalogue.builder_free_courses", return_value=[])
    @patch("learner_api.learning_plan.placement_payload", return_value={})
    @patch("learner_api.learning_plan._canonical_free_course_assignment_version", return_value="free-v1")
    @patch("learner_api.learning_plan._canonical_free_course_assignments", return_value=[])
    @patch("learner_api.learning_plan._canonical_free_course_assignment_ids", return_value=[])
    @patch("learner_api.learning_plan._meetings", return_value=([], ""))
    @patch("learner_api.learning_plan._all_modules", return_value=[MODULE])
    @patch("learner_api.learning_plan._modules_by_id", return_value={})
    @patch("learner_api.learning_plan.learner_group_module_ids", return_value=["M-GROUP"])
    @patch("learner_api.learning_plan.learner_programme_modules", return_value=[MODULE])
    def test_get_shape_does_not_implicitly_insert_group_or_aptem_modules(self, *mocks):
        payload = learning_plan._serialize(
            self.learner(),
            canonical_plan=(),
            plan_version=empty_training_plan_version(),
        )

        self.assertEqual(payload["plan"], [])
        self.assertEqual(payload["preset"], [MODULE])
        self.assertFalse(payload["saved"])
        self.assertEqual(payload["inheritedCount"], 0)
        self.assertEqual(payload["planVersion"], empty_training_plan_version())

    def test_compatibility_write_uses_kind_specific_field_and_exact_projection(self):
        manager = MagicMock()
        manager.using.return_value.filter.return_value.update.return_value = 1
        projection = [{"moduleId": "M-1", "weeks": []}]
        with patch.object(learning_plan.EnrolmentUser, "all_learners", manager), patch(
            "learner_api.learning_plan._plan_titles", return_value=("Module", "", "")
        ):
            learning_plan._write_compatibility_projection(
                self.learner("commercial"), projection
            )

        manager.using.return_value.filter.return_value.update.assert_called_once_with(
            training_plan=projection,
            modules="Module",
            weeks="",
            components="",
        )
        self.assertNotIn("assignmentMode", projection[0])

    def test_canonical_candidate_has_no_destructive_mirror_or_progression_call(self):
        source = inspect.getsource(learning_plan.canonical_learning_plan)
        self.assertIn("reconcile_training_plan(", source)
        self.assertIn("expected_version=editor_request.expected_plan_version", source)
        self.assertNotIn("sync_learning_plan_mirror(", source)
        self.assertNotIn("advance_learner(", source)
        self.assertNotIn("stored_training_plan(", source)

    def test_canonical_writer_is_not_the_active_route_while_gate_is_blocked(self):
        active = resolve("/learner_api/learning-plan/101/").func
        self.assertIs(active, learning_plan.learning_plan)
        self.assertIsNot(active, learning_plan.canonical_learning_plan)

