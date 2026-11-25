"""Concrete ORM query and compatibility contracts with database I/O forbidden."""

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

BACKEND = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(BACKEND))

from learner_api.identity_placement.tests.django_bootstrap import configure

configure()

from django.db.backends.base.base import BaseDatabaseWrapper
from learner_api import free_course_selectors
from learner_api.identity_placement import public
from learner_api.models import LearnerProfile


class OrmContractTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch.object(
            BaseDatabaseWrapper,
            "connect",
            side_effect=AssertionError("Database I/O forbidden"),
        ))

    def test_exact_kind_uses_only_the_established_bridge_and_projection(self):
        expected = SimpleNamespace(id=501, enrolment_id=19, learner_type="commercial")
        with patch.object(LearnerProfile, "objects") as manager:
            manager.only.return_value.get.return_value = expected
            self.assertIs(public.canonical_learner("commercial", 19), expected)
        manager.only.assert_called_once_with(
            "id", "enrolment_id", "learner_type", "lifecycle_status", "programme_status",
        )
        manager.only.return_value.get.assert_called_once_with(
            enrolment_id=19,
            learner_type="commercial",
        )

    def test_invalid_kind_does_not_query_and_uses_existing_missing_exception(self):
        with patch.object(LearnerProfile, "objects") as manager, \
                self.assertRaises(LearnerProfile.DoesNotExist):
            public.canonical_learner("unknown", 19)
        manager.only.assert_not_called()

    def test_legacy_exact_lookup_preserves_fields_and_active_filter(self):
        expected = SimpleNamespace(id=501, enrolment_id=19)
        with patch.object(LearnerProfile, "objects") as manager:
            manager.only.return_value.filter.return_value.first.return_value = expected
            result = public.learner_profile_for_source(
                SimpleNamespace(pk=19, email="ignored@example.test"),
                active_only=True,
                heal=False,
                fields=("id", "enrolment_id"),
            )
        self.assertIs(result, expected)
        manager.only.assert_called_once_with("id", "enrolment_id")
        manager.only.return_value.filter.assert_called_once_with(
            enrolment_id=19,
            lifecycle_status="active",
        )

    def test_obsolete_modules_and_free_course_identity_exports_are_removed(self):
        learner_root = BACKEND / "learner_api"
        self.assertFalse((learner_root / "identity.py").exists())
        self.assertFalse((learner_root / "placement_links.py").exists())
        self.assertFalse(hasattr(free_course_selectors, "canonical_learner"))
        self.assertFalse(hasattr(free_course_selectors, "VALID_LEARNER_KINDS"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
