"""Aptem PR/MCM booking boundaries; all persistence and Graph calls are mocked."""
import json
from datetime import date, time
from inspect import unwrap
from unittest.mock import MagicMock, patch

from django.test import RequestFactory, SimpleTestCase

from coach_api import views
from coach_api.models import CoachCalendarEvent
from coach_api.test_review_source_separation import profile, source, base_event, imported_row
from . import calendar
from . import tests_booking_calendar


class AptemBookingAvailabilityTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()
        # Exercise the current slot preflight; only transport/storage
        # responses are synthetic, not the availability validator.
        self.graph = self.enterContext(patch.object(views, "microsoft_graph_request", side_effect=self.free_schedule))
        self.records = MagicMock()
        self.records.exclude.return_value = self.records
        self.records.__iter__.return_value = iter(())
        self.records.first.return_value = None
        self.enterContext(patch.object(CoachCalendarEvent.objects, "filter", return_value=self.records))
        self.personal = self.enterContext(patch("learner_api.calendar_connections.booking_conflicts", return_value=False))
        self.sync = self.enterContext(patch.object(views, "synchronize_reserved_calendar_event"))
        self.persist = self.enterContext(patch.object(views, "persist_calendar_sync_reservation"))
        self.reserve_imported = self.enterContext(patch(
            "learner_api.imported_booking.reserve_imported_booking",
            side_effect=lambda record, event, *args, **kwargs: (self.persist(record, review_event=event), True),
        ))
        # Availability boundaries do not depend on the review lifecycle; the
        # overlay transition after a confirmed booking has its own suites.
        self.enterContext(patch("learner_api.imported_booking.schedule_overlay_for_booking",
                                return_value=False))
        self.enterContext(patch.object(calendar, "booking_date_restriction", return_value=None))
        self.enterContext(patch.object(calendar, "_mark_imported_review_scheduled"))
        self.enterContext(patch.object(calendar, "_record_enrolment_review"))
        self.enterContext(patch.object(calendar, "_follow_first_session_start_date"))
        self.enterContext(patch.object(calendar, "_booking_response_event", return_value={"eventKey": "saved"}))

    def free_schedule(self, method, path, payload=None, **kwargs):
        if method != "POST" or not path.endswith("/calendar/getSchedule"):
            raise AssertionError("Unexpected external request in availability fixture")
        return {"value": [{"scheduleId": payload["schedules"][0], "availabilityView": "0" * 96}]}

    def busy_schedule(self, method, path, payload=None, **kwargs):
        response = self.free_schedule(method, path, payload, **kwargs)
        response["value"][0]["availabilityView"] = "2" * 96
        return response

    def payload(self):
        return {"scheduledDate": "2026-11-20", "scheduledTime": "11:30", "durationMinutes": 60, "timezoneOffsetMinutes": -120,
                "expectedBooking": {"scheduledDate": "2026-09-08", "scheduledTime": "10:00", "durationMinutes": 60}}

    def test_new_booking_rejects_busy_or_unknown_coach_before_any_calendar_write(self):
        for kind in ("commercial", "apprenticeship"):
            for family in ("Monthly Coaching Meeting", "Progress Review", "Progress Review (+ Skills Radar)"):
                for status in (409, 503):
                    with self.subTest(kind=kind, family=family, status=status):
                        event = base_event(imported_row(review_type=family))
                        person = source(); person.username = "Synthetic learner"
                        model = MagicMock(); model.all_learners.filter.return_value.first.return_value = person
                        with patch.dict(calendar.SOURCE_MODELS, {kind: model}), \
                             patch.object(calendar, "_calendar_profile", return_value=profile()), \
                             patch.object(calendar, "coaching_events_for_learner", return_value=[event]), \
                             patch.object(calendar.CoachCalendarEvent.objects, "filter") as lookup, \
                             patch.object(calendar.CoachCalendarEvent.objects, "get_or_create") as create:
                            lookup.return_value.first.return_value = None
                            self.graph.side_effect = self.busy_schedule if status == 409 else RuntimeError("Synthetic calendar outage")
                            request = self.factory.post("/book/", data=json.dumps({**self.payload(), "reviewId": event["reviewId"], "sessionType": event["source"], "assignmentMonth": "2026-11"}), content_type="application/json")
                            response = unwrap(calendar.learner_calendar_book)(request, kind, 121)
                            self.assertEqual(response.status_code, status, response.content)
                            create.assert_not_called()
                            self.persist.assert_not_called(); self.sync.assert_not_called()
                            self.assertEqual(self.personal.call_args.kwargs["business_time_zone"], "Europe/London")

    def test_reschedule_rejects_busy_or_unavailable_before_mutating_the_record(self):
        for kind in ("commercial", "apprenticeship"):
            for session_type in ("mcr", "progress-review"):
                for status in (409, 503):
                    with self.subTest(kind=kind, session_type=session_type, status=status):
                        record = tests_booking_calendar.RescheduleEndpointTests.scheduled_record()
                        record.event_type = session_type
                        record._imported_review_event = {"reviewSource": "aptem", "reviewId": "401", "learnerId": "101"}
                        self.graph.side_effect = self.busy_schedule if status == 409 else RuntimeError("Synthetic calendar outage")
                        with patch.dict(calendar.SOURCE_MODELS, {kind: MagicMock()}), patch.object(calendar, "_learner_booking_record", return_value=record):
                            request = self.factory.patch("/reschedule/", data=json.dumps({**self.payload(), "eventKey": record.event_key}), content_type="application/json")
                            response = unwrap(calendar.learner_calendar_reschedule)(request, kind, 121)
                        self.assertEqual(response.status_code, status, response.content)
                        self.assertEqual(record.scheduled_time, time(10))
                        self.persist.assert_not_called(); self.sync.assert_not_called()

    def test_reschedule_uses_uk_personal_calendar_and_the_original_booking(self):
        record = tests_booking_calendar.RescheduleEndpointTests.scheduled_record()
        record._imported_review_event = {"reviewSource": "aptem", "reviewId": "401", "learnerId": "101"}
        self.persist.return_value = record
        self.sync.return_value = (record, "", True)
        with patch.dict(calendar.SOURCE_MODELS, {"commercial": MagicMock()}), patch.object(calendar, "_learner_booking_record", return_value=record):
            request = self.factory.patch("/reschedule/", data=json.dumps({**self.payload(), "eventKey": record.event_key}), content_type="application/json")
            response = unwrap(calendar.learner_calendar_reschedule)(request, "commercial", 121)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self.personal.call_args.kwargs["business_time_zone"], "Europe/London")
        self.assertEqual(self.personal.call_args.kwargs["exclude_scheduled_date"], date(2026, 9, 8))
        self.records.exclude.assert_any_call(pk=record.pk)
        self.persist.assert_called_once_with(record, review_event=record._imported_review_event)
        self.assertEqual(record.graph_event_id, "graph-event-1")

    def test_unreserved_placeholder_can_retry_but_cannot_change_its_owner(self):
        event = base_event(imported_row(review_type="Progress Review"))
        person = source(); person.username = "Synthetic learner"
        model = MagicMock(); model.all_learners.filter.return_value.first.return_value = person
        for valid_owner in (True, False):
            with self.subTest(valid_owner=valid_owner):
                record = CoachCalendarEvent(pk=51, event_key=event["eventKey"],
                    learner_id=int(event["learnerId"]), event_type=event["source"],
                    owner_email=profile().coach_email if valid_owner else "another@example.test",
                    target_date=date(2026, 11, 20))
                self.persist.reset_mock(); self.sync.reset_mock()
                self.persist.return_value = record; self.sync.return_value = (record, "", True)
                with patch.dict(calendar.SOURCE_MODELS, {"commercial": model}), \
                     patch.object(calendar, "_calendar_profile", return_value=profile()), \
                     patch.object(calendar, "coaching_events_for_learner", return_value=[event]), \
                     patch.object(calendar.CoachCalendarEvent.objects, "filter") as lookup, \
                     patch.object(calendar.CoachCalendarEvent.objects, "get_or_create", return_value=(record, False)):
                    lookup.return_value.first.return_value = record
                    request = self.factory.post("/book/", data=json.dumps({**self.payload(), "reviewId": event["reviewId"],
                        "sessionType": event["source"], "assignmentMonth": "2026-11"}), content_type="application/json")
                    response = unwrap(calendar.learner_calendar_book)(request, "commercial", 121)
                self.assertEqual(response.status_code, 200 if valid_owner else 409, response.content)
                if valid_owner:
                    self.persist.assert_called_once_with(record, review_event=event)
                    self.assertEqual(record.pk, 51)
                else:
                    self.persist.assert_not_called(); self.sync.assert_not_called()
