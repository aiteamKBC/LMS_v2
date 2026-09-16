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
                                             coach_email='coach@example.invalid', coach_name='Synthetic coach')
        self.source = Mock()
        self.source.all_learners.filter.return_value.first.return_value = self.learner
        self.event = {'eventKey': 'review:248:REV-SYNTHETIC:1', 'source': 'mcr', 'learnerId': '248',
                      'targetDate': '2026-10-16', 'status': 'not-scheduled',
                      'reviewTemplateId': 'REV-SYNTHETIC', 'occurrenceNumber': 1}
        self.record = types.SimpleNamespace(pk=1, event_key=self.event['eventKey'], review_instance_id='',
                                            graph_event_id='existing-graph-event', meeting_link='https://example.invalid/meeting')
        self.manager = Mock()
        self.manager.get_or_create.return_value = (self.record, True)
        self.coach = types.ModuleType('coach_api.views')
        self.coach.__dict__.update(date=date, datetime=datetime, time=time)
        load_functions(ROOT.parent / 'coach_api/views.py',
                       {'parse_date_value', 'parse_time_value', 'normalize_duration_minutes'}, self.coach.__dict__)
        for name in ('LearnerCalendarConflict', 'CalendarSyncInProgress', 'ReviewTemplateUnavailableError'):
            setattr(self.coach, name, type(name, (Exception,), {}))
        for name in ('build_booked_calendar_event', 'booking_request_matches_record', 'calendar_idempotency_key',
                     'reserve_coach_calendar_booking'):
            setattr(self.coach, name, Mock(side_effect=AssertionError('Unexpected generic booking path')))
        self.coach.find_generated_timetable_event = Mock(side_effect=lambda *_: (self.event, 'Synthetic coach'))
        self.coach.persist_calendar_sync_reservation = Mock(side_effect=lambda record: record)
        self.coach.synchronize_reserved_calendar_event = Mock(return_value=(self.record, '', True))
        self.coach.require_review_template_for_first_linkage = Mock()
        self.coach.ensure_review_instance_for_calendar_record = Mock(
            side_effect=lambda record, _: setattr(record, 'review_instance_id', 'INSTANCE-SYNTHETIC'))
        monthly = types.ModuleType('learner_api.monthly_assignment')
        monthly.__dict__.update(calendar=calendar, date=date, timedelta=timedelta)
        load_functions(ROOT / 'monthly_assignment.py',
                       {'text', 'month_bounds', 'coaching_booking_bounds', 'coaching_booking_windows'}, monthly.__dict__)
        connections = types.ModuleType('learner_api.calendar_connections')
        self.conflicts = connections.booking_conflicts = Mock(return_value=False)
        modules = patch.dict(sys.modules, {
            'coach_api': types.ModuleType('coach_api'), 'coach_api.views': self.coach,
            'learner_api': types.ModuleType('learner_api'), 'learner_api.monthly_assignment': monthly,
            'learner_api.calendar_connections': connections,
        })
        modules.start()
        self.addCleanup(modules.stop)
        self.resolver = Mock(return_value=(self.event['eventKey'], None))
        self.mark_imported = Mock()
        self.ns = dict(__package__='learner_api', json=json, datetime=datetime,
                       _s=lambda value: str(value or '').strip(), JsonResponse=Response,
                       DatabaseError=type('DatabaseError', (Exception,), {}), logger=logging.getLogger(__name__),
                       SOURCE_MODELS={'commercial': self.source, 'apprenticeship': self.source},
                       learner_profile_for_source=Mock(return_value=self.profile),
                       booking_date_restriction=Mock(return_value=None),
                       _resolve_assignment_month_mcm_occurrence=self.resolver,
                       _resolve_assignment_month_progress_review_occurrence=self.resolver,
                       _mark_imported_review_scheduled=self.mark_imported, _friendly_sync_warning=lambda warning: warning,
                       _serialize_event=lambda record: {'eventKey': record.event_key, 'reviewInstanceId': record.review_instance_id},
                       CoachCalendarEvent=types.SimpleNamespace(objects=self.manager, STATUS_AWAITING_SIGNATURE='awaiting-signature',
                                                               STATUS_COMPLETED='completed', STATUS_SCHEDULED='scheduled'))
        tree = ast.parse((ROOT / 'calendar.py').read_text(encoding='utf-8-sig'))
        for node in tree.body:
            if isinstance(node, ast.Assign):
                for target in node.targets:
                    if isinstance(target, ast.Name) and target.id in {'BOOKABLE_TYPES', 'ONBOARDING_REVIEW_TYPES'}:
                        self.ns[target.id] = ast.literal_eval(node.value)
        load_functions(ROOT / 'calendar.py', {'_error', 'learner_calendar_book'}, self.ns)

    def book(self, *, kind='commercial', **changes):
        payload = dict(sessionType='mcr', bookingContext='monthly-assignment', assignmentMonth='2026-09',
                       eventKey=self.event['eventKey'], scheduledDate='2026-10-28', scheduledTime='10:00',
                       durationMinutes=60, timezoneOffsetMinutes=0)
        payload.update(changes)
        request = types.SimpleNamespace(method='POST', body=json.dumps(payload), headers={})
        return self.ns['learner_calendar_book'](request, kind, 101)

    def assert_no_booking(self):
        self.manager.get_or_create.assert_not_called()
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

    def test_gap_and_dates_outside_both_windows_are_rejected(self):
        for day in ('2026-09-18', '2026-10-06', '2026-10-21', '2026-11-06'):
            with self.subTest(day=day):
                self.assertEqual(self.book(scheduledDate=day).status_code, 400)
        self.assert_no_booking()

    def test_assignment_requires_a_valid_month_and_sixty_minutes(self):
        for changes in ({'assignmentMonth': ''}, {'assignmentMonth': 'invalid'}, {'durationMinutes': 45}):
            with self.subTest(changes=changes):
                self.assertEqual(self.book(scheduledDate='2026-09-22', **changes).status_code, 400)
        self.assert_no_booking()

    def test_assignment_context_cannot_be_used_for_an_imported_or_other_review(self):
        for changes in ({'reviewId': '9'}, {'sessionType': 'progress-review'}, {'sessionType': 'catch-up'}):
            with self.subTest(changes=changes):
                self.assertEqual(self.book(scheduledDate='2026-09-22', **changes).status_code, 400)
        self.assert_no_booking()

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


if __name__ == '__main__':
    unittest.main()
