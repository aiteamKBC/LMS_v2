from decimal import Decimal
import unittest

from .monthly_target_sync import (
    FALLBACK_BASIS,
    PROGRAMME_BASIS,
    build_target_rows,
    fallback_targets,
    month_key,
    programme_structure_targets,
)


class MonthlyTargetSyncTests(unittest.TestCase):
    def test_month_key_accepts_iso_and_display_months_but_rejects_undated(self):
        self.assertEqual(month_key("2026-06-01"), "2026-06")
        self.assertEqual(month_key("June 2026"), "2026-06")
        self.assertIsNone(month_key("No date"))

    def test_programme_structure_reads_only_monthly_planned_hours(self):
        result = programme_structure_targets({
            "months": [
                {"date": "2026-06-01", "hours": {"planned": 38, "completed": 51.35}},
                {"date": "2026-07-01", "hours": {"completed": 78.5}},
                {"date": "No date", "hours": {"planned": 99}},
            ],
        })
        self.assertEqual(result, {"2026-06": Decimal("38.0000")})

    def test_fallback_and_preferred_sources_are_merged_with_preference(self):
        rows, stats = build_target_rows(
            [{"learner_id": 7, "enrolment_id": 70, "aptem_id": 19694, "programme_id": "PROG-MM-L6"}],
            [{"aptem_id": 19694, "programme_structure": {
                "months": [{"date": "2026-06-01", "hours": {"planned": 40}}],
            }}],
            [{"aptem_id": 19694, "planned_hours_monthly": {
                "2026-06": 38, "2026-07": 36,
            }}],
        )
        self.assertEqual([(row["report_month"], row["target_hours"]) for row in rows], [
            ("2026-06", Decimal("40.0000")), ("2026-07", Decimal("36.0000")),
        ])
        self.assertEqual(stats["programme_structure_targets"], 1)
        self.assertEqual(stats["fallback_targets"], 1)
        self.assertEqual(rows[0]["basis"], PROGRAMME_BASIS)
        self.assertEqual(rows[1]["basis"], FALLBACK_BASIS)
        self.assertTrue(rows[0]["source_ref"].startswith("Audit.learner_match:"))
        self.assertTrue(rows[1]["source_ref"].startswith("fetching_evidence.learner_hours_monthly:"))

    def test_sources_are_not_used_for_an_ambiguous_learner(self):
        rows, stats = build_target_rows(
            [
                {"learner_id": 7, "enrolment_id": 70, "aptem_id": 19694, "programme_id": "P1"},
                {"learner_id": 8, "enrolment_id": 80, "aptem_id": 19694, "programme_id": "P2"},
            ],
            [{"aptem_id": 19694, "programme_structure": {"months": []}}],
            [],
        )
        self.assertEqual(rows, [])
        self.assertEqual(stats["ambiguous_learner"], 1)
