"""Real row/advisory-lock regressions; run only on disposable PostgreSQL."""
from concurrent.futures import ThreadPoolExecutor
from datetime import date, time
from threading import Barrier
from unittest.mock import patch

from django.db import close_old_connections, connection
from django.test import TransactionTestCase

from . import views
from .models import CoachCalendarEvent


class CoachBookingAvailabilityPostgresTests(TransactionTestCase):
    available_apps = ["coach_api"]

    def setUp(self):
        self.assertEqual(connection.vendor, "postgresql")
        self.enterContext(patch.object(views, "england_non_delivery_reason", return_value=None))
        self.enterContext(patch("coach_api.reconciliation_links.require_schedulable", return_value=None))
        self.day = date(2099, 11, 19)
        self.created_ids = []

    def tearDown(self):
        CoachCalendarEvent.objects.filter(pk__in=self.created_ids).delete()
        super().tearDown()

    def slot(self, learner, owner="coach@example.test", *, at=None):
        record = CoachCalendarEvent.objects.create(event_key=f"imported-review:A-{learner}", owner_email=owner,
            learner_id=learner, learner_email=f"learner-{learner}@example.test", event_type="progress-review",
            target_date=self.day, scheduled_date=self.day if at else None, scheduled_time=at,
            status="scheduled" if at else "not-scheduled", duration_minutes=60)
        self.created_ids.append(record.pk)
        return record

    def save(self, record, at=time(10)):
        record.scheduled_date = self.day
        record.scheduled_time = at
        record.status = "scheduled"
        return views.persist_calendar_sync_reservation(record, review_event={"reviewSource": "aptem"})

    def test_other_learner_same_coach_blocks_overlap_but_allows_adjacent_and_other_coach(self):
        self.slot(501, at=time(10))
        target = self.slot(502, "COACH@example.test")
        with self.assertRaisesRegex(views.LearnerCalendarConflict, "coach is busy"):
            self.save(target, time(10, 30))
        self.assertIsNone(CoachCalendarEvent.objects.get(pk=target.pk).scheduled_time)
        self.save(target, time(11))
        self.save(self.slot(503, "another@example.test"), time(10))

    def test_rescheduling_excludes_current_booking_and_preserves_identity(self):
        record = self.slot(501, at=time(10))
        record.graph_event_id = "original"
        record.graph_organizer_email = record.owner_email
        record.meeting_link = "https://example.invalid/meeting"
        record.save()
        saved = self.save(record, time(10, 15))
        self.assertEqual((saved.pk, saved.graph_event_id, saved.meeting_link),
                         (record.pk, "original", "https://example.invalid/meeting"))
        self.assertEqual(CoachCalendarEvent.objects.count(), 1)

    def test_cancelled_appointments_do_not_hold_the_slot(self):
        old = self.slot(501, at=time(10))
        old.sync_state = "cancelled"; old.status = "not-scheduled"; old.save()
        self.save(self.slot(502))

    def test_native_booking_cannot_race_into_an_aptem_coach_slot(self):
        self.slot(501, at=time(10))
        with self.assertRaisesRegex(views.LearnerCalendarConflict, "coach is busy"):
            views.reserve_coach_calendar_booking(owner_email="coach@example.test", owner_name="Coach",
                learner_id=502, learner_name="Another learner", learner_email="other@example.test",
                session_type="catch-up", scheduled_date=self.day, scheduled_time=time(10, 15),
                duration_minutes=60, notes="", idempotency_key="independent-operation")
        self.assertEqual(CoachCalendarEvent.objects.count(), 1)

    def test_simultaneous_different_learners_have_one_winner_and_loser_can_retry(self):
        targets = [self.slot(501), self.slot(502, "COACH@example.test")]
        barrier = Barrier(2)
        def book(pk):
            close_old_connections()
            try:
                target = CoachCalendarEvent.objects.get(pk=pk)
                barrier.wait(timeout=10)
                try:
                    self.save(target)
                    return "saved", pk
                except views.LearnerCalendarConflict:
                    return "busy", pk
            finally:
                close_old_connections()
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(book, [target.pk for target in targets]))
        self.assertEqual(sorted(result for result, _ in results), ["busy", "saved"])
        loser = next(pk for result, pk in results if result == "busy")
        self.save(CoachCalendarEvent.objects.get(pk=loser), time(11))
        self.assertEqual(CoachCalendarEvent.objects.filter(status="scheduled").count(), 2)
