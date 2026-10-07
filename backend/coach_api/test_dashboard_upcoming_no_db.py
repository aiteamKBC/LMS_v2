"""Pure projection tests: no Django setup, database, Graph, or personal data."""
from copy import deepcopy
from datetime import date, timedelta
import json
import unittest
import re
from pathlib import Path

from coach_api.services.dashboard.upcoming import next_work_week, upcoming_meetings


class DashboardUpcomingTests(unittest.TestCase):
    def test_other_review_keeps_display_type_and_durable_routing(self):
        start, end = next_work_week(date(2026, 10, 6))
        event = {"id": "imported-review:synthetic", "eventKey": "imported-review:synthetic",
                 "source": "progress-review", "importedReviewType": "RPL and Experience",
                 "date": start.isoformat(), "learnerId": "1", "status": "scheduled"}
        row = upcoming_meetings({"meetings": {"events": [event]}}, start, end)["meetings"]["events"][0]
        self.assertEqual(row["importedReviewType"], "RPL and Experience")
        self.assertEqual(row["eventKey"], event["eventKey"])
        self.assertEqual(row["type"], "progress-review")

    def test_all_review_types_survive_import_metadata_removal_and_live_needs_no_learner_id(self):
        start, end = next_work_week(date(2026, 10, 6))
        events = [{"id": f"{source}-{identity}", "source": source, "reviewSource": "aptem",
                   "date": start.isoformat(), "learnerId": identity, "learner": "Synthetic Learner",
                   "status": "scheduled"}
                  for source in ("progress-review", "mcr", "catch-up") for identity in ("1", "2")]
        events.append({"id": "live", "source": "live-session", "date": start.isoformat(), "status": "scheduled"})
        rows = upcoming_meetings({"meetings": {"events": events}}, start, end)["meetings"]["events"]
        self.assertEqual(len(rows), 7)
        self.assertEqual({row["type"] for row in rows}, {"progress-review", "mcm", "catch-up", "live-session"})
        self.assertEqual([row["learner"]["id"] for row in rows[:-1]], ["1", "2"] * 3)
        self.assertNotIn("learner", rows[-1])
        self.assertTrue(all("reviewSource" not in row for row in rows))

    def test_production_dashboard_week_sources_have_no_fixed_calendar_dates(self):
        root = Path(__file__).resolve().parents[2]
        files = list((root / "backend/coach_api/services/dashboard").glob("*.py"))
        files += [root / "backend/coach_api/dashboard_view.py", root / "backend/coach_api/dashboard_cache.py"]
        files += list((root / "frontend/src/features/coach/dashboard").rglob("*.ts*"))
        for path in files:
            if ".test." in path.name:
                continue
            source = path.read_text(encoding="utf-8-sig")
            self.assertIsNone(re.search(r"\b20\d{2}-\d{2}-\d{2}\b|\b(?:date|datetime|Date)\(\s*20\d{2}\s*,", source), str(path))

    def test_exact_next_work_week_including_weekend_and_year_boundary(self):
        for today, monday in ((date(2026, 10, 6), date(2026, 10, 12)),
                              (date(2026, 10, 11), date(2026, 10, 12)),
                              (date(2026, 12, 31), date(2027, 1, 4))):
            self.assertEqual(next_work_week(today), (monday, monday + timedelta(days=4)))

    def test_date_precedence_boundaries_contract_and_no_mutation(self):
        base = {"id": "review", "source": "progress-review", "learnerId": "1", "learner": "Synthetic Learner",
                "date": "2026-09-01", "scheduledDate": "2026-10-12", "scheduledTime": "10:30:00",
                "durationMinutes": 60, "title": "Review", "programme": "Programme", "group": "Group",
                "status": "awaiting-signature", "eventKey": "pr:1:2", "enrolmentId": "22",
                "reviewInstanceId": "33", "reviewTemplateId": "44", "sequence": 2,
                "reviewResponses": {"private": "large"}, "email": "synthetic@example.invalid"}
        payload = {"meetings": {"events": [base,
            {**base, "id": "friday", "scheduledDate": "2026-10-16"},
            {**base, "id": "before", "scheduledDate": "2026-10-11"},
            {**base, "id": "after", "scheduledDate": "2026-10-17"},
            {**base, "id": "invalid", "scheduledDate": "bad"},
            {**base, "id": "live", "source": "live-session", "cohort": "Cohort", "meetingLink": "https://example.invalid/join"},
        ], "summary": {"internal": 1}, "reviewGenerationIssues": [{"internal": True}]}}
        before = deepcopy(payload)
        result = upcoming_meetings(payload, date(2026, 10, 12), date(2026, 10, 16))
        self.assertEqual(payload, before)
        self.assertEqual(result["meetings"]["range"], {"from": "2026-10-12", "to": "2026-10-16"})
        rows = result["meetings"]["events"]
        self.assertEqual([row["id"] for row in rows], ["review", "friday", "live"])
        self.assertEqual(rows[0]["learner"], {"id": "1", "name": "Synthetic Learner"})
        self.assertEqual(rows[0]["time"], "10:30")
        self.assertEqual(rows[0]["status"], "awaiting-signature")
        self.assertEqual(rows[0]["eventKey"], "pr:1:2")
        self.assertNotIn("learner", rows[2])
        self.assertEqual(rows[2]["cohort"], "Cohort")
        for field in ("email", "reviewResponses", "scheduledDate", "scheduledTime", "source"):
            self.assertNotIn(field, rows[0])
        self.assertEqual(set(result["meetings"]), {"range", "events"})

    def test_large_synthetic_payload_size_reduction(self):
        base = {"id": "synthetic", "source": "mcr", "learnerId": "1", "learner": "Synthetic Learner",
                "status": "scheduled", "title": "Monthly Coaching", "programme": "Programme", "group": "Group",
                "scheduledTime": "09:00", "durationMinutes": 60, "eventKey": "mcr:1:1", "enrolmentId": "2",
                "reviewResponses": {"synthetic": "x" * 1000}, "notes": "x" * 1000, "email": "synthetic@example.invalid"}
        events = [{**base, "date": (date(2026, 1, 1) + timedelta(days=i)).isoformat()} for i in range(365)]
        payload = {"meetings": {"events": events, "summary": {"internal": 365}, "reviewGenerationIssues": []}}
        result = upcoming_meetings(payload, date(2026, 10, 12), date(2026, 10, 16))
        old_size, new_size = len(json.dumps(payload).encode()), len(json.dumps(result).encode())
        self.assertEqual(len(result["meetings"]["events"]), 5)
        self.assertLess(new_size, old_size / 100)
        print(f"Synthetic payload: {old_size} -> {new_size} bytes; event keys: {len(events[0])} -> {len(result['meetings']['events'][0])}")
