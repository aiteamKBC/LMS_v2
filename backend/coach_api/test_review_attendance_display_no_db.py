from copy import deepcopy
from datetime import date, datetime, time, timezone as utc
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.db import DatabaseError
from django.test import SimpleTestCase

from . import review_attendance_display as display
from .migrated_session_scope import booking_fingerprint


class ReviewAttendanceDisplayTests(SimpleTestCase):
    def setUp(self):
        self.record = SimpleNamespace(pk=7, event_key='native:7', learner_id=12,
            event_type='mcr', graph_event_id='graph-7', owner_email='coach@example.test',
            graph_organizer_email='coach@example.test', learner_email='learner@example.test',
            learner_name='Synthetic learner', scheduled_date=date(2026, 11, 2),
            scheduled_time=time(14, 15), duration_minutes=60, status='in-progress')
        self.event = dict(eventKey='native:7', ownerEmail='coach@example.test', source='mcr',
            scheduledDate='2026-11-02', scheduledTime='14:15', durationMinutes=60, status='in-progress')
        self.now = datetime(2026, 11, 3, 12)

    def report(self, seconds=0, **overrides):
        return dict(id='report-1', meetingStartDateTime=datetime(2026, 11, 2, 14, 15, tzinfo=utc.utc),
            meetingEndDateTime=datetime(2026, 11, 2, 14, 25, tzinfo=utc.utc),
            records=[dict(id='person-1', reportId='report-1', email='learner@example.test',
                attended=seconds > 0, totalAttendanceSeconds=seconds)] if seconds else [], **overrides)

    def annotate(self, reports, *, events=None, links=(), previous=()):
        events = events or [self.event]
        before = deepcopy(self.record.__dict__)
        with patch.object(display, 'read_evidence', return_value=(
                {self.record.event_key: self.record}, {self.record.event_key: reports}, {self.record.pk: links})), \
                patch('coach_api.review_rescheduling.previous_bookings', return_value=list(previous)):
            display.annotate_review_attendance(events, now_local=self.now)
        self.assertEqual(self.record.__dict__, before)
        self.assertEqual(self.event['status'], 'in-progress')
        return events[0].get('reviewAttendance')

    def test_no_report_is_pending_not_missed(self):
        self.assertEqual(self.annotate([]), 'pending')

    def test_report_without_learner_is_missed(self):
        self.assertEqual(self.annotate([self.report()]), 'missed')

    def test_native_report_outside_booked_hours_matches_form(self):
        # Teams calls may occur before or after their planned slot. The Native
        # form uses saved evidence for this meeting until it is rescheduled.
        for hour in [13, 16]:
            for source in ['mcr', 'progress-review']:
                for seconds, expected in [(0, 'missed'), (600, 'attended')]:
                    with self.subTest(hour=hour, source=source, seconds=seconds):
                        report = self.report(seconds)
                        report.update(meetingStartDateTime=f'2026-11-02T{hour}:09:00Z',
                                      meetingEndDateTime=f'2026-11-02T{hour}:17:00Z')
                        self.record.event_type = source
                        self.event['source'] = source
                        self.assertEqual(self.annotate([report]), expected)

    def test_native_report_selection_keeps_all_current_meeting_evidence(self):
        early = self.report(600)
        early.update(id='early-report', meetingStartDateTime='2026-11-02T13:09:00Z',
                     meetingEndDateTime='2026-11-02T13:17:00Z')
        early['records'][0]['reportId'] = 'early-report'
        self.assertEqual(self.annotate([early, self.report()]), 'attended')

    def test_out_of_slot_imported_report_keeps_existing_selection(self):
        report = self.report(600)
        report.update(meetingStartDateTime='2026-11-02T13:09:00Z',
                      meetingEndDateTime='2026-11-02T13:17:00Z')
        for fields in [dict(reviewSource='aptem'), dict(importedReviewType='Monthly Coaching Meeting')]:
            self.assertEqual(self.annotate([report], events=[{**self.event, 'calendarEventKey': 'native:7', **fields}]), 'pending')

    def test_failed_history_read_does_not_reuse_out_of_slot_report(self):
        report = self.report(600)
        report.update(meetingStartDateTime='2026-11-02T13:09:00Z',
                      meetingEndDateTime='2026-11-02T13:17:00Z')
        with patch.object(display, 'read_evidence', return_value=(
                {self.record.event_key: self.record}, {self.record.event_key: [report]}, {})), \
                patch('coach_api.review_rescheduling.previous_bookings', side_effect=DatabaseError('unavailable')):
            display.annotate_review_attendance([self.event], now_local=self.now)
        self.assertEqual(self.event['reviewAttendance'], 'unavailable')

    def test_existing_duration_boundary_is_preserved(self):
        for seconds, expected in [(1, 'missed'), (180, 'missed'), (181, 'attended')]:
            with self.subTest(seconds=seconds):
                self.assertEqual(self.annotate([self.report(seconds)]), expected)

    def test_other_participant_does_not_confirm_learner(self):
        report = self.report(600)
        report['records'][0]['email'] = 'other@example.test'
        self.assertEqual(self.annotate([report]), 'missed')

    def test_old_report_is_not_the_replacement_booking(self):
        report = self.report(600)
        self.record.scheduled_date = date(2026, 11, 3)
        self.event['scheduledDate'] = '2026-11-03'
        self.now = datetime(2026, 11, 4, 12)
        self.assertEqual(self.annotate([report], previous=[SimpleNamespace()]), 'pending')

    def test_prior_fingerprint_is_not_reused_even_with_overlapping_times(self):
        self.assertEqual(self.annotate([self.report(600, _lms_booking_fingerprint='previous')]), 'pending')
        self.assertEqual(self.annotate([self.report(600, _lms_booking_fingerprint=booking_fingerprint(self.record))]), 'attended')

    def test_future_replacement_does_not_query_or_show_old_missed(self):
        self.event['scheduledDate'] = '2026-11-04'
        self.event['reviewAttendance'] = 'missed'
        with patch.object(display, 'read_evidence') as read:
            display.annotate_review_attendance([self.event], now_local=self.now)
        self.assertIsNone(self.event['reviewAttendance'])
        read.assert_not_called()

    def test_imported_alias_uses_verified_calendar_key(self):
        self.event.update(eventKey='imported-review:90', calendarEventKey='native:7',
                          reviewSource='aptem', importedReviewType='Progress Review (+ Skills Radar)')
        self.assertEqual(self.annotate([self.report()]), 'missed')

    def test_unlinked_import_and_psp_do_not_inherit_results(self):
        for fields in [dict(reviewSource='aptem'), dict(importedReviewType='Personal Support Plan')]:
            event = {**self.event, **fields}
            with patch.object(display, 'read_evidence') as read:
                display.annotate_review_attendance([event], now_local=self.now)
            self.assertIsNone(event.get('reviewAttendance'))
            read.assert_not_called()

    def test_stale_slot_or_wrong_owner_cannot_borrow_attendance(self):
        for fields in [dict(scheduledTime='15:00'), dict(ownerEmail='other@example.test'), dict(eventKey='native:8')]:
            with self.subTest(fields=fields):
                self.assertEqual(self.annotate([self.report(600)], events=[{**self.event, **fields}]), 'unavailable')

    def test_closed_reviews_keep_their_lifecycle(self):
        for status in ['completed', 'awaiting-signature', 'cancelled', 'not-scheduled']:
            event = {**self.event, 'status': status}
            with patch.object(display, 'read_evidence') as read:
                display.annotate_review_attendance([event], now_local=self.now)
            self.assertIsNone(event['reviewAttendance'])
            self.assertEqual(event['status'], status)
            read.assert_not_called()

    def test_read_failure_is_unavailable_and_never_absence(self):
        with patch.object(display, 'read_evidence', side_effect=DatabaseError('unavailable')):
            display.annotate_review_attendance([self.event], now_local=self.now)
        self.assertEqual(self.event['reviewAttendance'], 'unavailable')

    def test_malformed_report_and_missing_identity_are_unavailable(self):
        self.assertEqual(self.annotate([{'invalid': True}]), 'unavailable')
        self.record.learner_email = ''
        self.assertEqual(self.annotate([self.report()]), 'unavailable')

    def test_existing_coach_link_is_respected_but_other_learner_link_is_not(self):
        from .views import build_coach_meeting_attendance_tracker
        from .test_review_attendance_links import link_for
        report = self.report(600)
        report['records'][0]['email'] = 'guest@example.test'
        tracker = build_coach_meeting_attendance_tracker([
            dict(id='learner', role='learner', email=self.record.learner_email,
                 displayName=self.record.learner_name, required=True),
        ], report['records'], has_report=True)
        link = link_for(self.record, {'reports': [report], **tracker})
        self.assertEqual(self.annotate([report], links=[link]), 'attended')
        link.learner_id = 999
        self.assertEqual(self.annotate([report], links=[link]), 'missed')

    def test_batch_reader_keeps_provider_identity_and_saved_link_time_format(self):
        report = self.report(600)
        database = MagicMock()
        cursor = database.cursor.return_value.__enter__.return_value
        cursor.fetchall.return_value = [
            ('native:7', provider, 'report-1', report['meetingStartDateTime'], report['meetingEndDateTime'], report)
            for provider in ['previous-graph', 'graph-7']
        ]
        with patch.object(display.CoachCalendarEvent.objects, 'using') as records, \
                patch.object(display.ReviewAttendanceLink.objects, 'using') as links, \
                patch.object(display, 'connections', {'default': database}), \
                patch.object(display.router, 'db_for_read', return_value='default'):
            records.return_value.filter.return_value = [self.record]
            links.return_value.filter.return_value = []
            _, reports, _ = display.read_evidence(['native:7'])
        self.assertEqual(len(reports['native:7']), 1)
        self.assertEqual(reports['native:7'][0]['meetingStartDateTime'], '2026-11-02T14:15:00+00:00')
        self.assertEqual(reports['native:7'][0]['_lms_graph_event_id'], 'graph-7')
        sql, params = cursor.execute.call_args.args
        self.assertTrue(sql.startswith('SELECT'))
        self.assertEqual(params, [['native:7']])
        links.return_value.filter.assert_called_once_with(calendar_event_id__in=[7], target_role='learner', revoked_at__isnull=True)
