"""Coach API validation contract regressions."""

from __future__ import annotations

import json
import uuid
from datetime import date, timedelta
from inspect import unwrap
from unittest.mock import patch

from django.test import RequestFactory, SimpleTestCase

from coach_api.views import (
    coach_caseload_coach_rag,
    coach_marking_queue,
    coach_monthly_activity,
    coach_timetable,
    coach_timetable_book_event,
    coach_timetable_event_action,
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

