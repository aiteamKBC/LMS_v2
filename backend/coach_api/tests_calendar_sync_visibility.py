"""A failed Microsoft sync must not erase or hide a locally saved appointment."""
from contextlib import ExitStack
from datetime import date, time
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase

from . import views
from .models import CoachCalendarEvent
from learner_api.calendar import _serialize_event


class CalendarSyncVisibilityTests(SimpleTestCase):
    def record(self, event_type="mcr", **overrides):
        values = dict(
            event_key=f"{event_type}:211:1:2026-10-31", event_type=event_type,
            learner_id=211, learner_name="Learner", learner_email="learner@example.test",
            owner_email="coach@example.test", owner_name="Coach", sequence=1,
            target_date=date(2026, 10, 31), scheduled_date=date(2026, 10, 2),
            scheduled_time=time(9), duration_minutes=60, status="scheduled",
            sync_state="failed", last_graph_sync_error="HTTP 403: ErrorAccessDenied",
        )
        values.update(overrides)
        return CoachCalendarEvent(**values)

    def test_repeated_calendar_reads_keep_booked_time_without_save_or_graph_delete(self):
        for event_type in ("mcr", "progress-review", "catch-up"):
            with self.subTest(event_type=event_type):
                record = self.record(event_type)
                with patch.object(record, "save") as save, \
                        patch.object(views, "delete_calendar_event_from_graph") as delete, \
                        patch.object(CoachCalendarEvent.objects, "filter", return_value=[record]):
                    for _ in range(2):
                        found = views.fetch_calendar_event_records(record.owner_email, [record.event_key])
                        self.assertIs(found[record.event_key], record)
                self.assertEqual(record.status, "scheduled")
                self.assertEqual(record.scheduled_date, date(2026, 10, 2))
                self.assertEqual(record.scheduled_time, time(9))
                save.assert_not_called()
                delete.assert_not_called()

    def test_sync_warning_preserves_booking_and_remote_identity_for_retry(self):
        record = self.record(graph_event_id="existing-remote-event")
        with patch.object(record, "save") as save, \
                patch.object(views, "delete_calendar_event_from_graph") as delete:
            views.save_calendar_sync_warning(record, reason=record.last_graph_sync_error)
        self.assertEqual(record.graph_event_id, "existing-remote-event")
        self.assertEqual(record.status, "scheduled")
        self.assertEqual(record.scheduled_date, date(2026, 10, 2))
        self.assertEqual(record.scheduled_time, time(9))
        self.assertEqual(record.last_graph_sync_error, views.TEAMS_SYNC_PERMISSION_MESSAGE)
        save.assert_called_once_with(update_fields=["last_graph_sync_error", "updated_at"])
        delete.assert_not_called()

    def test_public_warning_keeps_the_permission_diagnosis_after_repeated_serialization(self):
        warning = "HTTP 403: ErrorAccessDenied"
        for _ in range(3):
            warning = views.public_graph_sync_warning(warning)
            self.assertEqual(warning, views.TEAMS_SYNC_PERMISSION_MESSAGE)

    def test_learner_calendar_keeps_saved_slot_and_exposes_invitation_failure(self):
        event = _serialize_event(self.record())
        self.assertEqual(event["status"], "scheduled")
        self.assertEqual(event["date"], "2026-10-02")
        self.assertEqual(event["scheduledTime"], "09:00")
        self.assertEqual(event["durationMinutes"], 60)
        self.assertEqual(event["syncState"], "failed")
        self.assertFalse(event["invited"])
        self.assertIn("administrator", event["syncWarning"])
        self.assertNotIn("HTTP 403", event["syncError"])

    def test_imported_booking_exposes_durable_review_identity_for_calendar_rescheduling(self):
        for event_type, key_type in [('mcr', 'mcm'), ('progress-review', 'progress-review')]:
            with self.subTest(event_type=event_type):
                event = _serialize_event(self.record(event_type, idempotency_key=f'learner-book:{key_type}:commercial:125:2026-10:9'))
                self.assertEqual(event['reviewId'], '9')
                self.assertEqual(event['assignmentMonth'], '2026-10')
        legacy = _serialize_event(self.record(idempotency_key='learner-book:mcm:commercial:125:2026-10'))
        self.assertEqual(legacy['reviewId'], '')

    def test_coach_week_uses_saved_date_even_when_target_is_outside_requested_range(self):
        learner = SimpleNamespace(id=211, username="Learner", email="learner@example.test",
            programme="Programme", cohort="C1", learner_type="commercial", enrolment_id=125)
        for event_type in ("mcr", "progress-review"):
            with self.subTest(event_type=event_type), ExitStack() as stack:
                record = self.record(event_type)
                responses = {
                    "fetch_owner_active_learner_profiles": [learner],
                    "coach_staff_display_name": "Coach",
                    "fetch_source_schedule_rows": ({}, {}),
                    "resolve_schedule_window": (record.target_date - (views.TIMETABLE_MCR_INTERVAL if event_type == 'mcr' else views.TIMETABLE_PROGRESS_REVIEW_INTERVAL), date(2027, 10, 1)),
                    "resolve_caseload_source_row": None,
                    "learner_employer_attendee": None,
                    "fetch_standalone_event_records": [record],
                    "fetch_calendar_event_records": {record.event_key: record},
                }
                for name, result in responses.items():
                    stack.enter_context(patch.object(views, name, return_value=result))
                with patch.object(record, "save") as save:
                    result = views.collect_generated_timetable(record.owner_email,
                        start_date=date(2026, 10, 1), end_date=date(2026, 10, 3),
                        include_live_sessions=False, include_scheduler_queues=False)
                self.assertEqual(len(result["events"]), 1)
                event = result["events"][0]
                self.assertEqual(event["eventKey"], record.event_key)
                self.assertEqual(event["date"], "2026-10-02")
                self.assertEqual(event["startHour"], 9)
                self.assertEqual(event["status"], "scheduled")
                self.assertTrue(event["syncWarning"])
                save.assert_not_called()

    def test_saved_appointments_remain_in_organiser_calendar_after_caseload_changes(self):
        records = [self.record(event_type) for event_type in ("mcr", "progress-review")]
        with ExitStack() as stack:
            for name, result in {
                "fetch_owner_active_learner_profiles": [],
                "coach_staff_display_name": "Coach",
                "fetch_source_schedule_rows": ({}, {}),
                "fetch_standalone_event_records": records,
                "fetch_calendar_event_records": {},
            }.items():
                stack.enter_context(patch.object(views, name, return_value=result))
            result = views.collect_generated_timetable("coach@example.test",
                start_date=date(2026, 10, 1), end_date=date(2026, 10, 7),
                include_live_sessions=False, include_scheduler_queues=False)
        self.assertEqual({event['eventKey'] for event in result['events']}, {record.event_key for record in records})
        self.assertTrue(all(event['date'] == '2026-10-02' for event in result['events']))
        self.assertEqual(next(event['type'] for event in result['events'] if event['source'] == 'progress-review'), 'review')
