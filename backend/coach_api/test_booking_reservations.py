"""Synthetic ORM boundaries; real occupancy and full overlap logic. No database/Graph."""
from copy import deepcopy
from datetime import date, time
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase

from .booking_availability import ensure_coach_calendar_available
from .booking_reservations import review_occupies_slot
from .views import LearnerCalendarConflict, find_learner_calendar_conflict
from learner_api.coach_availability import free_slots


class Rows(list):
    def only(self, *fields):
        return self

    def exclude(self, **kwargs):
        return Rows(row for row in self if not all(getattr(row, key) == value for key, value in kwargs.items()))


class BookingReservationTests(SimpleTestCase):
    day = date(2027, 3, 1)

    def record(self, **changes):
        return SimpleNamespace(pk=1, **dict({
            "event_key": "review:synthetic:1", "event_type": "mcr", "status": "not-scheduled",
            "scheduled_date": self.day, "scheduled_time": time(11), "duration_minutes": 60,
            "sync_state": "pending", "operation_id": "", "graph_event_id": "",
            "meeting_link": "", "graph_web_link": "", "sequence": 1,
        }, **changes))

    def test_same_occupancy_policy_in_read_slots_and_both_locked_conflict_checks(self):
        cases = [({}, False), ({"scheduled_time": None}, False),
                 ({"status": "scheduled"}, True), ({"status": "in-progress"}, True),
                 ({"status": "awaiting-signature"}, True), ({"status": "completed"}, True),
                 ({"status": "scheduled", "sync_state": "failed"}, True),
                 ({"sync_state": "syncing"}, True), ({"sync_state": "reconciliation"}, True),
                 ({"operation_id": "placeholder-default-uuid"}, False),
                 ({"sync_attempt_count": 1}, True),
                 ({"sync_state": "synced", "graph_event_id": "real-reference"}, True),
                 ({"status": "cancelled", "graph_event_id": "old-reference"}, False),
                 ({"status": "scheduled", "sync_state": "cancelled"}, False)]
        schedule = {"value": [{"scheduleId": "coach@example.invalid", "availabilityView": "0" * 96,
                    "workingHours": {"timeZone": {"name": "Europe/London"}, "startTime": "09:00",
                    "endTime": "17:00", "daysOfWeek": ["monday"]}}]}
        for changes, occupied in cases:
            with self.subTest(changes=changes):
                record = self.record(**changes)
                original = deepcopy(vars(record))
                with patch("coach_api.models.CoachCalendarEvent.objects.filter", return_value=Rows([record])), \
                     patch("coach_api.views.microsoft_graph_request", return_value=schedule):
                    self.assertEqual(review_occupies_slot(record), occupied)
                    slots = free_slots("coach@example.invalid", self.day, 0, duration=60, review_hours=True)
                    for slot in ("10:15", "10:30", "10:45", "11:00", "11:15", "11:45"):
                        self.assertEqual(slot not in slots, occupied)
                    self.assertIn("10:00", slots)
                    self.assertIn("12:00", slots)
                    found = find_learner_calendar_conflict(learner_id=1, learner_email="",
                        scheduled_date=self.day, scheduled_time=time(10, 30), duration_minutes=60)
                    self.assertEqual(found is record, occupied)
                    if occupied:
                        with self.assertRaises(LearnerCalendarConflict):
                            ensure_coach_calendar_available("coach@example.invalid", self.day, time(10, 30), 60)
                    else:
                        ensure_coach_calendar_available("coach@example.invalid", self.day, time(10, 30), 60)
                self.assertEqual(vars(record), original)

    def test_exact_self_exclusion_does_not_exclude_another_booking(self):
        own = self.record(status="scheduled")
        other = self.record(status="scheduled", event_key="review:synthetic:2")
        other.pk = 2
        for rows, conflict in ((Rows([own]), False), (Rows([own, other]), True)):
            with self.subTest(conflict=conflict), patch("coach_api.models.CoachCalendarEvent.objects.filter", return_value=rows):
                found = find_learner_calendar_conflict(learner_id=1, learner_email="",
                    scheduled_date=self.day, scheduled_time=time(11), duration_minutes=60, exclude_record_id=1)
                self.assertEqual(found is other, conflict)
                if conflict:
                    with self.assertRaises(LearnerCalendarConflict):
                        ensure_coach_calendar_available("coach@example.invalid", self.day, time(11), 60, exclude_record_id=1)
                else:
                    ensure_coach_calendar_available("coach@example.invalid", self.day, time(11), 60, exclude_record_id=1)

    def test_model_default_operation_uuid_does_not_turn_a_plan_into_a_reservation(self):
        from .models import CoachCalendarEvent
        record = CoachCalendarEvent(event_type="mcr", status="not-scheduled",
            target_date=self.day, scheduled_date=self.day, scheduled_time=time(11))
        self.assertTrue(record.operation_id)
        self.assertFalse(review_occupies_slot(record))
