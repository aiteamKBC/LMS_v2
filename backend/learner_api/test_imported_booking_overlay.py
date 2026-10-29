"""A learner's own Aptem booking must leave the Review in a bookable state.

Booking lives on the calendar record and the lifecycle lives on the overlay.
When the learner schedules the meeting, the Coach's form has to agree: the
Start/Submit gates read the lifecycle, so a booked Review that stayed
not-scheduled hides actions the booking has already earned.

No database access in the unit cases; the endpoint cases use synthetic rows
and mocked Graph/availability. PostgreSQL locking is not covered here.
"""
import json
from contextlib import nullcontext
from datetime import date, time
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, patch

from django.test import RequestFactory, SimpleTestCase, TestCase

from coach_api import views
from coach_api.models import CoachCalendarEvent, ImportedReviewInstance

from . import calendar, imported_booking


OWNER = "coach@example.invalid"
KEY = "imported-review:5101"


def aptem_event(**overrides):
    event = {
        "reviewSource": "aptem", "eventKey": KEY, "calendarEventKey": None,
        "reviewId": "401", "aptemReviewId": "5101", "learnerId": "101",
        "source": "mcr", "importedReviewType": "Monthly Coaching Meeting",
        "status": "not-scheduled", "coachEmail": OWNER, "coachName": "Coach",
        "learner": "Test Learner", "email": "learner@example.invalid",
        "sequence": 1, "targetDate": "2026-11-02",
    }
    event.update(overrides)
    return event


class ScheduleOverlayForBookingTests(SimpleTestCase):
    """The promotion rule itself: one step, only on a verified meeting."""

    def setUp(self):
        self.record = CoachCalendarEvent(
            pk=51, event_key=KEY, learner_id=101, owner_email=OWNER, event_type="mcr",
            status=CoachCalendarEvent.STATUS_SCHEDULED, sync_state=CoachCalendarEvent.SYNC_SYNCED,
            graph_event_id="existing-graph", meeting_link="https://example.invalid/meeting",
            scheduled_date=date(2026, 11, 2), scheduled_time=time(10), duration_minutes=60,
        )
        self.record.save = MagicMock()
        self.overlay = ImportedReviewInstance(
            pk=7, event_key=KEY, owner_email=OWNER, learner_id=101, source_review_id=401,
            status=ImportedReviewInstance.STATUS_NOT_SCHEDULED,
        )
        self.overlay.save = MagicMock()
        self.event = aptem_event()
        self.enterContext(patch.object(imported_booking.transaction, "atomic", return_value=nullcontext()))
        self.lock = self.enterContext(patch.object(views, "lock_learner_calendar"))
        query = self.enterContext(patch.object(CoachCalendarEvent.objects, "select_for_update"))
        query.return_value.get.return_value = self.record
        overlays = self.enterContext(patch.object(ImportedReviewInstance.objects, "select_for_update"))
        self.overlays = overlays.return_value.filter.return_value.filter
        self.overlays.return_value = [self.overlay]

    def schedule(self):
        return imported_booking.schedule_overlay_for_booking(self.record.pk, self.event)

    def test_a_confirmed_learner_booking_schedules_the_coachs_working_copy(self):
        self.assertTrue(self.schedule())
        self.assertEqual(self.overlay.status, ImportedReviewInstance.STATUS_SCHEDULED)
        self.overlay.save.assert_called_once_with(update_fields=["status", "updated_at"])
        self.lock.assert_called_once_with("101")
        # Booking state only: the calendar row and the Aptem row are untouched.
        self.record.save.assert_not_called()

    def test_an_unconfirmed_booking_leaves_the_working_copy_alone(self):
        for field, value in (("sync_state", CoachCalendarEvent.SYNC_PENDING),
                             ("sync_state", CoachCalendarEvent.SYNC_FAILED),
                             ("status", CoachCalendarEvent.STATUS_CANCELLED),
                             ("graph_event_id", ""),
                             ("meeting_link", ""),
                             ("scheduled_time", None)):
            with self.subTest(field=field):
                original = getattr(self.record, field)
                setattr(self.record, field, value)
                self.assertFalse(self.schedule())
                self.assertEqual(self.overlay.status, ImportedReviewInstance.STATUS_NOT_SCHEDULED)
                self.overlay.save.assert_not_called()
                setattr(self.record, field, original)

    def test_a_started_or_finished_review_is_never_rewound_or_advanced(self):
        for status in (ImportedReviewInstance.STATUS_SCHEDULED, ImportedReviewInstance.STATUS_IN_PROGRESS,
                       ImportedReviewInstance.STATUS_AWAITING_SIGNATURE,
                       ImportedReviewInstance.STATUS_COMPLETED):
            with self.subTest(status=status):
                self.overlay.status = status
                self.assertFalse(self.schedule())
                self.assertEqual(self.overlay.status, status)
                self.overlay.save.assert_not_called()

    def test_a_review_with_no_working_copy_yet_is_not_an_error(self):
        self.overlays.return_value = []
        self.assertFalse(self.schedule())

    def test_an_ambiguous_continuation_is_refused_instead_of_guessed(self):
        second = ImportedReviewInstance(pk=8, event_key=KEY, owner_email=OWNER, learner_id=101,
                                        source_review_id=401, status="not-scheduled")
        second.save = MagicMock()
        self.overlays.return_value = [self.overlay, second]
        self.assertFalse(self.schedule())
        self.overlay.save.assert_not_called()
        second.save.assert_not_called()

    def test_a_booking_that_belongs_to_another_review_is_refused(self):
        self.record.event_type = "progress-review"
        self.assertFalse(self.schedule())
        self.overlay.save.assert_not_called()

    def test_an_unsupported_session_type_never_touches_the_lifecycle(self):
        self.assertFalse(imported_booking.schedule_overlay_for_booking(
            self.record.pk, aptem_event(importedReviewType="Personal Support Plan")))
        self.lock.assert_not_called()
        self.overlay.save.assert_not_called()


class LearnerBookingEndpointOverlayTests(TestCase):
    """The booking endpoint wires the promotion in, and rolls back failures."""

    def setUp(self):
        self.overlay = ImportedReviewInstance.objects.create(
            event_key=KEY, owner_email=OWNER, learner_id=101, source_review_id=401,
            status=ImportedReviewInstance.STATUS_NOT_SCHEDULED,
            template_snapshot={"sections": [{"id": "s"}]},
        )
        self.event = aptem_event()
        mirror = SimpleNamespace(id=101, coach_email=OWNER, coach_name="Coach",
                                 full_name="Test Learner", email="learner@example.invalid",
                                 lifecycle_status="active")
        learner = SimpleNamespace(username="Test Learner", email="learner@example.invalid")
        source_model = Mock()
        source_model.all_learners.filter.return_value.first.return_value = learner
        self.enterContext(patch.object(calendar, "SOURCE_MODELS", {"commercial": source_model}))
        self.enterContext(patch.object(calendar, "learner_profile_for_source", return_value=mirror))
        self.enterContext(patch.object(calendar, "review_profile_for_source", return_value=mirror))
        self.enterContext(patch.object(calendar, "source_for_learner",
                                       return_value=SimpleNamespace(kind="aptem")))
        self.enterContext(patch.object(calendar, "coaching_events_for_learner",
                                       side_effect=lambda *_a, **_k: [dict(self.event)]))
        self.enterContext(patch.object(calendar, "_mark_imported_review_scheduled"))
        self.enterContext(patch.object(calendar, "_booking_response_event",
                                       side_effect=lambda record, target: {"eventKey": record.event_key}))
        self.enterContext(patch("learner_api.calendar_connections.booking_conflicts", return_value=False))
        self.enterContext(patch("coach_api.booking_availability.ensure_coach_calendar_available"))
        self.enterContext(patch("coach_api.booking_availability.ensure_coach_outlook_available"))
        self.enterContext(patch("learner_api.booking_calendar.timezone.localdate",
                                return_value=date(2026, 10, 1)))
        self.reserve = self.enterContext(patch.object(views, "synchronize_reserved_calendar_event",
                                                      side_effect=self.sync))
        self.graph_calls = []

    def sync(self, record_id, _base_event):
        record = CoachCalendarEvent.objects.get(pk=record_id)
        record.sync_state = CoachCalendarEvent.SYNC_SYNCED
        record.graph_event_id = "synthetic-graph-id"
        record.meeting_link = "https://example.invalid/meeting"
        record.save(update_fields=["sync_state", "graph_event_id", "meeting_link"])
        self.graph_calls.append(record_id)
        return record, "", True

    def reservation(self, record, event, expected_slot, **kwargs):
        record.status = CoachCalendarEvent.STATUS_SCHEDULED
        record.sync_state = CoachCalendarEvent.SYNC_PENDING
        record.save()
        return record, True

    def book(self, reserve=None):
        with patch.object(imported_booking, "reserve_imported_booking",
                          side_effect=reserve or self.reservation):
            request = RequestFactory().post(
                "/learner_api/calendar/commercial/101/book/",
                data=json.dumps({"sessionType": "mcr", "reviewId": "401",
                                 "scheduledDate": "2026-11-02", "scheduledTime": "10:00",
                                 "durationMinutes": 60}),
                content_type="application/json")
            return unwrap(calendar.learner_calendar_book)(request, "commercial", 101)

    def test_a_learner_booking_leaves_the_coachs_form_scheduled_not_blocked(self):
        response = self.book()
        self.assertEqual(response.status_code, 201)
        self.overlay.refresh_from_db()
        self.assertEqual(self.overlay.status, ImportedReviewInstance.STATUS_SCHEDULED)
        self.assertEqual(len(self.graph_calls), 1)

    def test_a_rejected_reservation_leaves_no_placeholder_for_the_next_booking(self):
        def refuse(*_args, **_kwargs):
            raise views.LearnerCalendarConflict("That slot is taken.")

        response = self.book(reserve=refuse)
        self.assertEqual(response.status_code, 409)
        self.assertFalse(CoachCalendarEvent.objects.filter(event_key=KEY).exists())
        self.assertEqual(self.graph_calls, [])
        self.overlay.refresh_from_db()
        self.assertEqual(self.overlay.status, ImportedReviewInstance.STATUS_NOT_SCHEDULED)

    def test_a_booking_graph_never_confirmed_does_not_schedule_the_form(self):
        self.reserve.side_effect = lambda record_id, _event: (
            CoachCalendarEvent.objects.get(pk=record_id), "Teams did not confirm.", True)
        self.assertEqual(self.book().status_code, 201)
        self.overlay.refresh_from_db()
        self.assertEqual(self.overlay.status, ImportedReviewInstance.STATUS_NOT_SCHEDULED)
