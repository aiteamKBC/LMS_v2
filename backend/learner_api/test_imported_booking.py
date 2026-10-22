"""Learner Aptem booking concurrency/lifecycle; no database or external I/O."""
import copy
import json
from contextlib import nullcontext
from datetime import date, time
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import RequestFactory, SimpleTestCase

from coach_api import views
from coach_api.models import CoachCalendarEvent, ImportedReviewInstance
from . import calendar, imported_booking, tests_booking_calendar


class ImportedReservationTests(SimpleTestCase):
    def setUp(self):
        self.record = CoachCalendarEvent(
            pk=51, event_key="imported-review:sample", learner_id=101,
            owner_email="coach@example.test", owner_name="Current coach",
            event_type="progress-review", status="scheduled", duration_minutes=60,
            scheduled_date=date(2026, 11, 20), scheduled_time=time(10),
            target_date=date(2026, 12, 1), notes="Original notes", sync_state="synced",
            graph_event_id="existing-graph", meeting_link="https://example.test/meeting",
            review_responses={"answer": "Preserve me"},
        )
        self.record.save = MagicMock()
        self.candidate = copy.copy(self.record)
        self.candidate.scheduled_time = time(11)
        self.event = {"eventKey": self.record.event_key, "learnerId": "101",
                      "reviewId": "401", "source": "progress-review", "reviewSource": "aptem"}
        self.source = {"learner_id": 101, "aptem_review_id": "sample", "review_type": "Progress Review",
                       "status": "Scheduled", "completed_date": None}
        self.enterContext(patch.object(imported_booking.transaction, "atomic", return_value=nullcontext()))
        self.lock = self.enterContext(patch.object(views, "lock_learner_calendar"))
        query = self.enterContext(patch.object(CoachCalendarEvent.objects, "select_for_update"))
        query.return_value.get.return_value = self.record
        overlay_query = self.enterContext(patch.object(ImportedReviewInstance.objects, "select_for_update"))
        self.overlays = overlay_query.return_value.filter.return_value.filter
        self.overlays.return_value = []
        self.enterContext(patch("coach_api.review_reconciliation.read_source", return_value=self.source))
        self.persist = self.enterContext(patch.object(
            views, "persist_calendar_sync_reservation", side_effect=lambda row, **kwargs: row,
        ))
        self.expected = (date(2026, 11, 20), time(10), 60)

    def reserve(self, **kwargs):
        return imported_booking.reserve_imported_booking(self.candidate, self.event, self.expected, **kwargs)

    def test_saves_only_requested_slot_and_notes_from_the_locked_record(self):
        self.candidate.owner_name = "Stale name"
        self.candidate.review_responses = {"answer": "Stale answer"}
        row, sync = self.reserve(notes="New notes", expected_notes="Original notes")
        self.assertTrue(sync)
        self.assertIs(row, self.record)
        self.assertEqual(row.scheduled_time, time(11))
        self.assertEqual(row.notes, "New notes")
        self.assertEqual(row.owner_name, "Current coach")
        self.assertEqual(row.review_responses, {"answer": "Preserve me"})
        self.assertEqual((row.pk, row.graph_event_id, row.meeting_link),
                         (51, "existing-graph", "https://example.test/meeting"))
        self.lock.assert_called_once_with(101)
        self.persist.assert_called_once_with(row, review_event=self.event)

    def test_request_loaded_before_another_booking_change_is_rejected_under_lock(self):
        self.record.scheduled_time = time(14)
        with self.assertRaisesMessage(views.LearnerCalendarConflict, "another request"):
            self.reserve(notes="New notes")
        self.assertEqual(self.record.scheduled_time, time(14))
        self.persist.assert_not_called()
        self.record.save.assert_not_called()

    def test_first_booking_cannot_overwrite_a_slot_reserved_while_it_waited(self):
        self.expected = (None, None, 60)
        with self.assertRaises(views.LearnerCalendarConflict):
            self.reserve()
        self.persist.assert_not_called()

    def test_notes_omitted_preserve_latest_notes_and_empty_string_explicitly_clears(self):
        self.record.notes = "Updated by coach"
        row, _ = self.reserve()
        self.assertEqual(row.notes, "Updated by coach")
        self.candidate.scheduled_time = time(12)
        self.expected = imported_booking.booking_slot(row)
        row, _ = self.reserve(notes="", expected_notes="Updated by coach")
        self.assertEqual(row.notes, "")

    def test_stale_notes_are_rejected_instead_of_overwriting_another_edit(self):
        self.record.notes = "Updated by coach"
        with self.assertRaisesMessage(views.LearnerCalendarConflict, "notes were changed"):
            self.reserve(notes="My edit", expected_notes="Original notes")
        self.persist.assert_not_called()

    def test_same_slot_notes_edit_and_replay_do_not_resync_the_meeting(self):
        self.candidate.scheduled_time = time(10)
        row, sync = self.reserve(notes="", expected_notes="Original notes")
        self.assertFalse(sync)
        self.assertEqual(row.notes, "")
        self.record.save.assert_called_once_with(update_fields=["notes", "updated_at"])
        self.record.save.reset_mock()
        _, sync = self.reserve(notes="", expected_notes="Original notes")
        self.assertFalse(sync)
        self.persist.assert_not_called()
        self.record.save.assert_not_called()

    def test_retry_of_already_applied_slot_is_idempotent(self):
        self.record.scheduled_time = time(11)
        _, sync = self.reserve()
        self.assertFalse(sync)
        self.persist.assert_not_called()

    def test_failed_sync_retries_the_existing_reservation(self):
        self.record.scheduled_time = time(11)
        self.record.sync_state = "failed"
        row, sync = self.reserve()
        self.assertTrue(sync)
        self.assertEqual(row.graph_event_id, "existing-graph")
        self.persist.assert_called_once()

    def test_pr_skills_radar_and_mcm_keep_their_own_booking_identity(self):
        for review_type, event_type in (("Progress Review", "progress-review"),
                                       ("Progress Review (+ Skills Radar)", "progress-review"),
                                       ("Monthly Coaching Meeting", "mcr")):
            with self.subTest(review_type=review_type):
                self.source["review_type"] = review_type
                self.event["source"] = self.record.event_type = self.candidate.event_type = event_type
                self.record.scheduled_time = time(10)
                row, sync = self.reserve()
                self.assertTrue(sync)
                self.assertEqual(row.event_type, event_type)
                self.assertEqual(row.graph_event_id, "existing-graph")

    def test_legacy_learner_booking_with_enrolment_identity_is_preserved(self):
        self.event.update(learnerType="commercial", enrolmentId="901")
        self.record.learner_id = self.candidate.learner_id = 901
        self.record.event_key = self.candidate.event_key = "legacy-booking"
        self.record.idempotency_key = "learner-book:progress-review:commercial:901:2026-11:401"
        row, sync = self.reserve()
        self.assertTrue(sync)
        self.assertEqual((row.pk, row.learner_id, row.event_key), (51, 901, "legacy-booking"))

    def test_calendar_adapter_exposes_only_raw_editable_notes_and_respects_compact_reads(self):
        from coach_api.review_sources import apply_imported_state
        event = {**self.event, "notes": "Generated calendar description"}
        for compact, expected in ((False, "Original notes"), (True, "")):
            with self.subTest(compact=compact):
                result = apply_imported_state(event, self.record, compact=compact)
                self.assertEqual(result["bookingNotes"], expected)
                self.assertEqual(result["notes"], "Generated calendar description")

    def test_source_completion_or_changed_identity_blocks_the_write(self):
        for change in ({"completed_date": "2026-11-20"}, {"learner_id": 999},
                       {"aptem_review_id": "other"}, {"review_type": "Monthly Coaching Meeting"},
                       {"status": "Completed"}):
            with self.subTest(change=change), patch.dict(self.source, change):
                with self.assertRaises(views.LearnerCalendarConflict):
                    self.reserve()
        self.persist.assert_not_called()

    def test_started_signed_or_cancelled_local_form_blocks_even_same_slot(self):
        self.candidate.scheduled_time = time(10)
        for status in ("in-progress", "awaiting-signature", "completed", "cancelled"):
            with self.subTest(status=status):
                self.overlays.return_value = [SimpleNamespace(
                    pk=71, learner_id=101, source_review_id=401, event_key=self.record.event_key,
                    owner_email=self.record.owner_email, status=status, completed_at=None,
                )]
                with self.assertRaises(views.LearnerCalendarConflict):
                    self.reserve()
        self.record.save.assert_not_called()
        self.persist.assert_not_called()


class ImportedRescheduleEndpointTests(SimpleTestCase):
    def setUp(self):
        self.record = tests_booking_calendar.RescheduleEndpointTests.scheduled_record()
        self.record._imported_review_event = {
            "reviewSource": "aptem", "reviewId": "401", "learnerId": "101",
        }
        self.expected = {"scheduledDate": "2026-09-08", "scheduledTime": "10:00",
                         "durationMinutes": 60, "notes": ""}
        self.enterContext(patch.object(calendar, "SOURCE_MODELS", {"commercial": MagicMock(), "apprenticeship": MagicMock()}))
        self.lookup = self.enterContext(patch.object(calendar, "_learner_booking_record", return_value=self.record))
        self.enterContext(patch.object(calendar, "booking_date_restriction", return_value=None))
        for name in ("_mark_imported_review_scheduled", "_record_enrolment_review", "_follow_first_session_start_date"):
            self.enterContext(patch.object(calendar, name))
        self.enterContext(patch.object(calendar, "_booking_response_event", return_value={"eventKey": "existing"}))
        self.personal = self.enterContext(patch("learner_api.calendar_connections.booking_conflicts", return_value=False))
        self.enterContext(patch("coach_api.booking_availability.ensure_coach_calendar_available"))
        self.outlook = self.enterContext(patch("coach_api.booking_availability.ensure_coach_outlook_available"))
        self.reserve = self.enterContext(patch.object(imported_booking, "reserve_imported_booking", return_value=(self.record, True)))
        self.sync = self.enterContext(patch.object(views, "synchronize_reserved_calendar_event", return_value=(self.record, "", True)))

    def request(self, extra=None, kind="commercial"):
        payload = {"eventKey": self.record.event_key, "scheduledDate": "2026-11-20",
                   "scheduledTime": "11:30", "durationMinutes": 60, **(extra or {})}
        request = RequestFactory().patch("/reschedule/", data=json.dumps(payload), content_type="application/json")
        return unwrap(calendar.learner_calendar_reschedule)(request, kind, 101)

    def test_old_client_without_original_booking_cannot_write(self):
        self.assertEqual(self.request().status_code, 400)
        self.reserve.assert_not_called()
        self.sync.assert_not_called()

    def test_both_learner_kinds_pass_explicit_clear_and_original_slot(self):
        for kind in ("commercial", "apprenticeship"):
            with self.subTest(kind=kind):
                self.record.scheduled_date, self.record.scheduled_time = date(2026, 9, 8), time(10)
                response = self.request({"expectedBooking": self.expected, "notes": ""}, kind)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(self.reserve.call_args.args[2], (date(2026, 9, 8), time(10), 60))
                self.assertEqual(self.reserve.call_args.kwargs, {"notes": "", "expected_notes": ""})
                self.assertEqual(self.personal.call_args.kwargs["business_time_zone"], "Europe/London")

    def test_omitted_notes_are_not_cleared(self):
        self.assertEqual(self.request({"expectedBooking": self.expected}).status_code, 200)
        self.assertIsNone(self.reserve.call_args.kwargs["notes"])

    def test_stale_slot_rejected_before_external_checks(self):
        self.record.scheduled_time = time(14)
        self.assertEqual(self.request({"expectedBooking": self.expected}).status_code, 409)
        self.outlook.assert_not_called()
        self.reserve.assert_not_called()

    def test_locked_lifecycle_conflict_returns_409_without_sync(self):
        self.reserve.side_effect = views.LearnerCalendarConflict("Only an unstarted imported review can be rescheduled.")
        self.assertEqual(self.request({"expectedBooking": self.expected}).status_code, 409)
        self.sync.assert_not_called()

    def test_notes_only_change_does_not_require_external_availability_or_sync(self):
        self.reserve.return_value = (self.record, False)
        response = self.request({"expectedBooking": self.expected, "notes": "New note",
                                 "scheduledDate": "2026-09-08", "scheduledTime": "10:00"})
        self.assertEqual(response.status_code, 200)
        self.reserve.assert_called_once()
        self.personal.assert_not_called()
        self.outlook.assert_not_called()
        self.sync.assert_not_called()

    def test_other_learner_booking_remains_not_found(self):
        self.lookup.return_value = None
        self.assertEqual(self.request({"expectedBooking": self.expected}).status_code, 404)
        self.reserve.assert_not_called()

    def test_invalid_expected_booking_or_notes_cannot_mutate_a_booking(self):
        for extra in ({"expectedBooking": []}, {"expectedBooking": {}},
                      {"expectedBooking": self.expected, "notes": {"text": "invalid"}},
                      {"expectedBooking": {**self.expected, "notes": None}, "notes": ""}):
            with self.subTest(extra=extra):
                self.assertEqual(self.request(extra).status_code, 400)
        self.reserve.assert_not_called()
        self.sync.assert_not_called()
