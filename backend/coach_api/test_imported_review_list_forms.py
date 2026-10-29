"""Saved LMS forms in imported list rows; synthetic data and isolated models."""
from copy import deepcopy
from itertools import product

from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from .models import ImportedReviewInstance, MigratedReviewRevision
from .review_sources import apply_imported_state, load_imported_links
from .test_review_source_separation import base_event, booking, imported_row
from .views import overlay_calendar_record


FAMILIES = ("Monthly Coaching Meeting", "Progress Review",
            "Progress Review (+ Skills Radar)", "Personal Support Plan")


class ImportedReviewListFormsTests(TestCase):
    def make_review(self, family=FAMILIES[1], status="completed", *, number=401):
        completed = timezone.now()
        event = base_event(imported_row(number, family, "Completed"))
        event.update(hasReviewForm=False, sourceCompletedDate="2026-10-24T10:00:00Z",
                     reviewCompletedAt="2026-10-24T10:00:00Z")
        overlay = ImportedReviewInstance.objects.create(
            learner_id=21, source_review_id=number, event_key=f"imported-review:legacy-{number}",
            owner_email="coach@example.invalid", status=status,
            completed_at=completed if status == "completed" else None,
            template_snapshot={"sections": [{"key": "discussion", "fields": []}]},
            answers={"discussion:action": "Synthetic saved answer"})
        if status in {"in-progress", "awaiting-signature"}:
            MigratedReviewRevision.objects.create(overlay=overlay, number=1,
                snapshot={"status": "completed", "source_review_id": number, "learner_id": 21,
                          "completed_at": completed.isoformat()},
                pdf_bytes=b"synthetic archived document", pdf_sha256="saved-digest",
                reason_code="incorrect-answer", actor_account_id=1, actor_email=overlay.owner_email)
        return event, overlay

    def resolve(self, event, *, compact=False, records=()):
        bookings, overlays = load_imported_links([event], records=records, compact=compact)
        loaded = overlays[event["eventKey"]]
        if compact and loaded:
            self.assertIn("template_snapshot", loaded.get_deferred_fields())
            self.assertIn("answers", loaded.get_deferred_fields())
        with self.assertNumQueries(0):
            return overlay_calendar_record(event, bookings[event["eventKey"]], loaded, compact=compact)

    def test_all_families_show_saved_form_and_current_status_in_full_and_compact_lists(self):
        for number, (family, status, compact) in enumerate(product(
                FAMILIES, ("completed", "in-progress", "awaiting-signature"), (False, True)), 501):
            with self.subTest(family=family, status=status, compact=compact):
                event, overlay = self.make_review(family, status, number=number)
                original = deepcopy(event)
                result = self.resolve(event, compact=compact)
                self.assertTrue(result["hasReviewForm"])
                self.assertTrue(result["migratedForm"])
                self.assertEqual(result["formEventKey"], overlay.event_key)
                self.assertEqual(result["status"], status)
                self.assertEqual(result["effectiveLmsStatus"], status)
                self.assertEqual(result["reviewCompletedAt"],
                                 overlay.completed_at.isoformat() if overlay.completed_at else None)
                self.assertEqual(result["sourceStatus"], "completed")
                self.assertEqual(result["sourceCompletedDate"], event["sourceCompletedDate"])
                self.assertEqual(event, original)
                overlay.refresh_from_db()
                self.assertEqual(overlay.answers, {"discussion:action": "Synthetic saved answer"})

    def test_source_completion_date_alone_does_not_hide_saved_form(self):
        event, overlay = self.make_review()
        event.update(sourceStatus="scheduled", status="scheduled")
        result = self.resolve(event)
        self.assertTrue(result["hasReviewForm"])
        self.assertEqual(result["reviewCompletedAt"], overlay.completed_at.isoformat())

    def test_active_source_forms_remain_accessible_without_completion_history(self):
        event, _ = self.make_review(status="scheduled")
        event.update(sourceStatus="not-scheduled", status="not-scheduled",
                     sourceCompletedDate=None, reviewCompletedAt=None)
        for compact in (False, True):
            with self.subTest(compact=compact):
                result = self.resolve(event, compact=compact)
                self.assertTrue(result["hasReviewForm"])
                self.assertEqual(result["status"], "scheduled")
                self.assertIsNone(result["reviewCompletedAt"])

    def test_source_only_history_and_unproven_draft_remain_historical(self):
        event, overlay = self.make_review(status="in-progress")
        overlay.archived_revisions.all().delete()
        for compact in (False, True):
            with self.subTest(compact=compact):
                result = self.resolve(event, compact=compact)
                self.assertFalse(result["hasReviewForm"])
                self.assertFalse(result["migratedForm"])
                self.assertEqual(result["status"], "completed")
                self.assertEqual(result["reviewCompletedAt"], event["reviewCompletedAt"])
        overlay.delete()
        self.assertFalse(self.resolve(event)["hasReviewForm"])
        event["hasReviewForm"] = True  # A real imported Aptem form is still viewable.
        self.assertTrue(self.resolve(event)["hasReviewForm"])

    def test_unrelated_or_incomplete_archive_cannot_promote_a_draft(self):
        event, overlay = self.make_review(status="in-progress")
        revision = overlay.archived_revisions.get()
        original = deepcopy(revision.snapshot)
        invalid = ({"source_review_id": 999}, {"learner_id": 999}, {"status": "awaiting-signature"},
                   {"completed_at": None})
        for changes in invalid:
            revision.snapshot = {**original, **changes}
            revision.save()
            for compact in (False, True):
                with self.subTest(changes=changes, compact=compact):
                    self.assertFalse(self.resolve(event, compact=compact)["hasReviewForm"])
        revision.snapshot = original
        revision.pdf_bytes = None
        revision.save()
        self.assertFalse(self.resolve(event)["hasReviewForm"])
        revision.pdf_bytes, revision.pdf_sha256 = b"synthetic", ""
        revision.save()
        self.assertFalse(self.resolve(event)["hasReviewForm"])

    def test_missing_or_malformed_frozen_sections_do_not_create_form_link(self):
        event, overlay = self.make_review()
        for snapshot in ({}, {"sections": []}, {"sections": None},
                         {"sections": {"0": {"key": "discussion"}}}, {"sections": "invalid"}, []):
            overlay.template_snapshot = snapshot
            overlay.save()
            for compact in (False, True):
                with self.subTest(snapshot=snapshot, compact=compact):
                    self.assertFalse(self.resolve(event, compact=compact)["hasReviewForm"])

    def test_missing_completion_timestamp_does_not_promote_source_history(self):
        event, overlay = self.make_review()
        overlay.completed_at = None
        overlay.save()
        self.assertFalse(self.resolve(event)["hasReviewForm"])
        self.assertFalse(self.resolve(event, compact=True)["hasReviewForm"])

    def test_another_learner_or_source_cannot_supply_form(self):
        event, overlay = self.make_review()
        for fields in ({"learner_id": 999}, {"learner_id": 21, "source_review_id": 999}):
            for key, value in fields.items():
                setattr(overlay, key, value)
            overlay.save()
            self.assertFalse(self.resolve(event)["hasReviewForm"])

    def test_completed_form_mapping_without_preload_is_pure(self):
        event, overlay = self.make_review()
        with self.assertNumQueries(0):
            result = apply_imported_state(event, overlay=overlay)
        self.assertTrue(result["hasReviewForm"])

    def test_booking_identity_and_source_dates_survive_reopened_form_mapping(self):
        event, _ = self.make_review(status="in-progress")
        record = booking(event_type="progress-review", status="completed")
        original = {field.attname: deepcopy(getattr(record, field.attname)) for field in record._meta.fields}
        result = self.resolve(event, records=[record])
        self.assertEqual(result["status"], "in-progress")
        self.assertEqual(result["bookingStatus"], "completed")
        self.assertEqual(result["calendarEventKey"], record.event_key)
        self.assertEqual(result["meetingLink"], record.meeting_link)
        self.assertEqual(result["scheduledDate"], record.scheduled_date.isoformat())
        self.assertEqual(result["sourcePlannedDate"], event["sourcePlannedDate"])
        self.assertEqual({key: getattr(record, key) for key in original}, original)

    def test_form_metadata_and_revision_proof_are_batched_without_lazy_queries(self):
        events = [self.make_review(status="in-progress", number=number)[0] for number in range(601, 611)]
        for compact in (False, True):
            with CaptureQueriesContext(connection) as single:
                load_imported_links(events[:1], records=[], compact=compact)
            with CaptureQueriesContext(connection) as many:
                _, overlays = load_imported_links(events, records=[], compact=compact)
            self.assertEqual(len(single), len(many))
            with self.assertNumQueries(0):
                for event in events:
                    result = apply_imported_state(event, overlay=overlays[event["eventKey"]], compact=compact)
                    self.assertTrue(result["hasReviewForm"])
                    self.assertEqual(result["status"], "in-progress")
