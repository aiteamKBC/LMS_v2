"""Public facade checks that do not initialize Django or a database."""

from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

BACKEND = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(BACKEND))

from learner_api.learning_plans import public


class PublicContractTests(unittest.TestCase):
    def test_supported_names_are_explicit(self):
        self.assertEqual(set(public.__all__), {
            "clean_text",
            "effective_module_ids",
            "effective_module_ids_from_state",
            "learner_membership_facts",
            "maybe_json",
            "members_for_lineages",
            "module_member_enrolment_ids",
            "module_member_enrolment_ids_by_module",
            "normalized_plan_has_module",
            "normalized_plan_has_rows",
            "normalized_plan_profile_for",
            "normalized_plan_snapshot",
            "stored_training_plan",
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

    def test_writer_is_not_part_of_the_public_read_contract(self):
        self.assertFalse(hasattr(public, "reconcile_training_plan"))

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


if __name__ == "__main__":
    unittest.main()
