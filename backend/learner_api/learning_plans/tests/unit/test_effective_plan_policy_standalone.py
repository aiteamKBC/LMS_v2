"""Database-free characterization of the effective-plan policy."""

from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

BACKEND = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(BACKEND))

from learner_api.learning_plans.application.effective_plan import effective_module_ids
from learner_api.learning_plans.domain.effective_plan import effective_module_ids_from_state


class EffectivePlanPolicyTests(unittest.TestCase):
    def resolve(self, saved, inherited=("G1", "G2")):
        reader = Mock(return_value=list(inherited))
        learner = SimpleNamespace(training_plan=saved, learning_plan=None)
        result = effective_module_ids(
            learner,
            {},
            read_inherited_module_ids=reader,
        )
        return result, reader

    def test_unsaved_plan_inherits_in_original_order(self):
        result, reader = self.resolve(None, ("G2", "G1", "G2"))
        self.assertEqual(result, ["G2", "G1", "G2"])
        reader.assert_called_once()

    def test_explicitly_empty_plan_stays_empty_without_preset_read(self):
        result, reader = self.resolve([])
        self.assertEqual(result, [])
        reader.assert_not_called()

    def test_explicit_assignment_never_inherits(self):
        result, reader = self.resolve([
            {"moduleId": " A ", "assignmentMode": "explicit"},
        ])
        self.assertEqual(result, ["A"])
        reader.assert_not_called()

    def test_non_explicit_saved_plan_appends_only_unplanned_inherited_ids(self):
        result, reader = self.resolve(
            [{"moduleId": "A"}, {"moduleId": "A"}],
            ("A", "B", "B"),
        )
        self.assertEqual(result, ["A", "A", "B", "B"])
        reader.assert_called_once()

    def test_canonical_cache_precedes_legacy_json(self):
        inherited = Mock(return_value=["G"])
        learner = SimpleNamespace(
            training_plan=[{"moduleId": "LEGACY"}],
            learning_plan=None,
            _canonical_training_plan=[{"moduleId": "CANONICAL"}],
        )
        result = effective_module_ids(
            learner,
            {},
            read_inherited_module_ids=inherited,
        )
        self.assertEqual(result, ["CANONICAL", "G"])

    def test_supplied_plan_bypasses_canonical_and_stored_plan_reader(self):
        stored = Mock(side_effect=AssertionError("stored plan must not be read"))
        learner = SimpleNamespace(_canonical_training_plan=[{"moduleId": "C"}])
        result = effective_module_ids(
            learner,
            {},
            read_inherited_module_ids=Mock(return_value=["G"]),
            read_stored_plan=stored,
            saved_plan=[{"moduleId": "S", "assignmentMode": "explicit"}],
        )
        self.assertEqual(result, ["S"])
        stored.assert_not_called()

    def test_narrowed_state_uses_total_count_to_preserve_inheritance(self):
        inherited = Mock(return_value=["TARGET"])
        result = effective_module_ids_from_state(
            (),
            inherited,
            has_saved_plan=True,
            has_explicit_assignment=False,
            saved_module_count=3,
        )
        self.assertEqual(result, ["TARGET"])
        inherited.assert_called_once()

    def test_narrowed_state_preserves_cleared_plan(self):
        inherited = Mock(return_value=["TARGET"])
        result = effective_module_ids_from_state(
            (),
            inherited,
            has_saved_plan=True,
            has_explicit_assignment=False,
            saved_module_count=0,
        )
        self.assertEqual(result, [])
        inherited.assert_not_called()


if __name__ == "__main__":
    unittest.main()
