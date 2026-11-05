from copy import deepcopy
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase

from .weekly_live_attendance import (add_live_activity_hours, credit_in_week,
                                     read_weekly_live_evidence, week_live_session)

NOW = datetime(2026, 10, 19, tzinfo=timezone.utc)
WEEK = {'kind': 'live-session', 'moduleId': 'M1', 'startDate': '2026-10-12', 'endDate': '2026-10-18'}


def lecture(**over):
    start = datetime(2026, 10, 14, 8, tzinfo=timezone.utc)
    return {'source': 'microsoft-teams', 'module_catalogue_id': 'M1', 'session_id': 'O1:M1',
            'occurrence_id': 'O1:M1', 'attendance_source_occurrence_id': 'O1',
            'scheduled_start': start, 'scheduled_end': start+timedelta(hours=2),
            'session_date': start.date(), 'attendance_status': 'present',
            'join_url': 'https://example.test/shared', **over}


class WeeklyLiveAttendanceTests(SimpleTestCase):
    def test_manual_only_session_hours_keep_their_week_without_provider_attendance(self):
        credit = {'moduleId': 'M1', 'componentId': 'C1', 'occurrenceId': '', 'hours': 2.5,
                  'sessionDate': '2026-10-14', 'timeTrackingSource': 'manual_attendance'}
        with patch('learner_api.attendance_lectures.lecture_register', return_value=[]), \
             patch('learner_api.live_session_progress.read_live_credits', return_value=[credit]) as read:
            rows, credits = read_weekly_live_evidence(SimpleNamespace(pk=7), {'id': 70}, ['M1'], ['M1'])
        self.assertEqual(rows, [])
        self.assertEqual(credits, [credit])
        self.assertTrue(credit_in_week(credits[0], WEEK))
        read.assert_called_once()
        hours = add_live_activity_hours({'M1': {'components': {}, 'quizzes': {}}}, [], credits)
        self.assertEqual(hours['M1']['components']['C1'], 2.5)

    def test_reader_reuses_learner_register_with_assigned_scope_and_source_identity(self):
        source = SimpleNamespace(pk=7)
        credit = {'moduleId': 'M1', 'componentId': 'C1', 'occurrenceId': 'O1', 'hours': 2}
        with patch('learner_api.attendance_lectures.lecture_register',
                   return_value=[lecture(), lecture(module_catalogue_id='OTHER')]) as register, \
             patch('learner_api.live_session_progress.read_live_credits', return_value=[credit]) as read:
            rows, credits = read_weekly_live_evidence(source, {'id': 70}, ['M1'], ['M1'])
        register.assert_called_once_with(source, module_ids=['M1'], learner_profile_id=70)
        read.assert_called_once_with(source, module_ids=['M1'], register=rows)
        self.assertEqual(len(rows), 1)
        self.assertEqual(credits[0]['sessionDate'], '2026-10-14')

    def test_credit_stays_in_occurrence_week_even_when_authored_week_is_reused(self):
        credit = {'moduleId': 'M1', 'sessionDate': '2026-10-14'}
        self.assertTrue(credit_in_week(credit, WEEK))
        self.assertFalse(credit_in_week(credit, {**WEEK, 'startDate': '2026-10-19', 'endDate': '2026-10-25'}))
        self.assertFalse(credit_in_week(credit, {**WEEK, 'moduleId': 'OTHER'}))
        self.assertFalse(credit_in_week(credit, {**WEEK, 'kind': 'reading-week'}))

    def test_session_uses_canonical_status_and_british_time_not_raw_email_presence(self):
        original = lecture(effective_attendance_status='absent', effective_attendance=0)
        before = deepcopy(original)
        session = week_live_session([original], WEEK, NOW)
        self.assertEqual((session['id'], session['sessionState'], session['attended']), ('O1:M1', 'missed', False))
        self.assertEqual((session['date'], session['startTime'], session['endTime']), ('2026-10-14', '09:00', '11:00'))
        self.assertEqual(session['joinUrl'], original['join_url'])
        self.assertEqual(original, before)

    def test_no_report_future_and_cancelled_are_not_present(self):
        self.assertEqual(week_live_session([lecture(attendance_status='pending')], WEEK, NOW)['sessionState'], 'unmarked')
        future = week_live_session([lecture()], WEEK, datetime(2026, 10, 13, tzinfo=timezone.utc))
        self.assertEqual(future['sessionState'], 'upcoming')
        self.assertIsNone(future['attended'])
        for row in [lecture(status='cancelled'), lecture(module_catalogue_id='OTHER'),
                    lecture(scheduled_start=NOW+timedelta(days=1))]:
            self.assertIsNone(week_live_session([row], WEEK, NOW))
        self.assertIsNone(week_live_session([lecture()], {**WEEK, 'kind': 'reading-week'}, NOW))

    def test_full_hours_top_up_manual_credit_once_and_preserve_staff_zero(self):
        credit = {'moduleId': 'M1', 'componentId': 'C1', 'hours': 2}
        for previous, basis, expected in [(0, None, 2), (.5, None, 2), (2, None, 2),
                                          (3, None, 3), (0, 'staff:module-progress', 0)]:
            with self.subTest(previous=previous, basis=basis):
                hours = {'M1': {'components': {'C1': previous, 'READING': 3}, 'quizzes': {'9': 1}}}
                records = [{'component_ref': 'C1', 'actual_seconds': previous*3600,
                            'actual_basis': basis, 'accepted': True}]
                result = add_live_activity_hours(hours, records, [credit, credit])
                self.assertEqual(result['M1']['components']['C1'], expected)
                self.assertEqual(result['M1']['components']['READING'], 3)
                self.assertEqual(result['M1']['quizzes'], {'9': 1})
                self.assertEqual(hours['M1']['components']['C1'], previous)
