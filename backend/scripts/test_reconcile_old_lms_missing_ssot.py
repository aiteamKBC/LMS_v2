import unittest
from collections import defaultdict
from datetime import date, datetime

from reconcile_old_lms_missing_ssot import (
    family_match,
    fmt,
    kind_family,
    choose_schedule,
    ref_tokens,
    valid_period,
)


class OldLmsReconciliationTests(unittest.TestCase):
    def test_kind_families_allow_reading_quiz_migration(self):
        self.assertTrue(family_match("reading_quiz", "quiz"))
        self.assertTrue(family_match("video", "audio"))
        self.assertEqual(kind_family("reading"), {"reading", "quiz", "reading_quiz"})

    def test_ref_tokens_preserve_typed_activity_id(self):
        row = {
            "source_activity_id": "journal:8003",
            "source_payload": {"activity_id": 57637, "original_source_ref": "la:56943:57637"},
        }
        self.assertIn("57637", ref_tokens(row))
        self.assertIn("8003", ref_tokens(row))

    def test_period_and_break_are_separate_rules(self):
        period = {"start_date": date(2025, 1, 1), "end_date": date(2025, 12, 31)}
        self.assertEqual(valid_period(date(2025, 3, 3), period, {}), "VALID")
        break_row = {"break_json": {"has_break_in_learning": True, "last_learning_date": "2025-03-01", "return_to_learning_date": "2025-04-01"}}
        self.assertEqual(valid_period(date(2025, 3, 15), period, break_row), "BREAK")
        self.assertEqual(valid_period(date(2026, 1, 1), period, {}), "OUTSIDE")

    def test_format_is_stable_for_report_hours(self):
        self.assertEqual(fmt(10740), "2:59:00")

    def test_estimated_schedule_never_precedes_source_date(self):
        period = {"start_date": date(2025, 6, 1), "end_date": date(2025, 6, 30)}
        segments = choose_schedule(
            owner_id=1,
            anchor=date(2025, 6, 24),
            target_month="2025-06",
            seconds=3600,
            period=period,
            break_row={},
            occupancy=defaultdict(int),
            counts=defaultdict(int),
            weekly=defaultdict(int),
            monthly=defaultdict(int),
            lecture_days=defaultdict(set),
            fingerprint="anchor-regression",
        )
        self.assertIsNotNone(segments)
        self.assertTrue(segments)
        self.assertGreaterEqual(datetime.fromisoformat(segments[0]["start"]).date(), date(2025, 6, 24))


if __name__ == "__main__":
    unittest.main()
