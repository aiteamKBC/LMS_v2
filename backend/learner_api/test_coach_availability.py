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
