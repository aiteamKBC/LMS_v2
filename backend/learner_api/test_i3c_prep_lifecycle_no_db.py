"""Database-free policy tests for the F06-I3C-PREP lifecycle foundation."""

from dataclasses import replace
from datetime import datetime, timedelta, timezone
from unittest import TestCase

from learner_api.malware_lifecycle import (
    ConcurrencyConflict,
    DeliveryDisposition,
    DownloadAuthorizationFacts,
    ExpectedDeliveryIdentity,
    ExpectedScanBinding,
    InvalidTransition,
    LifecycleSnapshot,
    ProviderEventDeferred,
    ProviderEventRejected,
    ProviderScanEvent,
    RecoveryAction,
    ScanLifecycleState,
    ValidatedDeliveryIdentity,
    classify_delivery,
    event_fingerprint,
    event_target_state,
    may_issue_download_sas,
    operation_idempotency_key,
    recovery_action,
    transition,
    validate_provider_event,
)


class MalwareLifecyclePolicyTests(TestCase):
    def setUp(self):
        self.now = datetime(2026, 10, 24, 12, tzinfo=timezone.utc)
        self.delivery = ValidatedDeliveryIdentity(
            authenticated=True,
            tenant_id="tenant-a",
            audience="scanner-callback",
            publisher_app_id="event-grid-publisher",
            subscription_id="subscription-a",
        )
        self.expected_delivery = ExpectedDeliveryIdentity(
            tenant_id="tenant-a",
            audience="scanner-callback",
            publisher_app_id="event-grid-publisher",
            subscription_id="subscription-a",
        )
        self.binding = ExpectedScanBinding(
            provider="defender_for_storage",
            correlation_id="correlation-a",
            storage_account="quarantineaccount",
            container="quarantine",
            blob_name="jobs/job-a/document.pdf",
            blob_etag='"etag-a"',
            blob_version_id="version-a",
            quarantined_at=self.now - timedelta(minutes=2),
        )
        self.event = ProviderScanEvent(
            provider="defender_for_storage",
            event_id="event-a",
            correlation_id="correlation-a",
            occurred_at=self.now - timedelta(minutes=1),
            storage_account="quarantineaccount",
            container="quarantine",
            blob_name="jobs/job-a/document.pdf",
            blob_etag='"etag-a"',
            blob_version_id="version-a",
            verdict="clean",
            payload_sha256="a" * 64,
        )

    def validate(self, event=None, delivery=None, binding=None):
        validate_provider_event(
            event or self.event,
            delivery=delivery or self.delivery,
            expected_delivery=self.expected_delivery,
            expected_scan=binding or self.binding,
            now=self.now,
        )

    def test_lifecycle_exposes_only_the_eight_approved_states(self):
        self.assertEqual(
            {state.value for state in ScanLifecycleState},
            {
                "pending_upload",
                "quarantined",
                "scan_pending",
                "scanning",
                "clean_verified",
                "infected",
                "scan_failed",
                "expired",
            },
        )

    def test_happy_path_transitions_are_versioned(self):
        snapshot = LifecycleSnapshot(ScanLifecycleState.PENDING_UPLOAD, 0)
        for target in (
            ScanLifecycleState.QUARANTINED,
            ScanLifecycleState.SCAN_PENDING,
            ScanLifecycleState.SCANNING,
            ScanLifecycleState.CLEAN_VERIFIED,
        ):
            snapshot = transition(snapshot, target, expected_version=snapshot.version)
        self.assertEqual(snapshot, LifecycleSnapshot(ScanLifecycleState.CLEAN_VERIFIED, 4))

    def test_stale_writer_and_invalid_transition_are_rejected(self):
        snapshot = LifecycleSnapshot(ScanLifecycleState.QUARANTINED, 3)
        with self.assertRaises(ConcurrencyConflict):
            transition(snapshot, ScanLifecycleState.SCAN_PENDING, expected_version=2)
        with self.assertRaises(InvalidTransition):
            transition(snapshot, ScanLifecycleState.CLEAN_VERIFIED, expected_version=3)

    def test_terminal_states_cannot_transition(self):
        for state in (
            ScanLifecycleState.CLEAN_VERIFIED,
            ScanLifecycleState.INFECTED,
            ScanLifecycleState.EXPIRED,
        ):
            with self.assertRaises(InvalidTransition):
                transition(LifecycleSnapshot(state, 1), ScanLifecycleState.SCAN_PENDING, expected_version=1)

    def test_authenticated_exact_blob_event_is_accepted(self):
        self.validate()
        self.assertEqual(
            event_target_state(ScanLifecycleState.SCANNING, verdict=self.event.verdict),
            ScanLifecycleState.CLEAN_VERIFIED,
        )

    def test_forged_delivery_is_rejected(self):
        with self.assertRaises(ProviderEventRejected):
            self.validate(delivery=replace(self.delivery, authenticated=False))
        with self.assertRaises(ProviderEventRejected):
            self.validate(delivery=replace(self.delivery, audience="wrong-audience"))

    def test_mismatched_correlation_and_blob_identity_are_rejected(self):
        for field, value in (
            ("correlation_id", "wrong-correlation"),
            ("storage_account", "wrong-account"),
            ("container", "approved"),
            ("blob_name", "other/file.pdf"),
            ("blob_etag", '"other-etag"'),
            ("blob_version_id", "other-version"),
        ):
            with self.subTest(field=field), self.assertRaises(ProviderEventRejected):
                self.validate(event=replace(self.event, **{field: value}))

    def test_invalid_payload_digest_is_rejected(self):
        with self.assertRaises(ProviderEventRejected):
            self.validate(event=replace(self.event, payload_sha256="not-a-sha256"))

    def test_stale_predating_and_future_events_are_rejected(self):
        for occurred_at in (
            self.binding.quarantined_at - timedelta(seconds=1),
            self.now - timedelta(days=2),
            self.now + timedelta(minutes=6),
        ):
            with self.subTest(occurred_at=occurred_at), self.assertRaises(ProviderEventRejected):
                self.validate(event=replace(self.event, occurred_at=occurred_at))

    def test_exact_redelivery_is_idempotent_but_event_id_reuse_is_rejected(self):
        fingerprint = event_fingerprint(self.event)
        self.assertEqual(
            classify_delivery(self.event, existing_fingerprint=fingerprint),
            DeliveryDisposition.DUPLICATE,
        )
        with self.assertRaises(ProviderEventRejected):
            classify_delivery(
                replace(self.event, verdict="infected"),
                existing_fingerprint=fingerprint,
            )

    def test_early_event_is_deferred_without_changing_trust_state(self):
        self.validate()
        for state in (ScanLifecycleState.PENDING_UPLOAD, ScanLifecycleState.QUARANTINED):
            with self.subTest(state=state), self.assertRaises(ProviderEventDeferred):
                event_target_state(state, verdict="clean")

    def test_duplicate_or_out_of_order_terminal_result_cannot_mutate_state(self):
        for state in (
            ScanLifecycleState.CLEAN_VERIFIED,
            ScanLifecycleState.INFECTED,
            ScanLifecycleState.EXPIRED,
        ):
            with self.subTest(state=state), self.assertRaises(ProviderEventRejected):
                event_target_state(state, verdict="clean")

    def test_provider_verdicts_map_only_to_fail_closed_terminal_outcomes(self):
        self.assertEqual(
            event_target_state(ScanLifecycleState.SCAN_PENDING, verdict="malicious"),
            ScanLifecycleState.INFECTED,
        )
        self.assertEqual(
            event_target_state(ScanLifecycleState.SCANNING, verdict="timeout"),
            ScanLifecycleState.SCAN_FAILED,
        )
        with self.assertRaises(ProviderEventRejected):
            event_target_state(ScanLifecycleState.SCANNING, verdict="probably clean")

    def test_clean_verdict_alone_never_authorizes_download(self):
        base = DownloadAuthorizationFacts(
            lifecycle_state=ScanLifecycleState.CLEAN_VERIFIED,
            promotion_completed=False,
            metadata_committed=False,
            approved_container="approved",
            approved_blob_name="job-a/document.pdf",
            approved_blob_etag='"approved-etag"',
            expected_container="approved",
            expected_blob_name="job-a/document.pdf",
            expected_blob_etag='"approved-etag"',
        )
        self.assertFalse(may_issue_download_sas(base))
        self.assertFalse(may_issue_download_sas(replace(base, promotion_completed=True)))
        self.assertTrue(
            may_issue_download_sas(
                replace(base, promotion_completed=True, metadata_committed=True)
            )
        )
        self.assertFalse(
            may_issue_download_sas(
                replace(
                    base,
                    promotion_completed=True,
                    metadata_committed=True,
                    approved_blob_etag='"stale-etag"',
                )
            )
        )

    def test_untrusted_states_never_authorize_download(self):
        for state in ScanLifecycleState:
            if state is ScanLifecycleState.CLEAN_VERIFIED:
                continue
            facts = DownloadAuthorizationFacts(
                lifecycle_state=state,
                promotion_completed=True,
                metadata_committed=True,
                approved_container="approved",
                approved_blob_name="file",
                approved_blob_etag="etag",
                expected_container="approved",
                expected_blob_name="file",
                expected_blob_etag="etag",
            )
            with self.subTest(state=state):
                self.assertFalse(may_issue_download_sas(facts))

    def test_recovery_policy_is_bounded_and_fail_closed(self):
        self.assertEqual(
            recovery_action(ScanLifecycleState.PENDING_UPLOAD, retries_remaining=True),
            RecoveryAction.RECONCILE_UPLOAD,
        )
        self.assertEqual(
            recovery_action(ScanLifecycleState.SCAN_FAILED, retries_remaining=True),
            RecoveryAction.RETRY_SCAN,
        )
        self.assertEqual(
            recovery_action(ScanLifecycleState.SCANNING, retries_remaining=False),
            RecoveryAction.EXPIRE,
        )
        self.assertEqual(
            recovery_action(
                ScanLifecycleState.CLEAN_VERIFIED,
                retries_remaining=False,
                promotion_completed=False,
            ),
            RecoveryAction.PROMOTE_OR_RECONCILE,
        )
        self.assertEqual(
            recovery_action(ScanLifecycleState.INFECTED, retries_remaining=False),
            RecoveryAction.CLEAN_QUARANTINE,
        )

    def test_outbox_idempotency_key_is_stable_and_version_scoped(self):
        first = operation_idempotency_key(job_id="job-a", state_version=4, operation="promote")
        self.assertEqual(
            first,
            operation_idempotency_key(job_id="job-a", state_version=4, operation="PROMOTE"),
        )
        self.assertNotEqual(
            first,
            operation_idempotency_key(job_id="job-a", state_version=5, operation="promote"),
        )
