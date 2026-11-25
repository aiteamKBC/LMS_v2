"""Public facade contract without importing Django or the concrete composition."""

import os
import subprocess
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
            "audit_admin_learner_action", "canonical_learner", "coach_owns_learner",
            "learner_owns_target", "learner_profile_for_source", "learner_self_only",
            "learner_self_or_admin", "learner_self_or_staff", "placement_ids",
            "placement_input", "placement_payload", "placement_profile",
            "staff_owns_learner", "validate_placement", "with_placements",
        })

    def test_import_is_framework_free_until_an_operation_is_called(self):
        code = (
            "import sys; from learner_api.identity_placement import public; "
            "print(int('django' in sys.modules), "
            "int('learner_api.identity_placement.composition' in sys.modules))"
        )
        environment = {**os.environ, "PYTHONPATH": str(BACKEND), "PYTHONDONTWRITEBYTECODE": "1"}
        result = subprocess.run(
            [sys.executable, "-c", code],
            capture_output=True,
            check=False,
            env=environment,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), "0 0")


if __name__ == "__main__":
    unittest.main()
