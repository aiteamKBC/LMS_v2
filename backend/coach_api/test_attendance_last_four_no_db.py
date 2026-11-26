from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase

from .views import coach_last_four_attendance_rows, coach_verified_teams_attendance_rows


class CoachAttendanceLastFourProjectionTests(SimpleTestCase):
    def test_projects_only_verified_present_and_absent_occurrences(self):
        payload = {"rows": [
            {"learner_id": 42, "session_id": "occ-1", "session_date": "2026-09-16", "attendance_status": "present"},
            {"learner_id": 42, "session_id": "occ-2", "session_date": "2026-09-09", "attendance_status": "absent"},
            {"learner_id": 42, "session_id": "occ-pending", "session_date": "2026-09-23", "attendance_status": "pending"},
        ]}

        rows = coach_verified_teams_attendance_rows(payload)

        self.assertEqual(
            [(row["sessionId"], row["status"]) for row in rows],
            [("occ-1", "present"), ("occ-2", "absent")],
        )

    def test_deduplicates_the_same_learner_occurrence(self):
        row = {"learner_id": 42, "session_id": "occ-1", "session_date": "2026-09-16", "attendance_status": "present"}

        self.assertEqual(len(coach_verified_teams_attendance_rows({"rows": [row, row]})), 1)

    @patch("coach_api.views.fetch_recent_kbc_attendance_rows")
    def test_aptem_learner_uses_kbc_while_other_learner_keeps_teams(self, fetch_kbc):
        fetch_kbc.return_value = [{
            "learner_id": 42,
            "session_id": "kbc-1",
            "session_date": "2026-09-20",
            "attendance_status": "present",
        }]
        attendance_data = {"rows": [
            {"learner_id": 42, "session_id": "teams-42", "session_date": "2026-09-19", "attendance_status": "absent"},
            {"learner_id": 43, "session_id": "teams-43", "session_date": "2026-09-18", "attendance_status": "present"},
        ]}
        profiles = [
            SimpleNamespace(id=42, full_name="Aptem Learner", email="aptem@example.test"),
            SimpleNamespace(id=43, full_name="Teams Learner", email="teams@example.test"),
        ]

        rows = coach_last_four_attendance_rows(attendance_data, profiles, {42: 14010})

        self.assertEqual(
            {(row["learnerId"], row["sessionId"]) for row in rows},
            {("42", "kbc-1"), ("43", "teams-43")},
        )
        fetch_kbc.assert_called_once_with([{
            "aptem_id": 14010,
            "learner_id": 42,
            "learner_name": "Aptem Learner",
            "learner_email": "aptem@example.test",
        }], limit=4)

    @patch("coach_api.views.fetch_recent_kbc_attendance_rows", side_effect=RuntimeError("unavailable"))
    def test_kbc_failure_does_not_fall_back_to_teams_for_aptem_learner(self, _fetch_kbc):
        attendance_data = {"rows": [
            {"learner_id": 42, "session_id": "teams-42", "session_date": "2026-09-19", "attendance_status": "present"},
            {"learner_id": 43, "session_id": "teams-43", "session_date": "2026-09-18", "attendance_status": "absent"},
        ]}
        profiles = [SimpleNamespace(id=42, full_name="A", email="a@example.test")]

        rows = coach_last_four_attendance_rows(attendance_data, profiles, {42: 14010})

        self.assertEqual([(row["learnerId"], row["sessionId"]) for row in rows], [("43", "teams-43")])
