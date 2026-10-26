"""I2 evidence schema and request-path regressions without a database."""
from contextlib import nullcontext
from datetime import datetime, timezone
import inspect
import io
import json
from pathlib import Path
import re
from unittest.mock import MagicMock, patch
import uuid

from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import CommandError, call_command
from django.db import DatabaseError
from django.test import RequestFactory, SimpleTestCase

from . import evidence, evidence_tables
from .evidence_tables import EvidenceSchemaReport, EvidenceSchemaValidationError


DDL = re.compile(r"\b(create|alter|drop|truncate)\b", re.IGNORECASE)


def _json(response):
    return json.loads(response.content.decode("utf-8"))


def _schema_error(message="private database detail"):
    cause = RuntimeError(message)
    cause.sqlstate = "42P01"
    error = DatabaseError(message)
    error.__cause__ = cause
    return error


def _valid_catalog_rows():
    relations = [("evidence_files", "r"), ("Evidence", "r")]
    columns = []
    for table, required in evidence_tables.REQUIRED_COLUMNS.items():
        for column, (accepted_types, nullable) in required.items():
            columns.append((table, column, sorted(accepted_types)[0], "YES" if nullable else "NO"))
    indexes = []
    for (table, name), required in evidence_tables.REQUIRED_INDEXES.items():
        predicate = required.get("predicate", "")
        if predicate == "component_refisnotnull":
            predicate = "(component_ref IS NOT NULL)"
        elif predicate == "progress_entry_idisnotnull":
            predicate = "(progress_entry_id IS NOT NULL)"
        else:
            predicate = None
        indexes.append(
            (
                table,
                name,
                required["primary"],
                required["unique"],
                True,
                list(required["columns"]),
                predicate,
            )
        )
    return relations, columns, indexes


class EvidenceSchemaValidatorTests(SimpleTestCase):
    def test_catalog_inspection_is_read_only_and_accepts_required_shape(self):
        cursor = MagicMock()
        cursor.fetchall.side_effect = list(_valid_catalog_rows())

        report = evidence_tables.inspect_evidence_schema(cursor)

        self.assertTrue(report.valid, report.issues)
        self.assertEqual(report.relation_count, 2)
        self.assertEqual(report.required_column_count, 22)
        self.assertEqual(report.required_index_count, 9)
        for call in cursor.execute.call_args_list:
            self.assertIsNone(DDL.search(call.args[0]), call.args[0])

    def test_missing_schema_is_reported_without_ddl(self):
        cursor = MagicMock()
        cursor.fetchall.side_effect = [[], [], []]

        report = evidence_tables.inspect_evidence_schema(cursor)

        self.assertFalse(report.valid)
        self.assertIn('missing base table "Learner"."evidence_files"', report.issues)
        self.assertIn('missing base table "Learner"."Evidence"', report.issues)
        for call in cursor.execute.call_args_list:
            self.assertIsNone(DDL.search(call.args[0]), call.args[0])

    def test_explicit_validator_starts_read_only_before_catalog_queries(self):
        cursor = MagicMock()
        cursor.fetchone.return_value = ("on",)
        cursor.fetchall.side_effect = list(_valid_catalog_rows())
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor

        with patch.object(evidence_tables, "connections", {"enrolment": connection}), patch.object(
            evidence_tables.transaction, "atomic", return_value=nullcontext()
        ):
            report = evidence_tables.validate_evidence_schema()

        self.assertTrue(report.valid)
        self.assertEqual(cursor.execute.call_args_list[0].args[0], "SET TRANSACTION READ ONLY")
        self.assertEqual(cursor.execute.call_args_list[1].args[0], "SHOW transaction_read_only")
        for call in cursor.execute.call_args_list:
            self.assertIsNone(DDL.search(call.args[0]), call.args[0])

    def test_management_command_passes_database_alias_and_reports_success(self):
        report = EvidenceSchemaReport((), 2, 22, 9)
        output = io.StringIO()
        with patch(
            "learner_api.management.commands.validate_evidence_schema.validate_evidence_schema",
            return_value=report,
        ) as validate:
            call_command("validate_evidence_schema", database="enrolment", stdout=output)

        validate.assert_called_once_with(using="enrolment")
        self.assertIn("verified read-only", output.getvalue())

    def test_management_command_fails_closed_on_schema_drift(self):
        report = EvidenceSchemaReport(("missing required object",), 0, 22, 9)
        with patch(
            "learner_api.management.commands.validate_evidence_schema.validate_evidence_schema",
            side_effect=EvidenceSchemaValidationError(report),
        ):
            with self.assertRaisesMessage(CommandError, "missing required object"):
                call_command("validate_evidence_schema")


class EvidenceRequestDDLTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()

    def _cursor(self):
        cursor = MagicMock()
        connection = self.enterContext(patch.object(evidence, "_conn"))
        connection.return_value.cursor.return_value.__enter__.return_value = cursor
        return cursor

    def _assert_no_ddl(self, cursor):
        for call in cursor.execute.call_args_list:
            self.assertIsNone(DDL.search(call.args[0]), call.args[0])

    def test_upload_does_not_invoke_ddl_and_preserves_success_contract(self):
        cursor = self._cursor()
        self.enterContext(patch.object(evidence, "azure_configured", return_value=True))
        self.enterContext(patch.object(evidence, "_ensure_scanner_ready"))
        self.enterContext(patch.object(evidence, "_scan"))
        self.enterContext(patch.object(evidence, "_verified_scan_verdict", return_value="clean"))
        upload = self.enterContext(patch.object(evidence, "upload_to_quarantine"))
        move = self.enterContext(patch.object(evidence, "move_blob"))
        self.enterContext(patch.object(evidence, "blob_url", return_value="https://files.test/blob"))
        self.enterContext(patch.object(evidence, "_record_approved_evidence"))
        self.enterContext(patch.object(evidence, "_record_evidence_file"))
        self.enterContext(
            patch.object(
                evidence,
                "_evidence_lineage",
                return_value={"component_ref": "COMP-1", "progress_entry_id": 9},
            )
        )
        uploaded = SimpleUploadedFile("report.pdf", b"evidence", content_type="application/pdf")
        request = self.factory.post("/upload/", {"section_ref": "COMP-1", "file": uploaded})

        response = inspect.unwrap(evidence.upload_evidence)(request, kind="commercial", pk=56)

        self.assertEqual(response.status_code, 201)
        self.assertEqual(
            set(_json(response)),
            {"id", "status", "scanResult", "filename", "sectionRef"},
        )
        upload.assert_called_once()
        move.assert_called_once()
        self._assert_no_ddl(cursor)

    def test_list_does_not_invoke_ddl_and_preserves_success_contract(self):
        cursor = self._cursor()
        cursor.fetchall.return_value = [
            (
                uuid.uuid4(), "report.pdf", "application/pdf", 8, "approved", "clean",
                "COMP-1", datetime(2026, 10, 22, tzinfo=timezone.utc), {"title": "Task"},
                "COMP-1", 9,
            )
        ]
        self.enterContext(
            patch.object(evidence, "_marking_statuses", return_value={"COMP-1": "accepted"})
        )
        request = self.factory.get("/evidence/")

        response = inspect.unwrap(evidence.list_evidence)(request, kind="commercial", pk=56)

        self.assertEqual(response.status_code, 200)
        item = _json(response)["results"][0]
        self.assertEqual(
            set(item),
            {
                "id", "filename", "contentType", "sizeBytes", "status", "scanResult",
                "sectionRef", "uploadedAt", "trainingPlanDetails", "componentRef",
                "progressEntryId", "canDelete", "markingStatus",
            },
        )
        self.assertFalse(item["canDelete"])
        self.assertEqual(item["markingStatus"], "accepted")
        self.assertIn("learner_kind = %s", cursor.execute.call_args.args[0])
        self.assertEqual(cursor.execute.call_args.args[1], ["commercial", "56"])
        self._assert_no_ddl(cursor)

    def test_download_does_not_invoke_ddl_and_preserves_success_contract(self):
        cursor = self._cursor()
        cursor.fetchone.return_value = ("commercial/56/file.pdf", "approved")
        self.enterContext(patch.object(evidence, "azure_configured", return_value=True))
        sas = self.enterContext(
            patch.object(evidence, "get_download_sas", return_value="https://files.test/read-token")
        )
        request = self.factory.get("/download/")
        file_id = uuid.uuid4()

        response = inspect.unwrap(evidence.download_evidence)(
            request, kind="commercial", pk=56, file_id=file_id
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(_json(response), {"url": "https://files.test/read-token"})
        self.assertEqual(cursor.execute.call_args.args[1], [str(file_id), "commercial", "56"])
        sas.assert_called_once()
        self._assert_no_ddl(cursor)

    def test_delete_does_not_invoke_ddl_and_preserves_success_contract(self):
        cursor = self._cursor()
        cursor.fetchone.side_effect = [
            ("commercial/56/file.pdf", "approved", "COMP-1", None),
            tuple(range(len(evidence.EVIDENCE_AUDIT_COLUMNS))),
        ]
        self.enterContext(patch.object(evidence, "_is_submitted_for_marking", return_value=False))
        self.enterContext(patch.object(evidence, "azure_configured", return_value=True))
        delete_blob = self.enterContext(patch.object(evidence, "delete_blob"))
        self.enterContext(patch.object(evidence, "_record_evidence_file"))
        request = self.factory.delete("/evidence/")
        file_id = uuid.uuid4()

        response = inspect.unwrap(evidence.delete_evidence)(
            request, kind="commercial", pk=56, file_id=file_id
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(_json(response), {"id": str(file_id), "deleted": True})
        delete_blob.assert_called_once_with("approved", "commercial/56/file.pdf")
        self._assert_no_ddl(cursor)

    def test_all_request_paths_map_missing_schema_to_safe_503(self):
        cases = []

        list_cursor = self._cursor()
        list_cursor.execute.side_effect = _schema_error()
        cases.append(
            inspect.unwrap(evidence.list_evidence)(
                self.factory.get("/evidence/"), kind="commercial", pk=56
            )
        )

        download_cursor = self._cursor()
        download_cursor.execute.side_effect = _schema_error()
        self.enterContext(patch.object(evidence, "azure_configured", return_value=True))
        cases.append(
            inspect.unwrap(evidence.download_evidence)(
                self.factory.get("/download/"),
                kind="commercial",
                pk=56,
                file_id=uuid.uuid4(),
            )
        )

        delete_cursor = self._cursor()
        delete_cursor.execute.side_effect = _schema_error()
        cases.append(
            inspect.unwrap(evidence.delete_evidence)(
                self.factory.delete("/evidence/"),
                kind="commercial",
                pk=56,
                file_id=uuid.uuid4(),
            )
        )

        upload_cursor = self._cursor()
        upload_cursor.execute.side_effect = _schema_error()
        self.enterContext(patch.object(evidence, "_ensure_scanner_ready"))
        self.enterContext(patch.object(evidence, "_scan"))
        self.enterContext(patch.object(evidence, "_verified_scan_verdict", return_value="clean"))
        self.enterContext(
            patch.object(
                evidence,
                "_evidence_lineage",
                return_value={"component_ref": "COMP-1", "progress_entry_id": None},
            )
        )
        self.enterContext(patch.object(evidence, "upload_to_quarantine"))
        move = self.enterContext(patch.object(evidence, "move_blob"))
        uploaded = SimpleUploadedFile("report.pdf", b"evidence", content_type="application/pdf")
        cases.append(
            inspect.unwrap(evidence.upload_evidence)(
                self.factory.post("/upload/", {"section_ref": "COMP-1", "file": uploaded}),
                kind="commercial",
                pk=56,
            )
        )

        for response in cases:
            self.assertEqual(response.status_code, 503)
            self.assertEqual(_json(response), {"error": "Evidence service is temporarily unavailable."})
            self.assertNotIn("private database detail", response.content.decode("utf-8"))
        move.assert_not_called()
        for cursor in (list_cursor, download_cursor, delete_cursor, upload_cursor):
            self._assert_no_ddl(cursor)

    def test_authorization_decorators_and_scoped_queries_remain_declared(self):
        source = Path(evidence.__file__).read_text(encoding="utf-8")
        self.assertRegex(
            source,
            r"@learner_self_or_admin\(kwarg=\"pk\"\)\s+def upload_evidence",
        )
        self.assertRegex(
            source,
            r"@learner_self_or_staff\(kwarg=\"pk\"\)\s+def list_evidence",
        )
        self.assertRegex(
            source,
            r"@learner_self_or_staff\(kwarg=\"pk\"\)\s+def download_evidence",
        )
        self.assertRegex(
            source,
            r"@learner_self_or_admin\(kwarg=\"pk\"\)\s+def delete_evidence",
        )
        self.assertNotIn("ensure_evidence_tables", source)

