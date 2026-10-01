"""Course display dates and placement; no app startup, database or network."""
import copy
import unittest

from test_canonical_learning_no_db import adapter


class RecordedCourseScheduleTests(unittest.TestCase):
    def setUp(self):
        self.schedule = adapter(lambda *args: [])['recorded_activity_schedule']

    def test_calendar_week_uses_london_date_and_retains_reporting_month(self):
        record = {'reporting_started_at': '2026-05-31T23:30:00Z',
                  'reporting_month': '2026-06', 'actual_seconds': 900, 'accepted': True}
        before = copy.deepcopy(record)
        self.assertEqual(self.schedule(record, '50'), {
            'date': '2026-06-01', 'month': '2026-06',
            'week_start': '2026-06-01', 'week_end': '2026-06-07',
            'date_source': 'consolidated_record'})
        self.assertEqual(record, before)

    def test_introduction_marker_only_applies_to_its_course(self):
        record = {'reporting_ended_at': '2026-06-15T09:00:00Z',
                  'reporting_month': '2026-06', 'accepted': False,
                  'source_payload': {'course_display_placement': {
                      'course_id': 50, 'section': 'introduction'}}}
        before = copy.deepcopy(record)
        placed = self.schedule(record, '50')
        self.assertEqual(placed['date_source'], 'introduction')
        self.assertEqual(placed['date'], '2026-06-15')
        self.assertEqual(placed['month'], '2026-06')
        self.assertEqual(self.schedule(record, '51')['date_source'], 'consolidated_record')
        self.assertEqual(record, before)

    def test_missing_dates_remain_missing(self):
        schedule = self.schedule({'reporting_month': None}, '50')
        for key in ('date', 'month', 'week_start', 'week_end'):
            self.assertIsNone(schedule[key])


if __name__ == '__main__':
    unittest.main()
