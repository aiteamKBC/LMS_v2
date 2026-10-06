"""Withdrawn, completed and EPA learners never reach the Coach Dashboard, even from an older snapshot."""
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase

from coach_api.services.dashboard.service import CoachDashboardService
from coach_api.views import is_hidden_caseload_programme_status


def profile(profile_id, status):
    return SimpleNamespace(id=profile_id, start_date=None, programme_status=status,
                           _caseload_source=SimpleNamespace(learner_start_date=None))


class HiddenProgrammeStatusTests(SimpleTestCase):
    def test_hidden_stages_match_the_frontend_rule(self):
        for status in ("Withdrawn", " withdrawn ", "Completed", "Entered EPA", "Entered-EPA", "EPA",
                       "Onboarding", "Onboarding Stage"):
            with self.subTest(status=status):
                self.assertTrue(is_hidden_caseload_programme_status(status))
        for status in ("Delivery", "Active", "On break", "Ready to enrol", "Fresh user", "", None):
            with self.subTest(status=status):
                self.assertFalse(is_hidden_caseload_programme_status(status))


class SnapshotReadDropsHiddenLearnersTests(SimpleTestCase):
    def test_learner_withdrawn_after_the_snapshot_was_built_is_not_served(self):
        snapshot = {"learners": [
            {"id": "1", "rawProgramStatus": "Delivery", "startDate": "--"},
            {"id": "2", "rawProgramStatus": "Delivery", "startDate": "--"},
            {"id": "3", "rawProgramStatus": "Delivery", "startDate": "--"},
            {"id": "4", "rawProgramStatus": "Active", "startDate": "--"},
        ], "meetings": {"events": [{"id": "preserved"}]}}
        before = deepcopy(snapshot)
        rows = [profile(1, "Withdrawn"), profile(2, "Delivery"), profile(3, "Completed")]
        with patch("coach_api.services.dashboard.profile_dates.fetch_dashboard_profile_dates", return_value=rows):
            payload = CoachDashboardService("coach@example.invalid").normalize_start_dates(snapshot)

        # 1 and 3 changed status since the build; 4 has no current row, so it is left as built.
        self.assertEqual([learner["id"] for learner in payload["learners"]], ["2", "4"])
        # The displayed status still comes from the snapshot.
        self.assertEqual(payload["learners"][0]["rawProgramStatus"], "Delivery")
        self.assertEqual(payload["meetings"], before["meetings"])
        self.assertEqual(snapshot, before)

    def test_payload_without_learners_keeps_its_shape(self):
        with patch("coach_api.services.dashboard.profile_dates.fetch_dashboard_profile_dates", return_value=[]):
            payload = CoachDashboardService("coach@example.invalid").normalize_start_dates({"meetings": {}})
        self.assertEqual(payload, {"meetings": {}})
