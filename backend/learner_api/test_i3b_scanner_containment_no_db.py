"""F06-I3B fail-closed upload containment without database or Azure access."""
from datetime import datetime, timezone
import inspect
import json
import os
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import RequestFactory, SimpleTestCase, override_settings

from enrolment_api import learner_uploads
from login import advanced_admin_assignment_uploads as admin_uploads
from . import evidence
from . import personal_learning_activities as personal
from . import support_ticket_files as ticket_files
from .malware_scanning import (
    MalwareDetected,
    ScannerFailure,
    ScannerTimeout,
    ScannerUnavailable,
    VerifiedScanResult,
    verified_verdict,
)


def _json(response):
    return json.loads(response.content.decode("utf-8"))


def _result(verdict, *, container="quarantine", blob_name="test/blob"):
    return VerifiedScanResult(
        verdict=verdict,
        provider="synthetic-test-provider",
        correlation_id="scan-test-1",
        scanned_at=datetime(2026, 10, 24, 12, 0, tzinfo=timezone.utc),
        container=container,
        blob_name=blob_name,
        blob_etag='"synthetic-etag"',
    )


@override_settings(
    AZURE_QUARANTINE_CONTAINER="quarantine",
    AZURE_APPROVED_CONTAINER="approved",
    AZURE_REJECTED_CONTAINER="rejected",
)
class ScannerPolicyTests(SimpleTestCase):
    def test_only_provenance_bearing_clean_result_is_accepted(self):
        self.assertEqual(
            verified_verdict(
                _result("clean"),
                expected_container="quarantine",
                expected_blob_name="test/blob",
            ),
            "clean",
        )
        with self.assertRaises(ScannerFailure):
            verified_verdict(
                "clean",
                expected_container="quarantine",
                expected_blob_name="test/blob",
            )

    def test_result_for_a_different_blob_is_not_trusted(self):
        with self.assertRaises(ScannerFailure):
            verified_verdict(
                _result("clean", blob_name="other/blob"),
                expected_container="quarantine",
                expected_blob_name="test/blob",
            )

    def test_infected_timeout_and_unknown_results_fail_closed(self):
        with self.assertRaises(MalwareDetected):
            verified_verdict(
                _result("infected"), expected_container="quarantine", expected_blob_name="test/blob"
            )
        with self.assertRaises(ScannerTimeout):
            verified_verdict(
                _result("timeout"), expected_container="quarantine", expected_blob_name="test/blob"
            )
        with self.assertRaises(ScannerFailure):
            verified_verdict(
                _result("unknown"), expected_container="quarantine", expected_blob_name="test/blob"
            )


@override_settings(
    AZURE_QUARANTINE_CONTAINER="quarantine",
    AZURE_APPROVED_CONTAINER="approved",
    AZURE_REJECTED_CONTAINER="rejected",
)
class EvidenceUploadContainmentTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()

    def _request(self, **extra):
        upload = SimpleUploadedFile("report.pdf", b"synthetic evidence", content_type="application/pdf")
        return self.factory.post(
            "/learner_api/evidence/commercial/56/upload/",
            {"section_ref": "COMP-1", "file": upload, **extra},
        )

    def test_unavailable_scanner_rejects_before_storage_or_database_and_ignores_client_verdict(self):
        upload = self.enterContext(patch.object(evidence, "upload_to_quarantine"))
        connection = self.enterContext(patch.object(evidence, "_conn"))
        lineage = self.enterContext(patch.object(evidence, "_evidence_lineage"))
        self.enterContext(patch.object(evidence, "azure_configured", return_value=True))

        response = inspect.unwrap(evidence.upload_evidence)(
            self._request(scan_result="clean", status="approved"),
            kind="commercial",
            pk=56,
        )

        self.assertEqual(response.status_code, 503)
        self.assertEqual(
            _json(response),
            {"error": "Malware scanning is temporarily unavailable. Upload has not been saved."},
        )
        upload.assert_not_called()
        connection.assert_not_called()
        lineage.assert_not_called()

    def test_verified_clean_result_preserves_success_contract(self):
        cursor = MagicMock()
        connection = self.enterContext(patch.object(evidence, "_conn"))
        connection.return_value.cursor.return_value.__enter__.return_value = cursor
        self.enterContext(patch.object(evidence, "azure_configured", return_value=True))
        self.enterContext(patch.object(evidence, "_ensure_scanner_ready"))
        self.enterContext(patch.object(
            evidence,
            "_scan",
            side_effect=lambda container, blob: _result("clean", container=container, blob_name=blob),
        ))
        self.enterContext(patch.object(evidence, "_evidence_lineage", return_value={"component_ref": "COMP-1", "progress_entry_id": None}))
        self.enterContext(patch.object(evidence, "upload_to_quarantine"))
        move = self.enterContext(patch.object(evidence, "move_blob"))
        self.enterContext(patch.object(evidence, "blob_url", return_value="https://example.invalid/blob"))
        self.enterContext(patch.object(evidence, "_record_approved_evidence"))
        self.enterContext(patch.object(evidence, "_record_evidence_file"))

        response = inspect.unwrap(evidence.upload_evidence)(self._request(), kind="commercial", pk=56)

        self.assertEqual(response.status_code, 201)
        self.assertEqual(_json(response)["status"], "approved")
        self.assertEqual(_json(response)["scanResult"], "clean")
        move.assert_called_once_with("quarantine", "approved", move.call_args.args[2])

    def test_timeout_and_scan_failure_never_promote(self):
        for failure in (ScannerTimeout("timeout"), ScannerFailure("provider error"), ScannerUnavailable("offline")):
            with self.subTest(failure=failure.__class__.__name__):
                cursor = MagicMock()
                with patch.object(evidence, "_conn") as connection, patch.object(
                    evidence, "azure_configured", return_value=True
                ), patch.object(evidence, "_ensure_scanner_ready"), patch.object(
                    evidence, "_scan", side_effect=failure
                ), patch.object(
                    evidence, "_evidence_lineage", return_value={"component_ref": "COMP-1", "progress_entry_id": None}
                ), patch.object(evidence, "upload_to_quarantine"), patch.object(evidence, "move_blob") as move:
                    connection.return_value.cursor.return_value.__enter__.return_value = cursor
                    response = inspect.unwrap(evidence.upload_evidence)(self._request(), kind="commercial", pk=56)
                self.assertEqual(response.status_code, 503)
                move.assert_not_called()

    def test_scan_and_storage_errors_do_not_expose_sensitive_exception_content(self):
        secret = "SECRET_SENTINEL learner@example.invalid"
        cursor = MagicMock()
        with patch.object(evidence, "_conn") as connection, patch.object(
            evidence, "azure_configured", return_value=True
        ), patch.object(evidence, "_ensure_scanner_ready"), patch.object(
            evidence, "_scan", side_effect=ScannerFailure(secret)
        ), patch.object(
            evidence, "_evidence_lineage", return_value={"component_ref": "COMP-1", "progress_entry_id": None}
        ), patch.object(evidence, "upload_to_quarantine"), self.assertLogs(
            "learner_api.evidence", level="ERROR"
        ) as captured:
            connection.return_value.cursor.return_value.__enter__.return_value = cursor
            response = inspect.unwrap(evidence.upload_evidence)(self._request(), kind="commercial", pk=56)
        self.assertNotIn(secret, response.content.decode("utf-8"))
        self.assertNotIn(secret, "\n".join(captured.output))

        with patch.object(evidence, "azure_configured", return_value=True), patch.object(
            evidence, "_ensure_scanner_ready"
        ), patch.object(
            evidence, "_evidence_lineage", return_value={"component_ref": "COMP-1", "progress_entry_id": None}
        ), patch.object(
            evidence, "upload_to_quarantine", side_effect=RuntimeError(secret)
        ), self.assertLogs("learner_api.evidence", level="WARNING") as captured:
            response = inspect.unwrap(evidence.upload_evidence)(self._request(), kind="commercial", pk=56)
        self.assertEqual(response.status_code, 502)
        self.assertNotIn(secret, response.content.decode("utf-8"))
        self.assertNotIn(secret, "\n".join(captured.output))

    def test_verified_infected_result_moves_only_to_rejected(self):
        cursor = MagicMock()
        with patch.object(evidence, "_conn") as connection, patch.object(
            evidence, "azure_configured", return_value=True
        ), patch.object(evidence, "_ensure_scanner_ready"), patch.object(
            evidence,
            "_scan",
            side_effect=lambda container, blob: _result("infected", container=container, blob_name=blob),
        ), patch.object(
            evidence, "_evidence_lineage", return_value={"component_ref": "COMP-1", "progress_entry_id": None}
        ), patch.object(evidence, "upload_to_quarantine"), patch.object(evidence, "move_blob") as move, patch.object(
            evidence, "_record_evidence_file"
        ):
            connection.return_value.cursor.return_value.__enter__.return_value = cursor
            response = inspect.unwrap(evidence.upload_evidence)(self._request(), kind="commercial", pk=56)

        self.assertEqual(response.status_code, 201)
        self.assertEqual(_json(response)["status"], "rejected")
        move.assert_called_once_with("quarantine", "rejected", move.call_args.args[2])

    def test_pending_or_rejected_file_never_receives_download_url(self):
        for status in ("pending", "rejected"):
            with self.subTest(status=status), patch.object(evidence, "_conn") as connection, patch.object(
                evidence, "azure_configured", return_value=True
            ), patch.object(evidence, "get_download_sas") as sas:
                cursor = connection.return_value.cursor.return_value.__enter__.return_value
                cursor.fetchone.return_value = ("private/blob", status)
                response = inspect.unwrap(evidence.download_evidence)(
                    RequestFactory().get("/download/"),
                    kind="commercial",
                    pk=56,
                    file_id="file-1",
                )
            self.assertEqual(response.status_code, 409)
            sas.assert_not_called()

    def test_unauthenticated_and_cross_learner_actions_stop_before_dependencies(self):
        upload = patch.object(evidence, "upload_to_quarantine").start()
        connection = patch.object(evidence, "_conn").start()
        delete = patch.object(evidence, "delete_blob").start()
        self.addCleanup(patch.stopall)

        with patch.dict(os.environ, {"LEARNER_API_REQUIRE_AUTH": "1"}):
            anonymous_upload = self._request()
            self.assertEqual(
                evidence.upload_evidence(anonymous_upload, kind="commercial", pk=56).status_code,
                401,
            )

            for request, view, kwargs in (
                (self._request(), evidence.upload_evidence, {}),
                (RequestFactory().get("/download/"), evidence.download_evidence, {"file_id": "file-1"}),
                (RequestFactory().delete("/file-1/"), evidence.delete_evidence, {"file_id": "file-1"}),
            ):
                request.login_account = SimpleNamespace(
                    role="learner", subject_id=99, is_active=True, email="other@example.invalid"
                )
                response = view(request, kind="commercial", pk=56, **kwargs)
                self.assertEqual(response.status_code, 404)

        upload.assert_not_called()
        connection.assert_not_called()
        delete.assert_not_called()


@override_settings(
    AZURE_QUARANTINE_CONTAINER="quarantine",
    AZURE_APPROVED_CONTAINER="approved",
    AZURE_REJECTED_CONTAINER="rejected",
)
class SharedUploadContainmentTests(SimpleTestCase):
    def test_support_attachment_is_rejected_before_storage_when_scanner_unavailable(self):
        prepared = ticket_files.prepare(
            [SimpleUploadedFile("error.log", b"synthetic error")],
            "ticket-1",
        )
        with patch.object(ticket_files.storage, "azure_configured", return_value=True), patch.object(
            ticket_files.storage, "upload_to_quarantine"
        ) as upload, self.assertRaises(ticket_files.AttachmentError) as error:
            ticket_files.save(prepared, [])

        self.assertEqual(error.exception.status, 503)
        self.assertIn("scanning", str(error.exception).lower())
        upload.assert_not_called()

    def test_support_scan_timeout_is_cleaned_and_never_promoted(self):
        prepared = ticket_files.prepare(
            [SimpleUploadedFile("error.log", b"synthetic error")],
            "ticket-1",
        )
        with patch.object(ticket_files.storage, "azure_configured", return_value=True), patch(
            "learner_api.evidence._ensure_scanner_ready"
        ), patch("learner_api.evidence._scan", side_effect=ScannerTimeout("synthetic")), patch.object(
            ticket_files.storage, "upload_to_quarantine"
        ), patch.object(ticket_files.storage, "move_blob") as move, patch.object(
            ticket_files.storage, "delete_blob"
        ) as delete, self.assertRaises(ticket_files.AttachmentError) as error:
            with ticket_files.upload_session() as staged:
                ticket_files.save(prepared, staged)

        self.assertEqual(error.exception.status, 503)
        move.assert_not_called()
        delete.assert_called_once_with("quarantine", prepared[0][0]["blobName"])

    def test_personal_learning_upload_is_rejected_before_store_or_storage(self):
        request = RequestFactory().post(
            "/learner_api/evidence/commercial/pl.7.study.MOD-A/upload/",
            {
                "section_ref": "C1",
                "file": SimpleUploadedFile("report.pdf", b"synthetic evidence", content_type="application/pdf"),
                "scan_result": "clean",
            },
        )
        context = {"id": "pl.7.study.MOD-A", "account_id": 7, "module_id": "MOD-A", "mode": "study"}
        detail = {"components": []}
        with patch("learner_api.personal_learning.ensure_open"), patch.object(
            personal, "component_for", return_value={"componentId": "C1", "moduleId": "MOD-A", "weekId": "W1"}
        ), patch("learner_api.evidence_storage.azure_configured", return_value=True), patch(
            "learner_api.evidence_storage.upload_to_quarantine"
        ) as upload, patch.object(personal.store, "edit") as edit:
            response = personal.evidence_request(
                request,
                context,
                detail,
                "/learner_api/evidence/commercial/pl.7.study.MOD-A/upload/",
                {},
            )

        self.assertEqual(response.status_code, 503)
        self.assertEqual(
            _json(response),
            {"error": "Malware scanning is temporarily unavailable. Upload has not been saved."},
        )
        upload.assert_not_called()
        edit.assert_not_called()

    def test_enrolment_document_upload_is_rejected_before_storage(self):
        upload = SimpleUploadedFile("passport.pdf", b"synthetic", content_type="application/pdf")
        request = SimpleNamespace(login_account=None, user=None)
        with patch.object(learner_uploads, "upload_to_quarantine") as storage_upload:
            item, response = learner_uploads.store(upload, "apprenticeship/41/identity", request)

        self.assertIsNone(item)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(_json(response), {"error": "Malware scanning is temporarily unavailable. Upload has not been saved."})
        storage_upload.assert_not_called()

    def test_advanced_admin_upload_is_rejected_before_storage_or_insert(self):
        profile = SimpleNamespace(aptem_id=123, pk=7)
        upload = SimpleUploadedFile("assignment.pdf", b"synthetic", content_type="application/pdf")
        with patch.object(admin_uploads, "azure_configured", return_value=True), patch.object(
            admin_uploads, "_existing", return_value=None
        ), patch.object(admin_uploads, "upload_to_quarantine") as storage_upload, patch.object(
            admin_uploads.transaction, "atomic"
        ) as atomic, self.assertRaisesRegex(RuntimeError, "scanning is unavailable"):
            admin_uploads.save_record(profile, "2026-07", "12", upload, "Synthetic Admin")

        storage_upload.assert_not_called()
        atomic.assert_not_called()
