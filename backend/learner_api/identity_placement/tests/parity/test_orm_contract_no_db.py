"""Concrete ORM query and compatibility contracts with database I/O forbidden."""

import importlib
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

BACKEND = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(BACKEND))

if __name__ == "__main__":
    from django.conf import settings

    settings.configure(
        SECRET_KEY="offline-identity-placement-check",
        INSTALLED_APPS=[],
        DATABASES={"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}},
    )
    from django.apps import AppConfig, apps

    apps.populate([AppConfig("learner_api", importlib.import_module("learner_api"))])

from django.db.backends.base.base import BaseDatabaseWrapper
from learner_api import free_course_selectors, identity, placement_links
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

    def test_legacy_modules_are_the_same_supported_function_objects(self):
        self.assertIs(identity.learner_profile_for_source, public.learner_profile_for_source)
        self.assertIs(free_course_selectors.canonical_learner, public.canonical_learner)
        for name in ("placement_profile", "with_placements", "placement_ids", "placement_payload"):
            self.assertIs(getattr(placement_links, name), getattr(public, name))


if __name__ == "__main__":
    unittest.main(verbosity=2)
