"""Run with python -I. Execute real booking views with storage/Graph doubles.

Only reviewed definitions are AST-loaded: no Django startup, database access or
application imports. Socket access is blocked for every test.
"""
import sys

if __name__ == '__main__' and not sys.flags.isolated:
    raise RuntimeError('Run with python -I to avoid shadowing stdlib calendar.')

import ast
import calendar
import json
import logging
import types
import unittest
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from pathlib import Path
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parent


def load(path, names, namespace):
    nodes = []
    for node in ast.parse(path.read_text(encoding='utf-8-sig')).body:
        if isinstance(node, (ast.FunctionDef, ast.ClassDef)) and node.name in names:
            if isinstance(node, ast.FunctionDef):
                node.decorator_list = []
            nodes.append(node)
        elif isinstance(node, ast.Assign) and any(
            isinstance(target, ast.Name) and target.id in names for target in node.targets
        ):
            nodes.append(node)
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(path), 'exec'), namespace)
    assert all(name in namespace for name in names)


class Response(dict):
    def __init__(self, data, status=200):
        super().__init__(data)
        self.status_code = status


class McmBookingWindowTests(unittest.TestCase):
    def setUp(self):
        for target in ('socket.socket.connect', 'socket.create_connection'):
            blocker = patch(target, side_effect=AssertionError('Network access is forbidden'))
            blocker.start()
            self.addCleanup(blocker.stop)
        dates = dict(__name__=__name__, date=date, dataclass=dataclass,
                     timezone=types.SimpleNamespace(localdate=lambda: date(2026, 1, 1)))
        load(ROOT / 'booking_calendar.py', {
            'BookingDateRestriction', 'ENGLAND_WALES_BANK_HOLIDAYS', 'COVERED_YEARS',
            'booking_date_restriction', 'mcm_booking_date_restriction',
        }, dates)
        self.dates = dates
        self.monthly = types.ModuleType('learner_api.monthly_assignment')
        self.monthly.__dict__.update(calendar=calendar, date=date, timedelta=timedelta)
        load(ROOT / 'monthly_assignment.py', {
            'text', 'month_bounds', 'coaching_booking_bounds', 'coaching_booking_windows',
        }, self.monthly.__dict__)
        self.profile = types.SimpleNamespace(id=248, lifecycle_status='active', full_name='Synthetic learner',
                                            email='learner@example.invalid', coach_email='coach@example.invalid', coach_name='Coach')
        self.learner = types.SimpleNamespace(pk=101, username=self.profile.full_name, email=self.profile.email)
        self.source_kind = 'curriculum'
        model = Mock()
        model.all_learners.filter.return_value.first.return_value = self.learner
        self.event = {'eventKey': 'review:248:SYNTHETIC:1', 'source': 'mcr', 'learnerId': '248',
                      'targetDate': '2026-10-15', 'status': 'not-scheduled', 'reviewTemplateId': 'SYNTHETIC'}
        self.record = types.SimpleNamespace(pk=1, event_key=self.event['eventKey'], event_type='mcr',
                                           learner_id=248, owner_email=self.profile.coach_email, status='scheduled',
                                           review_instance_id='INSTANCE-1', graph_event_id='GRAPH-1',
                                           meeting_link='https://example.invalid/meeting', sync_state='synced',
                                           scheduled_date=date(2026, 10, 22), scheduled_time=time(10), duration_minutes=60)
        self.manager = Mock()
        self.manager.get_or_create.return_value = (self.record, True)
        self.manager.filter.return_value.first.return_value = None
        self.coach = types.ModuleType('coach_api.views')
        self.coach.__dict__.update(date=date, datetime=datetime, time=time)
        load(ROOT.parent / 'coach_api/views.py', {'parse_date_value', 'parse_time_value', 'normalize_duration_minutes'}, self.coach.__dict__)
        for name in ('CalendarSyncInProgress', 'LearnerCalendarConflict', 'ReviewTemplateUnavailableError'):
            setattr(self.coach, name, type(name, (Exception,), {}))
        for name in ('booking_request_matches_record', 'calendar_idempotency_key', 'reserve_coach_calendar_booking'):
            setattr(self.coach, name, Mock(side_effect=AssertionError('Unexpected generic booking')))
        self.coach.find_generated_timetable_event = Mock(side_effect=lambda *_: (self.event, 'Coach'))
        self.coach.persist_calendar_sync_reservation = Mock(side_effect=lambda record, **_: record)
        self.coach.synchronize_reserved_calendar_event = Mock(return_value=(self.record, '', True))
        self.coach.require_review_template_for_first_linkage = Mock()
        self.coach.sync_scheduled_review_instance = Mock(side_effect=lambda record: record)
        self.coach.build_booked_calendar_event = Mock(return_value=self.event)
        connections = types.ModuleType('learner_api.calendar_connections')
        connections.booking_conflicts = Mock(return_value=False)
        self.conflicts = connections.booking_conflicts
        availability = types.ModuleType('coach_api.booking_availability')
        availability.ensure_coach_calendar_available = Mock()
        availability.ensure_coach_outlook_available = Mock()
        availability.CoachAvailabilityUnavailable = type('CoachAvailabilityUnavailable', (Exception,), {})
        imported_booking = types.ModuleType('learner_api.imported_booking')
        imported_booking.booking_slot = lambda record: (record.scheduled_date, record.scheduled_time, record.duration_minutes)
        imported_booking.reserve_imported_booking = Mock(side_effect=lambda record, event, *_args, **_kwargs:
            (self.coach.persist_calendar_sync_reservation(record, review_event=event), True))
        # Booking-window rules do not depend on the review lifecycle; the
        # overlay transition after a confirmed booking has its own suites.
        imported_booking.schedule_overlay_for_booking = Mock(return_value=False)
        modules = patch.dict(sys.modules, {
            'coach_api': types.ModuleType('coach_api'), 'coach_api.views': self.coach,
            'coach_api.booking_availability': availability,
            'learner_api': types.ModuleType('learner_api'), 'learner_api.monthly_assignment': self.monthly,
            'learner_api.calendar_connections': connections,
            'learner_api.imported_booking': imported_booking,
        })
        modules.start()
        self.addCleanup(modules.stop)
        self.ns = dict(__package__='learner_api', json=json, datetime=datetime, FIRST_SESSION_TYPE='first-session',
                       _s=lambda value: str(value or '').strip(), JsonResponse=Response,
                       DatabaseError=type('DatabaseError', (Exception,), {}), logger=logging.getLogger(__name__),
                       ReviewCreationBlocked=type('ReviewCreationBlocked', (Exception,), {}),
                       require_native_review_creation=Mock(),
                       CoachAvailabilityUnavailable=availability.CoachAvailabilityUnavailable,
                       SOURCE_MODELS={'commercial': model, 'apprenticeship': model},
                       _calendar_profile=Mock(return_value=self.profile),
                       source_for_learner=lambda *_: types.SimpleNamespace(kind=self.source_kind),
                       review_profile_for_source=Mock(return_value=self.profile),
                       coaching_events_for_learner=lambda *_: [self.event],
                       _curriculum_mcm_fallback=Mock(return_value=False),
                       booking_date_restriction=dates['booking_date_restriction'],
                       mcm_booking_date_restriction=dates['mcm_booking_date_restriction'],
                       _resolve_direct_cycle_event_key=lambda *_: (self.event['eventKey'], None),
                       _resolve_assignment_month_mcm_occurrence=lambda *_: (self.event['eventKey'], None),
                       _assignment_imported_mcm_month=lambda *_: ('2026-10', None),
                       _learner_booking_record=Mock(return_value=self.record),
                       _learner_catchup_change_error=Mock(return_value=None),
                       _mark_imported_review_scheduled=Mock(), _friendly_sync_warning=lambda value: value,
                       _follow_first_session_start_date=Mock(), _record_enrolment_review=Mock(),
                       _booking_response_event=lambda record, *_: {'eventKey': record.event_key},
                       # An Aptem booking now builds an unsaved candidate and
                       # lets the reservation commit it under its own lock, so
                       # the stub has to be constructible as well as queryable.
                       CoachCalendarEvent=Mock(
                           side_effect=lambda **_fields: self.record,
                           objects=self.manager, STATUS_AWAITING_SIGNATURE='awaiting-signature',
                           STATUS_COMPLETED='completed', STATUS_SCHEDULED='scheduled', SYNC_SYNCED='synced'))
        load(ROOT / 'calendar.py', {'BOOKABLE_TYPES', 'ONBOARDING_REVIEW_TYPES', 'COACH_APPROVAL_TYPES',
                                    '_error', 'learner_calendar_book', 'learner_calendar_reschedule'}, self.ns)

    def request(self, day, *, kind='commercial', path='assignment', session_type='mcr'):
        payload = dict(sessionType=session_type, eventKey=self.event['eventKey'], scheduledDate=day,
                       scheduledTime='11:00', durationMinutes=60, timezoneOffsetMinutes=0)
        if path in {'assignment', 'imported-assignment'}:
            payload.update(bookingContext='monthly-assignment', assignmentMonth='2026-10')
        if path.startswith('imported'):
            self.source_kind = 'aptem'
            self.event.update(reviewSource='aptem', reviewId='9840', eventKey='imported-review:9840', reviewTemplateId='')
            self.record.event_key = self.event['eventKey']
            payload.update(reviewId='9840', eventKey=None, assignmentMonth='2026-10')
        if path == 'generic':
            payload.pop('eventKey')
        endpoint = 'learner_calendar_reschedule' if path == 'reschedule' else 'learner_calendar_book'
        request = types.SimpleNamespace(method='POST', body=json.dumps(payload), headers={})
        return self.ns[endpoint](request, kind, 101)

    def test_fixed_bounds_for_all_month_lengths_and_year_rollover(self):
        for month, end in [('2026-04', '2026-05-05'), ('2026-10', '2026-11-05'),
                           ('2027-02', '2027-03-05'), ('2028-02', '2028-03-05'), ('2026-12', '2027-01-05')]:
            with self.subTest(month=month):
                self.assertEqual(self.monthly.coaching_booking_bounds(month),
                                 (date.fromisoformat(month + '-20'), date.fromisoformat(end)))
                for day in (1, 5, 20, calendar.monthrange(int(month[:4]), int(month[5:]))[1]):
                    self.assertIsNone(self.dates['mcm_booking_date_restriction'](date.fromisoformat(f'{month}-{day:02}')))
                for day in (6, 19):
                    self.assertEqual(self.dates['mcm_booking_date_restriction'](date.fromisoformat(f'{month}-{day:02}')).code,
                                     'mcm-booking-window')
        self.assertEqual(self.monthly.coaching_booking_windows('2026-12')[1], (date(2027, 1, 20), date(2027, 2, 5)))
        self.assertEqual(self.monthly.coaching_booking_bounds('invalid'), (None, None))

    def test_every_booking_entrypoint_rejects_closed_dates_before_writes_or_graph(self):
        for path in ('assignment', 'curriculum', 'generic', 'reschedule', 'imported', 'imported-assignment'):
            for kind in ('commercial', 'apprenticeship'):
                for day in ('2026-10-06', '2026-10-19'):
                    with self.subTest(path=path, kind=kind, day=day):
                        response = self.request(day, kind=kind, path=path)
                        self.assertEqual(response.status_code, 400, response)
                        self.assertIn('20th', response['error'])
        self.manager.get_or_create.assert_not_called()
        self.coach.persist_calendar_sync_reservation.assert_not_called()
        self.coach.synchronize_reserved_calendar_event.assert_not_called()

    def test_each_entrypoint_accepts_the_20th_and_following_5th(self):
        for path in ('assignment', 'curriculum', 'generic', 'reschedule', 'imported', 'imported-assignment'):
            for kind in ('commercial', 'apprenticeship'):
                for day in ('2026-10-20', '2026-11-05'):
                    with self.subTest(path=path, kind=kind, day=day):
                        response = self.request(day, kind=kind, path=path)
                        self.assertIn(response.status_code, (200, 201), response)
                        self.assertEqual(self.record.scheduled_date, date.fromisoformat(day))
                        self.assertEqual(self.record.graph_event_id, 'GRAPH-1')
                        self.assertEqual(self.record.meeting_link, 'https://example.invalid/meeting')

    def test_assignment_supports_short_months_leap_day_and_year_rollover(self):
        for day in ('2026-02-20', '2026-04-20', '2028-02-29', '2026-12-31', '2027-01-05'):
            with self.subTest(day=day):
                self.assertEqual(self.request(day).status_code, 201)

    def test_weekends_holidays_and_past_dates_stay_closed(self):
        for day in ('2026-09-20', '2026-12-25', '2025-12-31'):
            with self.subTest(day=day):
                self.assertEqual(self.request(day).status_code, 400)
        self.coach.persist_calendar_sync_reservation.assert_not_called()

    def test_progress_reviews_keep_their_independent_dates(self):
        self.event['source'] = 'progress-review'
        self.record.event_type = 'progress-review'
        for path in ('curriculum', 'reschedule'):
            response = self.request('2026-10-19', path=path, session_type='progress-review')
            self.assertIn(response.status_code, (200, 201), response)

    def test_ownership_completed_status_and_conflicts_still_prevent_booking(self):
        for changes, status in [({'learnerId': '999'}, 404), ({'source': 'progress-review'}, 404), ({'status': 'completed'}, 409)]:
            with patch.dict(self.event, changes):
                self.assertEqual(self.request('2026-10-20').status_code, status)
        self.conflicts.return_value = True
        self.assertEqual(self.request('2026-10-20').status_code, 409)
        self.coach.synchronize_reserved_calendar_event.assert_not_called()

    def test_failed_sync_remains_visible_and_retry_keeps_meeting_identity(self):
        self.coach.synchronize_reserved_calendar_event.return_value = (self.record, 'Sync failed', True)
        first = self.request('2026-10-20')
        self.assertEqual(first['warning'], 'Sync failed')
        self.manager.get_or_create.return_value = (self.record, False)
        self.coach.synchronize_reserved_calendar_event.return_value = (self.record, '', True)
        second = self.request('2026-10-20')
        self.assertEqual(second.status_code, 200)
        self.assertEqual(first['event'], second['event'])
        self.assertEqual(self.record.graph_event_id, 'GRAPH-1')


if __name__ == '__main__':
    unittest.main()
