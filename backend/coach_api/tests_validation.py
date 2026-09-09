"""Coach API validation contract regressions."""

from __future__ import annotations

import json
import uuid
from datetime import date, time, timedelta
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import patch

from django.test import RequestFactory, SimpleTestCase

from coach_api.views import (
    coach_caseload_coach_rag,
    coach_marking_queue,
    coach_monthly_activity,
    coach_timetable,
    coach_timetable_book_event,
    coach_timetable_event_action,
    ensure_learner_calendar_available,
    ensure_learner_session_not_booked_in_week,
    find_learner_calendar_conflict,
    find_learner_same_session_in_week,
    LearnerCalendarConflict,
    LearnerSessionAlreadyBooked,
)


class CoachValidationContractTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()

    def call(self, view, request, *args):
        request.coach_email = "coach@example.com"
        return unwrap(view)(request, *args)

    def body(self, response):
        return json.loads(response.content)

    def assert_validation_error(self, response, field):
        self.assertEqual(response.status_code, 400)
        payload = self.body(response)
        self.assertEqual(payload["error"], "validation_error")
        self.assertIn(field, payload["fields"])

    def post_action_raw(self, raw):
        request = self.factory.post(
            "/coach_api/coach/timetable/events/action",
            data=raw,
            content_type="application/json",
        )
        return self.call(coach_timetable_event_action, request)

    def test_json_array_null_string_and_number_are_rejected_as_objects(self):
        for raw in ("[]", "null", '"test"', "123"):
            with self.subTest(raw=raw):
                self.assert_validation_error(self.post_action_raw(raw), "body")

    def test_malformed_json_is_rejected(self):
        self.assert_validation_error(self.post_action_raw('{"action":'), "body")

    def test_missing_required_fields_use_standard_contract(self):
        self.assert_validation_error(self.post_action_raw("{}"), "eventKey")

    def test_invalid_action_enum_is_rejected(self):
        response = self.post_action_raw(json.dumps({"eventKey": "event-1", "action": "delete"}))
        self.assert_validation_error(response, "action")

    def test_invalid_month_is_not_silently_replaced(self):
        request = self.factory.get("/coach_api/coach/monthly-activity", {"month": "2026-99"})
        self.assert_validation_error(self.call(coach_monthly_activity, request), "month")

    def test_invalid_and_reversed_timetable_dates_are_rejected(self):
        invalid = self.factory.get("/coach_api/coach/timetable", {"start": "not-a-date"})
        self.assert_validation_error(self.call(coach_timetable, invalid), "start")
        reversed_range = self.factory.get(
            "/coach_api/coach/timetable", {"start": "2026-08-20", "end": "2026-08-19"}
        )
        self.assert_validation_error(self.call(coach_timetable, reversed_range), "end")

    def booking(self, **overrides):
        payload = {
            "learnerId": 1,
            "sessionType": "catch-up",
            "scheduledDate": (date.today() + timedelta(days=1)).isoformat(),
            "scheduledTime": "09:30",
            "durationMinutes": 30,
            "timezoneOffsetMinutes": 0,
        }
        payload.update(overrides)
        request = self.factory.post(
            "/coach_api/coach/timetable/events/book",
            data=json.dumps(payload),
            content_type="application/json",
        )
        return self.call(coach_timetable_book_event, request)

    def test_invalid_date_time_and_event_type_are_rejected(self):
        self.assert_validation_error(self.booking(scheduledDate="2026-02-30"), "scheduledDate")
        self.assert_validation_error(self.booking(scheduledTime="25:00"), "scheduledTime")
        self.assert_validation_error(self.booking(sessionType="internal-sync-state"), "sessionType")

    def test_duration_bounds_are_enforced(self):
        self.assert_validation_error(self.booking(durationMinutes=14), "durationMinutes")
        self.assert_validation_error(self.booking(durationMinutes=481), "durationMinutes")

    def test_excessive_booking_notes_are_rejected_not_truncated(self):
        self.assert_validation_error(self.booking(notes="x" * 501), "notes")

    @patch("coach_api.views.LearnerProfile.objects.annotate")
    def test_invalid_rag_and_excessive_marking_feedback_are_rejected(self, annotate):
        annotate.return_value.filter.return_value.values_list.return_value = [1]
        rag_request = self.factory.patch(
            "/coach_api/coach/caseload/1/coach-rag",
            data=json.dumps({"coachRag": "blue"}),
            content_type="application/json",
        )
        self.assert_validation_error(self.call(coach_caseload_coach_rag, rag_request, 1), "coachRag")

        marking_request = self.factory.patch(
            "/coach_api/coach/marking-queue/submission",
            data=json.dumps({"decision": "referred", "feedback": "x" * 4001}),
            content_type="application/json",
        )
        response = self.call(coach_marking_queue, marking_request, uuid.uuid4())
        self.assert_validation_error(response, "feedback")


class LearnerCalendarConflictTests(SimpleTestCase):
    @patch("coach_api.views.CoachCalendarEvent.objects.filter")
    def test_partially_overlapping_lms_session_is_found(self, event_filter):
        existing = SimpleNamespace(
            id=1,
            scheduled_date=date(2026, 9, 8),
            scheduled_time=time(10, 0),
            duration_minutes=60,
        )
        event_filter.return_value.only.return_value = [existing]

        conflict = find_learner_calendar_conflict(
            learner_id=7,
            learner_email="learner@example.com",
            scheduled_date=date(2026, 9, 8),
            scheduled_time=time(10, 30),
            duration_minutes=30,
        )

        self.assertIs(conflict, existing)
        # The lookup is learner-wide and deliberately has no coach/owner filter.
        self.assertNotIn("owner_email", event_filter.call_args.kwargs)

    @patch("coach_api.views.CoachCalendarEvent.objects.filter")
    def test_adjacent_lms_sessions_do_not_conflict(self, event_filter):
        existing = SimpleNamespace(
            id=1,
            scheduled_date=date(2026, 9, 8),
            scheduled_time=time(10, 0),
            duration_minutes=60,
        )
        event_filter.return_value.only.return_value = [existing]

        conflict = find_learner_calendar_conflict(
            learner_id=7,
            learner_email="learner@example.com",
            scheduled_date=date(2026, 9, 8),
            scheduled_time=time(11, 0),
            duration_minutes=30,
        )

        self.assertIsNone(conflict)

    @patch("coach_api.views.CoachCalendarEvent.objects.filter")
    def test_same_session_type_is_found_anywhere_in_monday_to_sunday_week(self, event_filter):
        existing = SimpleNamespace(
            id=4,
            scheduled_date=date(2026, 9, 9),
            scheduled_time=time(14, 0),
        )
        event_filter.return_value.order_by.return_value.first.return_value = existing

        result = find_learner_same_session_in_week(
            learner_id=7,
            learner_email="learner@example.com",
            session_type="catch-up",
            scheduled_date=date(2026, 9, 11),
        )

        self.assertIs(result, existing)
        self.assertEqual(
            event_filter.call_args.kwargs["scheduled_date__range"],
            (date(2026, 9, 7), date(2026, 9, 13)),
        )
        self.assertEqual(event_filter.call_args.kwargs["event_type__iexact"], "catch-up")

    @patch("coach_api.views.find_learner_same_session_in_week")
    def test_duplicate_session_message_offers_reschedule(self, find_same):
        find_same.return_value = SimpleNamespace(
            event_type="catch-up",
            sequence=2,
            scheduled_date=date(2026, 9, 8),
            scheduled_time=time(10, 30),
        )

        with self.assertRaisesRegex(
            LearnerSessionAlreadyBooked,
            "Would you like to reschedule it instead",
        ) as raised:
            ensure_learner_session_not_booked_in_week(
                learner_id=7,
                learner_email="learner@example.com",
                session_type="catch-up",
                scheduled_date=date(2026, 9, 8),
            )

        self.assertIn("Catch-up Session 2", str(raised.exception))
        self.assertIn("Tuesday, 8 September 2026 at 10:30", str(raised.exception))

    @patch("coach_api.views.find_learner_calendar_conflict")
    def test_any_session_time_conflict_identifies_existing_slot_and_offers_reschedule(
        self, find_conflict
    ):
        find_conflict.return_value = SimpleNamespace(
            event_type="student-support",
            sequence=3,
            scheduled_date=date(2026, 9, 9),
            scheduled_time=time(14, 0),
        )

        with self.assertRaisesRegex(
            LearnerCalendarConflict,
            "Would you like to reschedule that session instead",
        ) as raised:
            ensure_learner_calendar_available(
                learner_id=7,
                learner_email="learner@example.com",
                scheduled_date=date(2026, 9, 9),
                scheduled_time=time(14, 30),
                duration_minutes=30,
            )

        self.assertIn("Student Support 3", str(raised.exception))
        self.assertIn("Wednesday, 9 September 2026 at 14:00", str(raised.exception))

