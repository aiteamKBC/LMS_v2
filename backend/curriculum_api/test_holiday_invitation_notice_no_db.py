"""Pure notice regressions: no Django, database or external service access."""
import copy
from datetime import datetime, timezone
import unittest

from curriculum_api.holiday_invitation_notice import holiday_invitation_notice


class HolidayInvitationNoticeTests(unittest.TestCase):
    def setUp(self):
        self.plan = {'closedWeeks': [{'startDate': '2026-12-14', 'endDate': '2026-12-20',
            'holidays': [{'label': 'Winter closure', 'startDate': '2026-12-19'}]}]}

    def row(self, instant='2026-12-16T12:00:00Z', identifier='OCC-SYNTHETIC', status='scheduled'):
        return {'id': identifier, 'scheduled_start': instant, 'status': status}

    def test_uses_whole_week_not_only_the_holiday_date(self):
        result = holiday_invitation_notice([self.row()], self.plan, 'Europe/London')
        self.assertEqual(result['invitations'][0]['localDate'], '2026-12-16')
        self.assertEqual(result['invitations'][0]['holidayLabels'], ['Winter closure'])
        self.assertNotIn('teachingCancelled', result)

    def test_respects_non_monday_week_boundaries_from_the_plan(self):
        plan = {'closedWeeks': [{'startDate': '2026-12-16', 'endDate': '2026-12-22', 'holidays': []}]}
        result = holiday_invitation_notice([self.row('2026-12-22T23:00:00Z')], plan, 'Europe/London')
        self.assertEqual(result['invitationCount'], 1)
        self.assertIsNone(holiday_invitation_notice([self.row('2026-12-23T00:00:00Z')], plan, 'Europe/London'))

    def test_uses_the_saved_calendar_zone_at_a_date_boundary(self):
        self.assertIsNone(holiday_invitation_notice([self.row('2026-12-20T23:30:00Z')], self.plan, 'Africa/Cairo'))
        self.assertIsNotNone(holiday_invitation_notice([self.row('2026-12-20T23:30:00Z')], self.plan, 'Europe/London'))

    def test_dst_uses_the_actual_utc_instant(self):
        plan = {'closedWeeks': [{'startDate': '2026-10-19', 'endDate': '2026-10-25', 'holidays': []}]}
        rows = [self.row('2026-10-25T00:30:00Z', 'OCC-BST'), self.row('2026-10-25T01:30:00Z', 'OCC-GMT')]
        self.assertEqual(holiday_invitation_notice(rows, plan, 'Europe/London')['invitationCount'], 2)

    def test_never_reports_cancelled_or_removed_invitations(self):
        for status in ('cancelled', 'canceled', 'declined', 'deleted', 'removed', 'failed'):
            with self.subTest(status=status):
                self.assertIsNone(holiday_invitation_notice([self.row(status=status)], self.plan, 'Europe/London'))

    def test_removed_from_plan_does_not_mean_the_invitation_was_cancelled(self):
        result = holiday_invitation_notice([self.row(status='superseded')], self.plan, 'Europe/London')
        self.assertEqual(result['invitationCount'], 1)

    def test_new_calendars_without_overlapping_bookings_have_no_notice(self):
        self.assertIsNone(holiday_invitation_notice([], self.plan, 'Europe/London'))
        self.assertIsNone(holiday_invitation_notice([self.row('2027-01-06T12:00:00Z')], self.plan, 'Europe/London'))
        self.assertIsNone(holiday_invitation_notice([self.row()], {'closedWeeks': []}, 'Europe/London'))

    def test_duplicate_rows_are_not_counted_twice_and_order_is_stable(self):
        one, two = self.row(), self.row('2026-12-15T12:00:00Z', 'OCC-EARLIER')
        result = holiday_invitation_notice([one, two, one], self.plan, 'Europe/London')
        self.assertEqual([r['occurrenceId'] for r in result['invitations']], ['OCC-EARLIER', 'OCC-SYNTHETIC'])

    def test_unreadable_data_does_not_fabricate_a_retained_invitation(self):
        self.assertIsNone(holiday_invitation_notice([self.row('invalid')], self.plan, 'Europe/London'))
        self.assertIsNone(holiday_invitation_notice([self.row()], self.plan, 'invalid/zone'))
        self.assertIsNone(holiday_invitation_notice([self.row(identifier='')], self.plan, 'Europe/London'))

    def test_handles_database_datetime_without_mutating_inputs(self):
        row = self.row(datetime(2026, 12, 16, 12, tzinfo=timezone.utc))
        original = copy.deepcopy((row, self.plan))
        result = holiday_invitation_notice([row], self.plan, 'Europe/London')
        self.assertEqual(result['invitations'][0]['scheduledStart'], '2026-12-16T12:00:00Z')
        self.assertEqual((row, self.plan), original)
