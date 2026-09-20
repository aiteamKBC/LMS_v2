"""Offline regression coverage. All persistence is mocked; no database is created."""
from contextlib import nullcontext
from datetime import date, datetime, time, timezone as dt_timezone
import inspect
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from django.test import RequestFactory, SimpleTestCase
from django.utils import timezone

from .absence_reports import RecoveryPlanError, _catchup_booking, _fetch_missed_sessions, learner_absence_reports
from .attendance_lectures import build_lectures, read_native_occurrences
from .tests_attendance_lectures import register_row


SOURCE = SimpleNamespace(id=12, email='learner@example.test', username='Learner')
MIRROR = SimpleNamespace(id=99, email='learner@example.test', coach_name='Coach', coach_email='coach@example.test')


def booked_event(**overrides):
    return SimpleNamespace(event_key='catch-up:99:1', learner_id=99, learner_email='learner@example.test',
        event_type='catch-up', status='not-scheduled', scheduled_date=date(2026, 10, 5),
        scheduled_time=time(11), **overrides)


class RecoveryBookingTests(SimpleTestCase):
    def setUp(self):
        self.clock = patch('learner_api.absence_reports.timezone.localtime', return_value=datetime(2026, 9, 14, 9, tzinfo=dt_timezone.utc))
        self.clock.start()
        self.addCleanup(self.clock.stop)

    def resolve(self, event, *, lock=False):
        with patch('learner_api.absence_reports.CoachCalendarEvent.objects') as manager:
            manager.filter.return_value.first.return_value = event
            manager.select_for_update.return_value.filter.return_value.first.return_value = event
            result = _catchup_booking(SOURCE, MIRROR, 'catch-up:99:1', date(2026, 10, 1), lock=lock)
            if lock:
                manager.select_for_update.assert_called_once()
            return result

    def test_saved_pending_approval_booking_is_valid_and_can_be_locked(self):
        event = booked_event()
        self.assertIs(self.resolve(event, lock=True), event)

    def test_another_learners_email_cannot_be_overridden_by_an_id_collision(self):
        event = booked_event()
        event.learner_email = 'someone-else@example.test'
        with self.assertRaises(RecoveryPlanError):
            self.resolve(event)

    def test_missing_wrong_type_cancelled_undated_and_earlier_bookings_are_rejected(self):
        for field, value in [('event_type', 'student-support'), ('status', 'cancelled'),
                             ('scheduled_date', None), ('scheduled_time', None),
                             ('scheduled_date', date(2026, 9, 15)), ('scheduled_date', date(2026, 9, 1))]:
            with self.subTest(field=field, value=value):
                event = booked_event()
                setattr(event, field, value)
                with self.assertRaises(RecoveryPlanError):
                    self.resolve(event)
        with self.assertRaises(RecoveryPlanError):
            self.resolve(None)


class RecoverySubmissionTests(SimpleTestCase):
    def request(self, **extra):
        return RequestFactory().post('/', {'sessionId': 'teams:lecture', 'sessionTitle': 'Lecture',
            'sessionDate': '2026-10-01', 'reasonCategory': 'illness', **extra})

    def test_choice_and_booking_cannot_be_bypassed_by_direct_post(self):
        for choice in ({}, {'recoveryMethod': 'unknown'}, {'recoveryMethod': 'catch-up'},
                       {'recoveryMethod': 'recorded', 'catchupEventKey': 'catch-up:99:1'}):
            with self.subTest(choice=choice), patch('learner_api.absence_reports._source_learner', return_value=SOURCE), \
                    patch('learner_api.absence_reports.CoachAbsenceReport.objects') as manager:
                response = inspect.unwrap(learner_absence_reports)(self.request(**choice), 'apprenticeship', 12)
                self.assertEqual(response.status_code, 400)
                manager.create.assert_not_called()

    def submit(self, validation):
        with patch('learner_api.absence_reports._source_learner', return_value=SOURCE), \
             patch('learner_api.absence_reports._resolve_absent_attendance', return_value=8000000000000000001), \
             patch('learner_api.absence_reports.learner_profile_for_source', return_value=MIRROR), \
             patch('learner_api.absence_reports.CoachAbsenceReport.objects') as manager, \
             patch('learner_api.absence_reports._catchup_booking', side_effect=validation) as validate, \
             patch('learner_api.absence_reports.transaction.atomic', return_value=nullcontext()), \
             patch('learner_api.absence_reports._serialize', return_value={'id': 1}):
            manager.filter.return_value.exists.return_value = False
            manager.filter.return_value.count.return_value = 0
            response = inspect.unwrap(learner_absence_reports)(self.request(recoveryMethod='catch-up', catchupEventKey='catch-up:99:1'), 'apprenticeship', 12)
            return response, manager, validate

    def test_catchup_choice_and_verified_event_key_are_saved(self):
        response, manager, validate = self.submit([booked_event(), booked_event()])
        self.assertEqual(response.status_code, 201)
        self.assertEqual(manager.create.call_args.kwargs['recovery_method'], 'catch-up')
        self.assertEqual(manager.create.call_args.kwargs['catchup_event_key'], 'catch-up:99:1')
        self.assertEqual(validate.call_count, 2)
        self.assertTrue(validate.call_args.kwargs['lock'])

    def test_cancellation_between_validation_and_save_prevents_submission(self):
        response, manager, _ = self.submit([booked_event(), RecoveryPlanError('Booking cancelled.')])
        self.assertEqual(response.status_code, 409)
        self.assertEqual(json.loads(response.content)['error'], 'Booking cancelled.')
        manager.create.assert_not_called()

    def test_in_progress_lectures_can_be_reported(self):
        with patch('learner_api.absence_reports.lecture_register', return_value=[register_row(attendance_status='in_progress')]):
            self.assertEqual(_fetch_missed_sessions(SOURCE, 12)[0]['status'], 'in_progress')

    def test_manual_schema_allows_occurrence_scoped_alternative_recovery(self):
        sql = (Path(__file__).resolve().parents[1] / 'sql' / 'attendance_absence_recovery.sql').read_text()
        self.assertIn('DROP CONSTRAINT IF EXISTS coach_absence_catchup_event_fk', sql)
        self.assertIn("recovery_method = 'alternative'", sql)
        self.assertIn("catchup_event_key LIKE 'alternative:%'", sql)


class LiveLecturePayloadTests(SimpleTestCase):
    def test_native_payload_keeps_absolute_timestamps_and_the_lecture_link(self):
        row = register_row(source='microsoft-teams', session_id='occurrence', module_catalogue_id=3,
            attendance_status='upcoming', scheduled_start=datetime(2026, 10, 1, 9, tzinfo=dt_timezone.utc),
            scheduled_end=datetime(2026, 10, 1, 10, tzinfo=dt_timezone.utc), join_url='https://teams.microsoft.com/l/meetup-join/lecture')
        result = build_lectures([row], {}, [], [], 'apprenticeship', 12)[0]
        self.assertEqual(result['startsAt'], '2026-10-01T09:00:00+00:00')
        self.assertEqual(result['endsAt'], '2026-10-01T10:00:00+00:00')
        self.assertEqual(result['joinUrl'], row['join_url'])

    def test_missing_legacy_schedule_does_not_invent_a_live_link(self):
        result = build_lectures([register_row()], {}, [], [], 'apprenticeship', 12)[0]
        self.assertIsNone(result['startsAt'])
        self.assertIsNone(result['endsAt'])
        self.assertEqual(result['joinUrl'], '')
