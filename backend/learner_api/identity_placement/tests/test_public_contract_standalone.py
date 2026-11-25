"""Public facade contract without importing Django or the concrete composition."""

import sys
import unittest
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(BACKEND))

from learner_api.identity_placement import public


class PublicContractTests(unittest.TestCase):
    def test_supported_names_are_explicit(self):
        self.assertEqual(set(public.__all__), {
            "CACHE", "FIELDS", "RELATIONS", "VALID_LEARNER_KINDS",
            "canonical_learner", "learner_profile_for_source", "placement_ids",
            "placement_payload", "placement_profile", "with_placements",
        })

    def test_import_is_framework_free_until_an_operation_is_called(self):
        self.assertNotIn("django", sys.modules)
        self.assertNotIn("learner_api.identity_placement.composition", sys.modules)


if __name__ == "__main__":
    unittest.main()
