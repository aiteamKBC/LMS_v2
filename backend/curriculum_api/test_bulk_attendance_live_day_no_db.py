"""Direct stdlib checks for manual live-session attendance creation.

Run with: ``python backend/curriculum_api/test_bulk_attendance_live_day_no_db.py``.
No Django setup, database, network, or Teams API is used.
"""
import ast
from datetime import date, datetime, timezone
from pathlib import Path
from types import SimpleNamespace
import re
import unittest


ROOT = Path(__file__).parent
SOURCE = ROOT / "bulk_attendance_live_day.py"


def load_members(names, namespace):
    tree = ast.parse(SOURCE.read_text(encoding="utf-8-sig"))
    nodes = [
        node for node in tree.body
        if isinstance(node, (ast.FunctionDef, ast.ClassDef)) and node.name in names
    ]
    assert len(nodes) == len(names)
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(SOURCE), "exec"), namespace)


class LiveAttendanceDayTests(unittest.TestCase):
    def setUp(self):
        self.ns = {
            "date": date,
            "re": re,
            "MAX_LEARNERS": 1000,
            "LIVE_STATUSES": {"present", "absent"},
        }
        load_members(
            {
                "LiveAttendanceTargetError",
                "parse_live_attendance_request",
                "matching_occurrence",
                "register_rows",
            },
            self.ns,
        )

    def test_validates_only_kbc_ids_module_date_and_status_from_the_browser(self):
        payload = self.ns["parse_live_attendance_request"]({
            "learnerIds": ["42", "42", "43"],
            "moduleCatalogueId": "module-1",
            "date": "2026-10-17",
            "attendance": "present",
            "learnerProfileId": 999,
            "occurrenceId": "client-controlled",
        })
        self.assertEqual(payload, {
            "learner_ids": ["42", "43"],
            "module_catalogue_id": "module-1",
            "session_date": date(2026, 10, 17),
            "attendance": "present",
        })
        with self.assertRaises(ValueError):
            self.ns["parse_live_attendance_request"]({
                "learnerIds": ["not-a-kbc-id"], "moduleCatalogueId": "module-1",
                "date": "2026-10-17", "attendance": "present",
            })

    def test_only_one_non_cancelled_occurrence_can_receive_manual_attendance(self):
        occurrence = self.ns["matching_occurrence"](
            [
                {"id": "old", "status": "cancelled", "scheduled_start": datetime(2026, 10, 17, tzinfo=timezone.utc)},
                {"id": "live", "status": "scheduled", "scheduled_start": datetime(2026, 10, 17, 9, tzinfo=timezone.utc)},
            ],
            date(2026, 10, 17),
            lambda value: value.date(),
        )
        self.assertEqual(occurrence["id"], "live")
        with self.assertRaises(self.ns["LiveAttendanceTargetError"]):
            self.ns["matching_occurrence"]([], date(2026, 10, 17), lambda value: value.date())

    def test_manual_status_preserves_existing_teams_evidence(self):
        profile = SimpleNamespace(id=12, email="learner@example.invalid", full_name="Learner Example")
        rows = self.ns["register_rows"](
            {"id": "occ-1"}, {"id": "series-1", "module_catalogue_id": "module-1"},
            [profile], "absent", {
                12: {
                    "recovery_status": "requested", "attended_seconds": 1800,
                    "attendance_report_id": "report-1", "first_join_at": "first", "last_leave_at": "last",
                }
            }, "now",
        )
        self.assertEqual(rows[0], {
            "occurrence_id": "occ-1", "live_session_id": "series-1", "module_catalogue_id": "module-1",
            "learner_profile_id": 12, "learner_email": "learner@example.invalid", "learner_name": "Learner Example",
            "attendance_status": "absent", "recovery_status": "requested", "attended_seconds": 1800,
            "attendance_report_id": "report-1", "first_join_at": "first", "last_leave_at": "last", "calculated_at": "now",
        })

    def test_endpoint_source_targets_only_the_normalized_live_register(self):
        source = SOURCE.read_text(encoding="utf-8-sig").lower()
        self.assertIn("upsert_live_session_register", source)
        self.assertIn("live_session_learner_attendance", source)
        self.assertNotIn("kbc_attendance", source)
        self.assertNotIn("public.kbc_users_data", source)


if __name__ == "__main__":
    unittest.main(verbosity=2)
