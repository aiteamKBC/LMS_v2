"""Database-free integration contracts for the F06-I3D Defender pipeline."""

from __future__ import annotations

import base64
from contextlib import nullcontext
from dataclasses import replace
from datetime import datetime, timedelta, timezone
import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
import uuid

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from django.test import RequestFactory, SimpleTestCase, override_settings

from learner_api import malware_integration, malware_webhooks, malware_workers
from learner_api.malware_azure_storage import (
    AzureScannerStorageConflict,
    AzureScannerStorageError,
    DefenderBlobStorageAdapter,
)
from learner_api.malware_defender import (
    DefenderAuthenticationError,
    DefenderConfiguration,
    DefenderEventGridAuthenticator,
    DefenderPayloadError,
    EntraEventGridTokenVerifier,
)
from learner_api.malware_integration import ProviderCommitResult, verified_download_allowed
from learner_api.malware_lifecycle import (
    ExpectedDeliveryIdentity,
    ExpectedScanBinding,
    ProviderEventRejected,
    ScanLifecycleState,
    event_fingerprint,
    validate_provider_event,
)
from learner_api.malware_workflows import ExactBlobIdentity, PromotionReceipt


NOW = datetime(2026, 10, 24, 12, tzinfo=timezone.utc)
TENANT = "11111111-1111-4111-8111-111111111111"
PUBLISHER = "22222222-2222-4222-8222-222222222222"
TOPIC = "/subscriptions/sub-a/resourceGroups/rg-a/providers/Microsoft.EventGrid/topics/scan-results"
CONTENT_DIGEST = "a" * 64


def _b64(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _configuration() -> DefenderConfiguration:
    return DefenderConfiguration(
        enabled=True,
        on_upload_verified=True,
        event_grid_verified=True,
        private_quarantine_verified=True,
        storage_account="quarantineacct",
        quarantine_container="private-quarantine",
        approved_storage_account="approvedacct",
        approved_container="private-approved",
        tenant_id=TENANT,
        audience="api://lms-scanner",
        publisher_app_id=PUBLISHER,
        subscription_name="lms-defender-results",
        topic=TOPIC,
    )


def _event(result="No threats found", *, event_id="event-1", etag="etag-1", account="quarantineacct"):
    details = {"sha256": CONTENT_DIGEST} if result == "No threats found" else None
    return {
        "id": event_id,
        "subject": f"storageAccounts/{account}/containers/private-quarantine/blobs/jobs/job-1/report.pdf",
        "data": {
            "correlationId": "correlation-1",
            "blobUri": (
                f"https://{account}.blob.core.windows.net/private-quarantine/"
                "jobs/job-1/report.pdf?versionid=version-1"
            ),
            "eTag": etag,
            "scanFinishedTimeUtc": "2026-10-24T11:59:00Z",
            "scanResultType": result,
            "scanResultDetails": details,
        },
        "eventType": "Microsoft.Security.MalwareScanningResult",
        "dataVersion": "1.0",
        "metadataVersion": "1",
        "eventTime": "2026-10-24T11:59:01Z",
        "topic": TOPIC,
    }


class _Jwks:
    def __init__(self, key):
        numbers = key.public_key().public_numbers()
        self.value = [{
            "kid": "key-1",
            "kty": "RSA",
            "use": "sig",
            "alg": "RS256",
            "e": _b64(numbers.e.to_bytes((numbers.e.bit_length() + 7) // 8, "big")),
            "n": _b64(numbers.n.to_bytes((numbers.n.bit_length() + 7) // 8, "big")),
        }]
        self.refreshes = []

    def keys(self, tenant_id, *, refresh=False):
        self.refreshes.append(refresh)
        return self.value


def _token(private_key, *, publisher=PUBLISHER, audience="api://lms-scanner") -> str:
    header = _b64(json.dumps({"alg": "RS256", "kid": "key-1"}).encode())
    claims = _b64(json.dumps({
        "iss": f"https://login.microsoftonline.com/{TENANT}/v2.0",
        "tid": TENANT,
        "aud": audience,
        "azp": publisher,
        "iat": int(NOW.timestamp()) - 30,
        "nbf": int(NOW.timestamp()) - 30,
        "exp": int(NOW.timestamp()) + 300,
    }).encode())
    signature = private_key.sign(
        f"{header}.{claims}".encode("ascii"),
        padding.PKCS1v15(),
        hashes.SHA256(),
    )
    return f"{header}.{claims}.{_b64(signature)}"


class DefenderProviderAdapterTests(SimpleTestCase):
    databases = []

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    def adapter(self):
        cfg = _configuration()
        verifier = EntraEventGridTokenVerifier(cfg, _Jwks(self.private_key))
        return DefenderEventGridAuthenticator(cfg, verifier)

    def headers(self, **overrides):
        values = {
            "Authorization": f"Bearer {_token(self.private_key)}",
            "aeg-event-type": "Notification",
            "aeg-subscription-name": "lms-defender-results",
            "aeg-delivery-count": "0",
        }
        values.update(overrides)
        return values

    def parse(self, event):
        return self.adapter().authenticate_many(
            headers=self.headers(),
            body=json.dumps([event]).encode(),
            now=NOW,
        )[0]

    def test_clean_infected_failed_and_not_scanned_map_without_fabricated_clean(self):
        expected = {
            "No threats found": "clean",
            "Malicious": "infected",
            "Error": "failed",
            "Not scanned": "failed",
        }
        for result, verdict in expected.items():
            with self.subTest(result=result):
                parsed = self.parse(_event(result))
                self.assertEqual(parsed.message.event.verdict, verdict)
        with self.assertRaises(DefenderPayloadError):
            self.parse(_event("Unknown provider result"))

    def test_clean_requires_provider_content_hash_and_exact_quarantine_origin(self):
        missing_hash = _event()
        missing_hash["data"]["scanResultDetails"] = None
        with self.assertRaises(DefenderPayloadError):
            self.parse(missing_hash)
        with self.assertRaises(DefenderPayloadError):
            self.parse(_event(account="otheraccount"))

    def test_wrong_blob_etag_or_version_is_rejected_by_exact_binding(self):
        parsed = self.parse(_event(etag="wrong-etag"))
        event = parsed.message.event
        expected = ExpectedScanBinding(
            provider="defender_for_storage",
            correlation_id="correlation-1",
            storage_account="quarantineacct",
            container="private-quarantine",
            blob_name="jobs/job-1/report.pdf",
            blob_etag="etag-1",
            blob_version_id="version-1",
            quarantined_at=NOW - timedelta(minutes=2),
            content_sha256=CONTENT_DIGEST,
        )
        with self.assertRaises(ProviderEventRejected):
            validate_provider_event(
                event,
                delivery=parsed.message.delivery,
                expected_delivery=ExpectedDeliveryIdentity(
                    TENANT, "api://lms-scanner", PUBLISHER, "lms-defender-results"
                ),
                expected_scan=expected,
                now=NOW,
            )
        wrong_version = replace(event, blob_etag="etag-1", blob_version_id="other-version")
        with self.assertRaises(ProviderEventRejected):
            validate_provider_event(
                wrong_version,
                delivery=parsed.message.delivery,
                expected_delivery=ExpectedDeliveryIdentity(
                    TENANT, "api://lms-scanner", PUBLISHER, "lms-defender-results"
                ),
                expected_scan=expected,
                now=NOW,
            )

    def test_forged_token_wrong_publisher_and_wrong_subscription_are_rejected(self):
        adapter = self.adapter()
        for headers in (
            self.headers(Authorization="Bearer forged.token.value"),
            self.headers(Authorization=f"Bearer {_token(self.private_key, publisher=TENANT)}"),
            self.headers(**{"aeg-subscription-name": "other-subscription"}),
        ):
            with self.subTest(headers=headers), self.assertRaises(DefenderAuthenticationError):
                adapter.authenticate_many(
                    headers=headers,
                    body=json.dumps([_event()]).encode(),
                    now=NOW,
                )

    def test_duplicate_event_ids_in_one_batch_and_reused_ids_are_detectable(self):
        body = json.dumps([_event(), _event()]).encode()
        with self.assertRaises(DefenderPayloadError):
            self.adapter().authenticate_many(headers=self.headers(), body=body, now=NOW)
        first = self.parse(_event()).message.event
        conflicting = self.parse(_event("Malicious")).message.event
        self.assertNotEqual(event_fingerprint(first), event_fingerprint(conflicting))

    def test_subscription_validation_requires_the_same_authenticated_boundary(self):
        body = json.dumps([{
            "id": "validation-1",
            "eventType": "Microsoft.EventGrid.SubscriptionValidationEvent",
            "topic": TOPIC,
            "data": {"validationCode": "validation-code-1"},
        }]).encode()
        headers = self.headers(**{"aeg-event-type": "SubscriptionValidation"})
        code = self.adapter().subscription_validation_code(
            headers=headers, body=body, now=NOW
        )
        self.assertEqual(code, "validation-code-1")

    def test_authenticated_clean_result_commits_receipt_transition_and_promotion_outbox_atomically(self):
        parsed = self.parse(_event())
        job = SimpleNamespace(
            pk=uuid.uuid4(),
            provider="defender_for_storage",
            lifecycle_state="scan_pending",
            state_version=2,
            correlation_id="correlation-1",
            quarantine_account="quarantineacct",
            quarantine_container="private-quarantine",
            quarantine_blob_name="jobs/job-1/report.pdf",
            quarantine_etag="etag-1",
            quarantine_version_id="version-1",
            content_sha256=CONTENT_DIGEST,
            attempt_count=1,
            retry_limit=3,
        )
        candidate_query = MagicMock()
        candidate_query.__getitem__.return_value = [job]
        job_repository = MagicMock()
        job_repository.select_for_update.return_value.filter.return_value = candidate_query
        job_manager = MagicMock()
        job_manager.using.return_value = job_repository

        no_existing = MagicMock()
        no_existing.first.return_value = None
        quarantine_history = MagicMock()
        quarantine_history.order_by.return_value.first.return_value = SimpleNamespace(
            occurred_at=NOW - timedelta(minutes=2)
        )
        event_repository = MagicMock()
        event_repository.filter.side_effect = [no_existing, quarantine_history]
        event_manager = MagicMock()
        event_manager.using.return_value = event_repository
        receipt = SimpleNamespace(pk=51)
        updated = SimpleNamespace(
            pk=job.pk, lifecycle_state="clean_verified", state_version=3
        )
        with patch.object(malware_integration.FileScanJob, "objects", job_manager), patch.object(
            malware_integration.FileScanEvent, "objects", event_manager
        ), patch.object(
            malware_integration.transaction, "atomic", return_value=nullcontext()
        ), patch.object(
            malware_integration, "append_scan_event", return_value=(receipt, True)
        ) as append, patch.object(
            malware_integration,
            "apply_validated_lifecycle_transition",
            return_value=updated,
        ) as transition:
            result = malware_integration.commit_defender_event(
                parsed, configuration=_configuration(), now=NOW
            )
        self.assertEqual(result.lifecycle_state, "clean_verified")
        append.assert_called_once()
        self.assertEqual(
            transition.call_args.kwargs["authoritative_event_id"], receipt.pk
        )
        self.assertEqual(
            transition.call_args.kwargs["outbox_operations"], ("promote",)
        )


class _Http404(Exception):
    status_code = 404


class AzureStorageAdapterTests(SimpleTestCase):
    databases = []

    def services(self):
        quarantine = MagicMock()
        approved = MagicMock()
        quarantine.account_name = "quarantineacct"
        approved.account_name = "approvedacct"
        quarantine.get_account_information.return_value = {
            "account_kind": "StorageV2", "sku_name": "Standard_LRS"
        }
        approved.get_account_information.return_value = {
            "account_kind": "StorageV2", "sku_name": "Standard_LRS"
        }
        quarantine.get_container_client.return_value.get_container_properties.return_value = {
            "public_access": None
        }
        approved.get_container_client.return_value.get_container_properties.return_value = {
            "public_access": None
        }
        return quarantine, approved

    def test_capability_check_requires_supported_private_storage(self):
        quarantine, approved = self.services()
        adapter = DefenderBlobStorageAdapter(
            _configuration(), quarantine_service=quarantine, approved_service=approved
        )
        adapter.verify_capabilities()
        approved.get_container_client.return_value.get_container_properties.return_value = {
            "public_access": "blob"
        }
        with self.assertRaisesRegex(Exception, "private"):
            adapter.verify_capabilities()

    def test_inspection_rejects_etag_change(self):
        quarantine, approved = self.services()
        quarantine.get_blob_client.return_value.get_blob_properties.return_value = SimpleNamespace(
            etag="changed", version_id="version-1"
        )
        adapter = DefenderBlobStorageAdapter(
            _configuration(), quarantine_service=quarantine, approved_service=approved
        )
        blob = ExactBlobIdentity(
            "quarantineacct", "private-quarantine", "jobs/job-1/report.pdf", "etag-1", "version-1"
        )
        with self.assertRaises(AzureScannerStorageConflict):
            adapter.inspect_exact(blob)

    def test_promotion_is_conditional_idempotent_and_returns_verified_destination(self):
        quarantine, approved = self.services()
        source_client = quarantine.get_blob_client.return_value
        source_client.url = "https://quarantineacct.blob.core.windows.net/private-quarantine/jobs/job-1/report.pdf"
        source_client.get_blob_properties.return_value = SimpleNamespace(
            etag="etag-1", version_id="version-1"
        )
        destination_client = approved.get_blob_client.return_value
        idempotency_key = "b" * 64
        source = ExactBlobIdentity(
            "quarantineacct", "private-quarantine", "jobs/job-1/report.pdf", "etag-1", "version-1"
        )
        source_hash = __import__("hashlib").sha256(
            b"quarantineacct/private-quarantine/jobs/job-1/report.pdf/etag-1/version-1"
        ).hexdigest()
        final = SimpleNamespace(
            etag="approved-etag",
            version_id="approved-version",
            metadata={"lms_scan_idempotency": idempotency_key, "lms_scan_source": source_hash},
            copy=SimpleNamespace(status="success"),
        )
        destination_client.get_blob_properties.side_effect = [_Http404(), final]
        adapter = DefenderBlobStorageAdapter(
            _configuration(),
            quarantine_service=quarantine,
            approved_service=approved,
            quarantine_source_sas="sp=r&sig=synthetic",
            sleep=lambda _seconds: None,
        )
        receipt = adapter.promote_exact(
            source,
            ExactBlobIdentity(
                "approvedacct", "private-approved", source.name, "pending", None
            ),
            idempotency_key=idempotency_key,
        )
        self.assertTrue(receipt.source_condition_applied)
        self.assertTrue(receipt.destination_verified)
        self.assertEqual(receipt.destination.etag, "approved-etag")
        self.assertEqual(
            destination_client.start_copy_from_url.call_args.kwargs["source_if_match"],
            "etag-1",
        )


@override_settings(
    DEFENDER_STORAGE_INTEGRATION_ENABLED=True,
    DEFENDER_ON_UPLOAD_SCANNING_VERIFIED=True,
    DEFENDER_EVENT_GRID_VERIFIED=True,
    DEFENDER_PRIVATE_QUARANTINE_VERIFIED=True,
    DEFENDER_STORAGE_ACCOUNT="quarantineacct",
    DEFENDER_QUARANTINE_CONTAINER="private-quarantine",
    DEFENDER_APPROVED_STORAGE_ACCOUNT="approvedacct",
    DEFENDER_APPROVED_CONTAINER="private-approved",
    DEFENDER_EVENT_GRID_TENANT_ID=TENANT,
    DEFENDER_EVENT_GRID_AUDIENCE="api://lms-scanner",
    DEFENDER_EVENT_GRID_PUBLISHER_APP_ID=PUBLISHER,
    DEFENDER_EVENT_GRID_SUBSCRIPTION_NAME="lms-defender-results",
    DEFENDER_EVENT_GRID_TOPIC=TOPIC,
)
class DefenderWebhookTests(SimpleTestCase):
    databases = []

    def setUp(self):
        self.factory = RequestFactory()

    def test_forged_webhook_is_rejected_without_database_work(self):
        request = self.factory.post(
            "/learner_api/scanner/events/defender/",
            data=json.dumps([_event()]),
            content_type="application/json",
            HTTP_AUTHORIZATION="Bearer forged.token.value",
            HTTP_AEG_EVENT_TYPE="Notification",
            HTTP_AEG_SUBSCRIPTION_NAME="lms-defender-results",
            HTTP_AEG_DELIVERY_COUNT="0",
        )
        with patch.object(malware_webhooks, "commit_defender_event") as commit:
            response = malware_webhooks.defender_event_grid(request)
        self.assertEqual(response.status_code, 401)
        self.assertEqual(json.loads(response.content), {"error": "event_authentication_failed"})
        commit.assert_not_called()

    @override_settings(DEFENDER_STORAGE_INTEGRATION_ENABLED=False)
    def test_unavailable_integration_fails_closed_before_parsing_or_persistence(self):
        request = self.factory.post(
            "/learner_api/scanner/events/defender/",
            data=b"[]",
            content_type="application/json",
            HTTP_AEG_EVENT_TYPE="Notification",
        )
        with patch.object(malware_webhooks, "DefenderEventGridAuthenticator") as adapter, patch.object(
            malware_webhooks, "commit_defender_event"
        ) as commit:
            response = malware_webhooks.defender_event_grid(request)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(json.loads(response.content), {"error": "scanner_unavailable"})
        adapter.assert_not_called()
        commit.assert_not_called()

    def test_authenticated_batch_returns_counts_and_duplicate_is_noop(self):
        parsed_a, parsed_b = object(), object()
        adapter = MagicMock()
        adapter.authenticate_many.return_value = (parsed_a, parsed_b)
        request = self.factory.post(
            "/learner_api/scanner/events/defender/",
            data=b"[]",
            content_type="application/json",
            HTTP_AEG_EVENT_TYPE="Notification",
        )
        with patch.object(malware_webhooks, "DefenderEventGridAuthenticator", return_value=adapter), patch.object(
            malware_webhooks,
            "commit_defender_event",
            side_effect=(
                ProviderCommitResult(uuid.uuid4(), "applied", "clean_verified", 3),
                ProviderCommitResult(uuid.uuid4(), "duplicate", "clean_verified", 3),
            ),
        ):
            response = malware_webhooks.defender_event_grid(request)
        self.assertEqual(response.status_code, 202)
        self.assertEqual(json.loads(response.content), {"accepted": 1, "duplicates": 1})

    def test_unexpected_failure_returns_sanitized_retryable_response(self):
        secret = "secret-account-key-and-learner@example.invalid"
        adapter = MagicMock()
        adapter.authenticate_many.side_effect = RuntimeError(secret)
        request = self.factory.post(
            "/learner_api/scanner/events/defender/",
            data=b"[]",
            content_type="application/json",
            HTTP_AEG_EVENT_TYPE="Notification",
        )
        with patch.object(malware_webhooks, "DefenderEventGridAuthenticator", return_value=adapter), self.assertLogs(
            "learner_api.malware_webhooks", level="ERROR"
        ) as logs:
            response = malware_webhooks.defender_event_grid(request)
        combined = response.content.decode() + "\n".join(logs.output)
        self.assertEqual(response.status_code, 503)
        self.assertNotIn(secret, combined)


class WorkerAndDownloadSafetyTests(SimpleTestCase):
    databases = []

    def dependencies(self, storage=None, writer=None):
        return malware_workers.WorkerDependencies(
            configuration=_configuration(),
            storage=storage or MagicMock(),
            metadata_writer=writer or MagicMock(),
        )

    def test_retry_exhaustion_dead_letters_without_raw_error(self):
        row = SimpleNamespace(
            pk=7,
            operation="submit_scan",
            attempt_count=4,
            job=SimpleNamespace(retry_limit=3),
        )
        with patch.object(malware_workers, "acquire_due_outbox_operations", return_value=[row]), patch.object(
            malware_workers, "execute_outbox_operation", side_effect=AzureScannerStorageError("secret")
        ), patch.object(malware_workers, "dead_letter_outbox_operation") as dead, patch.object(
            malware_workers, "release_outbox_lease"
        ) as retry:
            result = malware_workers.dispatch_outbox_batch(
                worker_id="worker-a", dependencies=self.dependencies(), now=NOW
            )
        self.assertEqual(result.dead_lettered, 1)
        self.assertEqual(dead.call_args.kwargs["error_category"], "retry_exhausted")
        retry.assert_not_called()

    def test_worker_promotes_only_verified_clean_exact_blob_then_commits_metadata(self):
        job = SimpleNamespace(
            pk=uuid.uuid4(),
            lifecycle_state="clean_verified",
            quarantine_account="quarantineacct",
            quarantine_container="private-quarantine",
            quarantine_blob_name="jobs/job-1/report.pdf",
            quarantine_etag="etag-1",
            quarantine_version_id="version-1",
        )
        source = ExactBlobIdentity(
            "quarantineacct", "private-quarantine", job.quarantine_blob_name, "etag-1", "version-1"
        )
        destination = ExactBlobIdentity(
            "approvedacct", "private-approved", job.quarantine_blob_name, "approved-etag", "approved-version"
        )
        storage = MagicMock()
        storage.promote_exact.return_value = PromotionReceipt(source, destination, True, True)
        writer = MagicMock()
        row = SimpleNamespace(
            operation="promote", job_id=job.pk, idempotency_key="b" * 64
        )
        repository = MagicMock()
        repository.get.return_value = job
        manager = MagicMock()
        manager.using.return_value = repository
        promoted_job = SimpleNamespace(**job.__dict__, approved_account="approvedacct")
        with patch.object(malware_workers.FileScanJob, "objects", manager), patch.object(
            malware_workers, "record_promotion_receipt", return_value=promoted_job
        ) as record, patch.object(
            malware_workers, "mark_domain_metadata_committed"
        ) as commit_metadata:
            malware_workers.execute_outbox_operation(
                row, self.dependencies(storage=storage, writer=writer), now=NOW
            )
        storage.verify_capabilities.assert_called_once()
        storage.promote_exact.assert_called_once()
        record.assert_called_once()
        writer.commit_verified_clean.assert_called_once_with(
            promoted_job, occurred_at=NOW, using="enrolment"
        )
        commit_metadata.assert_called_once_with(
            job_id=job.pk, occurred_at=NOW, using="enrolment"
        )

    def test_two_workers_cannot_process_the_same_claimed_row(self):
        row = SimpleNamespace(pk=7, operation="cleanup_quarantine", attempt_count=1)
        with patch.object(
            malware_workers, "acquire_due_outbox_operations", side_effect=([row], [])
        ), patch.object(malware_workers, "execute_outbox_operation") as execute, patch.object(
            malware_workers, "complete_outbox_operation"
        ):
            first = malware_workers.dispatch_outbox_batch(
                worker_id="worker-a", dependencies=self.dependencies(), now=NOW
            )
            second = malware_workers.dispatch_outbox_batch(
                worker_id="worker-b", dependencies=self.dependencies(), now=NOW
            )
        self.assertEqual((first.claimed, second.claimed), (1, 0))
        execute.assert_called_once()

    def test_infected_file_is_not_deleted_without_retention_approval(self):
        job = SimpleNamespace(
            pk=uuid.uuid4(),
            lifecycle_state="infected",
            domain_metadata_committed_at=None,
        )
        row = SimpleNamespace(
            operation="cleanup_quarantine", job_id=job.pk, idempotency_key="c" * 64
        )
        repository = MagicMock()
        repository.get.return_value = job
        manager = MagicMock()
        manager.using.return_value = repository
        storage = MagicMock()
        with patch.object(malware_workers.FileScanJob, "objects", manager), self.assertRaisesRegex(
            Exception, "retention policy"
        ):
            malware_workers.execute_outbox_operation(
                row, self.dependencies(storage=storage), now=NOW
            )
        storage.delete_exact.assert_not_called()

    def test_missing_result_reconciliation_expires_without_unapproved_deletion(self):
        candidate = SimpleNamespace(
            pk=uuid.uuid4(), lifecycle_state="scan_pending"
        )
        leased = SimpleNamespace(
            pk=candidate.pk,
            lifecycle_state="scan_pending",
            state_version=4,
            attempt_count=4,
            retry_limit=3,
        )
        with patch.object(malware_workers, "due_scan_jobs", return_value=[candidate]), patch.object(
            malware_workers, "acquire_scan_job_lease", return_value=leased
        ), patch.object(malware_workers, "apply_validated_lifecycle_transition") as transition:
            handled = malware_workers.reconcile_due_scan_jobs(
                worker_id="worker-a", now=NOW
            )
        self.assertEqual(handled, 1)
        self.assertEqual(
            transition.call_args.kwargs["target_state"], ScanLifecycleState.EXPIRED
        )
        self.assertEqual(
            transition.call_args.kwargs["outbox_operations"],
            (),
        )

    def test_failed_state_retry_is_owned_by_outbox_not_double_consumed(self):
        candidate = SimpleNamespace(pk=uuid.uuid4(), lifecycle_state="scan_failed")
        with patch.object(malware_workers, "due_scan_jobs", return_value=[candidate]), patch.object(
            malware_workers, "acquire_scan_job_lease"
        ) as acquire:
            handled = malware_workers.reconcile_due_scan_jobs(
                worker_id="worker-a", now=NOW
            )
        self.assertEqual(handled, 0)
        acquire.assert_not_called()

    def test_unverified_or_wrong_approved_blob_never_authorizes_download(self):
        job = SimpleNamespace(
            lifecycle_state=ScanLifecycleState.CLEAN_VERIFIED.value,
            promotion_completed_at=None,
            domain_metadata_committed_at=None,
            approved_account="approvedacct",
            approved_container="private-approved",
            approved_blob_name="jobs/job-1/report.pdf",
            approved_etag="approved-etag",
        )
        expected = dict(
            expected_account="approvedacct",
            expected_container="private-approved",
            expected_blob_name="jobs/job-1/report.pdf",
            expected_blob_etag="approved-etag",
        )
        self.assertFalse(verified_download_allowed(job, **expected))
        job.promotion_completed_at = NOW
        self.assertFalse(verified_download_allowed(job, **expected))
        job.domain_metadata_committed_at = NOW
        self.assertTrue(verified_download_allowed(job, **expected))
        self.assertFalse(
            verified_download_allowed(job, **{**expected, "expected_blob_etag": "stale"})
        )
