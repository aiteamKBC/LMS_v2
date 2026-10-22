"""I5 Evidence read-path query bounds and compatibility, without database writes."""
from datetime import datetime, timezone
import inspect
import json
from unittest.mock import MagicMock, patch
import uuid

from django.db import DatabaseError
from django.test import RequestFactory, SimpleTestCase

from . import evidence
from . import historical_evidence as history


def _context(cursor):
    manager = MagicMock()
    manager.__enter__.return_value = cursor
    manager.__exit__.return_value = False
    return manager


def _row(section_ref, *, filename="evidence.pdf"):
    return (
        uuid.uuid4(), filename, "application/pdf", 12, "approved", "clean",
        section_ref, datetime(2026, 10, 22, tzinfo=timezone.utc),
        {"title": "Task"}, section_ref, 91,
    )


class CurrentEvidenceReadOptimizationTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()

    def _call(self, rows, *, profiles=(), statuses=(), kind="commercial", query=None):
        list_cursor = MagicMock()
        list_cursor.fetchall.return_value = rows
        marking_cursor = MagicMock()
        marking_cursor.fetchall.side_effect = [
            [(profile,) for profile in profiles], list(statuses)
        ]
        connection = MagicMock()
        connection.cursor.side_effect = [_context(list_cursor), _context(marking_cursor)]
        with patch.object(evidence, "_conn", return_value=connection):
            response = inspect.unwrap(evidence.list_evidence)(
                self.factory.get("/evidence/", data=query or {}), kind=kind, pk=101
            )
        return response, connection, list_cursor, marking_cursor

    def test_query_count_is_constant_for_one_or_many_sections(self):
        for rows in ([_row("A")], [_row("A"), _row("B"), _row("C"), _row("A")]):
            with self.subTest(row_count=len(rows)):
                response, connection, list_cursor, marking_cursor = self._call(
                    rows,
                    statuses=[("A", "accepted"), ("B", "submitted_for_tutor_review")],
                )
                self.assertEqual(response.status_code, 200)
                self.assertEqual(connection.cursor.call_count, 2)
                self.assertEqual(list_cursor.execute.call_count + marking_cursor.execute.call_count, 3)

    def test_empty_result_uses_only_the_evidence_query(self):
        list_cursor = MagicMock()
        list_cursor.fetchall.return_value = []
        connection = MagicMock()
        connection.cursor.return_value = _context(list_cursor)
        with patch.object(evidence, "_conn", return_value=connection):
            response = inspect.unwrap(evidence.list_evidence)(
                self.factory.get("/evidence/"), kind="apprenticeship", pk=101
            )
        self.assertEqual(json.loads(response.content), {"results": []})
        self.assertEqual(connection.cursor.call_count, 1)
        self.assertEqual(list_cursor.execute.call_count, 1)

    def test_response_fields_marking_precedence_and_order_are_compatible(self):
        rows = [_row("A", filename="new.pdf"), _row("B", filename="old.pdf")]
        response, _, _, marking_cursor = self._call(
            rows, statuses=[("A", "accepted"), ("B", "submitted_for_tutor_review")]
        )
        payload = json.loads(response.content)
        self.assertEqual([item["filename"] for item in payload["results"]], ["new.pdf", "old.pdf"])
        self.assertEqual([item["markingStatus"] for item in payload["results"]],
                         ["accepted", "submitted_for_tutor_review"])
        self.assertEqual([item["canDelete"] for item in payload["results"]], [False, False])
        self.assertEqual(
            set(payload["results"][0]),
            {"id", "filename", "contentType", "sizeBytes", "status", "scanResult",
             "sectionRef", "uploadedAt", "trainingPlanDetails", "componentRef",
             "progressEntryId", "canDelete", "markingStatus"},
        )
        sql = marking_cursor.execute.call_args_list[-1].args[0]
        self.assertIn("distinct on (activity_id)", sql.lower())
        self.assertLess(sql.index("'accepted'"), sql.index("'submitted_for_tutor_review'"))

    def test_apprenticeship_kind_and_existing_filters_reach_both_queries(self):
        _, _, list_cursor, marking_cursor = self._call(
            [_row("A")],
            kind="apprenticeship",
            query={"section_ref": "A", "status": "approved"},
        )
        self.assertEqual(
            list_cursor.execute.call_args.args[1],
            ["apprenticeship", "101", "A", "approved"],
        )
        self.assertEqual(
            marking_cursor.execute.call_args_list[-1].args[1][1],
            "apprenticeship",
        )

    def test_missing_section_is_editable_without_a_marking_lookup(self):
        response, _, _, marking_cursor = self._call([_row(None)])
        item = json.loads(response.content)["results"][0]
        self.assertTrue(item["canDelete"])
        self.assertEqual(item["markingStatus"], "")
        marking_cursor.execute.assert_not_called()

    def test_database_failure_is_fail_closed_for_every_section(self):
        connection = MagicMock()
        connection.cursor.side_effect = DatabaseError("offline")
        with patch.object(evidence, "_conn", return_value=connection):
            statuses = evidence._marking_statuses("commercial", 101, ["A", "B"])
        self.assertEqual(statuses, {"A": evidence.MARKING_STATUS_UNKNOWN,
                                    "B": evidence.MARKING_STATUS_UNKNOWN})

    def test_identity_bridge_is_typed_and_rejects_numeric_namespace_collisions(self):
        cursor = MagicMock()
        cursor.fetchall.return_value = []
        self.assertEqual(evidence._marking_learner_ids(cursor, "101"), ["101"])
        sql, params = cursor.execute.call_args.args
        self.assertIn("l.enrolment_id = %s", sql)
        self.assertNotIn("l.enrolment_id::text", sql)
        self.assertIn("other.id <> %s", sql)
        self.assertEqual(params, [101, 101])

    def test_unambiguous_legacy_profile_and_malformed_identity_are_safe(self):
        cursor = MagicMock()
        cursor.fetchall.return_value = [(248,)]
        self.assertEqual(evidence._marking_learner_ids(cursor, "101"), ["101", "248"])
        malformed = MagicMock()
        self.assertEqual(evidence._marking_learner_ids(malformed, "not-a-number"),
                         ["not-a-number"])
        malformed.execute.assert_not_called()


class HistoricalEvidenceReadOptimizationTests(SimpleTestCase):
    def test_summary_query_deduplicates_before_selecting_one_document(self):
        cursor = MagicMock()
        cursor.description = []
        cursor.fetchall.return_value = []
        tables = {history.MANUAL_ROWS, history.MANUAL_DOCS,
                  history.EVIDENCE_ITEMS, history.ARCHIVES}
        history.manual_documents(cursor, 42, tables, summary_only=True)
        sql = cursor.execute.call_args.args[0]
        self.assertIn("DISTINCT ON (r.id)", sql)
        self.assertIn("o.source_activity_id=r.id", sql)
        self.assertIn("o.azure_container=d.container", sql)
        self.assertLess(sql.index("NOT EXISTS"), sql.index("ORDER BY r.id,d.id"))

    def test_detail_query_keeps_all_documents(self):
        cursor = MagicMock()
        cursor.description = []
        cursor.fetchall.return_value = []
        history.manual_documents(cursor, 42, {history.MANUAL_ROWS, history.MANUAL_DOCS}, 19)
        sql = cursor.execute.call_args.args[0]
        self.assertNotIn("DISTINCT ON", sql)
        self.assertIn("ORDER BY r.activity_date DESC NULLS LAST,r.id,d.id", sql)

    def test_list_merges_sources_with_stable_precedence_without_azure(self):
        source_item = {"id": "aptem:1", "date": "2026-01-03"}
        manual_item = {"id": "audit:2", "date": "2026-01-02"}
        upload_item = {"id": "uploaded:3", "date": "2026-01-01"}
        cursor = MagicMock()
        connection = MagicMock()
        connection.cursor.return_value = _context(cursor)
        request = RequestFactory().get("/historical/")
        with patch.object(history, "connections", {"enrolment": connection}), \
             patch.object(history, "resolve_aptem", return_value=42), \
             patch.object(history, "available_tables", return_value=set()), \
             patch.object(history, "source_rows", return_value=[{"source": 1}]), \
             patch.object(history, "project_source", return_value=[source_item]), \
             patch.object(history, "uploaded_rows", return_value=[{"upload": 1}]), \
             patch.object(history, "project_uploaded", return_value=[upload_item]), \
             patch.object(history, "manual_documents", return_value=[{"manual": 1}]) as manual, \
             patch.object(history, "project_manual", return_value=[manual_item]), \
             patch.object(history.evidence_storage, "get_read_sas") as azure:
            result = inspect.unwrap(history.list_historical_evidence)(
                request, kind="apprenticeship", pk=7
            )
        self.assertEqual(result, {"items": [source_item, manual_item, upload_item], "total": 3})
        self.assertTrue(manual.call_args.kwargs["summary_only"])
        azure.assert_not_called()
