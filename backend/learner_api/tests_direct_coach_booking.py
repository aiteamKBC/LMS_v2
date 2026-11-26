"""Direct coach bookings: real views, synthetic storage and Microsoft transport."""
import inspect
import json
from datetime import date, time
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.test import RequestFactory, SimpleTestCase

from . import calendar, coach_availability
from coach_api.models import CoachCalendarEvent


class DirectCoachBookingTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.learner = SimpleNamespace(pk=101, username='Synthetic learner', email='learner@example.invalid',
                                       coach_email='current@example.invalid', coach_name='Current coach')
        self.profile = SimpleNamespace(id=248, full_name='Synthetic learner', email=self.learner.email,
                                       coach_email='old@example.invalid', coach_name='Old coach')
        model = Mock()
        model.all_learners.filter.return_value.first.return_value = self.learner
        self.enterContext(patch.object(calendar, 'SOURCE_MODELS', {'commercial': model, 'apprenticeship': model}))
        self.enterContext(patch.object(calendar, '_calendar_profile', return_value=self.profile))
        self.enterContext(patch.object(calendar, 'source_for_learner', return_value=SimpleNamespace(kind='curriculum')))
        self.enterContext(patch('learner_api.booking_calendar.timezone.localdate', return_value=date(2026, 11, 1)))
        self.events = self.enterContext(patch.object(CoachCalendarEvent.objects, 'filter'))
        self.events.return_value.first.return_value = None
        self.free = self.enterContext(patch.object(coach_availability, 'coach_session_slot_is_free', return_value=True))
        self.personal = self.enterContext(patch('learner_api.calendar_connections.booking_conflicts', return_value=False))
        self.record = CoachCalendarEvent(pk=1, event_key='student-support:248:1', learner_id=248,
            event_type='student-support', owner_email=self.learner.coach_email,
            scheduled_date=date(2026, 11, 4), scheduled_time=time(11), duration_minutes=60,
            status='scheduled', meeting_link='https://teams.microsoft.com/meet/synthetic', graph_event_id='original-event')
        self.reserve = self.enterContext(patch('coach_api.views.reserve_coach_calendar_booking', return_value=(self.record, True)))
        self.persist = self.enterContext(patch('coach_api.views.persist_calendar_sync_reservation', side_effect=lambda record: record))
        self.sync = self.enterContext(patch('coach_api.views.synchronize_reserved_calendar_event', return_value=(self.record, '', True)))
        self.enterContext(patch('coach_api.views.build_booked_calendar_event', return_value={'source': 'student-support'}))
        self.enterContext(patch.object(calendar, '_serialize_event', side_effect=lambda row: {
            'eventKey': row.event_key, 'status': row.status, 'meetingLink': row.meeting_link,
        }))
        self.enterContext(patch.object(calendar, '_record_enrolment_review'))
        self.enterContext(patch.object(calendar, '_follow_first_session_start_date'))
        self.enterContext(patch.object(calendar, '_mark_imported_review_scheduled'))

    def book(self, session_type='student-support', kind='commercial'):
        payload = {'sessionType': session_type, 'scheduledDate': '2026-11-04', 'scheduledTime': '11:00',
                   'durationMinutes': 60, 'notes': 'Synthetic support', 'timezoneOffsetMinutes': 0}
        request = self.factory.post('/book/', json.dumps(payload), content_type='application/json', HTTP_IDEMPOTENCY_KEY='synthetic-request')
        return inspect.unwrap(calendar.learner_calendar_book)(request, kind, 101)

    def move(self):
        self.enterContext(patch.object(calendar, '_learner_booking_record', return_value=self.record))
        request = self.factory.post('/reschedule/', json.dumps({'eventKey': self.record.event_key,
            'scheduledDate': '2026-11-04', 'scheduledTime': '12:00', 'durationMinutes': 60}), content_type='application/json')
        return inspect.unwrap(calendar.learner_calendar_reschedule)(request, 'commercial', 101)

    def test_all_former_approval_types_book_and_sync_for_both_learner_types(self):
        for kind in ('commercial', 'apprenticeship'):
            for session_type in ('student-support', 'gateway', 'other'):
                with self.subTest(kind=kind, session_type=session_type):
                    response = self.book(session_type, kind)
                    self.assertEqual(response.status_code, 201)
                    body = json.loads(response.content)
                    self.assertEqual(body['event']['status'], 'scheduled')
                    self.assertNotIn('approvalRequired', body)
                    self.assertEqual(self.reserve.call_args.kwargs['initial_status'], 'scheduled')
                    self.assertEqual(self.reserve.call_args.kwargs['owner_email'], 'current@example.invalid')
                    self.assertEqual(self.free.call_args.args[0], 'current@example.invalid')
                    self.sync.assert_called_with(self.record.pk, {'source': 'student-support'})

    def test_busy_slot_is_refused_before_reservation_or_invitation(self):
        self.free.return_value = False
        self.assertEqual(self.book().status_code, 409)
        self.reserve.assert_not_called()
        self.sync.assert_not_called()

    def test_unreadable_calendar_is_not_treated_as_available(self):
        self.free.side_effect = coach_availability.AvailabilityUnavailable('Could not check the coach calendar.')
        self.assertEqual(self.book().status_code, 503)
        self.reserve.assert_not_called()
        self.sync.assert_not_called()

    def test_personal_calendar_conflict_still_blocks_direct_bookings(self):
        self.personal.return_value = True
        self.assertEqual(self.book().status_code, 409)
        self.reserve.assert_not_called()
        self.assertEqual(self.personal.call_args.kwargs['business_time_zone'], 'Europe/London')

    def test_old_request_replay_rechecks_both_calendars_before_confirmation(self):
        self.record.status = 'not-scheduled'
        self.events.return_value.first.return_value = self.record
        self.personal.return_value = True
        with patch('coach_api.views.booking_request_matches_record', return_value=True):
            self.assertEqual(self.book().status_code, 409)
        self.free.assert_called_once()
        self.assertEqual(self.record.status, 'not-scheduled')
        self.persist.assert_not_called()
        self.sync.assert_not_called()

    def test_replay_reuses_the_confirmed_booking_without_rechecking_its_own_outlook_slot(self):
        self.events.return_value.first.return_value = self.record
        with patch('coach_api.views.booking_request_matches_record', return_value=True):
            self.assertEqual(self.book().status_code, 200)
        self.free.assert_not_called()
        self.reserve.assert_not_called()
        self.sync.assert_called_once_with(1, {'source': 'student-support'})

    def test_previous_request_is_confirmed_in_place_after_checking_availability(self):
        self.record.status = 'not-scheduled'
        response = self.move()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.record.status, 'scheduled')
        self.assertEqual(self.record.event_key, 'student-support:248:1')
        self.assertEqual(self.record.graph_event_id, 'original-event')
        self.free.assert_called_once_with('current@example.invalid', date(2026, 11, 4), time(12), 60, record=self.record)
        self.reserve.assert_not_called()
        self.persist.assert_called_once_with(self.record)
        self.sync.assert_called_once()

    def test_reschedule_rechecks_availability_and_preserves_the_existing_booking_when_busy(self):
        self.free.return_value = False
        self.assertEqual(self.move().status_code, 409)
        self.assertEqual(self.record.scheduled_time, time(11))
        self.assertEqual(self.record.graph_event_id, 'original-event')
        self.persist.assert_not_called()
        self.sync.assert_not_called()

    def test_completed_sessions_cannot_be_rescheduled(self):
        self.record.status = 'completed'
        self.assertEqual(self.move().status_code, 409)
        self.free.assert_not_called()
        self.sync.assert_not_called()


class DirectCoachAvailabilityTests(SimpleTestCase):
    def test_slot_check_uses_london_time_and_excludes_only_the_existing_booking(self):
        record = SimpleNamespace(pk=9, event_key='support:9')
        with patch.object(coach_availability, 'free_slots', return_value=['11:00']) as slots:
            self.assertTrue(coach_availability.coach_session_slot_is_free(
                'coach@example.invalid', date(2026, 7, 1), time(11), 45, record=record))
        slots.assert_called_once_with('coach@example.invalid', date(2026, 7, 1), -60, duration=45,
            exclude_event_key='support:9', exclude_record_id=9, review_self_record=record)

    def test_availability_checks_current_assignment_instead_of_a_stale_mirror(self):
        source = Mock()
        source.all_learners.filter.return_value.first.return_value = SimpleNamespace(coach_email='current@example.invalid')
        profile = SimpleNamespace(coach_email='old@example.invalid')
        request = RequestFactory().get('/availability/', {'date': '2026-07-01', 'purpose': 'coach-session', 'timezoneOffsetMinutes': -180})
        with patch('learner_api.learner_detail.SOURCE_MODELS', {'commercial': source}), \
                patch('learner_api.identity.learner_profile_for_source', return_value=profile), \
                patch.object(coach_availability, 'free_slots', return_value=['11:00']) as slots:
            response = inspect.unwrap(coach_availability.coach_available_slots)(request, 'commercial', 101)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(slots.call_args.args, ('current@example.invalid', date(2026, 7, 1), -60))

    def test_excluding_another_learners_booking_is_refused(self):
        source = Mock()
        source.all_learners.filter.return_value.first.return_value = SimpleNamespace()
        request = RequestFactory().get('/availability/', {'date': '2026-11-04', 'purpose': 'coach-session', 'excludeEventKey': 'other:9'})
        with patch('learner_api.learner_detail.SOURCE_MODELS', {'commercial': source}), \
                patch('learner_api.identity.learner_profile_for_source', return_value=SimpleNamespace(coach_email='coach@example.invalid')), \
                patch.object(calendar, '_learner_booking_record', return_value=None), \
                patch.object(coach_availability, 'free_slots') as slots:
            self.assertEqual(inspect.unwrap(coach_availability.coach_available_slots)(request, 'commercial', 101).status_code, 409)
        slots.assert_not_called()

    def test_direct_availability_preserves_existing_custom_booking_durations(self):
        source = Mock()
        source.all_learners.filter.return_value.first.return_value = SimpleNamespace()
        with patch('learner_api.learner_detail.SOURCE_MODELS', {'commercial': source}), \
                patch('learner_api.identity.learner_profile_for_source', return_value=SimpleNamespace(coach_email='coach@example.invalid')), \
                patch.object(coach_availability, 'free_slots', return_value=['11:00']) as slots:
            for duration in (15, 75, 180, 480):
                with self.subTest(duration=duration):
                    request = RequestFactory().get('/availability/', {'date': '2026-11-04', 'purpose': 'coach-session', 'durationMinutes': duration})
                    self.assertEqual(inspect.unwrap(coach_availability.coach_available_slots)(request, 'commercial', 101).status_code, 200)
                    self.assertEqual(slots.call_args.kwargs['duration'], duration)

    def test_existing_booking_keeps_its_original_coach_when_rescheduled_after_reassignment(self):
        source = Mock()
        source.all_learners.filter.return_value.first.return_value = SimpleNamespace(coach_email='new@example.invalid')
        record = SimpleNamespace(event_type='student-support', status='scheduled', owner_email='original@example.invalid')
        request = RequestFactory().get('/availability/', {'date': '2026-11-04', 'purpose': 'coach-session', 'excludeEventKey': 'support:9'})
        with patch('learner_api.learner_detail.SOURCE_MODELS', {'commercial': source}), \
                patch('learner_api.identity.learner_profile_for_source', return_value=SimpleNamespace(coach_email='old@example.invalid')), \
                patch.object(calendar, '_learner_booking_record', return_value=record), \
                patch.object(coach_availability, 'free_slots', return_value=['11:00']) as slots:
            self.assertEqual(inspect.unwrap(coach_availability.coach_available_slots)(request, 'commercial', 101).status_code, 200)
        self.assertEqual(slots.call_args.args[0], 'original@example.invalid')
        self.assertIs(slots.call_args.kwargs['review_self_record'], record)

    def test_direct_session_honours_outlook_hours_and_busy_intervals(self):
        schedule = {'scheduleId': 'coach@example.invalid', 'availabilityView': '0' * 40 + '2' * 4 + '0' * 52,
                    'workingHours': {'timeZone': {'name': 'GMT Standard Time'}, 'startTime': '10:00',
                                     'endTime': '12:00', 'daysOfWeek': ['wednesday']}}
        manager = Mock()
        manager.filter.return_value.exclude.return_value = ()
        with patch('coach_api.views.microsoft_graph_request', return_value={'value': [schedule]}) as graph, \
                patch('coach_api.models.CoachCalendarEvent.objects', manager), \
                patch('learner_api.booking_calendar.booking_date_restriction', return_value=None):
            self.assertEqual(coach_availability.free_slots('coach@example.invalid', date(2030, 11, 6), 0, duration=60), ['11:00'])
        self.assertEqual(graph.call_args.args[0], 'POST')
        self.assertTrue(graph.call_args.args[1].endswith('/calendar/getSchedule'))
        self.assertEqual(graph.call_args.kwargs['payload']['schedules'], ['coach@example.invalid'])
