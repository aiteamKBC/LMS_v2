from django.test import SimpleTestCase

from learner_api.models import (
    LearnerProgressEntry,
    LearnerTrainingPlanComponent,
    LearnerTrainingPlanModule,
    LearnerTrainingPlanWeek,
)
from learner_api.training_plan_writes import (
    TrainingPlanAuthorization,
    TrainingPlanAuthorizationError,
    TrainingPlanValidationError,
    _parse_plan,
    empty_training_plan_version,
)


class TrainingPlanWriteContractTests(SimpleTestCase):
    def test_empty_plan_version_is_deterministic_and_metadata_free(self):
        first = empty_training_plan_version()
        second = empty_training_plan_version()
        self.assertEqual(first, second)
        self.assertRegex(first, r"^sha256:[0-9a-f]{64}$")

    def test_duplicate_canonical_assignments_are_rejected(self):
        with self.assertRaises(TrainingPlanValidationError) as caught:
            _parse_plan(
                [
                    {"moduleId": "m-1", "weeks": []},
                    {"moduleId": "m-1", "weeks": []},
                ]
            )
        self.assertEqual(caught.exception.code, "duplicate_module_assignment")

    def test_cross_learner_authorization_is_rejected(self):
        with self.assertRaises(TrainingPlanAuthorizationError) as caught:
            TrainingPlanAuthorization.for_learner(12).assert_can_manage(13)
        self.assertEqual(caught.exception.code, "learner_access_denied")

    def test_progress_model_maps_the_physical_plan_component_fk(self):
        field = LearnerProgressEntry._meta.get_field("plan_component")
        self.assertEqual(field.column, "plan_component_id")
        self.assertTrue(field.null)
        self.assertEqual(field.remote_field.model._meta.model_name, "learnertrainingplancomponent")

    def test_progress_dependency_sql_uses_the_canonical_column(self):
        sql = str(
            LearnerProgressEntry._base_manager.using("enrolment")
            .filter(plan_component_id__in=[1, 2])
            .values("plan_component_id")
            .query
        )
        self.assertIn("plan_component_id", sql)
        self.assertNotIn("learning_plan", sql)

    def test_plan_orm_sql_uses_only_canonical_curriculum_foreign_keys(self):
        cases = (
            (LearnerTrainingPlanModule, "curriculum_module_id", ("module_ref", "module_title")),
            (LearnerTrainingPlanWeek, "curriculum_week_id", ("week_ref", "week_title")),
            (
                LearnerTrainingPlanComponent,
                "curriculum_component_id",
                ("component_ref", "component_title"),
            ),
        )
        for model, canonical_column, obsolete_columns in cases:
            with self.subTest(model=model.__name__):
                sql = str(model._base_manager.using("enrolment").all().query)
                self.assertIn(canonical_column, sql)
                for obsolete_column in obsolete_columns:
                    self.assertNotIn(f'"{obsolete_column}"', sql)

