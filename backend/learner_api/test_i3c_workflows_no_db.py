"""Database-free contracts for the disconnected I3C workflow foundation."""

from dataclasses import replace
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from pathlib import Path
from unittest.mock import Mock

from django.test import SimpleTestCase

from learner_api.malware_lifecycle import (
    ExpectedDeliveryIdentity,
    ExpectedScanBinding,
    ProviderEventRejected,
    ProviderScanEvent,
    RecoveryAction,
    ScanLifecycleState,
    ValidatedDeliveryIdentity,
    event_fingerprint,
)
from learner_api.malware_workflows import (
    AuthenticatedProviderMessage,
    ExactBlobIdentity,
    PreparedEventDisposition,
    PromotionReceipt,
    ProviderEventContext,
    PublicScanStatusFacts,
    RecoveryFacts,
    RetryPolicy,
    WorkflowPolicyError,
    next_retry_at,
    plan_recovery,
    prepare_authenticated_provider_event,
    public_scan_status,
    verify_promotion_receipt,
)


NOW = datetime(2026, 10, 24, 12, tzinfo=timezone.utc)


class ScannerWorkflowFoundationTests(SimpleTestCase):
    databases = []

    def setUp(self):
        self.delivery = ValidatedDeliveryIdentity(
            authenticated=True,
            tenant_id="tenant-a",
            audience="scanner-callback",
            publisher_app_id="event-grid",
            subscription_id="subscription-a",
        )
        self.event = ProviderScanEvent(
            provider="defender_for_storage",
            event_id="event-a",
            correlation_id="correlation-a",
            occurred_at=NOW - timedelta(minutes=1),
            storage_account="quarantine-account",
            container="quarantine",
            blob_name="jobs/job-a/file.pdf",
            blob_etag='"etag-a"',
            blob_version_id="version-a",
            verdict="clean",
            payload_sha256=sha256(b"synthetic-event").hexdigest(),
        )
        self.context = ProviderEventContext(
            expected_delivery=ExpectedDeliveryIdentity(
                tenant_id="tenant-a",
                audience="scanner-callback",
                publisher_app_id="event-grid",
                subscription_id="subscription-a",
            ),
            expected_scan=ExpectedScanBinding(
                provider="defender_for_storage",
                correlation_id="correlation-a",
                storage_account="quarantine-account",
                container="quarantine",
                blob_name="jobs/job-a/file.pdf",
                blob_etag='"etag-a"',
                blob_version_id="version-a",
                quarantined_at=NOW - timedelta(minutes=2),
            ),
            lifecycle_state=ScanLifecycleState.SCANNING,
            state_version=4,
        )

    def prepare(self, *, event=None, context=None):
        authenticator = Mock()
        authenticator.authenticate.return_value = AuthenticatedProviderMessage(
            self.delivery,
            event or self.event,
        )
        result = prepare_authenticated_provider_event(
            authenticator=authenticator,
            headers={"authorization": "synthetic"},
            body=b"synthetic-event",
            context=context or self.context,
            now=NOW,
        )
        authenticator.authenticate.assert_called_once()
        return result

    def test_clean_event_is_authenticated_correlated_and_requests_promotion(self):
        result = self.prepare()
        self.assertEqual(result.disposition, PreparedEventDisposition.APPLIED)
        self.assertEqual(result.target_state, ScanLifecycleState.CLEAN_VERIFIED)
        self.assertEqual(result.outbox_operations, ("promote",))
        self.assertEqual(result.expected_state_version, 4)

    def test_infected_event_stays_private_until_retention_policy_is_approved(self):
        result = self.prepare(event=replace(self.event, verdict="malicious"))
        self.assertEqual(result.target_state, ScanLifecycleState.INFECTED)
        self.assertEqual(result.outbox_operations, ())

    def test_exact_redelivery_is_noop_and_conflicting_reuse_is_rejected(self):
        duplicate = replace(
            self.context,
            existing_event_fingerprint=event_fingerprint(self.event),
        )
        result = self.prepare(context=duplicate)
        self.assertEqual(result.disposition, PreparedEventDisposition.DUPLICATE)
        self.assertIsNone(result.target_state)
        with self.assertRaises(ProviderEventRejected):
            self.prepare(
                event=replace(self.event, verdict="infected"),
                context=duplicate,
            )

    def test_authenticated_early_event_is_deferred_without_side_effects(self):
        result = self.prepare(
            context=replace(self.context, lifecycle_state=ScanLifecycleState.QUARANTINED)
        )
        self.assertEqual(result.disposition, PreparedEventDisposition.DEFERRED)
        self.assertEqual(result.outbox_operations, ())

    def test_mismatched_blob_or_transport_identity_is_rejected(self):
        with self.assertRaises(ProviderEventRejected):
            self.prepare(event=replace(self.event, blob_etag='"wrong"'))

        authenticator = Mock()
        authenticator.authenticate.return_value = AuthenticatedProviderMessage(
            replace(self.delivery, authenticated=False), self.event
        )
        with self.assertRaises(ProviderEventRejected):
            prepare_authenticated_provider_event(
                authenticator=authenticator,
                headers={},
                body=b"synthetic-event",
                context=self.context,
                now=NOW,
            )

    def test_authenticated_parser_cannot_substitute_a_different_body_digest(self):
        with self.assertRaisesRegex(WorkflowPolicyError, "body digest"):
            self.prepare(event=replace(self.event, payload_sha256="a" * 64))

    def test_promotion_requires_conditional_source_and_verified_destination(self):
        source = ExactBlobIdentity("q", "quarantine", "job/file", '"q-etag"', "v1")
        destination = ExactBlobIdentity("a", "approved", "job/file", '"a-etag"', "v2")
        good = PromotionReceipt(source, destination, True, True)
        verify_promotion_receipt(
            good,
            expected_source=source,
            expected_destination=destination,
        )
        with self.assertRaises(WorkflowPolicyError):
            verify_promotion_receipt(
                replace(good, destination_verified=False),
                expected_source=source,
                expected_destination=destination,
            )

    def test_retry_schedule_is_bounded_deterministic_and_exhausts(self):
        policy = RetryPolicy(
            base_delay=timedelta(seconds=10),
            maximum_delay=timedelta(minutes=2),
            maximum_attempts=3,
        )
        first = next_retry_at(
            now=NOW, attempt_count=1, stable_identity="job-a", policy=policy
        )
        self.assertEqual(
            first,
            next_retry_at(
                now=NOW, attempt_count=1, stable_identity="job-a", policy=policy
            ),
        )
        self.assertGreater(first, NOW)
        self.assertLessEqual(first, NOW + timedelta(seconds=12))
        self.assertIsNone(
            next_retry_at(
                now=NOW, attempt_count=3, stable_identity="job-a", policy=policy
            )
        )

    def test_recovery_plans_one_idempotent_operation_or_expiry(self):
        pending = plan_recovery(
            RecoveryFacts(ScanLifecycleState.PENDING_UPLOAD, 0, 3, False)
        )
        self.assertEqual(pending.outbox_operation, "upload_reconcile")
        promotion = plan_recovery(
            RecoveryFacts(ScanLifecycleState.CLEAN_VERIFIED, 1, 3, False)
        )
        self.assertEqual(promotion.outbox_operation, "promote")
        exhausted = plan_recovery(
            RecoveryFacts(ScanLifecycleState.SCAN_FAILED, 4, 3, False)
        )
        self.assertEqual(exhausted.action, RecoveryAction.EXPIRE)
        self.assertEqual(exhausted.target_state, ScanLifecycleState.EXPIRED)

    def test_public_status_contract_exposes_no_storage_or_provider_details(self):
        pending = public_scan_status(
            PublicScanStatusFacts(
                job_id="job-a",
                lifecycle_state=ScanLifecycleState.SCAN_FAILED,
                updated_at=NOW,
                attempt_count=1,
                retry_limit=3,
                next_retry_at=NOW + timedelta(minutes=1),
            )
        )
        self.assertEqual(pending["status"], "pending")
        self.assertTrue(pending["retryable"])
        self.assertEqual(pending["scanResult"], "error")
        self.assertNotIn("blob", str(pending).lower())
        self.assertNotIn("provider", str(pending).lower())

        clean = public_scan_status(
            PublicScanStatusFacts(
                job_id="job-a",
                lifecycle_state=ScanLifecycleState.CLEAN_VERIFIED,
                updated_at=NOW,
                attempt_count=1,
                retry_limit=3,
                promotion_completed=True,
                metadata_committed=True,
            )
        )
        self.assertEqual(clean["status"], "approved")
        self.assertEqual(clean["scanResult"], "clean")

    def test_new_workflow_remains_disconnected_from_live_requests(self):
        root = Path(__file__).resolve().parent.parent
        for relative in (
            "learner_api/evidence.py",
            "learner_api/reflection_submissions.py",
            "learner_api/support_ticket_files.py",
            "enrolment_api/learner_uploads.py",
            "login/advanced_admin_assignment_uploads.py",
        ):
            with self.subTest(module=relative):
                source = (root / relative).read_text(encoding="utf-8")
                self.assertNotIn("malware_workflows", source)
