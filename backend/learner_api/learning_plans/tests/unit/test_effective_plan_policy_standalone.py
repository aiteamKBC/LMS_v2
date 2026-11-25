"""Database-free characterization of the effective-plan policy."""

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

BACKEND = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(BACKEND))

from learner_api.learning_plans.application.effective_plan import (
    effective_module_ids,
    effective_plan_projection,
)
from learner_api.learning_plans.domain.effective_plan import (
    effective_module_ids_from_state,
    effective_plan_selection_from_plan,
)


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

    def test_enriched_projection_preserves_snapshots_and_appends_minimal_ids(self):
        saved = [{"moduleId": "A", "moduleTitle": "Agreed title"}]
        stored = Mock(return_value=saved)
        fallback = Mock(side_effect=AssertionError("saved plan must win"))
        effective = Mock(return_value=["A", "B"])
        learner = SimpleNamespace()

        self.assertEqual(
            effective_plan_projection(
                learner,
                {"request": "cache"},
                read_stored_plan=stored,
                read_fallback_plan=fallback,
                read_effective_module_ids=effective,
            ),
            [saved[0], {"moduleId": "B"}],
        )
        effective.assert_called_once_with(
            learner,
            {"request": "cache"},
            saved_plan=saved,
        )
        fallback.assert_not_called()

    def test_enriched_projection_uses_fallback_only_for_unsaved_plan(self):
        learner = SimpleNamespace()
        fallback = Mock(return_value=[{"moduleId": "F", "legacy": True}])
        effective = Mock(return_value=["F"])

        self.assertEqual(
            effective_plan_projection(
                learner,
                read_stored_plan=Mock(return_value=None),
                read_fallback_plan=fallback,
                read_effective_module_ids=effective,
            ),
            [{"moduleId": "F", "legacy": True}],
        )
        fallback.assert_called_once_with(learner)
        effective.assert_called_once_with(learner, {}, saved_plan=None)

    def test_enriched_projection_canonical_cache_short_circuits_legacy_reads(self):
        canonical = [{"moduleId": "C", "weeks": []}]
        learner = SimpleNamespace(_canonical_training_plan=canonical)
        stored = Mock(side_effect=AssertionError("canonical plan must win"))
        fallback = Mock(side_effect=AssertionError("canonical plan must win"))
        effective = Mock(side_effect=AssertionError("canonical plan must win"))

        result = effective_plan_projection(
            learner,
            read_stored_plan=stored,
            read_fallback_plan=fallback,
            read_effective_module_ids=effective,
        )

        self.assertEqual(result, canonical)
        self.assertIsNot(result, canonical)
        stored.assert_not_called()
        fallback.assert_not_called()
        effective.assert_not_called()

    def test_unsaved_imported_plan_appends_imported_ids_after_the_preset(self):
        selection = effective_plan_selection_from_plan(
            None,
            lambda: ["G1", "SHARED"],
            lambda: ["SHARED", "A1"],
        )
        self.assertEqual(selection.module_ids, ("G1", "SHARED", "A1"))
        self.assertEqual(selection.inherited_module_ids, ())
        self.assertEqual(selection.imported_module_ids, ("A1",))
        self.assertFalse(selection.has_saved_plan)

    def test_empty_imported_plan_keeps_imported_ids_without_group_inheritance(self):
        inherited = Mock(return_value=["G1"])
        selection = effective_plan_selection_from_plan(
            [], inherited, lambda: ["A1"],
        )
        self.assertEqual(selection.module_ids, ("A1",))
        self.assertEqual(selection.inherited_module_ids, ())
        self.assertEqual(selection.imported_module_ids, ("A1",))
        inherited.assert_not_called()

    def test_explicit_assignment_suppresses_group_and_imported_reads(self):
        inherited = Mock(side_effect=AssertionError("group preset"))
        imported = Mock(side_effect=AssertionError("imported subjects"))
        selection = effective_plan_selection_from_plan(
            [{"moduleId": "S1", "assignmentMode": "explicit"}],
            inherited,
            imported,
        )
        self.assertEqual(selection.module_ids, ("S1",))
        inherited.assert_not_called()
        imported.assert_not_called()

    def test_saved_plan_orders_stored_then_inherited_then_imported(self):
        selection = effective_plan_selection_from_plan(
            [{"moduleId": "S1"}],
            lambda: ["S1", "G1"],
            lambda: ["G1", "A1"],
        )
        self.assertEqual(selection.module_ids, ("S1", "G1", "A1"))
        self.assertEqual(selection.inherited_module_ids, ("G1",))
        self.assertEqual(selection.imported_module_ids, ("A1",))


if __name__ == "__main__":
    unittest.main()
