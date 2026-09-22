from datetime import date, time
from types import SimpleNamespace
from unittest.mock import patch, Mock
from django.test import SimpleTestCase
from .coach_availability import free_slots, AvailabilityUnavailable


class CoachAvailabilityTests(SimpleTestCase):
    def read(self, view='0' * 96, records=(), error=False):
        schedule = {'scheduleId': 'coach@example.com', 'availabilityView': view,
                    'workingHours': {'daysOfWeek': ['monday'], 'startTime': '09:00:00',
                                     'endTime': '12:00:00', 'timeZone': {'name': 'GMT Standard Time'}}}
        manager = Mock()
        manager.filter.return_value.exclude.return_value = records
        with patch('coach_api.views.microsoft_graph_request', return_value={'value': [] if error else [schedule]}), \
             patch('coach_api.models.CoachCalendarEvent.objects', manager), \
             patch('learner_api.booking_calendar.booking_date_restriction', return_value=None):
            return free_slots('coach@example.com', date(2030, 7, 1), -60)

    def test_slots_fit_working_hours_and_duration_in_uk_summer_time(self):
        slots = self.read()
        self.assertEqual(slots[0], '09:00')
        self.assertEqual(slots[-1], '11:00')
        self.assertEqual(len(slots), 9)

    def test_outlook_busy_intervals_block_partial_overlaps(self):
        view = list('0' * 96)
        view[40] = '2' # 10:00 UK time within this local-day query
        slots = self.read(''.join(view))
        self.assertNotIn('09:15', slots)
        self.assertNotIn('10:00', slots)
        self.assertIn('09:00', slots)
        self.assertIn('10:15', slots)

    def test_lms_booking_blocks_even_before_outlook_sync(self):
        record = SimpleNamespace(scheduled_date=date(2030, 7, 1), scheduled_time=time(10), duration_minutes=60)
        slots = self.read(records=[record])
        self.assertEqual(slots, ['09:00', '11:00'])

    def test_unavailable_or_incomplete_calendar_is_not_treated_as_free(self):
        with self.assertRaises(AvailabilityUnavailable):
            self.read(error=True)
        with self.assertRaises(AvailabilityUnavailable):
            self.read(view='0')


class CoachAvailabilityAccessTests(SimpleTestCase):
    def test_signed_in_learner_can_read_own_availability_but_not_another_learners(self):
        import json
        from django.test import RequestFactory
        from django.urls import resolve
        source = Mock()
        source.all_learners.filter.return_value.first.return_value = SimpleNamespace(id=101)
        profile = SimpleNamespace(coach_email='coach@example.com')
        with patch('login.permissions._auth_gate_enabled', return_value=True), \
             patch('login.permissions.authenticate_request', return_value=SimpleNamespace(role='learner', subject_id=101)), \
             patch('learner_api.learner_detail.SOURCE_MODELS', {'commercial': source}), \
             patch('learner_api.identity.learner_profile_for_source', return_value=profile), \
             patch('learner_api.coach_availability.free_slots', return_value=['10:00']) as slots:
            path = '/learner_api/calendar/commercial/101/coach-availability/'
            route = resolve(path)
            response = route.func(RequestFactory().get(path, {'date': '2026-09-22', 'timezoneOffsetMinutes': '-60'}), **route.kwargs)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(json.loads(response.content)['times'], ['10:00'])
            slots.assert_called_once_with('coach@example.com', date(2026, 9, 22), -60)
            slots.reset_mock()
            path = '/learner_api/calendar/commercial/102/coach-availability/'
            route = resolve(path)
            response = route.func(RequestFactory().get(path, {'date': '2026-09-22'}), **route.kwargs)
            self.assertEqual(response.status_code, 404)
            slots.assert_not_called()


class FirstSessionCollegeDayTests(SimpleTestCase):
    """The learner's own first-session picker asks for the college day.

    ``coach-availability`` serves two different pickers. The MCM one wants the
    coach's own working hours on a 15-minute grid -- a learner rearranging a
    monthly meeting around a job is well served by 10:15. The first session is
    a different thing: it is the meeting that starts the programme, it happens
    in Kent, and it is offered as a short list of the hours the college works.

    ``collegeDay`` asks for the second shape. The two must not drift, so the
    default is asserted here as well.
    """

    def call(self, params, owner=('owner@example.com', 'Mahmoud Fouda'), slots=None,
             expect_status=200):
        import json
        from django.test import RequestFactory
        from django.urls import resolve
        source = Mock()
        source.all_learners.filter.return_value.first.return_value = SimpleNamespace(id=101)
        profile = SimpleNamespace(coach_email='coach@example.com')
        path = '/learner_api/calendar/commercial/101/coach-availability/'
        free = Mock(return_value=['09:00', '09:15', '11:00', '18:00']) if slots is None else slots
        with patch('login.permissions._auth_gate_enabled', return_value=True), \
             patch('login.permissions.authenticate_request',
                   return_value=SimpleNamespace(role='learner', subject_id=101)), \
             patch('learner_api.learner_detail.SOURCE_MODELS', {'commercial': source}), \
             patch('learner_api.identity.learner_profile_for_source', return_value=profile), \
             patch('learner_api.calendar._case_owner_contact', return_value=owner), \
             patch('learner_api.coach_availability.free_slots', free):
            route = resolve(path)
            response = route.func(RequestFactory().get(path, params), **route.kwargs)
            self.last_free = free
        self.assertEqual(response.status_code, expect_status)
        return json.loads(response.content)

    BASE = {'date': '2026-09-22', 'timezoneOffsetMinutes': '-60'}

    def test_the_college_day_is_reported_hour_by_hour(self):
        body = self.call(dict(self.BASE, collegeDay='1'))
        self.assertEqual(
            [slot['time'] for slot in body['slots']],
            ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00'],
        )

    def test_a_taken_hour_is_listed_but_flagged_rather_than_hidden(self):
        # An hour missing altogether reads as the college not working then,
        # which is a different and wrong message.
        body = self.call(dict(self.BASE, collegeDay='1'))
        taken = {slot['time']: slot['available'] for slot in body['slots']}
        self.assertTrue(taken['09:00'])
        self.assertTrue(taken['11:00'])
        self.assertFalse(taken['10:00'])

    def test_bookable_times_exclude_quarter_hours_and_hours_outside_the_day(self):
        # 09:15 is free but not offered for a first session; 18:00 is free on
        # the coach's own calendar but outside the college's day entirely.
        body = self.call(dict(self.BASE, collegeDay='1'))
        self.assertEqual(body['times'], ['09:00', '11:00'])
        self.assertEqual(body['durationMinutes'], 60)

    def test_without_the_flag_the_mcm_grid_is_unchanged(self):
        # The monthly-meeting picker reads `times` and must keep seeing the
        # coach's own hours on the 15-minute grid.
        body = self.call(self.BASE)
        self.assertEqual(body['times'], ['09:00', '09:15', '11:00', '18:00'])
        self.assertNotIn('slots', body)

    def test_the_first_session_checks_the_case_owner_not_a_coach(self):
        # The booking creates the meeting on the case owner's mailbox, so the
        # slots must describe that same person's day. Checking the coach would
        # offer one diary and send the invitation to another -- and a learner
        # who has no coach yet, which is every learner at this point, would be
        # told nobody is assigned at all.
        self.call(dict(self.BASE, collegeDay='1'))
        self.last_free.assert_called_once_with('owner@example.com', date(2026, 9, 22), -60)

    def test_a_learner_with_no_case_owner_is_told_who_to_ask(self):
        body = self.call(dict(self.BASE, collegeDay='1'), owner=('', ''), expect_status=400)
        self.assertIn('case owner', body['error'])

    def test_an_unreadable_case_owner_calendar_still_offers_the_college_day(self):
        # A calendar that is not linked, or a Microsoft outage, must not lock a
        # learner out of the meeting that opens their programme.
        body = self.call(
            dict(self.BASE, collegeDay='1'),
            slots=Mock(side_effect=AvailabilityUnavailable('Could not check the coach calendar.')),
        )
        self.assertEqual(
            body['times'],
            ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00'],
        )
        # Flagged, so the form can say the hours were not actually checked.
        self.assertIn('Could not check', body['unconfirmed'])

    def test_a_confirmed_day_is_not_flagged_as_unconfirmed(self):
        body = self.call(dict(self.BASE, collegeDay='1'))
        self.assertNotIn('unconfirmed', body)

    def test_the_mcm_picker_still_fails_loudly_on_an_outage(self):
        # Only the first session falls back: an MCM learner already has a
        # programme and can try again, so pretending an unchecked hour is free
        # would double-book for no gain.
        body = self.call(
            self.BASE,
            slots=Mock(side_effect=AvailabilityUnavailable('Could not check the coach calendar.')),
            expect_status=503,
        )
        self.assertIn('Could not check', body['error'])

    def test_free_busy_is_never_cached(self):
        from django.test import RequestFactory
        from django.urls import resolve
        source = Mock()
        source.all_learners.filter.return_value.first.return_value = SimpleNamespace(id=101)
        path = '/learner_api/calendar/commercial/101/coach-availability/'
        with patch('login.permissions._auth_gate_enabled', return_value=True), \
             patch('login.permissions.authenticate_request',
                   return_value=SimpleNamespace(role='learner', subject_id=101)), \
             patch('learner_api.learner_detail.SOURCE_MODELS', {'commercial': source}), \
             patch('learner_api.identity.learner_profile_for_source',
                   return_value=SimpleNamespace(coach_email='coach@example.com')), \
             patch('learner_api.calendar._case_owner_contact',
                   return_value=('owner@example.com', 'Mahmoud Fouda')), \
             patch('learner_api.coach_availability.free_slots', return_value=[]):
            route = resolve(path)
            response = route.func(
                RequestFactory().get(path, dict(self.BASE, collegeDay='1')), **route.kwargs)
        self.assertEqual(response['Cache-Control'], 'private, no-store')
