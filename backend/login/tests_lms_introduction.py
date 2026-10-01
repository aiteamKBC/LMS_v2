"""LMS introduction bookings against the real coach calendar table (Graph mocked, no mail)."""
from datetime import date, time, timedelta
from types import SimpleNamespace
from unittest.mock import patch

from django.test import TestCase

from coach_api.models import CoachCalendarEvent
from coach_api.views import collect_generated_timetable
from learner_api.booking_calendar import booking_date_restriction

from . import lms_introduction as intro

OWNER = "qa-case-owner@kbc.invalid"
ACCOUNT = SimpleNamespace(email="qa-learner@kbc.invalid", display_name="QA Learner")
LEARNER = SimpleNamespace(pk=990_000_731, username="QA Learner")


def open_day(start):
    day = start
    while booking_date_restriction(day) is not None:
        day += timedelta(days=1)
    return day


def teams_accepts(record, base_event):
    record.graph_event_id = f"graph-{record.pk}"
    record.meeting_provider = "teamsForBusiness"
    record.meeting_link = f"https://teams.example/join/{record.pk}"
    return ""


class LmsIntroductionBookingTests(TestCase):
    databases = {"default", "enrolment"}

    def setUp(self):
        self.day = open_day(date.today() + timedelta(days=14))

    def save(self, at=time(10, 30), note="Mornings"):
        return intro._save(ACCOUNT, LEARNER, OWNER, "QA Case Owner", self.day, at, note)

    def rows(self):
        return CoachCalendarEvent.objects.filter(learner_id=LEARNER.pk, event_type=intro.EVENT_TYPE)

    @patch("coach_api.views.sync_calendar_event_to_graph", side_effect=teams_accepts)
    def test_booking_lands_in_teams_once_with_the_learner_invited(self, graph):
        record, created = self.save()
        self.assertTrue(created)
        self.assertEqual(
            (record.status, record.owner_email, record.learner_email, record.scheduled_date, record.scheduled_time,
             record.duration_minutes, record.sync_state),
            ("scheduled", OWNER, ACCOUNT.email, self.day, time(10, 30), 30, CoachCalendarEvent.SYNC_PENDING),
        )
        record, warning = intro._sync(record)
        self.assertEqual((warning, record.sync_state, record.meeting_link), ("", "synced", f"https://teams.example/join/{record.pk}"))
        base_event = graph.call_args.args[1]
        self.assertEqual(base_event["email"], ACCOUNT.email)
        self.assertEqual(base_event["title"], "LMS Introduction")
        # A retry or double submit never makes a second meeting.
        again, created = self.save()
        self.assertEqual((again.pk, created), (record.pk, False))
        intro._sync(again)
        self.assertEqual(graph.call_count, 1)
        self.assertEqual(self.rows().count(), 1)
        events = collect_generated_timetable(OWNER, include_live_sessions=False, include_scheduler_queues=False)
        listed = [event for event in events["events"] if event["eventKey"] == record.event_key]
        self.assertEqual([(event["source"], event["title"], event["status"]) for event in listed],
                         [("lms-introduction", "LMS Introduction", "scheduled")])

    @patch("coach_api.views.sync_calendar_event_to_graph", return_value="Graph returned 403 ErrorAccessDenied")
    def test_teams_failure_keeps_the_booking_visible_and_retryable(self, graph):
        record, _ = self.save()
        record, warning = intro._sync(record)
        self.assertEqual(record.sync_state, CoachCalendarEvent.SYNC_FAILED)
        self.assertIn("no calendar invite", warning)
        self.assertFalse(intro._serialize(record)["inviteSent"])
        graph.side_effect, graph.return_value = teams_accepts, None
        record, warning = intro._sync(record)
        self.assertEqual((warning, record.sync_state), ("", "synced"))
        self.assertEqual(self.rows().count(), 1)

    def test_a_request_saved_before_immediate_booking_is_booked_on_the_same_row(self):
        legacy = CoachCalendarEvent.objects.create(
            event_key=f"lms-introduction:{LEARNER.pk}:legacy", owner_email=OWNER, owner_name="QA Case Owner",
            learner_id=LEARNER.pk, learner_name="QA Learner", learner_email=ACCOUNT.email, event_type=intro.EVENT_TYPE,
            sequence=1, target_date=self.day, scheduled_date=self.day, scheduled_time=time(9, 0),
            duration_minutes=30, status="not-scheduled", idempotency_key=f"lms-introduction:{LEARNER.pk}:1",
        )
        record, created = self.save(at=time(11, 0))
        self.assertEqual((record.pk, created, record.status, record.scheduled_time), (legacy.pk, False, "scheduled", time(11, 0)))
        self.assertEqual(self.rows().count(), 1)

    def test_after_a_cancellation_the_learner_can_book_again(self):
        record, _ = self.save()
        CoachCalendarEvent.objects.filter(pk=record.pk).update(status="cancelled")
        fresh, created = self.save(at=time(11, 0))
        self.assertTrue(created)
        self.assertNotEqual(fresh.pk, record.pk)
        self.assertEqual(fresh.idempotency_key, f"lms-introduction:{LEARNER.pk}:2")
