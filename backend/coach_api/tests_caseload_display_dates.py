from datetime import date
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase

from coach_api.views import caseload_display_start_date, caseload_schedule_values


class CaseloadDisplayStartDateTests(SimpleTestCase):
    def row(self, kind="apprenticeship", **source_dates):
        return SimpleNamespace(
            start_date=None,
            _caseload_source=SimpleNamespace(
                learner_type=kind, programme="Programme A", cohort="Cohort A",
                **source_dates,
            ),
            _caseload_contract={"program_start_date": "2025-10-01"},
        )

    @patch("learner_api.active_users.cohort_dates", return_value=(date(2025, 10, 15), date(2027, 2, 14)))
    def test_cohort_fallback_matches_case_file_for_both_learner_types(self, cohort_dates):
        for kind in ("apprenticeship", "commercial"):
            with self.subTest(kind=kind):
                row = self.row(kind)
                self.assertEqual(caseload_display_start_date(row), "15 Oct 2025")
                self.assertEqual(caseload_schedule_values(row)[1], "2025-10-01")

    @patch("learner_api.active_users.cohort_dates")
    def test_recorded_source_date_wins_over_cohort_contract_and_profile(self, cohort_dates):
        row = self.row(start_date="2025-10-20", end_date="2027-02-14")
        row.start_date = date(2025, 10, 2)
        self.assertEqual(caseload_display_start_date(row), "20 Oct 2025")
        cohort_dates.assert_not_called()

    @patch("learner_api.active_users.cohort_dates", return_value=(None, None))
    def test_no_date_is_not_fabricated_from_contract(self, cohort_dates):
        self.assertEqual(caseload_display_start_date(self.row()), "--")

    @patch("learner_api.active_users.cohort_dates", return_value=(None, None))
    def test_profile_shell_is_used_when_detail_has_no_date(self, cohort_dates):
        row = self.row()
        row.start_date = date(2025, 10, 25)
        self.assertEqual(caseload_display_start_date(row), "25 Oct 2025")

    def test_missing_source_uses_only_profile_date(self):
        row = SimpleNamespace(start_date=None)
        self.assertEqual(caseload_display_start_date(row), "--")
        row.start_date = date(2025, 10, 28)
        self.assertEqual(caseload_display_start_date(row), "28 Oct 2025")
