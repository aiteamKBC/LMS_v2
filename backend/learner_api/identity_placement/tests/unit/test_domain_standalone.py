"""Pure identity and placement domain tests; no Django or database."""

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

BACKEND = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(BACKEND))

from learner_api.identity_placement.domain.identifiers import (
    VALID_LEARNER_KINDS,
    source_email,
    source_primary_key,
)
from learner_api.identity_placement.domain.placement import (
    ids_from_profile,
    payload_from_ids,
)


class IdentifierTests(unittest.TestCase):
    def test_explicit_enrolment_identifier_is_not_replaced(self):
        self.assertEqual(source_primary_key(SimpleNamespace(pk=7, id=8), 0), 0)
        self.assertEqual(source_primary_key(SimpleNamespace(pk=7, id=8), 9), 9)

    def test_source_pk_then_id_precedence_is_unchanged(self):
        self.assertEqual(source_primary_key(SimpleNamespace(pk=7, id=8)), 7)
        self.assertEqual(source_primary_key(SimpleNamespace(pk=None, id=8)), 8)
        self.assertIsNone(source_primary_key(SimpleNamespace()))

    def test_email_is_only_trimmed_for_the_legacy_fallback(self):
        self.assertEqual(source_email(SimpleNamespace(email=" Learner@Example.Test ")), "Learner@Example.Test")
        self.assertEqual(source_email(SimpleNamespace(email=None)), "")

    def test_supported_kinds_remain_explicit(self):
        self.assertEqual(VALID_LEARNER_KINDS, {"commercial", "apprenticeship"})


class PlacementProjectionTests(unittest.TestCase):
    def test_stable_ids_and_missing_relationships_keep_the_existing_shape(self):
        ids = ids_from_profile(SimpleNamespace(programme_id="P", cohort_id=None, group_id=""))
        self.assertEqual(ids, {"programme_id": "P", "cohort_id": "", "group_id": ""})
        self.assertEqual(
            payload_from_ids(ids),
            {"programmeId": "P", "cohortId": "", "groupId": ""},
        )

    def test_none_profile_is_a_missing_placement_not_an_inferred_one(self):
        self.assertEqual(
            ids_from_profile(None),
            {"programme_id": "", "cohort_id": "", "group_id": ""},
        )


if __name__ == "__main__":
    unittest.main()
