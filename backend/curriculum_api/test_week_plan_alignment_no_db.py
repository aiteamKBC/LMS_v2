"""General materials never consume a delivery week; booked anchors are required."""
import copy
import unittest
from .week_plan_alignment import week_plan_offset


class WeekPlanAlignmentTests(unittest.TestCase):
    def setUp(self):
        self.plan = [{'date': day, 'weekNumber': index + 1} for index, day in enumerate(
            ('2026-12-09', '2026-12-16', '2026-12-23', '2026-12-30', '2027-01-06'))]
        def live(day):
            return {'type': 'live_session', 'settings_json': {
                'sessionDate': day, 'teamsLiveSessionId': 'SERIES', 'teamsSessionNumber': 1}}
        self.weeks = [{'components': []}, {'components': [live('2026-12-09')]},
                      {'components': [live('2026-12-16')]}, {'components': []},
                      {'components': []}, {'components': [live('2027-01-06')]}]

    def test_confirmed_dates_align_general_materials_and_preserve_midcourse_breaks(self):
        original = copy.deepcopy(self.weeks)
        self.assertEqual(week_plan_offset(self.weeks, self.plan), 1)
        self.assertEqual(self.weeks, original)

    def test_a_real_first_week_holiday_does_not_move_the_delivery_plan(self):
        weeks = [{'components': []}, *self.weeks[1:3]]
        plan = [{'date': '2026-12-09', 'weekNumber': 2}, {'date': '2026-12-16', 'weekNumber': 3}]
        self.assertEqual(week_plan_offset(weeks, plan), 0)

    def test_missing_or_conflicting_anchors_cannot_reinterpret_authored_weeks(self):
        self.weeks[-1]['components'][0]['settings_json']['sessionDate'] = '2026-12-30'
        self.assertEqual(week_plan_offset(self.weeks, self.plan), 0)
        self.weeks[-1]['components'][0]['settings_json']['sessionDate'] = '2027-02-01'
        self.assertEqual(week_plan_offset(self.weeks, self.plan), 0)
        self.assertEqual(week_plan_offset(self.weeks[:2], self.plan), 0)

    def test_explicit_reschedules_and_additional_meetings_do_not_anchor_the_main_calendar(self):
        extra = {'type': 'live-session', 'settings': {'teamsOccurrenceId': 'OTHER', 'sessionDate': '2027-02-01', 'extraTeamsMeetingUrl': 'https://example.invalid'}}
        self.weeks[-1]['components'].append(extra)
        self.weeks[-1]['components'].append({'type': 'live-session', 'settings': {
            'teamsOccurrenceId': 'RESCHEDULED', 'sessionDate': '2027-02-02', 'sessionRescheduled': True}})
        self.assertEqual(week_plan_offset(self.weeks, self.plan), 1)
