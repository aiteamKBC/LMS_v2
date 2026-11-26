"""Calendar overview regressions with database and Microsoft access mocked."""
import json
from contextlib import ExitStack
from datetime import date, datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.db import DatabaseError
from django.test import RequestFactory, SimpleTestCase

from . import directory_calendar as calendar, views

OWNER = 'coach@example.test'
OTHER = 'other@example.test'
START, END = date(2027, 5, 24), date(2027, 5, 30)
REFRESHED = datetime(2026, 11, 1, tzinfo=timezone.utc)


class MissingBookingTests(SimpleTestCase):
    def setUp(self):
        self.manager = MagicMock()
        self.query = self.manager.annotate.return_value.filter.return_value
        self.query.exclude.return_value = self.query
        self.query.values_list.return_value = [(OWNER, 'booking-1', 1, 'operation-1')]
        self.patch = patch.object(calendar.CoachCalendarEvent, 'objects', self.manager)
        self.patch.start()
        self.addCleanup(self.patch.stop)

    def test_past_and_future_bookings_use_requested_range_not_dashboard_horizon(self):
        for start, end in [(date(2026, 7, 1), date(2026, 7, 7)), (START, END)]:
            with self.subTest(start=start):
                self.assertEqual(calendar.missing_booking_owners({OWNER}, [], start, end), {OWNER})
                self.manager.annotate.return_value.filter.assert_called_with(
                    owner_key__in=[OWNER], scheduled_date__range=(start, end), scheduled_time__isnull=False)
        self.assertIn((('graph_event_id', ''),), [tuple(call.kwargs.items()) for call in self.query.exclude.call_args_list])
        self.query.exclude.assert_any_call(status='cancelled')
        self.query.exclude.assert_any_call(sync_state='cancelled')

    def test_reconciled_and_imported_identities_do_not_duplicate_bookings(self):
        for field, value in [('eventKey', 'booking-1'), ('calendarEventKey', 'booking-1'),
                             ('calendarEventId', '1'), ('operationId', 'operation-1')]:
            with self.subTest(field=field):
                rows = [(OWNER, REFRESHED, json.dumps({field: value}))]
                self.assertEqual(calendar.missing_booking_owners({OWNER}, rows, START, END), set())

    def test_another_coachs_event_does_not_hide_the_owners_booking(self):
        rows = [(OTHER, REFRESHED, {'eventKey': 'booking-1'})]
        self.assertEqual(calendar.missing_booking_owners({OWNER, OTHER}, rows, START, END), {OWNER})
        self.query.values_list.return_value = [(OTHER, 'booking-1', 1, 'operation-1')]
        self.assertEqual(calendar.missing_booking_owners({OWNER}, [], START, END), set())

    def test_only_affected_coaches_use_the_existing_read_resolver(self):
        event = {'eventKey': 'imported-review:17:8', 'calendarEventKey': 'booking-1',
                 'reviewSource': 'aptem', 'reviewId': '8', 'meetingLink': 'https://example.test/meeting'}
        with patch.object(views, 'collect_generated_timetable', return_value={'events': [event]}) as read, \
             patch('coach_api.meeting_outcomes.annotate_meeting_outcomes') as outcomes:
            result = calendar.read_missing_bookings({OWNER, OTHER}, [], START, END)
            self.assertEqual(result, {OWNER: [event]})
            read.assert_called_once_with(OWNER, start_date=START, end_date=END,
                                         include_live_sessions=False, include_scheduler_queues=False,
                                         include_unlinked_bookings=True)
            outcomes.assert_called_once_with([event])

    def test_complete_preview_avoids_timetable_rebuild(self):
        with patch.object(views, 'collect_generated_timetable') as read:
            self.assertEqual(calendar.read_missing_bookings({OWNER},
                [(OWNER, REFRESHED, {'eventKey': 'booking-1'})], START, END), {})
            read.assert_not_called()

    def test_resolver_failure_remains_an_error(self):
        with patch.object(views, 'collect_generated_timetable', side_effect=DatabaseError('offline')):
            with self.assertRaises(DatabaseError):
                calendar.read_missing_bookings({OWNER}, [], START, END)


class DirectoryCalendarResponseTests(SimpleTestCase):
    def request(self, *, role='admin', access='super-admin', rows=(), snapshots=(OWNER,),
                current=None, error=None, method='get'):
        request = getattr(RequestFactory(), method)('/coach_api/coaches/calendar',
            {'start': START.isoformat(), 'end': END.isoformat()})
        cursor = MagicMock()
        cursor.fetchall.return_value = list(rows)
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor
        staff = MagicMock()
        staff.annotate.return_value.filter.return_value.values_list.return_value = [OWNER, OTHER]
        snapshot = MagicMock()
        snapshot.annotate.return_value.filter.return_value.values_list.return_value = list(snapshots)
        with ExitStack() as stack:
            stack.enter_context(patch('login.permissions.authenticate_request', return_value=SimpleNamespace(role=role)))
            stack.enter_context(patch('login.permissions._accesses_of', return_value={access}))
            stack.enter_context(patch.object(views.StaffUser, 'objects', staff))
            stack.enter_context(patch.object(views.CoachDashboardSnapshot, 'objects', snapshot))
            stack.enter_context(patch.object(views, 'connections', {'default': connection}))
            stack.enter_context(patch.object(views.router, 'db_for_read', return_value='default'))
            stack.enter_context(patch.object(views.logger, 'exception'))
            read = stack.enter_context(patch.object(calendar, 'read_missing_bookings',
                return_value=current or {}, side_effect=error))
            response = views.coach_directory_calendar(request)
            return response, read

    def test_fills_missing_booking_and_preserves_live_sessions_without_duplicates(self):
        old = {'eventKey': 'booking-1', 'source': 'mcr', 'date': '2027-05-28'}
        live = {'eventKey': 'live-1', 'source': 'live-session', 'date': '2027-05-27'}
        fresh = {**old, 'scheduledTime': '10:00', 'meetingLink': 'https://example.test/meeting'}
        response, _ = self.request(rows=[(OWNER, REFRESHED, old), (OWNER, REFRESHED, live)],
                                   current={OWNER: [fresh]})
        self.assertEqual(response.status_code, 200)
        result = json.loads(response.content)
        self.assertEqual(result['calendars'][0]['events'], [live, fresh])
        self.assertEqual(result['missingCoaches'], [OTHER])

    def test_booked_coach_without_dashboard_snapshot_can_still_be_displayed(self):
        response, _ = self.request(snapshots=(), current={OWNER: [{'eventKey': 'booking-1'}]})
        result = json.loads(response.content)
        self.assertEqual([row['email'] for row in result['calendars']], [OWNER])
        self.assertEqual(result['missingCoaches'], [OTHER])

    def test_read_failure_returns_503_without_private_error_details(self):
        response, _ = self.request(error=DatabaseError('private database details'))
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('private database details', response.content.decode())

    def test_non_admin_roles_cannot_read_other_coaches_bookings(self):
        for role, access in [('learner', ''), ('employer', ''), ('staff', 'coach'), ('staff', 'curriculum')]:
            with self.subTest(role=role, access=access):
                response, read = self.request(role=role, access=access)
                self.assertEqual(response.status_code, 403)
                read.assert_not_called()

    def test_post_cannot_trigger_the_calendar_read(self):
        response, read = self.request(method='post')
        self.assertEqual(response.status_code, 405)
        read.assert_not_called()
