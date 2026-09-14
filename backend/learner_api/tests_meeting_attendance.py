"""Same-day meeting credit and source isolation without database writes."""
from contextlib import nullcontext
from datetime import date
from inspect import unwrap
import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import RequestFactory, SimpleTestCase

from . import meeting_attendance as meetings
from . import attendance_confirmation as ledger
from .monthly_log_sources import _meetings, _attendance


class MeetingAttendanceTests(SimpleTestCase):
    def setUp(self):
        self.source = SimpleNamespace(pk=12, id=12, email='learner@example.test', aptem_id='')
        self.meeting = {'id': 'mcr:55:1:2026-09-14', 'eventKey': 'mcr:55:1:2026-09-14',
            'source': 'mcr', 'status': 'scheduled', 'scheduledDate': '2026-09-14',
            'scheduledTime': '10:00', 'durationMinutes': 90, 'title': 'Monthly Coaching', 'coachName': 'Assigned coach'}
        self.records = patch.object(meetings, 'meeting_records', return_value=[self.meeting]).start()
        patch.object(meetings.timezone, 'localdate', return_value=date(2026, 9, 14)).start()
        patch.object(meetings, '_source', return_value=self.source).start()
        self.reports = patch('coach_api.models.CoachAbsenceReport').start()
        self.reports.objects.filter.return_value.exists.return_value = False
        self.addCleanup(patch.stopall)

    def resolve(self, id=None):
        return meetings.resolve_confirmation(self.source, 'apprenticeship', id or self.meeting['id'])

    def test_resolves_exact_owned_meeting_and_real_duration(self):
        resolved = self.resolve()
        self.assertEqual(resolved['durationMinutes'], 90)
        self.assertEqual(resolved['monthlyLog']['sourceRef'], f"meeting:{self.meeting['id']}")
        self.assertEqual(resolved['componentType'], 'mcr')
        self.assertEqual(resolved['category'], 'Meeting')
        with self.assertRaises(ValueError):
            self.resolve('someone-elses-meeting')
        self.records.return_value = [self.meeting, self.meeting]
        with self.assertRaises(ValueError):
            self.resolve()

    def test_rejects_unscheduled_cancelled_completed_and_submitted_meetings(self):
        for status in ['not-scheduled', 'cancelled', 'completed', 'awaiting-signature', 'unknown']:
            with self.subTest(status=status), self.assertRaises(ValueError):
                self.meeting['status'] = status
                self.resolve()

    def test_rejects_missing_time_and_unknown_or_invalid_duration(self):
        self.meeting['scheduledTime'] = None
        with self.assertRaises(ValueError):
            self.resolve()
        self.meeting['scheduledTime'] = '10:00'
        for minutes in [None, 0, -1, float('nan'), float('inf')]:
            with self.subTest(minutes=minutes), self.assertRaises(ValueError):
                self.meeting['durationMinutes'] = minutes
                self.resolve()

    def test_rejects_dates_outside_today(self):
        for day in ['2026-09-13', '2026-09-15']:
            self.meeting['scheduledDate'] = day
            with self.assertRaises(ValueError):
                self.resolve()

    def test_reported_absence_cannot_be_credited(self):
        self.reports.objects.filter.return_value.exists.return_value = True
        with self.assertRaisesRegex(ValueError, 'absence'):
            self.resolve()

    def test_cancelled_imported_booking_is_not_attendable(self):
        self.meeting['bookingStatus'] = 'cancelled'
        with self.assertRaises(ValueError):
            self.resolve()

    def test_server_ignores_client_hours_and_rechecks_after_lock(self):
        request = RequestFactory().post('/', json.dumps({'meetingId': self.meeting['id'], 'durationMinutes': 10000}), content_type='application/json')
        with patch.object(meetings, 'save_confirmation', return_value={'creditedMinutes': 90}) as save:
            response = unwrap(meetings.confirm_meeting_attendance)(request, 'apprenticeship', 12)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(save.call_args.args[1]['durationMinutes'], 90)
        self.meeting['status'] = 'cancelled'
        with self.assertRaises(ValueError):
            save.call_args.kwargs['validate']()

    def test_same_meeting_keeps_ledger_identity_after_rescheduling(self):
        before = self.resolve()['id']
        absence_before = meetings.report_key(self.source, self.meeting)
        self.meeting['scheduledTime'] = '14:00'
        self.assertEqual(self.resolve()['id'], before)
        self.assertNotEqual(meetings.report_key(self.source, self.meeting), absence_before)

    def test_meeting_absence_uses_normal_coach_review_without_lecture_recovery_choices(self):
        from . import absence_reports as absence
        request = RequestFactory().post('/', {'sessionId': meetings.report_key(self.source, self.meeting),
            'sessionTitle': self.meeting['title'], 'sessionDate': '2026-09-14', 'reasonCategory': 'illness', 'recoveryMethod': ''})
        with patch.object(absence, '_source_learner', return_value=self.source), \
            patch.object(absence, '_resolve_absent_attendance', return_value=8000000000000000012), \
            patch.object(absence, 'learner_profile_for_source', return_value=SimpleNamespace(coach_name='Coach', coach_email='coach@example.test')), \
            patch.object(absence, 'CoachAbsenceReport') as model, patch.object(absence.transaction, 'atomic', return_value=nullcontext()), \
            patch.object(absence, '_serialize', return_value={'id': 1}):
            model.objects.filter.return_value.exists.return_value = False
            model.objects.filter.return_value.count.return_value = 0
            response = unwrap(absence.learner_absence_reports)(request, 'apprenticeship', 12)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(model.objects.create.call_args.kwargs['recovery_method'], '')
        self.assertIsNone(model.objects.create.call_args.kwargs['catchup_event_key'])

    def test_context_reflects_confirmation_without_changing_review_workflow(self):
        saved = {meetings.ledger_id(self.source, self.meeting): {'seconds': 5400}}
        context = meetings.attendance_context(self.source, self.meeting, saved, set())
        self.assertTrue(context['attendanceConfirmed'])
        self.assertEqual(context['creditedMinutes'], 90)
        self.assertFalse(context['canAttend'])
        self.assertFalse(context['canReportAbsence'])
        self.assertEqual(self.meeting['status'], 'scheduled')

    def test_absence_identity_is_scoped_to_learner_and_resolves_existing_form(self):
        from .attendance_lectures import session_key, report_id
        from .absence_reports import _resolve_absent_attendance, _fetch_missed_sessions
        with patch.object(meetings, 'read_confirmations', return_value={}):
            rows = meetings.absence_rows(self.source, 'apprenticeship')
            sessions = _fetch_missed_sessions(self.source, 12, meetings=True, kind='apprenticeship')
            resolved = _resolve_absent_attendance(self.source, 12, session_key(rows[0]), self.meeting['title'], date(2026, 9, 14), None, kind='apprenticeship')
        self.assertEqual(resolved, report_id(rows[0]))
        context = meetings.attendance_context(self.source, self.meeting, {}, set())
        self.assertEqual(context['absenceSessionId'], sessions[0]['id'])
        other = SimpleNamespace(pk=13)
        self.assertNotEqual(meetings.report_key(self.source, self.meeting), meetings.report_key(other, self.meeting))

    def test_full_meeting_hours_are_persisted_once(self):
        profile = SimpleNamespace(id=55)
        profiles = MagicMock()
        profiles.objects.using.return_value.select_for_update.return_value.filter.return_value.only.return_value.__getitem__.return_value = [profile]
        model = MagicMock()
        entries = model.objects.using.return_value.filter.return_value
        entries.filter.return_value.first.side_effect = [None, SimpleNamespace(claimed_seconds=5400)]
        entries.aggregate.return_value = {'last': 1}
        with patch.object(ledger, 'LearnerProfile', profiles), patch.object(ledger, 'LearnerProgressEntry', model), patch.object(ledger.transaction, 'atomic', return_value=nullcontext()):
            lecture = self.resolve()
            first = ledger.save_confirmation(self.source, lecture, validate=self.resolve)
            second = ledger.save_confirmation(self.source, lecture, validate=self.resolve)
        self.assertEqual(first['creditedMinutes'], 90)
        self.assertTrue(second['alreadyRecorded'])
        entries.create.assert_called_once()
        values = entries.create.call_args.kwargs
        self.assertEqual(values['claimed_seconds'], 5400)
        self.assertEqual(json.loads(values['time_tracking_calculation'])['category'], 'Meeting')

    def test_monthly_log_replaces_later_coach_completion_and_excludes_lecture_rows(self):
        saved = {'meeting': {'seconds': 5400, 'details': json.dumps({'category': 'Meeting', 'componentType': 'progress-review',
            'sourceRef': 'meeting:review:1', 'date': '2026-09-14', 'startsAt': '2026-09-14T10:00:00+01:00', 'title': 'Review'})}}
        with patch.object(ledger, 'read_confirmations', return_value=saved), patch('learner_api.monthly_log_sources.query', return_value=[{
            'event_key': 'review:1', 'event_type': 'progress-review', 'scheduled_date': date(2026, 9, 14), 'duration_minutes': 60, 'notes': ''}]):
            rows = _meetings({'id': 12, 'email': self.source.email})
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['actual_hours'], 1.5)
        with patch.object(ledger, 'read_confirmations', return_value=saved), patch('learner_api.monthly_log_sources.query', return_value=[]):
            self.assertEqual(_attendance({'id': 12, 'email': self.source.email}), [])

    def test_imported_review_credit_survives_a_replacement_calendar_key(self):
        saved = {'meeting': {'seconds': 5400, 'details': json.dumps({'category': 'Meeting', 'componentType': 'progress-review',
            'meetingId': 'imported-review:9', 'sourceRef': 'meeting:old-booking', 'date': '2026-09-14', 'title': 'Review'})}}
        record = {'event_key': 'replacement-booking', 'idempotency_key': 'learner-book:progress-review:apprenticeship:12:2026-10:9',
            'event_type': 'progress-review', 'scheduled_date': date(2026, 10, 1), 'duration_minutes': 90, 'notes': ''}
        with patch.object(ledger, 'read_confirmations', return_value=saved), patch('learner_api.monthly_log_sources.query', return_value=[record]):
            rows = _meetings({'id': 12, 'email': self.source.email})
        self.assertEqual(len(rows), 1)
        self.assertEqual((rows[0]['source_ref'], rows[0]['actual_hours'], rows[0]['activity_date']), ('meeting:old-booking', 1.5, '2026-09-14'))

    def test_authorization_csrf_and_methods(self):
        for request, status in [(RequestFactory().get('/'), 405), (RequestFactory().post('/'), 403)]:
            self.assertEqual(meetings.confirm_meeting_attendance(request, 'apprenticeship', 12).status_code, status)
        with patch('login.permissions._auth_gate_enabled', return_value=True):
            for account, expected in [(SimpleNamespace(role='staff'), 403), (SimpleNamespace(role='learner', subject_id=99), 404), (None, 401)]:
                request = RequestFactory().post('/', '{}', content_type='application/json')
                request._dont_enforce_csrf_checks = True
                with patch('login.permissions.authenticate_request', return_value=account):
                    result = meetings.confirm_meeting_attendance(request, kind='apprenticeship', learner_id=12)
                self.assertEqual(result.status_code, expected)


class MeetingSourceTests(SimpleTestCase):
    def test_imported_meeting_uses_only_its_own_durable_booking(self):
        source = SimpleNamespace(pk=12, aptem_id='123')
        review = {'id': '9', 'type': 'Progress Review', 'name': 'Review', 'status': 'scheduled', 'plannedDate': '2026-09-14', 'plannedTime': '10:00', 'reviewerName': 'Coach'}
        booking = {'id': 'booked', 'eventKey': 'booked', 'source': 'progress-review', 'status': 'scheduled', 'scheduledDate': '2026-09-14',
            'scheduledTime': '10:00', 'durationMinutes': 75, 'meetingLink': 'https://teams.microsoft.com/meeting', 'meetingProvider': 'Teams',
            'invited': False, 'syncWarning': 'Calendar sync pending'}
        with patch.object(meetings, 'learner_profile_for_source'), patch.object(meetings, 'coaching_events_for_learner', return_value=[booking]), \
            patch.object(meetings, 'connection'), patch.object(meetings, '_learner_profile_id', return_value=55), \
            patch.object(meetings, '_review_rows', side_effect=[[], [review], [], [review]]), patch.object(meetings, '_serialize_review', side_effect=lambda row, _: row), \
            patch('coach_api.models.CoachCalendarEvent') as model:
            record = SimpleNamespace(event_key='booked', idempotency_key='learner-book:progress-review:apprenticeship:12:2026-09:9')
            model.objects.filter.return_value = [record]
            result = meetings.meeting_records(source, 'apprenticeship')
            record.idempotency_key = 'learner-book:progress-review:apprenticeship:99:2026-09:9'
            unrelated = meetings.meeting_records(source, 'apprenticeship')
        self.assertEqual(result[0]['durationMinutes'], 75)
        self.assertEqual(result[0]['meetingLink'], booking['meetingLink'])
        context = meetings.attendance_context(source, result[0], {}, set())
        self.assertEqual(context['calendarEventKey'], 'booked')
        self.assertEqual(context['syncWarning'], 'Calendar sync pending')
        self.assertFalse(context['invited'])
        self.assertIsNone(unrelated[0]['durationMinutes'])

    def test_calendar_source_is_used_when_no_imported_history_exists(self):
        source = SimpleNamespace(pk=12, aptem_id='')
        mirror = SimpleNamespace(id=55)
        calendar = [{'id': 'own', 'source': 'mcr'}, {'id': 'lecture', 'source': 'live-session'}]
        with patch.object(meetings, 'learner_profile_for_source', return_value=mirror), patch.object(meetings, 'coaching_events_for_learner', return_value=calendar) as read:
            self.assertEqual(meetings.meeting_records(source, 'apprenticeship'), [calendar[0]])
        read.assert_called_once_with(source, mirror)

    def test_imported_reviews_do_not_inherit_unrelated_same_date_bookings(self):
        source = SimpleNamespace(pk=12, aptem_id='123')
        review = {'id': '9', 'type': 'Progress Review', 'name': 'Review', 'status': 'scheduled', 'plannedDate': '2026-09-14', 'plannedTime': '10:00', 'reviewerName': 'Coach'}
        with patch.object(meetings, 'learner_profile_for_source'), patch.object(meetings, 'coaching_events_for_learner', return_value=[{
            'id': 'unrelated', 'eventKey': 'unrelated', 'source': 'progress-review', 'scheduledDate': '2026-09-14', 'scheduledTime': '10:00'}]), \
            patch.object(meetings, 'connection'), patch.object(meetings, '_learner_profile_id', return_value=55), \
            patch.object(meetings, '_review_rows', side_effect=[[], [review]]), patch.object(meetings, '_serialize_review', side_effect=lambda row, _: row), \
            patch('coach_api.models.CoachCalendarEvent') as model:
            model.objects.filter.return_value = []
            result = meetings.meeting_records(source, 'apprenticeship')
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]['id'], 'imported-review:9')
        self.assertIsNone(result[0]['durationMinutes'])
        self.assertEqual(result[0]['meetingLink'], '')
        self.assertEqual(model.objects.filter.call_args.kwargs['event_key__in'], ['unrelated'])
