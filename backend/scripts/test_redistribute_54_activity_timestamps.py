from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime
import unittest

import redistribute_54_activity_timestamps as subject


class TimestampRedistributionTests(unittest.TestCase):
    def containers(self):
        return defaultdict(int), defaultdict(int), defaultdict(int), defaultdict(int), set(), {}

    def test_weekend_anchor_moves_forward_and_preserves_duration(self):
        occupancy, counts, weekly, monthly, lecture, cursor = self.containers()
        period = {"start_date": date(2026, 1, 1), "end_date": date(2026, 1, 31)}
        item = {"anchor": date(2026, 1, 3), "seconds": 5417}
        result = subject.allocate(item, period, None, occupancy, counts, weekly, monthly, lecture, cursor, "weekend")
        self.assertIsNotNone(result)
        self.assertEqual(date(2026, 1, 5), datetime.fromisoformat(result[0]["start"]).date())
        self.assertEqual(5417, sum(part["seconds"] for part in result))
        self.assertEqual(5417, int((datetime.fromisoformat(result[0]["end"]) - datetime.fromisoformat(result[0]["start"])).total_seconds()))

    def test_sequential_activities_do_not_overlap(self):
        occupancy, counts, weekly, monthly, lecture, cursor = self.containers()
        period = {"start_date": date(2026, 2, 1), "end_date": date(2026, 2, 28)}
        first = subject.allocate({"anchor": date(2026, 2, 2), "seconds": 3600}, period, None, occupancy, counts, weekly, monthly, lecture, cursor, "one")
        second = subject.allocate({"anchor": date(2026, 2, 2), "seconds": 3600}, period, None, occupancy, counts, weekly, monthly, lecture, cursor, "two")
        self.assertLessEqual(datetime.fromisoformat(first[-1]["end"]), datetime.fromisoformat(second[0]["start"]))

    def test_daily_and_monthly_caps_are_respected(self):
        occupancy, counts, weekly, monthly, lecture, cursor = self.containers()
        period = {"start_date": date(2026, 3, 1), "end_date": date(2026, 4, 30)}
        result = subject.allocate({"anchor": date(2026, 3, 2), "seconds": 46 * 3600}, period, None, occupancy, counts, weekly, monthly, lecture, cursor, "large")
        self.assertIsNotNone(result)
        by_day = defaultdict(int); by_month = defaultdict(int)
        for part in result:
            by_day[part["start"][:10]] += part["seconds"]
            by_month[part["month"]] += part["seconds"]
        self.assertTrue(all(value <= subject.DAILY for value in by_day.values()))
        self.assertTrue(all(value <= subject.MONTHLY for value in by_month.values()))

    def test_existing_segment_count_can_be_preserved_without_delete(self):
        start = datetime.fromisoformat("2026-04-01T09:15:13+01:00")
        segments = [{"start": start.isoformat(), "end": (start.replace(hour=11)).isoformat(), "month": "2026-04", "seconds": 62987}]
        # Use internally consistent seconds/end for the split assertion.
        segments[0]["end"] = (start + subject.timedelta(seconds=segments[0]["seconds"])).isoformat()
        result = subject.split_to_count(segments, 5)
        self.assertEqual(5, len(result))
        self.assertEqual(62987, sum(item["seconds"] for item in result))
        self.assertTrue(all(item["seconds"] > 0 for item in result))


if __name__ == "__main__":
    unittest.main()
