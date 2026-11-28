from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from unittest import TestCase

from learner_api.aptem_schedule import normalise_source_row, plan_mirror_update


class AptemScheduleNormalisationTests(TestCase):
    def test_complete_source_row_is_ready_and_typed(self):
        result = normalise_source_row({
            "aptem_id": 1234,
            "planned_hours": "576",
            "start_date": date(2026, 8, 26),
            "end_date": "25/08/2027",
        })

        self.assertEqual(result["status"], "READY")
        self.assertEqual(result["planned_hours"], Decimal("576.00"))
        self.assertEqual(result["start_date"], date(2026, 8, 26))
        self.assertEqual(result["end_date"], date(2027, 8, 25))

    def test_invalid_or_incomplete_source_needs_review(self):
        result = normalise_source_row({
            "aptem_id": "1234",
            "planned_hours": "not-a-number",
            "start_date": "2026-08-26",
            "end_date": None,
        })

        self.assertEqual(result["status"], "REVIEW")
        self.assertIn("invalid_planned_hours", result["errors"])
        self.assertIn("missing_end_date", result["errors"])

    def test_mirror_plan_fills_only_missing_fields(self):
        source = normalise_source_row({
            "aptem_id": "1234",
            "planned_hours": 576,
            "start_date": "2026-08-26",
            "end_date": "2027-08-25",
        })
        enrolment = SimpleNamespace(planned_hours="", start_date=None, end_date=None)
        profile = SimpleNamespace(planned_hours=None, start_date=None, end_date=None)

        result = plan_mirror_update(source, enrolment, profile)

        self.assertEqual(result["status"], "UPDATE")
        self.assertEqual(result["enrolment_fields"], {
            "planned_hours": "576.00",
            "start_date": "2026-08-26",
            "end_date": "2027-08-25",
        })
        self.assertEqual(result["profile_fields"]["start_date"], date(2026, 8, 26))

    def test_different_existing_value_is_a_conflict_without_replace(self):
        source = normalise_source_row({
            "aptem_id": "1234",
            "planned_hours": 576,
            "start_date": "2026-08-26",
            "end_date": "2027-08-25",
        })
        enrolment = SimpleNamespace(planned_hours="576.00", start_date="2026-08-27", end_date=None)
        profile = SimpleNamespace(planned_hours=Decimal("576.00"), start_date=None, end_date=None)

        result = plan_mirror_update(source, enrolment, profile)

        self.assertEqual(result["status"], "CONFLICT")
        self.assertEqual(result["enrolment_fields"], {"end_date": "2027-08-25"})
        self.assertEqual(result["profile_fields"]["end_date"], date(2027, 8, 25))
        self.assertIn({"target": "enrolment", "field": "start_date"}, result["conflicts"])
