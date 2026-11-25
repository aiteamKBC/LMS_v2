"""Runtime compatibility checks for the supported Learning Plans facade."""

from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase

from learner_api import learning_plan as compatibility
from learner_api.learning_plans import public


class LearningPlanPublicCompatibilityTests(SimpleTestCase):
    def test_root_enriched_projection_uses_live_compatibility_patch_targets(self):
        learner = SimpleNamespace(training_plan=None, learning_plan=None)
        stored = [{"moduleId": "A", "moduleTitle": "Snapshot"}]
        with (
            patch.object(compatibility, "stored_training_plan", return_value=stored) as read,
            patch.object(
                compatibility,
                "get_training_plan",
                side_effect=AssertionError("stored plan must win"),
            ),
            patch.object(
                compatibility,
                "_effective_plan_ids",
                return_value=["A", "B"],
            ) as effective,
        ):
            self.assertEqual(
                compatibility.effective_training_plan(learner, {"request": True}),
                [stored[0], {"moduleId": "B"}],
            )
        read.assert_called_once_with(learner)
        effective.assert_called_once_with(
            learner,
            {"request": True},
            saved_plan=stored,
        )

    def test_public_projection_preserves_canonical_hydration_without_reads(self):
        plan = [{"moduleId": "C", "weeks": [{"weekId": "W"}]}]
        learner = SimpleNamespace(_canonical_training_plan=plan)
        self.assertEqual(public.effective_plan_projection(learner), plan)

    def test_public_compatibility_operations_keep_root_patch_targets(self):
        learner = object()
        plan = [{"moduleId": "M"}]
        with (
            patch.object(
                compatibility,
                "_plan_titles",
                return_value=("M", "W", "C"),
            ) as titles,
            patch.object(
                compatibility,
                "sync_learning_plan_mirror",
                return_value=True,
            ) as synchronize,
        ):
            self.assertEqual(
                public.compatibility_plan_titles(plan),
                ("M", "W", "C"),
            )
            self.assertTrue(
                public.synchronize_compatibility_plan(learner, strict=True)
            )
        titles.assert_called_once_with(plan)
        synchronize.assert_called_once_with(learner, strict=True)

    def test_public_authorization_factories_enforce_existing_identity_policy(self):
        learner_authorization = public.normalized_plan_authorization_for_learner(42)
        learner_authorization.assert_can_manage(42)
        with self.assertRaises(Exception) as denied:
            learner_authorization.assert_can_manage(43)
        self.assertEqual(denied.exception.code, "learner_access_denied")

        staff_authorization = public.normalized_plan_authorization_for_staff()
        staff_authorization.assert_can_manage(43)

