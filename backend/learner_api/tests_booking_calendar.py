"""Working-day rules shared by every learner calendar session type."""

import inspect
import json
from datetime import date
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.test import RequestFactory, SimpleTestCase

from .booking_calendar import booking_calendar_payload, booking_date_restriction


class BookingDateRestrictionTests(SimpleTestCase):
    def test_saturday_and_sunday_are_closed(self):
        self.assertEqual(booking_date_restriction(date(2026, 9, 5)).code, "weekend")
        self.assertEqual(booking_date_restriction(date(2026, 9, 6)).code, "weekend")

    def test_england_and_wales_bank_holiday_is_closed(self):
        restriction = booking_date_restriction(date(2026, 12, 28))

        self.assertEqual(restriction.code, "bank-holiday")
        self.assertIn("Boxing Day", restriction.message)

    def test_ordinary_weekday_is_open(self):
        self.assertIsNone(booking_date_restriction(date(2026, 9, 7)))

    def test_unpublished_year_fails_closed(self):
        self.assertEqual(
            booking_date_restriction(date(2029, 1, 2)).code,
            "calendar-unavailable",
        )

    def test_payload_exposes_the_same_holidays_to_the_calendar_ui(self):
        payload = booking_calendar_payload()

        holiday = next(row for row in payload["bankHolidays"] if row["date"] == "2026-12-28")
        self.assertIn("Boxing Day", holiday["title"])
        self.assertIn(2026, payload["coveredYears"])


class BookingEndpointRestrictionTests(SimpleTestCase):
    def test_every_coach_session_type_is_rejected_on_a_weekend(self):
        from . import calendar as module

        learner = SimpleNamespace(username="Test Learner", email="learner@example.com")
        mirror = SimpleNamespace(
            coach_email="coach@example.com",
            coach_name="Coach",
            full_name="Test Learner",
            email="learner@example.com",
        )
        source_model = Mock()
        source_model.all_learners.filter.return_value.first.return_value = learner
        # Bypass only the authentication wrapper; this test is about the view's
        # own booking rule and must never reach a database or Microsoft Graph.
        view = inspect.unwrap(module.learner_calendar_book)

        for session_type in module.BOOKABLE_TYPES:
            with self.subTest(session_type=session_type), \
                    patch.object(module, "SOURCE_MODELS", {"commercial": source_model}), \
                    patch.object(module, "learner_profile_for_source", return_value=mirror):
                request = RequestFactory().post(
                    "/learner_api/calendar/commercial/101/book/",
                    data=json.dumps({
                        "sessionType": session_type,
                        "scheduledDate": "2026-09-05",
                        "scheduledTime": "10:00",
                        "durationMinutes": 60,
                    }),
                    content_type="application/json",
                )
                response = view(request, "commercial", 101)

            self.assertEqual(response.status_code, 400)
            self.assertIn("Saturdays or Sundays", json.loads(response.content)["error"])
