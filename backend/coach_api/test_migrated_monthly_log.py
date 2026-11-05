"""Synthetic Aptem MCM signing: real lifecycle rows, mocked reporting transport."""
from contextlib import contextmanager
from copy import deepcopy
from datetime import date
import json
from types import SimpleNamespace
from unittest.mock import patch

from django.test import RequestFactory, TestCase

from . import migrated_completion_views as endpoints, migrated_monthly_log as logs
from .models import ImportedReviewInstance, MigratedReviewDocument
from .test_migrated_auto_completion import review_fixture, source_identity, sign_request
from .tests_migrated_completion import PNG


class MigratedMonthlyLogTests(TestCase):
    def setUp(self):
        self.overlay, self.booking = review_fixture()
        self.account = SimpleNamespace(pk=1, subject_id=71, role="learner",
                                       display_name="Synthetic learner", email="learner@example.invalid")
        self.definition = {
            "migratedForm": True, "historicalReview": {"type": "Monthly Coaching Meeting"},
            "instance": {"targetDate": "2026-10-19", "status": "awaiting-signature"},
        }

    @contextmanager
    def transport(self, *, failure=False):
        with source_identity(), \
             patch("coach_api.views._imported_review_definition", side_effect=lambda *args: deepcopy(self.definition)), \
             patch("old_otjh.service.resolve_record", return_value={"id": 71, "aptem_id": "synthetic"}) as resolve, \
             patch("learner_api.monthly_logs.mirror_mcm_learner_signature",
                   side_effect=RuntimeError("synthetic reporting failure") if failure else None,
                   return_value={"status": "synced", "month": "2026-10"}) as mirror:
            yield resolve, mirror

    def request(self, payload, *, query=""):
        request = RequestFactory().post("/sign/" + query, json.dumps(payload), content_type="application/json")
        with patch.object(endpoints, "authenticate_request", return_value=self.account):
            return endpoints.migrated_review_party_sign(request, self.overlay.event_key)

    def sign(self, **extra):
        return self.request({"signature": PNG, "applyMonthlyLogSignature": True, **extra})

    def test_copies_to_source_month_with_enrolment_identity_and_saved_signature(self):
        self.booking.scheduled_date = date(2026, 12, 2)
        self.booking.save(update_fields=["scheduled_date"])
        with self.transport() as (resolve, mirror):
            response = self.sign(month="2026-12", learnerId=999, name="Client name")
        self.assertEqual(response.status_code, 200, response.content)
        resolve.assert_called_once_with(71)
        mirror.assert_called_once_with({"id": 71, "aptem_id": "synthetic"}, "2026-10", PNG, "Synthetic learner")
        self.overlay.refresh_from_db()
        self.assertEqual(self.overlay.status, "awaiting-signature")
        self.assertEqual(self.overlay.migrated_signatures.count(), 1)
        self.assertEqual(logs.saved_state(self.overlay)["month"], "2026-10")
        self.assertEqual(json.loads(response.content)["monthlyLogSync"]["status"], "synced")

    def test_opt_out_and_old_clients_sign_only_the_mcm(self):
        for choice in ({}, {"applyMonthlyLogSignature": False}):
            with self.subTest(choice=choice), self.transport() as (resolve, mirror):
                self.overlay, self.booking = review_fixture()
                response = self.request({"signature": PNG, **choice})
                self.assertEqual(response.status_code, 200)
                self.overlay.refresh_from_db()
                self.assertFalse(logs.saved_state(self.overlay))
                self.assertEqual(self.overlay.migrated_signatures.count(), 1)
                mirror.assert_not_called()
                resolve.assert_not_called()

    def test_failure_preserves_completed_mcm_and_retry_uses_original_signature(self):
        with self.transport(failure=True):
            self.assertEqual(sign_request(self.overlay, "advisor").status_code, 200)
            first = self.sign()
        self.assertEqual(first.status_code, 200)
        self.assertEqual(json.loads(first.content)["monthlyLogSync"]["status"], "failed")
        self.overlay.refresh_from_db()
        self.booking.refresh_from_db()
        completed_at = self.overlay.completed_at
        self.assertEqual((self.overlay.status, self.booking.status), ("completed", "completed"))
        document = MigratedReviewDocument.objects.create(overlay=self.overlay, pdf_bytes=b"synthetic", sha256="original")
        signature = self.overlay.migrated_signatures.get(role="participant")
        self.definition["instance"]["targetDate"] = "2027-02-15"
        with self.transport() as (_, mirror):
            retry = self.request({"retryMonthlyLogSignature": True})
        self.assertEqual(json.loads(retry.content)["monthlyLogSync"]["status"], "synced")
        self.assertEqual(mirror.call_args.args[1:], ("2026-10", PNG, signature.signer_name))
        self.overlay.refresh_from_db()
        document.refresh_from_db()
        signature.refresh_from_db()
        self.assertEqual(self.overlay.completed_at, completed_at)
        self.assertEqual(self.overlay.migrated_signatures.count(), 2)
        self.assertEqual((bytes(document.pdf_bytes), document.sha256), (b"synthetic", "original"))
        self.assertEqual(signature.signature, PNG)
        self.assertNotIn("message", logs.saved_state(self.overlay))

    def test_repeated_sign_request_is_idempotent_and_cannot_replace_the_image(self):
        with self.transport() as (_, mirror):
            self.assertEqual(self.sign().status_code, 200)
            self.assertEqual(self.sign().status_code, 200)
            self.assertEqual(self.request({"retryMonthlyLogSignature": True, "signature": "replacement"}).status_code, 409)
        mirror.assert_called_once()
        self.assertEqual(self.overlay.migrated_signatures.count(), 1)

    def test_reopened_review_collects_a_new_signature_without_replacing_old_monthly_log_consent(self):
        from django.db import transaction
        from .migrated_reopening import archive, clear_active_signatures
        with self.transport(failure=True):
            self.assertEqual(self.sign().status_code, 200)
        self.overlay.refresh_from_db()
        old_request = deepcopy(logs.saved_state(self.overlay))
        with transaction.atomic():
            archive(self.overlay, account=self.account, reason="correction-required", note="", pdf_context={})
            clear_active_signatures(self.overlay)
            self.overlay.meeting_intelligence["reviewRevision"] = 1
            self.overlay.status = "in-progress"
            self.overlay.save()
        # Retry remains tied to the archived signature even while editing.
        with self.transport() as (_, mirror):
            self.assertEqual(self.request({"retryMonthlyLogSignature": True}).status_code, 200)
        mirror.assert_called_once()
        self.assertFalse(self.overlay.migrated_signatures.exists())
        self.overlay.status = "awaiting-signature"
        self.overlay.save(update_fields=["status"])
        with self.transport() as (_, mirror):
            self.assertEqual(self.sign(reviewRevision=0).status_code, 409)
            self.assertEqual(self.sign(reviewRevision=1).status_code, 200)
        mirror.assert_not_called()
        self.overlay.refresh_from_db()
        self.assertEqual(self.overlay.migrated_signatures.count(), 1)
        self.assertNotEqual(self.overlay.migrated_signatures.get().pk, old_request["signatureId"])
        self.assertEqual(logs.saved_state(self.overlay)["signatureId"], old_request["signatureId"])
        self.assertEqual(logs.saved_state(self.overlay)["status"], "synced")

    def test_coach_signing_last_completes_without_erasing_the_log_receipt(self):
        with self.transport() as (_, mirror):
            self.sign()
            self.assertEqual(sign_request(self.overlay, "advisor").status_code, 200)
        self.overlay.refresh_from_db()
        self.assertEqual(self.overlay.status, "completed")
        self.assertEqual(logs.saved_state(self.overlay)["status"], "synced")
        mirror.assert_called_once()

    def test_receipt_write_failure_keeps_durable_pending_request_for_safe_retry(self):
        with self.transport(failure=True):
            self.sign()
        self.overlay.refresh_from_db()
        with self.transport() as (_, mirror), \
             patch.object(ImportedReviewInstance.objects, "select_for_update", side_effect=RuntimeError("receipt unavailable")):
            result = logs.sync_request(self.overlay)
        self.assertEqual(result["status"], "failed")
        self.overlay.refresh_from_db()
        self.assertEqual(logs.saved_state(self.overlay)["status"], "failed")
        self.assertEqual(self.overlay.migrated_signatures.count(), 1)
        with self.transport() as (_, mirror):
            mirror.return_value = {"status": "already-synced"}
            response = self.request({"retryMonthlyLogSignature": True})
        self.assertEqual(json.loads(response.content)["monthlyLogSync"]["status"], "already-synced")
        self.assertEqual(self.overlay.migrated_signatures.count(), 1)

    def test_previous_signature_without_consent_cannot_be_copied_retroactively(self):
        with self.transport() as (_, mirror):
            self.assertEqual(self.request({"signature": PNG}).status_code, 200)
            self.assertEqual(self.request({"retryMonthlyLogSignature": True}).status_code, 409)
            self.assertEqual(self.sign().status_code, 409)
        mirror.assert_not_called()

    def test_pr_and_missing_month_cannot_enable_monthly_log_copy(self):
        for family, target in (("Progress Review", "2026-10-19"), ("Monthly Coaching Meeting", None)):
            self.definition["historicalReview"]["type"] = family
            self.definition["instance"]["targetDate"] = target
            with self.subTest(family=family, target=target), self.transport() as (_, mirror):
                response = self.sign()
                self.assertEqual(response.status_code, 409)
                mirror.assert_not_called()
                self.assertFalse(self.overlay.migrated_signatures.exists())

    def test_other_learner_staff_employer_and_preview_cannot_copy(self):
        for role, subject, query, expected in (
            ("learner", 999, "", 404), ("staff", 71, "", 403),
            ("employer", 91, "", 403), ("learner", 71, "?viewAsLearner=71", 403),
        ):
            self.account.role, self.account.subject_id = role, subject
            with self.subTest(role=role, subject=subject, query=query), self.transport() as (_, mirror):
                response = self.request({"signature": PNG, "applyMonthlyLogSignature": True}, query=query)
                self.assertEqual(response.status_code, expected)
                mirror.assert_not_called()
                self.assertFalse(self.overlay.migrated_signatures.exists())

    def test_retry_rechecks_ownership_and_original_signer(self):
        with self.transport(failure=True):
            self.sign()
        for account_id, subject, expected in ((1, 999, 404), (2, 71, 409)):
            self.account.pk, self.account.subject_id = account_id, subject
            with self.subTest(account=account_id), self.transport() as (_, mirror):
                self.assertEqual(self.request({"retryMonthlyLogSignature": True}).status_code, expected)
                mirror.assert_not_called()

    def test_invalid_choice_is_rejected_before_signing(self):
        for name in ("applyMonthlyLogSignature", "retryMonthlyLogSignature"):
            for value in ("true", 1, None):
                with self.subTest(name=name, value=value), self.transport():
                    self.assertEqual(self.request({"signature": PNG, name: value}).status_code, 400)
        self.assertFalse(self.overlay.migrated_signatures.exists())

    def test_signing_error_never_queues_a_log_copy(self):
        with self.transport() as (_, mirror):
            self.assertEqual(self.sign(signature="invalid").status_code, 409)
        self.overlay.refresh_from_db()
        self.assertFalse(logs.saved_state(self.overlay))
        mirror.assert_not_called()

    def test_detail_restores_pending_copy_for_original_month_after_reload(self):
        with self.transport(failure=True):
            self.sign()
        self.overlay.refresh_from_db()
        self.definition["instance"]["targetDate"] = "2027-05-01"
        with self.transport():
            definition = endpoints._party_definition(self.overlay, self.account)
        self.assertEqual(definition["mcmMonthlyLog"]["month"], "2026-10")
        self.assertEqual(definition["mcmMonthlyLog"]["sync"]["status"], "failed")
        self.assertNotIn("enrolmentId", definition["mcmMonthlyLog"]["sync"])
        self.assertNotIn("historicalReview", definition)

    def test_option_is_learner_mcm_only_and_preserves_reporting_month(self):
        option = logs.signing_option(self.overlay, self.account, self.definition)
        self.assertEqual(option, {"month": "2026-10"})
        self.account.role = "employer"
        self.assertIsNone(logs.signing_option(self.overlay, self.account, self.definition))

    def test_late_failed_retry_cannot_hide_a_successful_copy_or_unrelated_metadata(self):
        with self.transport(failure=True):
            self.sign()
        self.overlay.refresh_from_db()
        self.overlay.meeting_intelligence["unrelated"] = {"keep": True}
        self.overlay.save(update_fields=["meeting_intelligence"])

        def concurrent_success(*args):
            current = ImportedReviewInstance.objects.get(pk=self.overlay.pk)
            current.meeting_intelligence[logs.STATE_KEY].update(status="already-synced")
            current.meeting_intelligence[logs.STATE_KEY].pop("message", None)
            current.save(update_fields=["meeting_intelligence"])
            raise RuntimeError("late failure")

        with self.transport() as (_, mirror):
            mirror.side_effect = concurrent_success
            response = self.request({"retryMonthlyLogSignature": True})
        self.assertEqual(json.loads(response.content)["monthlyLogSync"]["status"], "already-synced")
        self.overlay.refresh_from_db()
        self.assertEqual(self.overlay.meeting_intelligence["unrelated"], {"keep": True})

    def test_already_signed_log_and_historical_month_are_reported_without_overwriting(self):
        for result in ({"status": "already-synced"}, {"status": "skipped", "reason": "legacy_month"}):
            with self.subTest(result=result), self.transport() as (_, mirror):
                self.overlay, self.booking = review_fixture()
                mirror.return_value = result
                response = self.sign()
                self.assertEqual(json.loads(response.content)["monthlyLogSync"], {**result, "month": "2026-10"})
