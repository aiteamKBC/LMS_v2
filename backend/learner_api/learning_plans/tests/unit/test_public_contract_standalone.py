"""Public facade checks that do not initialize Django or a database."""

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

BACKEND = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(BACKEND))

from learner_api.learning_plans import public


class PublicContractTests(unittest.TestCase):
    def test_supported_names_are_explicit(self):
        self.assertEqual(set(public.__all__), {
            "NORMALIZED_PLAN_PREFETCH",
            "clean_text",
            "compatibility_plan_titles",
            "effective_module_ids",
            "effective_module_ids_from_state",
            "effective_plan_projection",
            "hydrate_normalized_plan",
            "hydrate_normalized_plan_modules",
            "learner_membership_facts",
            "maybe_json",
            "members_for_lineages",
            "module_member_enrolment_ids",
            "module_member_enrolment_ids_by_module",
            "normalized_plan_has_module",
            "normalized_plan_has_rows",
            "normalized_plan_authorization_for_learner",
            "normalized_plan_authorization_for_staff",
            "normalized_plan_profile_for",
            "normalized_plan_snapshot",
            "stored_training_plan",
            "synchronize_compatibility_plan",
            "write_normalized_plan",
        })

    def test_stored_plan_keeps_unsaved_and_empty_distinct(self):
        self.assertIsNone(public.stored_training_plan(SimpleNamespace(
            training_plan=None, learning_plan=None,
        )))
        self.assertEqual(public.stored_training_plan(SimpleNamespace(
            training_plan="[]", learning_plan=None,
        )), [])

    def test_public_module_does_not_load_django_or_infrastructure(self):
        loaded = set(sys.modules)
        self.assertNotIn("django", loaded)
        self.assertNotIn(
            "learner_api.learning_plans.infrastructure.assignment_reads",
            loaded,
        )

    def test_low_level_writer_is_not_exposed_by_the_public_contract(self):
        self.assertFalse(hasattr(public, "reconcile_training_plan"))

    def test_supported_write_forwards_every_concurrency_argument(self):
        result = object()
        implementation = Mock(return_value=result)
        module = SimpleNamespace(write_normalized_plan=implementation)
        authorization = object()
        requested = [{"moduleId": "M1", "weeks": []}]
        with patch.dict(sys.modules, {
            "learner_api.learning_plans.composition": module,
        }):
            self.assertIs(
                public.write_normalized_plan(
                    42,
                    requested,
                    authorization=authorization,
                    expected_version="v1",
                    reorder=True,
                    using="synthetic",
                ),
                result,
            )
        implementation.assert_called_once_with(
            42,
            requested,
            authorization=authorization,
            expected_version="v1",
            reorder=True,
            using="synthetic",
        )

    def test_effective_ids_forward_to_composition_without_changing_arguments(self):
        implementation = Mock(return_value=["M1"])
        module = SimpleNamespace(effective_module_ids=implementation)
        learner = object()
        saved = [{"moduleId": "M1"}]
        with patch.dict(sys.modules, {
            "learner_api.learning_plans.composition": module,
        }):
            self.assertEqual(
                public.effective_module_ids(learner, {"cache": True}, saved_plan=saved),
                ["M1"],
            )
        implementation.assert_called_once_with(
            learner,
            {"cache": True},
            saved_plan=saved,
        )

    def test_snapshot_forwards_database_alias_to_existing_reader(self):
        snapshot = object()
        implementation = Mock(return_value=snapshot)
        module = SimpleNamespace(normalized_plan_snapshot=implementation)
        with patch.dict(sys.modules, {
            "learner_api.learning_plans.composition": module,
        }):
            self.assertIs(
                public.normalized_plan_snapshot(42, using="synthetic"),
                snapshot,
            )
        implementation.assert_called_once_with(42, using="synthetic")

    def test_projection_forwards_learner_and_request_cache(self):
        learner = object()
        cache = {"shared": True}
        implementation = Mock(return_value=[{"moduleId": "M1"}])
        module = SimpleNamespace(effective_plan_projection=implementation)
        with patch.dict(sys.modules, {
            "learner_api.learning_plans.composition": module,
        }):
            self.assertEqual(
                public.effective_plan_projection(learner, cache),
                [{"moduleId": "M1"}],
            )
        implementation.assert_called_once_with(learner, cache)

    def test_hydration_operations_forward_identity_arguments_unchanged(self):
        full = Mock(return_value=[{"moduleId": "M1"}])
        compact = Mock(return_value=[{"moduleId": "M2"}])
        module = SimpleNamespace(
            hydrate_normalized_plan=full,
            hydrate_normalized_plan_modules=compact,
        )
        source = object()
        profile = object()
        with patch.dict(sys.modules, {
            "learner_api.learning_plans.composition": module,
        }):
            self.assertEqual(
                public.hydrate_normalized_plan(source, profile, profile_id=17),
                [{"moduleId": "M1"}],
            )
            self.assertEqual(
                public.hydrate_normalized_plan_modules(source, profile),
                [{"moduleId": "M2"}],
            )
        full.assert_called_once_with(source, profile, profile_id=17)
        compact.assert_called_once_with(source, profile)

    def test_compatibility_operations_forward_without_exposing_root_helpers(self):
        titles = Mock(return_value=("Modules", "Weeks", "Components"))
        synchronize = Mock(return_value=True)
        module = SimpleNamespace(
            compatibility_plan_titles=titles,
            synchronize_compatibility_plan=synchronize,
        )
        learner = object()
        plan = [{"moduleId": "M1"}]
        with patch.dict(sys.modules, {
            "learner_api.learning_plans.composition": module,
        }):
            self.assertEqual(
                public.compatibility_plan_titles(plan),
                ("Modules", "Weeks", "Components"),
            )
            self.assertTrue(
                public.synchronize_compatibility_plan(learner, strict=True)
            )
        titles.assert_called_once_with(plan)
        synchronize.assert_called_once_with(learner, strict=True)

    def test_write_authorization_factories_are_public_but_opaque(self):
        learner_authorization = object()
        staff_authorization = object()
        learner_factory = Mock(return_value=learner_authorization)
        staff_factory = Mock(return_value=staff_authorization)
        module = SimpleNamespace(
            normalized_plan_authorization_for_learner=learner_factory,
            normalized_plan_authorization_for_staff=staff_factory,
        )
        with patch.dict(sys.modules, {
            "learner_api.learning_plans.composition": module,
        }):
            self.assertIs(
                public.normalized_plan_authorization_for_learner(42),
                learner_authorization,
            )
            self.assertIs(
                public.normalized_plan_authorization_for_staff(),
                staff_authorization,
            )
        learner_factory.assert_called_once_with(42)
        staff_factory.assert_called_once_with()

    def test_normalized_existence_reads_hide_orm_models_by_default(self):
        owner = object()
        profile_for = Mock(return_value=owner)
        has_rows = Mock(return_value=True)
        has_module = Mock(return_value=True)
        module = SimpleNamespace(
            normalized_plan_profile_for=profile_for,
            normalized_plan_has_rows=has_rows,
            normalized_plan_has_module=has_module,
        )
        learner = object()
        with patch.dict(sys.modules, {
            "learner_api.learning_plans.composition": module,
        }):
            self.assertIs(public.normalized_plan_profile_for(learner), owner)
            self.assertTrue(public.normalized_plan_has_rows(owner))
            self.assertTrue(public.normalized_plan_has_module(owner, "M1"))
        profile_for.assert_called_once_with(learner, learner_profile_model=None)
        has_rows.assert_called_once_with(owner, plan_module_model=None)
        has_module.assert_called_once_with(
            owner,
            "M1",
            plan_module_model=None,
        )


if __name__ == "__main__":
    unittest.main()
