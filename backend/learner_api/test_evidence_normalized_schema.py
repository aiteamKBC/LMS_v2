import inspect
import json
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from django.db import ProgrammingError
from django.test import RequestFactory, SimpleTestCase

from . import evidence, evidence_tables


class EvidenceSchemaGuardTests(SimpleTestCase):
    def setUp(self):
        evidence_tables._READY = False
        evidence_tables._WRITE_READY = False

    def tearDown(self):
        evidence_tables._READY = False
        evidence_tables._WRITE_READY = False

    def test_schema_guard_is_read_only(self):
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchall.return_value = [(column,) for column in evidence_tables.REQUIRED_COLUMNS]

        with patch.object(evidence_tables, "connections", {"enrolment": connection}):
            evidence_tables.ensure_evidence_tables()
            evidence_tables.ensure_evidence_tables()

        cursor.execute.assert_called_once()
        sql = cursor.execute.call_args.args[0].strip().lower()
        self.assertTrue(sql.startswith("select "))
        for write_keyword in ("create ", "alter ", "drop ", "insert ", "update ", "delete "):
            self.assertNotIn(write_keyword, sql)

    def test_incompatible_schema_fails_visibly(self):
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchall.return_value = [
            (column,) for column in evidence_tables.REQUIRED_COLUMNS
            if column != "learner_profile_id"
        ]

        with patch.object(evidence_tables, "connections", {"enrolment": connection}):
            with self.assertRaisesMessage(ProgrammingError, "learner_profile_id"):
                evidence_tables.ensure_evidence_tables()


class NormalizedEvidenceReaderTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()

    def _list(self, *, kind, enrolment_id, profile_id, rows, section_ref="COMP-1"):
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchall.side_effect = [[(profile_id,)], rows]
        request = self.factory.get("/", {"section_ref": section_ref})
        with patch.object(evidence, "_conn", return_value=connection), \
             patch.object(evidence, "ensure_evidence_tables"), \
             patch.object(
                 evidence, "ensure_evidence_write_tables",
                 side_effect=AssertionError("GET must not provision schema"),
             ), \
             patch.object(evidence, "_evidence_submissions", return_value=[]), \
             patch.object(evidence, "_marking_status", return_value=""):
            response = inspect.unwrap(evidence.list_evidence)(
                request, kind=kind, pk=enrolment_id,
            )
        return response, cursor

    def test_commercial_reader_uses_profile_id_when_it_differs_from_enrolment_id(self):
        row = (
            "b4d71a32-2678-45a4-a50b-e7504d8b9379", "report.pdf", "application/pdf",
            1234, "approved", "clean", "COMP-1", datetime(2026, 11, 1, tzinfo=timezone.utc),
            {"componentTitle": "Report"}, "COMP-1", 91,
        )

        response, cursor = self._list(
            kind="commercial", enrolment_id=285, profile_id=407, rows=[row],
        )

        self.assertEqual(response.status_code, 200)
        result = json.loads(response.content)["results"]
        self.assertEqual(result[0]["filename"], "report.pdf")
        evidence_sql, evidence_params = cursor.execute.call_args_list[1].args
        self.assertIn("learner_profile_id = %s", evidence_sql)
        self.assertNotIn("learner_id = %s", evidence_sql)
        self.assertEqual(evidence_params, ["commercial", 407, "COMP-1"])

    def test_apprenticeship_reader_preserves_an_empty_result(self):
        response, cursor = self._list(
            kind="apprenticeship", enrolment_id=676, profile_id=975, rows=[],
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content), {"results": []})
        _, evidence_params = cursor.execute.call_args_list[1].args
        self.assertEqual(evidence_params, ["apprenticeship", 975, "COMP-1"])

    def test_download_cannot_resolve_another_profiles_file(self):
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchall.return_value = [(975,)]
        cursor.fetchone.return_value = None
        request = self.factory.get("/")

        with patch.object(evidence, "_conn", return_value=connection), \
             patch.object(evidence, "ensure_evidence_tables"), \
             patch.object(
                 evidence, "ensure_evidence_write_tables",
                 side_effect=AssertionError("GET must not provision schema"),
             ), \
             patch.object(evidence, "azure_configured", return_value=True), \
             patch.object(evidence, "get_download_sas") as get_download_sas:
            response = inspect.unwrap(evidence.download_evidence)(
                request,
                kind="apprenticeship",
                pk=676,
                file_id="b4d71a32-2678-45a4-a50b-e7504d8b9379",
            )

        self.assertEqual(response.status_code, 404)
        lookup_sql, lookup_params = cursor.execute.call_args_list[1].args
        self.assertIn("learner_kind = %s and learner_profile_id = %s", lookup_sql)
        self.assertEqual(lookup_params[-2:], ["apprenticeship", 975])
        get_download_sas.assert_not_called()
