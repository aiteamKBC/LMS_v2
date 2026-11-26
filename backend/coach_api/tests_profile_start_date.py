"""Date serialization tests: unittest + SimpleTestCase, no database setup/writes."""
from copy import deepcopy
import json
from datetime import date
from types import SimpleNamespace
from unittest.mock import patch

from django.test import RequestFactory, SimpleTestCase

from coach_api.services.dashboard.service import CoachDashboardService
from coach_api.tests import SerializeCaseloadDashboardLearnerTests, call_coach_view
from coach_api.views import apply_otjh_to_date_metrics, caseload_profile_start_date, serialize_caseload_dashboard_learner


class ProfileStartDateTests(SimpleTestCase):
    def source(self, start=None):
        return SimpleNamespace(learner_start_date=start, start_date="2020-01-01", end_date="2027-05-01", programme="Synthetic programme", cohort="Synthetic cohort")

    def test_canonical_enrolment_date_wins_for_all_learner_types(self):
        for kind in ("apprenticeship", "commercial"):
            for recorded in ("2025-05-01", "2026-05-28"):
                with self.subTest(kind=kind, recorded=recorded):
                    source = self.source(recorded)
                    row = SerializeCaseloadDashboardLearnerTests()._row(
                        learner_type=kind, _caseload_source=source,
                        _caseload_contract={"program_start_date": "2025-10-01"},
                    )
                    with patch("learner_api.active_users.cohort_dates") as cohorts:
                        payload = serialize_caseload_dashboard_learner(row)
                        self.assertEqual(payload["startDate"], recorded)
                        self.assertEqual(payload["otjhProgrammeStartDate"], "01 Oct 2025")
                        cohorts.assert_not_called()

    @patch("learner_api.active_users.cohort_dates", return_value=(date(2025, 5, 1), date(2027, 5, 1)))
    def test_missing_learner_date_does_not_use_cohort_or_profile(self, cohorts):
        source = self.source()
        row = SimpleNamespace(start_date=None, _caseload_source=source)
        self.assertIsNone(caseload_profile_start_date(row))
        cohorts.assert_not_called()

    @patch("learner_api.active_users.cohort_dates", return_value=(None, None))
    def test_missing_canonical_date_stays_missing_despite_contract_or_group_name(self, cohorts):
        source = self.source()
        source.group = "May 2025"
        row = SimpleNamespace(start_date=None, _caseload_source=source, _caseload_contract={"program_start_date": "2025-05-01"})
        self.assertIsNone(caseload_profile_start_date(row))

    def test_old_snapshot_dates_are_corrected_without_mutating_other_fields(self):
        rows = [SimpleNamespace(id=i, start_date=None, _caseload_source=self.source(day))
                for i, day in ((1, "2025-05-01"), (2, "2026-05-28"))]
        original = {"learners": [
            {"id": "1", "startDate": "--", "otjhTarget": 42, "lastPr": "2025-04-01"},
            {"id": "2", "startDate": "01 Oct 2025", "status": "active", "plannedEndDate": "01 May 2027"},
        ], "meetings": {"events": [{"id": "preserved"}]}}
        before = deepcopy(original)
        with patch("coach_api.services.dashboard.profile_dates.fetch_dashboard_profile_dates", return_value=rows) as fetch:
            corrected = CoachDashboardService("coach@example.com").normalize_start_dates(original)
        fetch.assert_called_once_with("coach@example.com", [1, 2])
        self.assertEqual(original, before)
        self.assertEqual([r["startDate"] for r in corrected["learners"]], ["2025-05-01", "2026-05-28"])
        for old, new in zip(original["learners"], corrected["learners"]):
            self.assertEqual(new["otjhProgrammeStartDate"], old["startDate"])
            for key in old.keys() - {"startDate"}:
                self.assertEqual(new[key], old[key])
        self.assertEqual(corrected["meetings"], original["meetings"])

    def test_otjh_values_are_identical_when_profile_date_differs(self):
        old = {"startDate": "01 Oct 2025", "plannedEndDate": "01 Oct 2027", "otjhPlanned": 576, "otjhCompleted": 100}
        new = {**old, "startDate": "2025-05-01", "otjhProgrammeStartDate": old["startDate"]}
        today = date(2026, 6, 1)
        apply_otjh_to_date_metrics(old, today=today)
        apply_otjh_to_date_metrics(new, today=today)
        for key in old.keys() - {"startDate"}:
            self.assertEqual(old[key], new[key])

    def test_dashboard_get_corrects_a_cached_missing_date(self):
        from coach_api.dashboard_view import coach_dashboard

        source = self.source("2025-05-01")
        row = SimpleNamespace(id=1, start_date=None, _caseload_source=source)
        cached = {"learners": [{"id": "1", "startDate": "--", "otjhTarget": 42}]}
        with patch("coach_api.dashboard_view.dashboard_cache.get_cached_coach_dashboard", return_value=cached), \
                patch("coach_api.dashboard_view.snapshot_needs_refresh", return_value=False), \
                patch("coach_api.services.dashboard.otjh.refresh_otjh_rows"), \
                patch("coach_api.services.dashboard.profile_dates.fetch_dashboard_profile_dates", return_value=[row]):
            response = call_coach_view(coach_dashboard, RequestFactory().get("/coach_api/coach/dashboard"))
        self.assertEqual(response.status_code, 200)
        learner = json.loads(response.content)["learners"][0]
        self.assertEqual(learner["startDate"], "2025-05-01")
        self.assertEqual(learner["otjhTarget"], 42)
        self.assertEqual(cached["learners"][0]["startDate"], "--")

    def test_null_empty_and_invalid_values_are_null_in_api(self):
        for value in (None, "", "   ", "null", "--", "2026-02-30", "2026-05-28garbage"):
            with self.subTest(value=value):
                row = SerializeCaseloadDashboardLearnerTests()._row(
                    start_date=date(2020, 1, 1), _caseload_source=self.source(value),
                    _caseload_contract={"program_start_date": "2025-10-01"},
                )
                self.assertIsNone(serialize_caseload_dashboard_learner(row)["startDate"])

    def test_valid_dates_are_trimmed_and_normalized(self):
        for value in (" 2026-05-28 ", "28/05/2026", date(2026, 5, 28)):
            with self.subTest(value=value):
                self.assertEqual(caseload_profile_start_date(
                    SimpleNamespace(_caseload_source=self.source(value))), "2026-05-28")

    def test_all_coaches_and_cached_rows_use_canonical_dates_or_null(self):
        for coach in ("coach-a@example.invalid", "coach-b@example.invalid"):
            with self.subTest(coach=coach):
                rows = [SimpleNamespace(id=i, _caseload_source=self.source(value))
                        for i, value in ((1, "2026-05-28"), (2, None), (3, " "))]
                original = {"learners": [
                    {"id": str(i), "startDate": "2020-01-01", "displayStartDate": "01 Jan 2020",
                     "otjhProgrammeStartDate": "01 Oct 2025", "lastActivity": "preserved"}
                    for i in range(1, 5)
                ]}
                with patch("coach_api.services.dashboard.profile_dates.fetch_dashboard_profile_dates", return_value=rows) as fetch:
                    payload = CoachDashboardService(coach).normalize_start_dates(original)
                fetch.assert_called_once_with(coach, [1, 2, 3, 4])
                self.assertEqual([r["startDate"] for r in payload["learners"]],
                                 ["2026-05-28", None, None, None])
                for learner in payload["learners"]:
                    self.assertEqual(learner["otjhProgrammeStartDate"], "01 Oct 2025")
                    self.assertEqual(learner["lastActivity"], "preserved")
