"""Execute the Dashboard JSON projection against an isolated PostgreSQL test DB."""

import json
from unittest import skipUnless
from unittest.mock import patch

from django.db import connection
from django.test import TestCase

from coach_api.models import CoachDashboardSnapshot
from coach_api.services.dashboard.sections import DashboardSectionProjection, load_section, project_section


@skipUnless(connection.vendor == "postgresql", "JSONB projection requires PostgreSQL")
class DashboardPostgresProjectionTests(TestCase):
    def setUp(self):
        self.payload = {
            "owner": {"name": "Synthetic Coach", "email": "coach-a@example.invalid"},
            "learners": [
                {"id": "1", "name": "Alpha", "rawProgramStatus": "Active", "learnerType": "commercial",
                 "otjhCompleted": 0, "otjhTargetAsOfToday": 0, "otjhRagStatus": "unavailable",
                 "attendanceRate": None, "attendanceAvailable": False,
                 "ksbCompletedDetails": [{"privateDetail": "x" * 1000000}], "otjhCompletedEntries": [{"unused": True}]},
                {"id": "2", "name": "Beta", "learnerType": "apprenticeship", "enrolmentId": "1002"},
            ],
            "marking": {"summary": {"pendingItems": 0}, "items": [{"id": "1", "learner": "Alpha", "privateDetail": "omitted"}]},
            "meetings": {"events": [{"id": "event-1", "eventKey": "mcr:1", "learnerId": "1", "source": "mcr",
                                     "status": "scheduled", "scheduledDate": "2026-09-21", "meetingLink": "https://example.invalid/join"}],
                         "summary": {"mcrRows": 1}, "reviewGenerationIssues": []}, "errors": {},
        }
        CoachDashboardSnapshot.objects.create(owner_email="coach-a@example.invalid", payload=self.payload, schema_version=19)
        CoachDashboardSnapshot.objects.create(owner_email="coach-b@example.invalid", payload={"learners": [{"id": "other-coach"}]}, schema_version=19)

    def test_postgres_and_python_projections_match_and_preserve_null_zero_missing_and_array_order(self):
        for section in ("summary", "learners", "risk", "meetings"):
            with self.subTest(section=section), self.assertNumQueries(1):
                actual = CoachDashboardSnapshot.objects.filter(owner_email="coach-a@example.invalid").annotate(
                    projected=DashboardSectionProjection("payload", section),
                ).values_list("projected", flat=True).get()
            self.assertEqual(actual, project_section(self.payload, section))
            self.assertNotIn("privateDetail", json.dumps(actual))
            self.assertLess(len(json.dumps(actual)), 10000)

    def test_empty_or_null_arrays_remain_small_valid_sections(self):
        for payload in ({}, {"learners": None, "meetings": {"events": None}, "marking": {"items": None}}):
            CoachDashboardSnapshot.objects.filter(owner_email="coach-a@example.invalid").update(payload=payload)
            result = CoachDashboardSnapshot.objects.filter(owner_email="coach-a@example.invalid").annotate(
                projected=DashboardSectionProjection("payload", "summary"),
            ).values_list("projected", flat=True).get()
            self.assertEqual(result["learners"], [])
            self.assertEqual(result["meetings"]["events"], [])
            self.assertEqual(result["marking"]["items"], [])

    @patch("coach_api.services.dashboard.profile_dates.fetch_dashboard_profile_dates", return_value=[])
    @patch("coach_api.services.dashboard.service.CoachDashboardService.refresh")
    def test_persisted_section_loader_reads_one_scoped_json_projection_without_rebuild(self, refresh, _profiles):
        with self.assertNumQueries(1):
            result = load_section("coach-a@example.invalid", "risk")
        self.assertEqual([item["id"] for item in result["learners"]], ["1", "2"])
        self.assertNotIn("privateDetail", json.dumps(result))
        refresh.assert_not_called()
