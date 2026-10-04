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
from learner_api.apprenticeship_agreement import _group_dates


class ProfileStartDateTests(SimpleTestCase):
    def source(self, start=None):
        return SimpleNamespace(start_date=start, end_date="2027-05-01", programme="Synthetic programme", cohort="Synthetic cohort")

    def test_recorded_profile_date_wins_for_all_learner_types(self):
        for kind in ("apprenticeship", "commercial"):
            for recorded in ("2025-05-01", "2026-08-26"):
                with self.subTest(kind=kind, recorded=recorded):
                    source = self.source(recorded)
                    row = SerializeCaseloadDashboardLearnerTests()._row(
                        learner_type=kind, _caseload_source=source,
                        _caseload_contract={"program_start_date": "2025-10-01"},
                    )
                    with patch("learner_api.active_users.cohort_dates") as cohorts:
                        payload = serialize_caseload_dashboard_learner(row)
                        self.assertEqual(payload["startDate"], _group_dates(source)[0].isoformat())
                        self.assertEqual(payload["startDate"], recorded)
                        self.assertEqual(payload["otjhProgrammeStartDate"], "01 Oct 2025")
                        cohorts.assert_not_called()

    @patch("learner_api.active_users.cohort_dates", return_value=(date(2025, 5, 1), date(2027, 5, 1)))
    def test_missing_learner_date_uses_same_stored_field_as_profile(self, cohorts):
        source = self.source()
        row = SimpleNamespace(start_date=None, _caseload_source=source)
        self.assertEqual(caseload_profile_start_date(row), _group_dates(source)[0].isoformat())
        self.assertEqual(caseload_profile_start_date(row), "2025-05-01")

    @patch("learner_api.active_users.cohort_dates", return_value=(None, None))
    def test_missing_canonical_date_stays_missing_despite_contract_or_group_name(self, cohorts):
        source = self.source()
        source.group = "May 2025"
        row = SimpleNamespace(start_date=None, _caseload_source=source, _caseload_contract={"program_start_date": "2025-05-01"})
        self.assertEqual(caseload_profile_start_date(row), "--")

    def test_old_snapshot_dates_are_corrected_without_mutating_other_fields(self):
        rows = [SimpleNamespace(id=i, start_date=None, _caseload_source=self.source(day))
                for i, day in ((1, "2025-05-01"), (2, "2026-08-26"))]
        original = {"learners": [
            {"id": "1", "startDate": "--", "otjhTarget": 42, "lastPr": "2025-04-01"},
            {"id": "2", "startDate": "01 Oct 2025", "status": "active", "plannedEndDate": "01 May 2027"},
        ], "meetings": {"events": [{"id": "preserved"}]}}
        before = deepcopy(original)
        with patch("coach_api.views.fetch_caseload_dashboard_profiles", return_value=rows) as fetch:
            corrected = CoachDashboardService("coach@example.com").normalize_start_dates(original)
        fetch.assert_called_once_with("coach@example.com")
        self.assertEqual(original, before)
        self.assertEqual([r["startDate"] for r in corrected["learners"]], ["2025-05-01", "2026-08-26"])
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
                patch("coach_api.views.fetch_caseload_dashboard_profiles", return_value=[row]):
            response = call_coach_view(coach_dashboard, RequestFactory().get("/coach_api/coach/dashboard"))
        self.assertEqual(response.status_code, 200)
        learner = json.loads(response.content)["learners"][0]
        self.assertEqual(learner["startDate"], "2025-05-01")
        self.assertEqual(learner["otjhTarget"], 42)
        self.assertEqual(cached["learners"][0]["startDate"], "--")
