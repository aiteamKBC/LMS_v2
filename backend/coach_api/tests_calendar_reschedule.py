"""Rescheduling preserves the existing Microsoft event, including failed retries."""
from contextlib import ExitStack, nullcontext
from datetime import date, time
from unittest.mock import Mock, patch

from django.db import DatabaseError
from django.test import SimpleTestCase

from . import views
from .models import CoachCalendarEvent


class CalendarRescheduleSyncTests(SimpleTestCase):
    def record(self, existing=True):
        record = CoachCalendarEvent(
            pk=51, event_key="mcr:211:1:2026-10-31", event_type="mcr",
            owner_email="coach@example.test", owner_name="Coach",
            learner_profile_id=211, learner_name="Learner", learner_email="learner@example.test",
            scheduled_date=date(2026, 10, 5), scheduled_time=time(11, 30),
            target_date=date(2026, 10, 31), duration_minutes=90, status="scheduled",
            graph_event_id="original-event" if existing else "",
            graph_organizer_email="original-organizer@example.test" if existing else "",
            meeting_provider="Microsoft Teams" if existing else "",
            meeting_link="https://teams.microsoft.com/meet/original" if existing else "",
            graph_web_link="https://outlook.office.com/calendar/item/original" if existing else "",
            sync_state="pending",
        )
        record.save = Mock()
        return record

    def graph_response(self, record):
        return {"id": record.graph_event_id, "webLink": record.graph_web_link,
                "onlineMeeting": {"joinUrl": record.meeting_link}}

    def patches(self, record):
        stack = ExitStack()
        stack.enter_context(patch.object(views, "has_graph_credentials", return_value=True))
        stack.enter_context(patch.object(views, "apply_teams_meeting_options", return_value=(True, {}, [])))
        stack.enter_context(patch.object(views, "logger"))
        return stack

    def reservation_patches(self, record):
        stack = self.patches(record)
        stack.enter_context(patch.object(views.transaction, "atomic", side_effect=lambda: nullcontext()))
        locked = stack.enter_context(patch.object(CoachCalendarEvent.objects, "select_for_update"))
        locked.return_value.get.return_value = record
        return stack

    def test_reschedule_updates_original_mailbox_event_without_replacing_teams_body(self):
        record = self.record()
        with self.patches(record), patch.object(views, "microsoft_graph_request", return_value=self.graph_response(record)) as graph:
            warning = views.sync_calendar_event_to_graph(record, {"source": "mcr", "title": "Monthly coaching"})

        self.assertEqual(warning, "")
        graph.assert_called_once()
        self.assertEqual(graph.call_args.args, ("PATCH", "users/original-organizer%40example.test/events/original-event"))
        payload = graph.call_args.kwargs["payload"]
        self.assertEqual(payload["start"]["dateTime"], "2026-10-05T11:30:00")
        self.assertEqual(payload["end"]["dateTime"], "2026-10-05T13:00:00")
        for name in ("body", "attendees", "isOnlineMeeting", "onlineMeetingProvider", "transactionId"):
            self.assertNotIn(name, payload)
        self.assertEqual(record.graph_event_id, "original-event")
        self.assertEqual(record.meeting_link, "https://teams.microsoft.com/meet/original")

    def test_reschedule_of_the_same_meeting_sends_no_meeting_options(self):
        record = self.record()
        with self.patches(record), patch.object(views, "microsoft_graph_request", return_value=self.graph_response(record)):
            options = views.apply_teams_meeting_options
            self.assertEqual(views.sync_calendar_event_to_graph(record, {"source": "mcr"}), "")
        options.assert_not_called()

    def test_new_or_replaced_online_meeting_still_gets_its_options(self):
        for existing, join_url in ((False, "https://teams.microsoft.com/meet/new"),
                                   (True, "https://teams.microsoft.com/meet/replaced")):
            with self.subTest(existing=existing):
                record = self.record(existing=existing)
                response = {"id": record.graph_event_id or "new-event", "onlineMeeting": {"joinUrl": join_url}}
                with self.patches(record), patch.object(views, "microsoft_graph_request", return_value=response):
                    options = views.apply_teams_meeting_options
                    self.assertEqual(views.sync_calendar_event_to_graph(record, {"source": "mcr"}), "")
                options.assert_called_once()
                self.assertEqual(options.call_args.args[1], join_url)

    def test_first_booking_still_creates_online_meeting_with_stable_transaction_id(self):
        record = self.record(existing=False)
        response = {"id": "new-event", "onlineMeeting": {"joinUrl": "https://teams.microsoft.com/meet/new"}}
        with self.patches(record), patch.object(views, "microsoft_graph_request", return_value=response) as graph:
            warning = views.sync_calendar_event_to_graph(record, {"source": "mcr"})
        self.assertEqual(warning, "")
        self.assertEqual(graph.call_args.args, ("POST", "users/coach%40example.test/events"))
        self.assertTrue(graph.call_args.kwargs["payload"]["isOnlineMeeting"])
        self.assertEqual(graph.call_args.kwargs["payload"]["transactionId"], str(record.operation_id))
        self.assertEqual(record.graph_event_id, "new-event")

    def test_failed_update_keeps_identity_and_link_without_creating_replacement(self):
        for message in ("Microsoft Graph 403 ErrorAccessDenied", "Microsoft Graph 404 ErrorItemNotFound", "Microsoft Graph timed out"):
            with self.subTest(message=message):
                record = self.record()
                with self.patches(record), patch.object(views, "microsoft_graph_request", side_effect=RuntimeError(message)) as graph:
                    warning = views.sync_calendar_event_to_graph(record, {"source": "mcr"})
                self.assertTrue(warning)
                self.assertEqual([call.args[0] for call in graph.call_args_list], ["PATCH"])
                self.assertEqual(record.graph_event_id, "original-event")
                self.assertEqual(record.meeting_provider, "Microsoft Teams")
                self.assertEqual(record.meeting_link, "https://teams.microsoft.com/meet/original")

    def test_missing_credentials_do_not_clear_previous_link(self):
        record = self.record()
        with patch.object(views, "has_graph_credentials", return_value=False), patch.object(views, "microsoft_graph_request") as graph:
            warning = views.sync_calendar_event_to_graph(record, {"source": "mcr"})
        graph.assert_not_called()
        self.assertEqual(warning, views.TEAMS_SYNC_NOT_CONFIGURED_MESSAGE)
        self.assertEqual(record.meeting_link, "https://teams.microsoft.com/meet/original")
        self.assertEqual(record.graph_event_id, "original-event")

    def test_partial_patch_response_keeps_known_join_url(self):
        record = self.record()
        response = {"id": "original-event", "webLink": record.graph_web_link}
        with self.patches(record), patch.object(views, "microsoft_graph_request", return_value=response):
            self.assertEqual(views.sync_calendar_event_to_graph(record, {"source": "mcr"}), "")
        self.assertEqual(record.meeting_link, "https://teams.microsoft.com/meet/original")

    def test_failed_patch_with_old_link_stays_failed_and_retry_uses_same_event(self):
        record = self.record()
        with self.reservation_patches(record), patch.object(views, "microsoft_graph_request") as graph:
            graph.side_effect = RuntimeError("Microsoft Graph 403 ErrorAccessDenied")
            _, warning, attempted = views.synchronize_reserved_calendar_event(record.pk, {"source": "mcr"})
            self.assertTrue(attempted)
            self.assertTrue(warning)
            self.assertEqual(record.sync_state, CoachCalendarEvent.SYNC_FAILED)
            self.assertEqual(record.meeting_link, "https://teams.microsoft.com/meet/original")
            graph.side_effect = None
            graph.return_value = self.graph_response(record)
            _, warning, attempted = views.synchronize_reserved_calendar_event(record.pk, {"source": "mcr"})
        self.assertEqual(warning, "")
        self.assertTrue(attempted)
        self.assertEqual(record.sync_state, CoachCalendarEvent.SYNC_SYNCED)
        self.assertEqual([call.args[0] for call in graph.call_args_list], ["PATCH", "PATCH"])
        self.assertEqual(graph.call_args_list[0].args[1], graph.call_args_list[1].args[1])

    def test_failed_local_finalization_never_deletes_existing_microsoft_event(self):
        record = self.record()
        with self.reservation_patches(record), \
                patch.object(views, "microsoft_graph_request", return_value=self.graph_response(record)), \
                patch.object(views, "finalize_calendar_graph_sync", side_effect=DatabaseError("save failed")), \
                patch.object(views, "delete_calendar_event_from_graph") as delete, \
                patch.object(CoachCalendarEvent.objects, "filter") as records:
            with self.assertRaises(DatabaseError):
                views.synchronize_reserved_calendar_event(record.pk, {"source": "mcr"})
        delete.assert_not_called()
        recovery = records.return_value.update.call_args.kwargs
        self.assertEqual(recovery["sync_state"], CoachCalendarEvent.SYNC_FAILED)
        self.assertEqual(recovery["graph_event_id"], "original-event")
        self.assertEqual(recovery["graph_organizer_email"], "original-organizer@example.test")
        self.assertEqual(recovery["meeting_link"], "https://teams.microsoft.com/meet/original")

    def test_new_event_finalization_failure_can_compensate_only_that_new_event(self):
        for delete_warning in ("", "Microsoft Graph 403 ErrorAccessDenied"):
            with self.subTest(delete_warning=delete_warning):
                record = self.record(existing=False)
                response = {"id": "new-event", "onlineMeeting": {"joinUrl": "https://teams.microsoft.com/meet/new"}}
                with self.reservation_patches(record), \
                        patch.object(views, "microsoft_graph_request", return_value=response), \
                        patch.object(views, "finalize_calendar_graph_sync", side_effect=DatabaseError("save failed")), \
                        patch.object(views, "delete_calendar_event_from_graph", return_value=delete_warning) as delete, \
                        patch.object(CoachCalendarEvent.objects, "filter") as records:
                    with self.assertRaises(DatabaseError):
                        views.synchronize_reserved_calendar_event(record.pk, {"source": "mcr"})
                delete.assert_called_once_with(record)
                recovery = records.return_value.update.call_args.kwargs
                self.assertEqual(recovery["graph_event_id"], "new-event" if delete_warning else "")
                self.assertEqual(recovery["sync_state"], CoachCalendarEvent.SYNC_RECONCILIATION if delete_warning else CoachCalendarEvent.SYNC_FAILED)


class CalendarRescheduleAvailabilityTests(SimpleTestCase):
    def test_move_excludes_own_old_slot_but_still_rejects_other_busy_time(self):
        import json
        from inspect import unwrap
        from types import SimpleNamespace
        from unittest.mock import MagicMock
        from django.test import RequestFactory
        from learner_api import calendar_connections

        for event_type in ('catch-up', 'student-support', 'lms-introduction'):
            for another_meeting in (False, True):
                with self.subTest(event_type=event_type, another_meeting=another_meeting), ExitStack() as stack:
                    record = CoachCalendarEvent(
                        pk=51, event_key='synthetic-existing', event_type=event_type,
                        owner_email='coach@example.invalid', owner_name='Coach',
                        learner_profile_id=21, learner_name='Synthetic learner', learner_email='learner@example.invalid',
                        target_date=date(2099, 11, 23), scheduled_date=date(2099, 11, 23),
                        scheduled_time=time(10), duration_minutes=60, status='scheduled', sync_state='synced',
                        graph_event_id='original-event', graph_organizer_email='coach@example.invalid',
                        meeting_link='https://example.invalid/original',
                    )
                    record.save = Mock()
                    learner = SimpleNamespace(id=21, learner_type='commercial', enrolment_id=121)
                    database = MagicMock()
                    database.cursor.return_value.__enter__.return_value.fetchall.return_value = [('microsoft',)]
                    stack.enter_context(patch.object(calendar_connections, '_db', return_value=database))
                    stack.enter_context(patch.object(calendar_connections, '_row', return_value={}))
                    busy = [{'start': '2099-11-23T10:00:00Z', 'end': '2099-11-23T11:00:00Z'}]
                    if another_meeting:
                        busy.append({'start': '2099-11-23T10:45:00Z', 'end': '2099-11-23T11:15:00Z'})
                    stack.enter_context(patch.object(calendar_connections, '_sync_connection_busy', return_value=busy))
                    for name, value in {
                        'authenticated_coach_email': record.owner_email,
                        'find_catchup_calendar_record': (record, 'Coach'),
                        'fetch_owner_active_learner_profiles': [learner],
                        'resolve_caseload_source_row': SimpleNamespace(id=121, learner_type='commercial'),
                        'has_graph_credentials': True,
                    }.items():
                        stack.enter_context(patch.object(views, name, return_value=value))
                    reserve = stack.enter_context(patch.object(views, 'persist_calendar_sync_reservation', return_value=record))
                    graph = stack.enter_context(patch.object(views, 'microsoft_graph_request', return_value={
                        'id': record.graph_event_id, 'onlineMeeting': {'joinUrl': record.meeting_link},
                    }))
                    def synchronize(_pk, event):
                        warning = views.sync_calendar_event_to_graph(record, event)
                        return record, warning, True
                    stack.enter_context(patch.object(views, 'synchronize_reserved_calendar_event', side_effect=synchronize))
                    request = RequestFactory().post('/coach_api/coach/timetable/events/schedule',
                        data=json.dumps({'eventKey': record.event_key, 'scheduledDate': '2099-11-23',
                                         'scheduledTime': '10:30', 'durationMinutes': 60, 'timezoneOffsetMinutes': -120}),
                        content_type='application/json')
                    response = unwrap(views.coach_timetable_schedule_event)(request)
                    if another_meeting:
                        self.assertEqual(response.status_code, 409)
                        self.assertEqual(record.scheduled_time, time(10))
                        reserve.assert_not_called()
                        graph.assert_not_called()
                    else:
                        self.assertEqual(response.status_code, 200, response.content)
                        graph.assert_called_once()
                        self.assertEqual(graph.call_args.args, ('PATCH', 'users/coach%40example.invalid/events/original-event'))
                        self.assertEqual(graph.call_args.kwargs['payload']['start']['dateTime'], '2099-11-23T10:30:00')
                        self.assertEqual(record.graph_event_id, 'original-event')
                        self.assertEqual(record.meeting_link, 'https://example.invalid/original')
