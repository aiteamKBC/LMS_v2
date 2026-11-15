"""Synthetic custom schedules through real planners; no database or Graph calls."""
from copy import deepcopy
from datetime import date, datetime

from django.test import SimpleTestCase

from . import views


class CustomWeeklyScheduleTests(SimpleTestCase):
    def payload(self, count):
        return {
            'scheduleMode': 'custom', 'startDate': '2026-09-07', 'weeks': 4,
            'sessionsNumber': 4 * count,
            'weeklySchedule': [
                {'day': day, 'startTime': '09:00', 'endTime': '11:00'}
                for day in ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')[:count]
            ],
        }

    def test_two_three_and_seven_sessions_are_inside_each_week_with_distinct_dates(self):
        for count in (2, 3, 7):
            with self.subTest(count=count):
                weeks = views.attachment_week_structure(self.payload(count), week_count=4)
                self.assertEqual(len(weeks), 4)
                self.assertEqual([len(week['components']) for week in weeks], [count] * 4)
                dates = []
                for week_index, week in enumerate(weeks):
                    for slot_index, component in enumerate(week['components']):
                        settings = component['settings']
                        day = date.fromisoformat(settings['sessionDate'])
                        self.assertEqual(day.weekday(), slot_index)
                        self.assertEqual((day - date(2026, 9, 7)).days // 7, week_index)
                        self.assertEqual(settings['sessionTime'], '09:00')
                        self.assertEqual(settings['durationMinutes'], 120)
                        dates.append(day)
                self.assertEqual(len(set(dates)), count * 4)

    def test_mid_week_start_does_not_invent_sessions_before_the_start(self):
        payload = {**self.payload(7), 'startDate': '2026-09-09'}
        weeks = views.attachment_week_structure(payload, week_count=4)
        self.assertEqual([len(week['components']) for week in weeks], [5, 7, 7, 7])
        self.assertEqual(weeks[0]['components'][0]['settings']['sessionDate'], '2026-09-09')

    def test_the_default_once_weekly_structure_is_unchanged(self):
        payload = {**self.payload(1), 'scheduleMode': 'group'}
        weeks = views.attachment_week_structure(payload, week_count=4)
        self.assertEqual(weeks, [views.empty_authoring_week(index + 1) for index in range(4)])

    def test_custom_components_stop_at_the_explicit_end_date(self):
        payload = {**self.payload(7), 'endDate': '2026-10-02'}
        weeks = views.attachment_week_structure(payload, week_count=4)
        self.assertEqual([len(week['components']) for week in weeks], [7, 7, 7, 5])
        self.assertEqual(weeks[-1]['components'][-1]['settings']['sessionDate'], '2026-10-02')

    def test_generated_custom_components_satisfy_the_authoring_save_contract(self):
        payload = self.payload(7)
        payload.update(title='Synthetic custom module', weekStructure=views.attachment_week_structure(payload, week_count=4))
        self.assertEqual(views.validate_module_authoring_payload(payload), [])

    def test_extending_a_custom_end_date_requires_a_fresh_server_tutor_check(self):
        row = views.module_schedule_view({**self.payload(7), 'weeksNumber': 4, 'endDate': '2026-10-02'})
        self.assertTrue(views.module_schedule_assignment_changed(row, {**row, 'end_date': '2026-10-04'}))
        inherited = {**row, 'schedule_mode': 'group'}
        self.assertFalse(views.module_schedule_assignment_changed(inherited, {**inherited, 'end_date': '2026-10-04'}))

    def test_existing_reading_content_and_booked_sessions_are_preserved(self):
        stored = {'weekStructure': [{
            'id': 'WEEK-KEEP', 'components': [
                {'id': 'READING-KEEP', 'type': 'reading', 'title': 'Existing content'},
                {'id': 'LIVE-KEEP', 'type': 'live-session', 'settings': {
                    'teamsLiveSessionId': 'SERIES-KEEP', 'teamsSessionNumber': 1,
                    'sessionDate': '2026-09-07', 'sessionTime': '09:00',
                }},
            ],
        }]}
        before = deepcopy(stored)
        self.assertEqual(views.attachment_week_structure(self.payload(7), stored, week_count=4), stored['weekStructure'])
        self.assertEqual(stored, before)

    def test_custom_schedule_does_not_require_a_weekday_on_its_group(self):
        schedule = {'schedule_mode': 'custom', 'session_week_day': 'Monday, Tuesday', 'group_id': 'GROUP-1'}
        groups = {'GROUP-1': {'session_start_time': '10:00', 'session_end_time': '12:00'}}
        self.assertIsNone(views.module_delivery_day_gap(schedule, groups))
        self.assertEqual(views.tutor_delivery_schedule(schedule, groups), schedule)

    def test_seven_days_share_a_recurring_series_when_their_times_match(self):
        weeks = views.attachment_week_structure(self.payload(7), week_count=4)
        payload = {'scheduledOccurrences': [
            {'sessionNumber': index + 1, 'startDateTimeUtc': component['settings']['sessionDate'] + 'T08:00:00Z', 'durationMinutes': 120}
            for index, component in enumerate(component for week in weeks for component in week['components'])
        ]}
        anchor = datetime(2026, 9, 7, 9, 0)
        days = views.teams_recurrence_weekdays(payload, anchor)
        recurrence = views.teams_event_recurrence('weekly', anchor, 28, days)
        self.assertEqual(recurrence['pattern']['daysOfWeek'], ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'])
        self.assertEqual(recurrence['range']['numberOfOccurrences'], 28)

    def test_custom_tutor_dates_stay_within_the_authored_weeks(self):
        payload = {**self.payload(7), 'weeksNumber': 4, 'startDate': '2026-09-09'}
        row = views.module_schedule_view(payload)
        dates = views.module_session_dates(row)
        self.assertEqual(len(dates), 26)
        self.assertEqual(min(dates), date(2026, 9, 9))
        self.assertEqual(max(dates), date(2026, 10, 4))
