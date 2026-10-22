"""Employer dashboard reads: owned learner IDs, canonical totals and OTJ rules.

All database readers are mocked; no schema setup or external calls are needed.
"""
import json
from datetime import date
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.db import DatabaseError
from django.test import RequestFactory, SimpleTestCase

from learner_api import employer_portal


class EmployerDashboardMetricsTests(SimpleTestCase):
    def setUp(self):
        self.account = SimpleNamespace(role="employer", subject_id=7)
        self.model = MagicMock()
        self.model.all_learners.filter.return_value.values_list.return_value = [101, 102, 103]
        self.progress = {
            key: {"programme": {"completed": 68, "total": 100, "percent": 68, "status": "ready"}, "private": "not exposed"}
            for key in (101, 102, 103, 999)
        }
        self.hours = {
            key: {"planned": 200, "actual": actual, "start_date": date(2026, 10, 1), "end_date": date(2026, 11, 10)}
            for key, actual in ((101, 90), (102, 70), (103, 40))
        }
        patches = [
            patch.dict("os.environ", {"LEARNER_API_REQUIRE_AUTH": "1"}),
            patch("login.permissions.authenticate_request", side_effect=lambda request: self.account),
            patch.object(employer_portal, "_employer_or_404", return_value=(SimpleNamespace(pk=7), None)),
            patch.object(employer_portal, "SOURCE_MODELS", {"apprenticeship": self.model}),
            patch.object(employer_portal.timezone, "localdate", return_value=date(2026, 10, 21)),
        ]
        for item in patches:
            item.start()
            self.addCleanup(item.stop)

    def call(self, *, employer_id=7, method="get", error=None):
        with patch("learner_api.canonical_learning.metrics_bulk", return_value=self.progress, side_effect=error) as metrics, \
                patch("learner_api.canonical_learning.otjh_summary_bulk", return_value=self.hours) as hours:
            response = employer_portal.employer_dashboard_metrics(
                getattr(RequestFactory(), method)("/dashboard-metrics/"), employer_id=employer_id,
            )
        return response, metrics, hours

    def test_uses_only_owned_ids_and_the_existing_coach_otj_verdict(self):
        response, metrics, hours = self.call()
        self.model.all_learners.filter.assert_called_once_with(employer_id=7)
        metrics.assert_called_once_with([101, 102, 103])
        hours.assert_called_once_with([101, 102, 103])
        self.assertEqual(response.status_code, 200)
        body = json.loads(response.content)
        self.assertEqual(set(body["learners"]), {"101", "102", "103"})
        self.assertEqual([row["risk"] for row in body["learners"].values()], ["on-track", "need-attention", "at-risk"])
        self.assertEqual(body["learners"]["101"]["programme"], self.progress[101]["programme"])
        self.assertEqual(set(body["learners"]["101"]), {"programme", "risk"})
        self.assertEqual(body["asOf"], "2026-10-21")
        self.assertEqual(response["Cache-Control"], "private, no-store")

    def test_missing_identity_or_hours_stays_unavailable(self):
        self.progress = {101: None}
        self.hours = {101: None}
        response, _, _ = self.call()
        for row in json.loads(response.content)["learners"].values():
            self.assertEqual(row, {"programme": None, "risk": "unavailable"})

    def test_no_learners_has_no_fabricated_metrics(self):
        self.model.all_learners.filter.return_value.values_list.return_value = []
        response, metrics, hours = self.call()
        metrics.assert_called_once_with([])
        hours.assert_called_once_with([])
        self.assertEqual(json.loads(response.content)["learners"], {})

    def test_unavailable_source_returns_an_error_not_zero_progress(self):
        response, _, hours = self.call(error=DatabaseError("synthetic unavailable source"))
        self.assertEqual(response.status_code, 503)
        self.assertIn("error", json.loads(response.content))
        hours.assert_not_called()

    def test_ownership_role_and_read_only_boundaries(self):
        for role, subject_id, employer_id, method, expected in (
            ("employer", 7, 8, "get", 404),
            ("learner", 101, 7, "get", 403),
            ("employer", 7, 7, "post", 405),
        ):
            with self.subTest(role=role, method=method):
                self.account = SimpleNamespace(role=role, subject_id=subject_id)
                response, metrics, hours = self.call(employer_id=employer_id, method=method)
                self.assertEqual(response.status_code, expected)
                metrics.assert_not_called()
                hours.assert_not_called()

    def test_staff_can_read_the_selected_employer(self):
        self.account = SimpleNamespace(role="staff", subject_id=None)
        response, _, _ = self.call()
        self.assertEqual(response.status_code, 200)

    def test_signed_out_cannot_read_dashboard(self):
        self.account = None
        response, metrics, _ = self.call()
        self.assertEqual(response.status_code, 401)
        metrics.assert_not_called()
