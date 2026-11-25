"""Runtime parity for the preserved fallback and optional repair policy."""

import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, patch

BACKEND = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(BACKEND))

from learner_api.identity_placement.tests.django_bootstrap import configure

configure()

from django.test import SimpleTestCase

from learner_api.identity_placement.public import learner_profile_for_source
from learner_api.models import EnrolmentUser, LearnerProfile


class LearnerProfileResolutionTests(SimpleTestCase):
    def setUp(self):
        patcher = patch.object(EnrolmentUser.all_learners, "filter")
        self.source_filter = patcher.start()
        self.twins = self.source_filter.return_value.exclude.return_value.values_list.return_value
        self.twins.__getitem__.return_value = []
        self.addCleanup(patcher.stop)

    @staticmethod
    def _returns(*results):
        calls = []

        def fake_filter(**kwargs):
            calls.append(kwargs)
            outcome = results[len(calls) - 1] if len(calls) <= len(results) else None
            return SimpleNamespace(first=lambda: outcome)

        return fake_filter, calls

    def profile_filter(self, *results):
        fake, calls = self._returns(*results)
        manager = self.enterContext(patch.object(LearnerProfile, "objects"))
        manager.filter.side_effect = fake
        return calls

    def test_prefers_the_explicit_enrolment_link(self):
        expected = SimpleNamespace(id=2, enrolment_id=19)
        calls = self.profile_filter(expected)
        result = learner_profile_for_source(
            SimpleNamespace(email=" Learner@Example.com "), 19, active_only=True,
        )
        self.assertIs(result, expected)
        self.assertEqual(calls, [{"enrolment_id": 19, "lifecycle_status": "active"}])

    def test_falls_back_to_email_when_the_link_is_not_set(self):
        expected = SimpleNamespace(id=2, enrolment_id=None, save=lambda **kw: None)
        calls = self.profile_filter(None, expected)
        result = learner_profile_for_source(
            SimpleNamespace(email=" Learner@Example.com "), 19, active_only=True,
        )
        self.assertIs(result, expected)
        self.assertEqual(calls, [
            {"enrolment_id": 19, "lifecycle_status": "active"},
            {
                "email__iexact": "Learner@Example.com",
                "enrolment_id__isnull": True,
                "lifecycle_status": "active",
            },
        ])

    def test_an_email_match_repairs_the_missing_link(self):
        saved = {}
        expected = SimpleNamespace(
            id=2,
            enrolment_id=None,
            save=lambda **kwargs: saved.update(kwargs),
        )
        self.profile_filter(None, expected)
        learner_profile_for_source(
            SimpleNamespace(email="learner@example.com"), 19, active_only=True,
        )
        self.assertEqual(expected.enrolment_id, 19)
        self.assertEqual(saved, {"update_fields": ["enrolment_id"]})

    def test_falls_back_to_source_id_only_when_source_has_no_email(self):
        expected = SimpleNamespace(id=19)
        calls = self.profile_filter(None, expected)
        result = learner_profile_for_source(
            SimpleNamespace(email="  "), 19, active_only=True,
        )
        self.assertIs(result, expected)
        self.assertEqual(calls, [
            {"enrolment_id": 19, "lifecycle_status": "active"},
            {
                "pk": 19,
                "enrolment_id__isnull": True,
                "lifecycle_status": "active",
            },
        ])

    def test_does_not_cross_link_an_unmatched_email_by_source_id(self):
        calls = self.profile_filter(None, None)
        result = learner_profile_for_source(
            SimpleNamespace(email="missing@example.com"), 19, active_only=True,
        )
        self.assertIsNone(result)
        self.assertEqual(calls, [
            {"enrolment_id": 19, "lifecycle_status": "active"},
            {
                "email__iexact": "missing@example.com",
                "enrolment_id__isnull": True,
                "lifecycle_status": "active",
            },
        ])

    def test_duplicate_source_email_does_not_claim_unlinked_work(self):
        profile = SimpleNamespace(id=2, enrolment_id=None, save=Mock())
        self.profile_filter(None, profile)
        self.twins.__getitem__.return_value = [501]
        self.assertIsNone(learner_profile_for_source(
            SimpleNamespace(email="shared@example.com"), 500,
        ))
        profile.save.assert_not_called()

    def test_a_learner_enrolled_twice_is_named_in_the_log_with_both_ids(self):
        self.profile_filter(
            None,
            SimpleNamespace(id=2, enrolment_id=None, save=Mock()),
        )
        self.twins.__getitem__.return_value = [501, 502]
        with self.assertLogs("learner_api.identity_placement.composition", level="WARNING") as logged:
            learner_profile_for_source(SimpleNamespace(email="shared@example.com"), 500)
        message = logged.output[0]
        self.assertIn("shared@example.com", message)
        for pk in ("500", "501", "502"):
            self.assertIn(pk, message)
        self.assertIn("merge_duplicate_enrolments", message)


class ReadOnlyIdentityTests(SimpleTestCase):
    def resolve(self, heal):
        legacy = MagicMock(enrolment_id=None)
        profiles = MagicMock()
        profiles.filter.side_effect = [
            MagicMock(first=MagicMock(return_value=None)),
            MagicMock(first=MagicMock(return_value=legacy)),
        ]
        no_twins = MagicMock()
        no_twins.filter.return_value.exclude.return_value.values_list.return_value = []
        with patch.object(LearnerProfile, "objects", profiles), patch.object(
            EnrolmentUser, "all_learners", no_twins,
        ):
            found = learner_profile_for_source(
                SimpleNamespace(pk=265, email="a@example.test"), 265, heal=heal,
            )
        return found, legacy

    def test_read_only_lookup_never_saves(self):
        found, legacy = self.resolve(heal=False)
        self.assertIs(found, legacy)
        legacy.save.assert_not_called()
        self.assertIsNone(legacy.enrolment_id)

    def test_default_lookup_still_heals_the_link(self):
        found, legacy = self.resolve(heal=True)
        self.assertIs(found, legacy)
        legacy.save.assert_called_once_with(update_fields=["enrolment_id"])
        self.assertEqual(legacy.enrolment_id, 265)


if __name__ == "__main__":
    import unittest

    unittest.main()
