"""Working-day rules shared by every learner calendar session type."""

import inspect
import json
from datetime import date, time
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.test import RequestFactory, SimpleTestCase

from .booking_calendar import booking_calendar_payload, booking_date_restriction


class BookingDateRestrictionTests(SimpleTestCase):
    def restriction_on_2026_09_01(self, day):
        return booking_date_restriction(day, today=date(2026, 9, 1))

    def test_a_date_before_today_is_closed(self):
        restriction = self.restriction_on_2026_09_01(date(2026, 8, 28))

        self.assertEqual(restriction.code, "past-date")
        self.assertIn("already passed", restriction.message)

    def test_saturday_and_sunday_are_closed(self):
        self.assertEqual(self.restriction_on_2026_09_01(date(2026, 9, 5)).code, "weekend")
        self.assertEqual(self.restriction_on_2026_09_01(date(2026, 9, 6)).code, "weekend")

    def test_england_and_wales_bank_holiday_is_closed(self):
        restriction = self.restriction_on_2026_09_01(date(2026, 12, 28))

        self.assertEqual(restriction.code, "bank-holiday")
        self.assertIn("Boxing Day", restriction.message)

    def test_ordinary_weekday_is_open(self):
        self.assertIsNone(self.restriction_on_2026_09_01(date(2026, 9, 7)))

    def test_unpublished_year_fails_closed(self):
        self.assertEqual(
            self.restriction_on_2026_09_01(date(2029, 1, 2)).code,
            "calendar-unavailable",
        )

    def test_payload_exposes_the_same_holidays_to_the_calendar_ui(self):
        with patch(
            "learner_api.booking_calendar.timezone.localdate",
            return_value=date(2026, 9, 7),
        ):
            payload = booking_calendar_payload()

        holiday = next(row for row in payload["bankHolidays"] if row["date"] == "2026-12-28")
        self.assertIn("Boxing Day", holiday["title"])
        self.assertIn(2026, payload["coveredYears"])
        self.assertEqual(payload["today"], "2026-09-07")


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
                    patch.object(module, "learner_profile_for_source", return_value=mirror), \
                    patch("learner_api.booking_calendar.timezone.localdate", return_value=date(2026, 9, 1)):
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

    def test_a_direct_booking_request_for_a_past_date_is_rejected(self):
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
        view = inspect.unwrap(module.learner_calendar_book)

        with patch.object(module, "SOURCE_MODELS", {"commercial": source_model}), \
                patch.object(module, "learner_profile_for_source", return_value=mirror), \
                patch("learner_api.booking_calendar.timezone.localdate", return_value=date(2026, 9, 7)):
            request = RequestFactory().post(
                "/learner_api/calendar/commercial/101/book/",
                data=json.dumps({
                    "sessionType": module.BOOKABLE_TYPES[0],
                    "scheduledDate": "2026-09-04",
                    "scheduledTime": "10:00",
                    "durationMinutes": 60,
                }),
                content_type="application/json",
            )
            response = view(request, "commercial", 101)

        self.assertEqual(response.status_code, 400)
        self.assertIn("already passed", json.loads(response.content)["error"])


class RescheduleEndpointTests(SimpleTestCase):
    @staticmethod
    def scheduled_record():
        return SimpleNamespace(
            pk=55,
            event_key="progress-review:101:3:2026-09-08",
            event_type="progress-review",
            sequence=3,
            status="scheduled",
            target_date=date(2026, 9, 8),
            scheduled_date=date(2026, 9, 8),
            scheduled_time=time(10, 0),
            duration_minutes=60,
            owner_name="Coach Example",
            owner_email="coach@example.com",
            learner_id=101,
            learner_name="Test Learner",
            learner_email="learner@example.com",
            meeting_provider="Microsoft Teams",
            meeting_link="https://teams.microsoft.com/l/meetup-join/test",
            graph_web_link="https://outlook.office.com/calendar/item/test",
            graph_event_id="graph-event-1",
            notes="",
            review_responses={},
            review_completed_at=None,
            last_graph_sync_error="",
        )

    def request(self):
        return RequestFactory().patch(
            "/learner_api/calendar/commercial/101/reschedule/",
            data=json.dumps({
                "eventKey": "progress-review:101:3:2026-09-08",
                "scheduledDate": "2026-09-09",
                "scheduledTime": "11:30",
                "durationMinutes": 45,
                "timezoneOffsetMinutes": 0,
            }),
            content_type="application/json",
        )

    def test_reschedule_updates_the_same_booking_record(self):
        from . import calendar as module

        record = self.scheduled_record()
        view = inspect.unwrap(module.learner_calendar_reschedule)
        with patch.object(module, "SOURCE_MODELS", {"commercial": Mock()}), \
                patch.object(module, "_learner_booking_record", return_value=record), \
                patch("learner_api.booking_calendar.timezone.localdate", return_value=date(2026, 9, 7)), \
                patch("learner_api.calendar_connections.booking_conflicts", return_value=False), \
                patch("coach_api.views.build_booked_calendar_event", return_value={}) as build_event, \
                patch("coach_api.views.persist_calendar_sync_reservation", return_value=record) as persist, \
                patch("coach_api.views.synchronize_reserved_calendar_event", return_value=(record, "", True)) as sync:
            response = view(self.request(), "commercial", 101)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(record.scheduled_date, date(2026, 9, 9))
        self.assertEqual(record.scheduled_time.strftime("%H:%M"), "11:30")
        self.assertEqual(record.duration_minutes, 45)
        persist.assert_called_once_with(record)
        build_event.assert_called_once_with(record)
        sync.assert_called_once_with(record.pk, {})

    def test_reschedule_returns_conflict_for_any_other_overlapping_session(self):
        from coach_api.views import LearnerCalendarConflict
        from . import calendar as module

        record = self.scheduled_record()
        view = inspect.unwrap(module.learner_calendar_reschedule)
        with patch.object(module, "SOURCE_MODELS", {"commercial": Mock()}), \
                patch.object(module, "_learner_booking_record", return_value=record), \
                patch("learner_api.booking_calendar.timezone.localdate", return_value=date(2026, 9, 7)), \
                patch("learner_api.calendar_connections.booking_conflicts", return_value=False), \
                patch("coach_api.views.persist_calendar_sync_reservation", side_effect=LearnerCalendarConflict("This learner already has another session at that time.")), \
                patch("coach_api.views.synchronize_reserved_calendar_event") as sync:
            response = view(self.request(), "commercial", 101)

        self.assertEqual(response.status_code, 409)
        self.assertIn("already has another session", json.loads(response.content)["error"])
        sync.assert_not_called()

    def test_booking_lookup_accepts_current_active_users_mirror_id(self):
        from . import calendar as module

        learner = SimpleNamespace(email="learner@example.com")
        mirror = SimpleNamespace(id=248, email="learner@example.com")
        record = self.scheduled_record()
        record.event_key = "progress-review:248:3:2026-09-08"
        record.learner_id = 248

        source_model = Mock()
        source_model.all_learners.filter.return_value.first.return_value = learner
        with patch.object(module, "SOURCE_MODELS", {"commercial": source_model}), \
                patch.object(module, "learner_profile_for_source", return_value=mirror), \
                patch.object(module.CoachCalendarEvent.objects, "filter") as event_filter:
            event_filter.return_value.first.return_value = record

            found = module._learner_booking_record("commercial", 101, record.event_key)

        self.assertIs(found, record)
