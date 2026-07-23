from datetime import date, datetime, timezone

from django.test import SimpleTestCase

from .attendance import _summarize_attendance


class AttendanceSummaryTests(SimpleTestCase):
    def test_summarizes_session_rows_for_the_learner_page(self):
        updated_at = datetime(2026, 7, 21, 14, 28, tzinfo=timezone.utc)
        common = {
            'learner_id': 2,
            'learner_name': 'Test Learner',
            'learner_email': 'learner@example.com',
            'catchup_completed': False,
            'updated_at': updated_at,
        }
        rows = [
            {**common, 'session_date': date(2026, 7, 15), 'attendance_status': 'absent', 'minutes_late': 0},
            {**common, 'session_date': date(2026, 7, 8), 'attendance_status': 'absent', 'minutes_late': 0, 'catchup_completed': True},
            {**common, 'session_date': date(2026, 7, 1), 'attendance_status': 'present', 'minutes_late': 12},
            {**common, 'session_date': date(2026, 6, 24), 'attendance_status': 'present', 'minutes_late': 0},
            {**common, 'session_date': date(2026, 6, 17), 'attendance_status': 'present', 'minutes_late': 0},
        ]

        summary = _summarize_attendance(rows)

        self.assertEqual(summary['sessions'], 5)
        self.assertEqual(summary['present'], 3)
        self.assertEqual(summary['absent'], 2)
        self.assertEqual(summary['late'], 1)
        self.assertEqual(summary['catchup'], 1)
        self.assertEqual(summary['attendanceRate'], 60)
        self.assertEqual(summary['risk'], 'red')
        self.assertEqual(summary['consecutiveMissed'], 2)
        self.assertEqual(summary['lastSessionDate'], '2026-07-15')
        self.assertEqual(summary['updatedAt'], '2026-07-21T14:28:00+00:00')

    def test_returns_none_without_session_rows(self):
        self.assertIsNone(_summarize_attendance([]))
