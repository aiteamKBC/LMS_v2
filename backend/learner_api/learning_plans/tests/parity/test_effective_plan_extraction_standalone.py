"""Frozen effective-plan source versus the extracted application policy."""

from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

BACKEND = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(BACKEND))

from learner_api.learning_plans.application.effective_plan import effective_module_ids
from learner_api.learning_plans.tests.parity.test_assignment_reads_standalone import (
    environment,
    outcome,
)


class EffectivePlanExtractionParityTests(unittest.TestCase):
    def test_frozen_truth_table_matches_extracted_policy(self):
        plans = [
            None,
            [],
            [{"moduleId": " A "}],
            [{"moduleId": "A"}, {"moduleId": "A"}],
            [{"moduleId": "A", "assignmentMode": "explicit"}],
            [{"moduleId": ""}],
        ]
        for plan in plans:
            for group_id in ("", "GROUP"):
                for canonical in (False, True):
                    old = environment(False)
                    old_reader = Mock(return_value=["A", "B", "B"])
                    old["_group_module_ids"] = old_reader
                    learner = SimpleNamespace(
                        group_id=group_id,
                        training_plan=plan,
                        learning_plan=None,
                    )
                    if canonical:
                        learner._canonical_training_plan = plan
                    old_result = outcome(old["_effective_plan_ids"], learner, {})

                    inherited = Mock(
                        return_value=["A", "B", "B"] if group_id else [],
                    )
                    new_result = outcome(
                        effective_module_ids,
                        learner,
                        {},
                        read_inherited_module_ids=inherited,
                    )
                    with self.subTest(
                        plan=plan,
                        group_id=group_id,
                        canonical=canonical,
                    ):
                        self.assertEqual(new_result, old_result)


if __name__ == "__main__":
    unittest.main()
