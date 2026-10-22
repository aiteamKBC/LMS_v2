"""Synthetic Aptem revision tests. External services are never required."""
from copy import deepcopy
import hashlib
from inspect import unwrap
import json
from types import SimpleNamespace
from unittest.mock import patch

from django.db import IntegrityError, transaction
from django.http import JsonResponse
from django.test import TestCase, RequestFactory

from .migrated_completion import ensure_document, complete, submit, sign
from .migrated_reopening import archive, check_revision, clear_active_signatures, history, validate_reason
from .migrated_summary_binding import answer_version
from .models import ImportedReviewInstance, MigratedReviewDocument, MigratedReviewRevision, MigratedReviewTemplate, CoachCalendarEvent
from .test_migrated_pdf_download import create_review
from .test_migrated_pdf_parity import CONTEXT

ACTOR = SimpleNamespace(pk=931, email="assigned-coach@example.invalid")


class MigratedRevisionArchiveTests(TestCase):
    def archive(self, overlay):
        return archive(overlay, account=ACTOR, reason="correction-required",
                       note="Correct the agreed action.", pdf_context=CONTEXT)

    def test_completed_archive_preserves_answers_signatures_and_exact_existing_pdf(self):
        overlay = create_review()
        document = ensure_document(overlay, **CONTEXT)
        before_answers = deepcopy(overlay.answers)
        before_signatures = list(overlay.migrated_signatures.values_list("signature", flat=True))
        with patch("coach_api.migrated_completion.build_pdf", side_effect=AssertionError("Existing PDF must be reused")):
            revision = self.archive(overlay)
        clear_active_signatures(overlay)
        self.assertEqual(revision.number, 1)
        self.assertEqual(revision.snapshot["answers"], before_answers)
        self.assertEqual([row["signature"] for row in revision.snapshot["signatures"]], before_signatures)
        self.assertEqual(bytes(revision.pdf_bytes), bytes(document.pdf_bytes))
        self.assertEqual(revision.pdf_sha256, hashlib.sha256(bytes(document.pdf_bytes)).hexdigest())
        self.assertEqual(revision.actor_account_id, ACTOR.pk)
        self.assertFalse(overlay.migrated_signatures.exists())
        self.assertFalse(MigratedReviewDocument.objects.filter(overlay=overlay).exists())
        overlay.answers = {"new": "Corrected"}
        overlay.save(update_fields=["answers"])
        revision.refresh_from_db()
        self.assertEqual(revision.snapshot["answers"], before_answers)

    def test_awaiting_signature_archive_does_not_invent_a_completed_pdf(self):
        overlay = create_review("MCM")
        overlay.status, overlay.completed_at = "awaiting-signature", None
        overlay.save(update_fields=["status", "completed_at"])
        with patch("coach_api.migrated_reopening.ensure_document", side_effect=AssertionError("No unsigned PDF")):
            revision = self.archive(overlay)
        self.assertIsNone(revision.pdf_bytes)
        self.assertEqual(revision.snapshot["status"], "awaiting-signature")
        self.assertEqual(len(revision.snapshot["signatures"]), 2)

    def test_pdf_failure_leaves_signed_review_intact(self):
        overlay = create_review()
        signatures = list(overlay.migrated_signatures.values())
        with patch("coach_api.migrated_completion.build_pdf", side_effect=ValueError("Rendering failed")):
            with self.assertRaisesMessage(ValueError, "Rendering failed"), transaction.atomic():
                self.archive(overlay)
        overlay.refresh_from_db()
        self.assertEqual(overlay.status, "completed")
        self.assertEqual(list(overlay.migrated_signatures.values()), signatures)
        self.assertFalse(MigratedReviewRevision.objects.exists())

    def test_corrupt_stored_pdf_is_not_archived_as_authoritative(self):
        overlay = create_review()
        MigratedReviewDocument.objects.create(overlay=overlay, pdf_bytes=b"changed", sha256="0" * 64)
        with self.assertRaisesMessage(ValueError, "checksum"), transaction.atomic():
            self.archive(overlay)
        self.assertFalse(MigratedReviewRevision.objects.exists())
        self.assertTrue(overlay.migrated_signatures.exists())

    def test_revision_numbers_are_unique_per_review(self):
        overlay = create_review()
        self.archive(overlay)
        with self.assertRaises(IntegrityError), transaction.atomic():
            self.archive(overlay)
        self.assertEqual(MigratedReviewRevision.objects.count(), 1)

    def test_history_exposes_metadata_without_answers_signature_images_or_pdf_bytes(self):
        overlay = create_review()
        self.archive(overlay)
        overlay.meeting_intelligence = {"reviewRevision": 1}
        rows = history(overlay)
        self.assertEqual(rows[0]["number"], 1)
        self.assertTrue(rows[0]["pdfAvailable"])
        self.assertEqual(set(rows[0]), {"number", "reopenedAt", "reasonCode", "note", "reopenedBy", "pdfAvailable"})

    def test_stale_and_missing_revision_are_refused_after_reopen(self):
        overlay = create_review()
        check_revision(overlay, {})
        check_revision(overlay, {"reviewRevision": 0})
        overlay.meeting_intelligence = {"reviewRevision": 1}
        for value in (None, 0, 2, "1", True):
            with self.subTest(value=value), self.assertRaisesMessage(ValueError, "reopened"):
                check_revision(overlay, {"reviewRevision": value})
        check_revision(overlay, {"reviewRevision": 1})

    def test_reason_validation_requires_details_for_other(self):
        self.assertEqual(validate_reason({"reasonCode": "other", "note": " Correction "}), ("other", "Correction"))
        for payload in ({}, {"reasonCode": "other"}, {"reasonCode": "unknown"},
                        {"reasonCode": "correction-required", "note": "x" * 2001}):
            with self.subTest(payload=payload), self.assertRaises(ValueError):
                validate_reason(payload)

    def test_all_signing_endpoints_require_the_current_reopened_revision(self):
        from . import migrated_completion_views as api
        from .test_migrated_auto_completion import review_fixture, source_identity, definition_for
        from .tests_migrated_completion import PNG
        for role in ("advisor", "participant", "employer"):
            with self.subTest(role=role), source_identity():
                overlay, _ = review_fixture("PR")
                overlay.meeting_intelligence = {"reviewRevision": 1}
                overlay.save()
                account = SimpleNamespace(
                    pk=71, role={"advisor": "staff", "participant": "learner", "employer": "employer"}[role],
                    email=overlay.owner_email, display_name="Synthetic signer",
                    subject_id=91 if role == "employer" else 71,
                )
                with patch.object(api, "_coach_review", return_value=(overlay.owner_email, definition_for(overlay))), \
                     patch.object(api, "_response", return_value=JsonResponse({"ok": True})), \
                     patch.object(api, "authenticate_request", return_value=account):
                    for token in ({}, {"reviewRevision": 0}, {"reviewRevision": 1}):
                        request = RequestFactory().post("/", json.dumps({"signature": PNG, **token}),
                                                        content_type="application/json")
                        request.login_account = account
                        endpoint = unwrap(api.migrated_review_coach_sign) if role == "advisor" else api.migrated_review_party_sign
                        response = endpoint(request, overlay.event_key)
                        self.assertEqual(response.status_code, 200 if token.get("reviewRevision") == 1 else 409,
                                         response.content)
                self.assertEqual(list(overlay.migrated_signatures.values_list("role", flat=True)), [role])


class MigratedReopenLifecycleTests(TestCase):
    def setUp(self):
        from . import migrated_reopening_views as endpoints
        self.endpoints = endpoints
        self.overlay = create_review("MCM")
        template = MigratedReviewTemplate.objects.create(
            name="Synthetic MCM", review_family="MCM", programme_key="", scope="GLOBAL",
            definition_json=self.overlay.template_snapshot,
        )
        self.overlay.migrated_template = template
        self.overlay.meeting_intelligence = {
            "otjhCredit": {"hours": 1, "progressId": 53, "completedAt": self.overlay.completed_at.isoformat()},
            "unrelated": {"keep": True},
        }
        self.overlay.save()
        self.original = deepcopy(self.overlay.meeting_intelligence)
        self.account = SimpleNamespace(role="staff", pk=91, email=self.overlay.owner_email, display_name="Assigned Coach")
        self.calendar = CoachCalendarEvent.objects.create(
            owner_email=self.overlay.owner_email, learner_id=self.overlay.learner_id,
            event_key=self.overlay.event_key, event_type="mcr", status="completed",
            review_completed_at=self.overlay.completed_at, graph_event_id="synthetic-event",
            target_date=self.overlay.completed_at.date(),
            meeting_link="https://example.invalid/synthetic-meeting", duration_minutes=60,
        )
        for patcher in (
            patch.object(endpoints, "_coach_review", return_value=(self.overlay.owner_email, {"migratedForm": True})),
            patch.object(endpoints, "_locked_overlay", side_effect=lambda *a, **kw: ImportedReviewInstance.objects.select_for_update().get(pk=self.overlay.pk)),
            patch.object(endpoints, "_pdf_context", return_value=CONTEXT),
            patch.object(endpoints, "booking_for_overlay", return_value=self.calendar),
            patch.object(endpoints, "_response", side_effect=lambda *a: JsonResponse({"status": ImportedReviewInstance.objects.get(pk=self.overlay.pk).status})),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)

    def request(self, **payload):
        request = RequestFactory().post("/", json.dumps({
            "reasonCode": "correction-required", "note": "Correct the action",
            "answerVersion": answer_version(self.overlay), **payload,
        }), content_type="application/json")
        request.login_account = self.account
        return unwrap(self.endpoints.reopen_review)(request, self.overlay.event_key)

    def test_reopen_and_recomplete_preserves_hours_and_calendar_identity(self):
        before_pdf = ensure_document(self.overlay, **CONTEXT)
        old_completed_at = self.overlay.completed_at
        self.assertEqual(self.request().status_code, 200)
        self.overlay.refresh_from_db()
        self.calendar.refresh_from_db()
        self.assertEqual(self.overlay.status, "in-progress")
        self.assertIsNone(self.overlay.completed_at)
        self.assertFalse(self.overlay.migrated_signatures.exists())
        self.assertEqual(self.overlay.meeting_intelligence["otjhCredit"], self.original["otjhCredit"])
        self.assertEqual(self.overlay.meeting_intelligence["unrelated"], {"keep": True})
        self.assertEqual(self.calendar.status, "in-progress")
        self.assertIsNone(self.calendar.review_completed_at)
        self.assertEqual(self.calendar.graph_event_id, "synthetic-event")
        self.assertEqual(self.calendar.meeting_link, "https://example.invalid/synthetic-meeting")
        revision = self.overlay.archived_revisions.get()
        self.assertEqual(bytes(revision.pdf_bytes), bytes(before_pdf.pdf_bytes))
        submit(self.overlay, self.overlay.answers)
        with self.assertRaisesMessage(ValueError, "All required signatures"):
            complete(self.overlay)
        for old in revision.snapshot["signatures"]:
            sign(self.overlay, old["role"], account=SimpleNamespace(
                pk=old["signer_account_id"], email=old["signer_email"], display_name=old["signer_name"],
            ), signature=old["signature"])
        with patch("coach_api.migrated_otjh.record_completion", side_effect=AssertionError("Hours must not be credited again")):
            complete(self.overlay)
        self.overlay.refresh_from_db()
        self.assertEqual(self.overlay.status, "completed")
        self.assertNotEqual(self.overlay.completed_at, old_completed_at)
        self.assertEqual(self.overlay.meeting_intelligence["otjhCredit"], self.original["otjhCredit"])
        new_pdf = ensure_document(self.overlay, **CONTEXT)
        self.assertNotEqual(new_pdf.pk, before_pdf.pk)
        revision.refresh_from_db()
        self.assertEqual(bytes(revision.pdf_bytes), bytes(before_pdf.pdf_bytes))

    def test_previously_completed_zero_credit_is_not_backfilled(self):
        self.overlay.meeting_intelligence = {}
        self.overlay.save()
        self.assertEqual(self.request().status_code, 200)
        self.overlay.refresh_from_db()
        self.overlay.status = "awaiting-signature"
        self.overlay.signature_requirements = {"advisor": False, "participant": False}
        self.overlay.template_snapshot["otjh"] = {"expectedHours": 3, "countsTowardsOtjh": True}
        with patch("coach_api.migrated_otjh.record_completion", side_effect=AssertionError("No historical backfill")):
            complete(self.overlay)
        self.assertNotIn("otjhCredit", self.overlay.meeting_intelligence)

    def test_stale_reopen_and_wrong_actor_are_refused_without_archives(self):
        self.assertEqual(self.request(answerVersion="old").status_code, 409)
        self.account.email = "another-coach@example.invalid"
        self.assertEqual(self.request().status_code, 403)
        self.assertFalse(MigratedReviewRevision.objects.exists())
        self.assertTrue(self.overlay.migrated_signatures.exists())

    def test_double_reopen_creates_only_one_archive(self):
        self.assertEqual(self.request().status_code, 200)
        self.assertEqual(self.request().status_code, 409)
        self.assertEqual(MigratedReviewRevision.objects.count(), 1)

    def test_calendar_failure_rolls_back_pdf_archive_and_signature_changes(self):
        with patch.object(self.endpoints, "booking_for_overlay", side_effect=ValueError("Calendar association changed")):
            self.assertEqual(self.request().status_code, 409)
        self.overlay.refresh_from_db()
        self.assertEqual(self.overlay.status, "completed")
        self.assertTrue(self.overlay.migrated_signatures.exists())
        self.assertFalse(MigratedReviewRevision.objects.exists())
        self.assertFalse(MigratedReviewDocument.objects.exists())

    def test_original_monthly_log_consent_and_mark_survive_reopen(self):
        from .migrated_monthly_log import saved_signature
        original_signature = self.overlay.migrated_signatures.get(role="participant")
        state = {
            "status": "failed", "month": "2026-10", "enrolmentId": 42,
            "signerAccountId": original_signature.signer_account_id, "signatureId": original_signature.pk,
        }
        self.overlay.meeting_intelligence["monthlyLogSignature"] = deepcopy(state)
        self.overlay.save()
        self.assertEqual(self.request().status_code, 200)
        self.overlay.refresh_from_db()
        self.assertEqual(self.overlay.meeting_intelligence["monthlyLogSignature"], state)
        saved = saved_signature(self.overlay, state)
        self.assertEqual(saved.signature, original_signature.signature)
        self.assertEqual(saved.signer_account_id, original_signature.signer_account_id)

    def test_archive_pdf_read_remains_available_while_current_review_is_editable(self):
        self.assertEqual(self.request().status_code, 200)
        self.overlay.refresh_from_db()
        response = self.endpoints.archived_pdf(self.overlay, 1, role="participant")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, bytes(self.overlay.archived_revisions.get().pdf_bytes))
        self.assertEqual(response["Cache-Control"], "private, no-store")
        self.assertEqual(self.endpoints.archived_pdf(self.overlay, 1, role="employer").status_code, 404)
        self.assertEqual(self.endpoints.archived_pdf(self.overlay, 2).status_code, 404)

    def test_reopened_zero_credit_never_becomes_new_planned_hours(self):
        from datetime import date
        from .migrated_otjh import frozen_hours, planned_meetings, overlays_for
        self.overlay.meeting_intelligence = {}
        self.overlay.save()
        self.assertEqual(self.request().status_code, 200)
        self.overlay.refresh_from_db()
        self.overlay.status = "awaiting-signature"
        self.overlay.template_snapshot["otjh"] = {"expectedHours": 10, "countsTowardsOtjh": True}
        self.overlay.save()
        projected = list(overlays_for([self.overlay.learner_id]))[0]
        self.assertEqual(frozen_hours(projected), 0)
        template = SimpleNamespace(pk=1, name="Changed allowance", definition_json=self.overlay.template_snapshot)
        rows = planned_meetings(
            SimpleNamespace(id=self.overlay.learner_id, aptem_id="synthetic", programme="Synthetic"),
            date(2026, 1, 1), date(2027, 12, 31),
            templates={family: template for family in ("MCM", "PR", "PR_SKILLS_RADAR")},
            overlays={self.overlay.source_review_id: projected},
            rows=[{"id": self.overlay.source_review_id, "learner_id": self.overlay.learner_id,
                   "aptem_review_id": "synthetic", "review_type": "Monthly Coaching Meeting",
                   "planned_scheduled_date": date(2026, 10, 20), "status": "Scheduled",
                   "completed_date": None, "review_data": {}}],
        )
        self.assertEqual(rows, [])
