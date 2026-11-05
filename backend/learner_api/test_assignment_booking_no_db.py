"""Run with python -I: actual booking logic, mocked storage and Graph.

AST loading avoids Django startup, database provisioning and import-time effects.
The authentication decorators are not exercised; the view's learner/event ownership
checks are. No application module is imported and socket access is rejected.
"""
import sys

# This directory contains calendar.py; isolated mode prevents it shadowing stdlib.
if __name__ == '__main__' and not sys.flags.isolated:
    raise RuntimeError('Run: python -I backend/learner_api/test_assignment_booking_no_db.py')

import ast
import calendar
import json
import logging
import types
import unittest
from datetime import date, datetime, time, timedelta
from pathlib import Path
from unittest.mock import Mock, patch


ROOT = Path(__file__).resolve().parent


def load_functions(path, names, namespace):
    tree = ast.parse(path.read_text(encoding='utf-8-sig'))
    nodes = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names]
    assert {node.name for node in nodes} == set(names)
    for node in nodes:
        node.decorator_list = []
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(path), 'exec'), namespace)


class Response(dict):
    def __init__(self, data, status=200):
        super().__init__(data)
        self.status_code = status


class AssignmentBookingTests(unittest.TestCase):
    def setUp(self):
        for target in ('socket.socket.connect', 'socket.create_connection'):
            blocker = patch(target, side_effect=AssertionError('Network access is forbidden'))
            blocker.start()
            self.addCleanup(blocker.stop)
        self.learner = types.SimpleNamespace(pk=101, username='Synthetic learner', email='learner@example.invalid')
        self.profile = types.SimpleNamespace(id=248, full_name='Synthetic learner', email=self.learner.email,
                                             coach_email='coach@example.invalid', coach_name='Synthetic coach',
                                             lifecycle_status='active')
        self.source = Mock()
        self.source.all_learners.filter.return_value.first.return_value = self.learner
        self.event = {'eventKey': 'review:248:REV-SYNTHETIC:1', 'source': 'mcr', 'learnerId': '248',
                      'targetDate': '2026-10-16', 'status': 'not-scheduled',
                      'reviewTemplateId': 'REV-SYNTHETIC', 'occurrenceNumber': 1}
        self.record = types.SimpleNamespace(pk=1, event_key=self.event['eventKey'], review_instance_id='',
                                            graph_event_id='existing-graph-event', meeting_link='https://example.invalid/meeting')
        self.manager = Mock()
        self.manager.get_or_create.return_value = (self.record, True)
        self.manager.filter.return_value.first.return_value = None
        self.coach = types.ModuleType('coach_api.views')
        self.coach.__dict__.update(date=date, datetime=datetime, time=time)
        load_functions(ROOT.parent / 'coach_api/views.py',
                       {'parse_date_value', 'parse_time_value', 'normalize_duration_minutes'}, self.coach.__dict__)
        for name in ('LearnerCalendarConflict', 'CalendarSyncInProgress', 'ReviewTemplateUnavailableError'):
            setattr(self.coach, name, type(name, (Exception,), {}))
        review_sources = types.ModuleType('coach_api.review_sources')
        review_sources.ReviewCreationBlocked = type('ReviewCreationBlocked', (Exception,), {})
        review_sources.require_native_review_creation = Mock()
        review_sources.review_profile_for_source = Mock(return_value=self.profile)
        review_sources.linked_booking = Mock(return_value=None)
        review_sources.source_for_learner = Mock(
            side_effect=lambda _source, profile: types.SimpleNamespace(
                kind='aptem' if getattr(profile, 'aptem_id', None) else 'curriculum'))
        for name in ('build_booked_calendar_event', 'booking_request_matches_record', 'calendar_idempotency_key',
                     'reserve_coach_calendar_booking'):
            setattr(self.coach, name, Mock(side_effect=AssertionError('Unexpected generic booking path')))
        self.coach.find_generated_timetable_event = Mock(side_effect=lambda *_: (self.event, 'Synthetic coach'))
        self.coach.persist_calendar_sync_reservation = Mock(side_effect=self.persist_reservation)
        self.coach.synchronize_reserved_calendar_event = Mock(return_value=(self.record, '', True))
        self.coach.require_review_template_for_first_linkage = Mock()
        self.coach.ensure_review_instance_for_calendar_record = Mock(
            side_effect=lambda record, _: setattr(record, 'review_instance_id', 'INSTANCE-SYNTHETIC'))
        self.coach.ReviewCreationBlocked = review_sources.ReviewCreationBlocked
        self.coach.require_native_review_creation = review_sources.require_native_review_creation
        monthly = types.ModuleType('learner_api.monthly_assignment')
        monthly.__dict__.update(calendar=calendar, date=date, timedelta=timedelta)
        load_functions(ROOT / 'monthly_assignment.py',
                       {'text', 'month_bounds', 'coaching_booking_bounds', 'coaching_booking_windows'}, monthly.__dict__)
        connections = types.ModuleType('learner_api.calendar_connections')
        self.conflicts = connections.booking_conflicts = Mock(return_value=False)
        availability = types.ModuleType('coach_api.booking_availability')
        availability.ensure_coach_review_slot_available = Mock()
        availability.CoachAvailabilityUnavailable = type('CoachAvailabilityUnavailable', (Exception,), {})
        self.review_availability = availability
        imported_booking = types.ModuleType('learner_api.imported_booking')
        imported_booking.booking_slot = Mock(return_value=None)
        imported_booking.reserve_imported_booking = Mock(side_effect=lambda record, *_args, **_kwargs: (record, True))
        imported_booking.schedule_overlay_for_booking = Mock(return_value=True)
        self.imported_booking = imported_booking
        booking_hours = types.ModuleType('coach_api.booking_hours')
        from datetime import timezone
        from zoneinfo import ZoneInfo
        import re
        booking_hours.__dict__.update(datetime=datetime, time=time, timedelta=timedelta,
                                      timezone=timezone, re=re, ZoneInfo=ZoneInfo)
        load_functions(ROOT.parent / 'coach_api/booking_hours.py',
                       {'validate_review_duration', 'validate_review_interval', 'validate_review_time_precision'},
                       booking_hours.__dict__)
        booking_hours.REVIEW_TIME_ZONE = ZoneInfo('Europe/London')
        booking_hours.REVIEW_DAY_START = time(9, 0)
        booking_hours.REVIEW_DAY_END = time(17, 0)
        booking_hours.REVIEW_BOOKING_ERROR = 'Review appointment must fit within 09:00–17:00 UK time.'
        booking_hours.REVIEW_DURATION_ERROR = 'Choose a supported Review duration.'
        modules = patch.dict(sys.modules, {
            'coach_api': types.ModuleType('coach_api'), 'coach_api.views': self.coach,
            'coach_api.booking_availability': availability, 'coach_api.booking_hours': booking_hours,
            'coach_api.review_sources': review_sources,
            'learner_api': types.ModuleType('learner_api'), 'learner_api.monthly_assignment': monthly,
            'learner_api.calendar_connections': connections,
            'learner_api.imported_booking': imported_booking,
        })
        modules.start()
        self.addCleanup(modules.stop)
        self.resolver = Mock(return_value=(self.event['eventKey'], None))
        self.mark_imported = Mock()
        self.imported_mcm = Mock(return_value=('2026-10', None))
        self.ns = dict(__package__='learner_api', json=json, datetime=datetime,
                       FIRST_SESSION_TYPE='first-session',
                       _s=lambda value: str(value or '').strip(), JsonResponse=Response,
                       DatabaseError=type('DatabaseError', (Exception,), {}), logger=logging.getLogger(__name__),
                       SOURCE_MODELS={'commercial': self.source, 'apprenticeship': self.source},
                       source_for_learner=review_sources.source_for_learner,
                       learner_profile_for_source=Mock(return_value=self.profile),
                       review_profile_for_source=review_sources.review_profile_for_source,
                       ReviewCreationBlocked=review_sources.ReviewCreationBlocked,
                       require_native_review_creation=review_sources.require_native_review_creation,
                       _calendar_profile=Mock(return_value=self.profile),
                       CoachAvailabilityUnavailable=availability.CoachAvailabilityUnavailable,
                       REVIEW_BOOKING_TYPES=frozenset(('mcr', 'progress-review', 'review', 'eligibility-review',
                                                       'workspace', 'training-plan', 'uln-privacy')),
                       booking_date_restriction=Mock(return_value=None),
                       mcm_booking_date_restriction=Mock(return_value=None),
                       _catchup_time_error=Mock(return_value=None),
                       _resolve_assignment_month_mcm_occurrence=self.resolver,
                       _resolve_assignment_month_progress_review_occurrence=self.resolver,
                       _mark_imported_review_scheduled=self.mark_imported, _friendly_sync_warning=lambda warning: warning,
                       _assignment_imported_mcm_month=self.imported_mcm,
                       _follow_first_session_start_date=Mock(), _record_enrolment_review=Mock(),
                       coaching_events_for_learner=Mock(side_effect=lambda *_: [self.event]),
                       _booking_response_event=lambda record, event: {
                           'eventKey': record.event_key, 'reviewInstanceId': record.review_instance_id,
                           'reviewId': event.get('reviewId') if event else None,
                       },
                       _serialize_event=lambda record: {'eventKey': record.event_key, 'reviewInstanceId': record.review_instance_id},
                       CoachCalendarEvent=type('SyntheticCalendarEvent', (), {
                           'objects': self.manager, 'STATUS_AWAITING_SIGNATURE': 'awaiting-signature',
                           'STATUS_COMPLETED': 'completed', 'STATUS_SCHEDULED': 'scheduled',
                           'SYNC_SYNCED': 'synced',
                           '__init__': lambda record, **values: record.__dict__.update({
                               'pk': 1, 'review_instance_id': '', 'owner_email': 'coach@example.invalid',
                               'scheduled_date': None, 'scheduled_time': None, 'duration_minutes': 60,
                               'status': 'not-scheduled', 'graph_event_id': '', **values,
                           }),
                       }))
        tree = ast.parse((ROOT / 'calendar.py').read_text(encoding='utf-8-sig'))
        for node in tree.body:
            if isinstance(node, ast.Assign):
                for target in node.targets:
                    if isinstance(target, ast.Name) and target.id in {'BOOKABLE_TYPES', 'ONBOARDING_REVIEW_TYPES'}:
                        self.ns[target.id] = ast.literal_eval(node.value)
                    elif isinstance(target, ast.Name) and target.id == 'COACH_APPROVAL_TYPES':
                        # frozenset((...)): read the literal inside the call.
                        self.ns[target.id] = frozenset(ast.literal_eval(node.value.args[0]))
        load_functions(ROOT / 'calendar.py', {'_error', 'learner_calendar_book'}, self.ns)

    def persist_reservation(self, record, *, review_event=None):
        # First linkage is now part of the reservation's atomic write.
        if review_event is not None and not record.review_instance_id:
            self.coach.ensure_review_instance_for_calendar_record(record, review_event)
        return record

    def book(self, *, kind='commercial', **changes):
        if changes.get('reviewId'):
            self.profile.aptem_id = 9840
            self.event.update(eventKey=f"imported-review:{changes['reviewId']}", reviewSource='aptem',
                              reviewId=str(changes['reviewId']), calendarEventKey=None,
                              source=changes.get('sessionType', 'mcr'))
        elif hasattr(self.profile, 'aptem_id'):
            del self.profile.aptem_id
        payload = dict(sessionType='mcr', bookingContext='monthly-assignment', assignmentMonth='2026-09',
                       eventKey=self.event['eventKey'], scheduledDate='2026-10-28', scheduledTime='10:00',
                       durationMinutes=60, timezoneOffsetMinutes=0)
        payload.update(changes)
        request = types.SimpleNamespace(method='POST', body=json.dumps(payload), headers={})
        return self.ns['learner_calendar_book'](request, kind, 101)

    def assert_no_booking(self):
        self.manager.get_or_create.assert_not_called()
        self.imported_booking.reserve_imported_booking.assert_not_called()
        self.coach.persist_calendar_sync_reservation.assert_not_called()
        self.coach.synchronize_reserved_calendar_event.assert_not_called()

    def test_assignment_books_the_selected_official_occurrence_without_imported_review(self):
        for kind in ('commercial', 'apprenticeship'):
            with self.subTest(kind=kind):
                response = self.book(kind=kind)
                self.assertEqual(response.status_code, 201, response)
                self.assertEqual(response['event']['eventKey'], self.event['eventKey'])
                self.assertEqual(self.record.review_template_id, 'REV-SYNTHETIC')
                self.assertEqual(self.record.review_instance_id, 'INSTANCE-SYNTHETIC')
                self.assertEqual(self.record.target_date, date(2026, 10, 16))
                self.assertEqual(self.record.scheduled_date, date(2026, 10, 28))
                self.assertEqual(self.record.graph_event_id, 'existing-graph-event')
        self.resolver.assert_not_called()
        self.coach.reserve_coach_calendar_booking.assert_not_called()
        self.assertTrue(all(call.args[0] is None for call in self.mark_imported.call_args_list))

    def test_both_windows_are_accepted_with_the_original_month_and_offset(self):
        for day, offset in [('2026-09-22', -60), ('2026-10-05', -60), ('2026-10-22', -60),
                            ('2026-10-28', 0), ('2026-11-05', 0)]:
            with self.subTest(day=day):
                response = self.book(scheduledDate=day, timezoneOffsetMinutes=offset)
                self.assertEqual(response.status_code, 201, response)
                self.assertEqual(self.conflicts.call_args.args[-1], offset)

    def test_dates_outside_the_old_monthly_windows_are_accepted(self):
        for day in ('2026-09-18', '2026-10-06', '2026-10-21', '2026-11-06'):
            with self.subTest(day=day):
                self.assertEqual(self.book(scheduledDate=day).status_code, 201)

    def test_assignment_requires_a_valid_month(self):
        for changes in ({'assignmentMonth': ''}, {'assignmentMonth': 'invalid'}):
            with self.subTest(changes=changes):
                self.assertEqual(self.book(scheduledDate='2026-09-22', **changes).status_code, 400)
        self.assert_no_booking()

    def test_assignment_accepts_the_selected_review_duration(self):
        for duration in (30, 45, 60, 90, 120):
            with self.subTest(duration=duration):
                response = self.book(durationMinutes=duration)
                self.assertEqual(response.status_code, 201, response)
                self.assertEqual(self.record.duration_minutes, duration)
                self.assertEqual(self.record.graph_event_id, 'existing-graph-event')

    def test_review_api_rejects_out_of_hours_slots_before_reservation(self):
        for changes in (
            {'scheduledTime': '08:59'}, {'scheduledTime': '09:00:01'}, {'scheduledTime': '16:01'},
            {'scheduledTime': '17:00'}, {'scheduledTime': '23:30'},
            {'durationMinutes': 481},
        ):
            with self.subTest(changes=changes):
                response = self.book(scheduledDate='2026-10-28', **changes)
                self.assertEqual(response.status_code, 400, response)
                self.assert_no_booking()
                self.review_availability.ensure_coach_review_slot_available.assert_not_called()

    def test_review_api_allows_nine_am_when_otherwise_available(self):
        response = self.book(scheduledDate='2026-10-28', scheduledTime='09:00')
        self.assertEqual(response.status_code, 201, response)
        self.review_availability.ensure_coach_review_slot_available.assert_called_once()

    def test_assignment_context_cannot_be_used_for_another_review_or_a_mixed_identity(self):
        # An imported review plus a Curriculum slot names two identities at once.
        for changes in ({'reviewId': '9'}, {'sessionType': 'progress-review'}, {'sessionType': 'catch-up'}):
            with self.subTest(changes=changes):
                self.assertEqual(self.book(scheduledDate='2026-09-22', **changes).status_code, 400)
        self.assert_no_booking()
        self.imported_mcm.assert_not_called()

    def use_imported_path(self, earlier_key=None):
        imported = self.manager.filter.return_value
        imported.order_by.return_value.values_list.return_value.first.return_value = earlier_key
        imported.first.return_value = None
        self.imported_booking.reserve_imported_booking = Mock(return_value=(self.record, True))

    def test_assignment_books_an_owned_aptem_mcm_on_the_imported_path(self):
        # Aptem-sourced learners have no Curriculum MCM on the coach timetable,
        # so the assignment must book their imported Aptem MCM instead.
        self.use_imported_path()
        response = self.book(eventKey=None, reviewId='9840', scheduledDate='2026-10-27')
        self.assertEqual(response.status_code, 201, response)
        self.imported_mcm.assert_called_once_with(248, '9840')
        self.resolver.assert_not_called()
        self.coach.find_generated_timetable_event.assert_not_called()
        self.manager.get_or_create.assert_not_called()
        candidate, event, _expected_slot = self.imported_booking.reserve_imported_booking.call_args.args
        self.assertEqual(candidate.event_key, 'imported-review:9840')
        self.assertEqual(event['reviewId'], '9840')
        self.coach.synchronize_reserved_calendar_event.assert_called_once()
        self.mark_imported.assert_called_once_with('9840', 248, date(2026, 10, 27), time(10, 0))

    def test_assignment_reuses_an_earlier_booking_of_the_same_aptem_mcm(self):
        self.use_imported_path(earlier_key='learner-book:mcm:commercial:101:2026-11:9840')
        response = self.book(eventKey=None, reviewId='9840', scheduledDate='2026-10-27')
        self.assertEqual(response.status_code, 201, response)
        candidate, event, _expected_slot = self.imported_booking.reserve_imported_booking.call_args.args
        self.assertEqual(candidate.event_key, 'imported-review:9840')
        self.assertEqual(event['reviewId'], '9840')

    def test_assignment_rejects_an_unowned_or_finished_aptem_mcm(self):
        for status in (404, 409):
            with self.subTest(status=status):
                self.imported_mcm.return_value = (None, ('Not available', status))
                response = self.book(eventKey=None, reviewId='9840', scheduledDate='2026-10-27')
                self.assertEqual(response.status_code, status)
                self.assertEqual(response['error'], 'Not available')
        self.assert_no_booking()
        self.coach.reserve_coach_calendar_booking.assert_not_called()
        self.mark_imported.assert_not_called()

    def test_imported_aptem_mcm_books_outside_the_old_monthly_windows(self):
        self.use_imported_path()
        for day in ('2026-10-06', '2026-11-06'):
            with self.subTest(day=day):
                self.assertEqual(self.book(eventKey=None, reviewId='9840', scheduledDate=day).status_code, 201)

    def test_no_explicit_slot_resolves_to_an_official_occurrence(self):
        response = self.book(eventKey=None)
        self.assertEqual(response.status_code, 201, response)
        self.resolver.assert_called_once_with(self.learner, self.profile)
        self.coach.find_generated_timetable_event.assert_called_once_with(self.profile.coach_email, self.event['eventKey'])
        self.coach.reserve_coach_calendar_booking.assert_not_called()

    def test_unresolved_official_occurrence_stays_an_error(self):
        for status in (404, 409, 422):
            self.resolver.return_value = (None, ('Cannot resolve official occurrence', status))
            response = self.book(eventKey=None)
            self.assertEqual(response.status_code, status)
            self.assertEqual(response['error'], 'Cannot resolve official occurrence')
        self.assert_no_booking()

    def test_imported_review_still_requires_its_id(self):
        response = self.book(bookingContext=None, scheduledDate='2026-09-22')
        self.assertEqual(response.status_code, 400)
        self.assertIn('reviewId is required', response['error'])
        self.assert_no_booking()

    def test_imported_review_keeps_its_original_window_and_linkage(self):
        response = self.book(bookingContext=None, reviewId='9', scheduledDate='2026-09-22')
        self.assertEqual(response.status_code, 201, response)
        self.mark_imported.assert_called_once_with('9', 248, date(2026, 9, 22), time(10, 0))
        response = self.book(bookingContext=None, reviewId='9')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.coach.synchronize_reserved_calendar_event.call_count, 1)

    def test_imported_progress_review_keeps_its_independent_schedule(self):
        self.event['source'] = 'progress-review'
        response = self.book(bookingContext=None, sessionType='progress-review', reviewId='9', scheduledDate='2026-12-10')
        self.assertEqual(response.status_code, 201, response)

    def test_other_learner_or_wrong_session_type_cannot_be_booked(self):
        for changes in ({'learnerId': '999'}, {'source': 'progress-review'}):
            with self.subTest(changes=changes), patch.dict(self.event, changes):
                self.assertEqual(self.book().status_code, 404)
        self.assert_no_booking()

    def test_completed_or_signed_review_cannot_be_rebooked(self):
        for status in ('completed', 'awaiting-signature'):
            self.event['status'] = status
            self.assertEqual(self.book().status_code, 409)
        self.assert_no_booking()

    def test_personal_calendar_conflicts_still_stop_booking(self):
        self.conflicts.return_value = True
        self.assertEqual(self.book().status_code, 409)
        self.assert_no_booking()

    def test_booking_conflict_never_reaches_teams(self):
        self.coach.persist_calendar_sync_reservation.side_effect = self.coach.LearnerCalendarConflict('Busy')
        self.assertEqual(self.book().status_code, 409)
        self.coach.synchronize_reserved_calendar_event.assert_not_called()

    def test_sync_failure_is_returned_and_retry_keeps_the_same_event(self):
        self.coach.synchronize_reserved_calendar_event.return_value = (self.record, 'Sync failed', True)
        response = self.book()
        self.assertEqual(response.status_code, 201, response)
        self.assertEqual(response['warning'], 'Sync failed')
        self.manager.get_or_create.return_value = (self.record, False)
        self.coach.synchronize_reserved_calendar_event.return_value = (self.record, '', True)
        retried = self.book()
        self.assertEqual(retried.status_code, 200, retried)
        self.assertEqual(response['event'], retried['event'])
        self.assertEqual(self.record.graph_event_id, 'existing-graph-event')
        self.coach.ensure_review_instance_for_calendar_record.assert_called_once()


class LearnerReviewCancellationWiringTests(unittest.TestCase):
    def test_cancel_view_imports_conflict_and_shared_review_cancel_helper(self):
        tree = ast.parse((ROOT / 'calendar.py').read_text(encoding='utf-8-sig'))
        cancel_view = next(
            node for node in tree.body
            if isinstance(node, ast.FunctionDef) and node.name == 'learner_calendar_cancel'
        )
        imported = {
            alias.name
            for node in ast.walk(cancel_view)
            if isinstance(node, ast.ImportFrom) and node.module == 'coach_api.views'
            for alias in node.names
        }
        self.assertIn('LearnerCalendarConflict', imported)
        self.assertIn('cancel_reserved_calendar_event', imported)


if __name__ == '__main__':
    unittest.main()
