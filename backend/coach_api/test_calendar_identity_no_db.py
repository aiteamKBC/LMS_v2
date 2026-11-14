"""Calendar learner-link validation without a database or external services."""

from unittest.mock import patch

from django.test import SimpleTestCase

from .calendar_identity import (
    CalendarLearnerIdentityError,
    require_profile_identity,
    resolve_profile_identity,
)


class CalendarIdentityGuardTests(SimpleTestCase):
    def test_profile_link_is_returned_only_for_the_expected_profile(self):
        link = {
            "calendar_event_id": 91,
            "raw_learner_id": 17,
            "identity_kind": "profile",
            "learner_profile_id": 42,
            "verified_profile_id": None,
        }
        with patch("coach_api.calendar_identity.calendar_learner_link", return_value=link):
            self.assertEqual(require_profile_identity(91, expected_profile_id=42), link)
            with self.assertRaises(CalendarLearnerIdentityError):
                require_profile_identity(91, expected_profile_id=17)

    def test_raw_or_unresolved_links_fail_closed(self):
        for link in (None, {"identity_kind": "raw", "learner_profile_id": 42},
                     {"identity_kind": "profile", "learner_profile_id": None}):
            with self.subTest(link=link), patch(
                "coach_api.calendar_identity.calendar_learner_link", return_value=link,
            ):
                with self.assertRaises(CalendarLearnerIdentityError):
                    require_profile_identity(91, expected_profile_id=42)

    def test_enrolment_link_resolves_only_through_profile_bridge(self):
        link = {
            "calendar_event_id": 91,
            "raw_learner_id": 17,
            "identity_kind": "enrolment",
            "learner_profile_id": None,
            "enrolment_id": 17,
            "verified_profile_id": None,
        }
        manager = patch("learner_api.models.LearnerProfile.objects").start()
        self.addCleanup(patch.stopall)
        query = manager.filter.return_value
        query.values_list.return_value = [42]
        with patch("coach_api.calendar_identity.calendar_learner_link", return_value=link):
            result = resolve_profile_identity(91, expected_profile_id=42, expected_enrolment_id=17)
        self.assertEqual(result["learner_profile_id"], 42)
        manager.filter.assert_called_once_with(enrolment_id=17)

    def test_enrolment_link_cannot_be_reused_for_another_enrolment(self):
        link = {
            "calendar_event_id": 91,
            "raw_learner_id": 17,
            "identity_kind": "enrolment",
            "learner_profile_id": None,
            "enrolment_id": 17,
            "verified_profile_id": None,
        }
        with patch("coach_api.calendar_identity.calendar_learner_link", return_value=link):
            with self.assertRaises(CalendarLearnerIdentityError):
                resolve_profile_identity(91, expected_enrolment_id=18)
