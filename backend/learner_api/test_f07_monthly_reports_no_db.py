import json
import uuid
from contextlib import nullcontext
from datetime import datetime, timezone
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import patch

from django.test import RequestFactory, SimpleTestCase

from learner_api import monthly_reports


class ScriptedCursor:
    def __init__(self, *, one=(), all_rows=()):
        self.one = list(one)
        self.all_rows = list(all_rows)
        self.executions = []

    def execute(self, sql, params=None):
        self.executions.append((" ".join(sql.split()), list(params or [])))

    def fetchone(self):
        return self.one.pop(0)

    def fetchall(self):
        return self.all_rows.pop(0)

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False


class Connection:
    def __init__(self, cursor):
        self._cursor = cursor

    def cursor(self):
        return self._cursor


def report_row(*, updated_at=None):
    now = updated_at or datetime(2026, 10, 24, 9, 30, tzinfo=timezone.utc)
    return (
        uuid.UUID("00000000-0000-0000-0000-000000000007"),
        "commercial", "42", "Synthetic Learner", "Programme",
        "2026-09", "September 2026", "submitted",
        [{"title": "Large snapshot excluded from list"}],
        {"totalEvents": 1},
        [{"id": "file-1", "filename": "notes.pdf"}],
        "What I learned", now, now,
        [{"code": "K1"}], "data:image/png;base64,c2ln",
        "Synthetic Learner", now,
    )


def summary_row():
    row = report_row()
    return (
        *row[:8], row[9], row[10], row[11], row[12], row[13], row[14],
        True, row[16], row[17], 1,
    )


class MonthlyReportPaginationTests(SimpleTestCase):
    databases = set()

    def setUp(self):
        self.factory = RequestFactory()

    def test_paginated_list_uses_lean_projection_and_stable_slice(self):
        cursor = ScriptedCursor(one=[(3,)], all_rows=[[summary_row()]])
        request = self.factory.get("/learner_api/monthly-reports/commercial/42/", {
            "page": "2", "pageSize": "1",
        })

        with patch.object(
            monthly_reports, "connections", {"enrolment": Connection(cursor)},
        ), patch.object(
            monthly_reports, "_saved_signature",
            return_value={"signature": "saved", "name": "Learner"},
        ):
            response = unwrap(monthly_reports._list_monthly_reports)(
                request, kind="commercial", pk=42,
            )

        payload = json.loads(response.content)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload["pagination"]["page"], 2)
        self.assertEqual(payload["pagination"]["total"], 3)
        self.assertEqual(payload["reports"][0]["activityCount"], 1)
        self.assertNotIn("activitySnapshot", payload["reports"][0])
        self.assertNotIn("signature", payload["reports"][0])
        page_sql, page_params = cursor.executions[1]
        self.assertIn("order by month_key desc, id desc limit %s offset %s", page_sql.lower())
        self.assertNotIn("activity_snapshot, summary_metrics", page_sql.lower())
        self.assertEqual(page_params[-2:], [1, 1])

    def test_invalid_pagination_is_explicit(self):
        request = self.factory.get("/", {"page": "invalid"})
        response = unwrap(monthly_reports._list_monthly_reports)(
            request, kind="commercial", pk=42,
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("whole numbers", json.loads(response.content)["error"])


class MonthlyReportConcurrencyTests(SimpleTestCase):
    databases = set()
    signature = "data:image/png;base64,c2ln"

    def setUp(self):
        self.factory = RequestFactory()

    def request(self, expected_updated_at):
        request = self.factory.post(
            "/learner_api/monthly-reports/commercial/42/",
            data=json.dumps({
                "monthKey": "2026-09",
                "learnedSummary": "Updated reflection",
                "signature": self.signature,
                "signedName": "Synthetic Learner",
                "expectedUpdatedAt": expected_updated_at,
            }),
            content_type="application/json",
        )
        request.login_account = SimpleNamespace(
            role="learner", display_name="Synthetic Learner", email="learner@example.test",
        )
        return request

    def submit(self, cursor, expected_updated_at):
        with patch.object(
            monthly_reports, "connections", {"enrolment": Connection(cursor)},
        ), patch.object(
            monthly_reports.transaction, "atomic", return_value=nullcontext(),
        ), patch.object(monthly_reports, "_record_monthly_report") as audit:
            response = unwrap(monthly_reports._submit_monthly_report)(
                self.request(expected_updated_at), kind="commercial", pk=42,
            )
        return response, audit

    def test_stale_report_returns_conflict_without_audit_or_replacement(self):
        cursor = ScriptedCursor(one=[None])
        response, audit = self.submit(cursor, "2026-10-24T09:30:00Z")

        self.assertEqual(response.status_code, 409)
        self.assertIn("updated elsewhere", json.loads(response.content)["error"])
        sql, params = cursor.executions[0]
        self.assertIn("where not %s or existing_report.updated_at is not distinct from %s", sql.lower())
        self.assertTrue(params[-2])
        self.assertEqual(params[-1], datetime(2026, 10, 24, 9, 30, tzinfo=timezone.utc))
        audit.assert_not_called()

    def test_matching_report_version_preserves_success_contract(self):
        row = report_row()
        cursor = ScriptedCursor(one=[row])
        response, audit = self.submit(cursor, "2026-10-24T09:30:00Z")

        self.assertEqual(response.status_code, 201)
        payload = json.loads(response.content)
        self.assertEqual(payload["report"]["id"], str(row[0]))
        self.assertEqual(payload["report"]["status"], "submitted")
        audit.assert_called_once_with(row)

    def test_legacy_resubmission_without_token_keeps_its_success_contract(self):
        row = report_row()
        cursor = ScriptedCursor(one=[row])
        request = self.request(None)
        body = json.loads(request.body)
        body.pop("expectedUpdatedAt")
        request = self.factory.post(
            "/learner_api/monthly-reports/commercial/42/",
            data=json.dumps(body),
            content_type="application/json",
        )
        request.login_account = SimpleNamespace(
            role="learner",
            display_name="Synthetic Learner",
            email="learner@example.test",
        )

        with patch.object(
            monthly_reports, "connections", {"enrolment": Connection(cursor)},
        ), patch.object(
            monthly_reports.transaction, "atomic", return_value=nullcontext(),
        ), patch.object(monthly_reports, "_record_monthly_report"):
            response = unwrap(monthly_reports._submit_monthly_report)(
                request, kind="commercial", pk=42,
            )

        self.assertEqual(response.status_code, 201)
        self.assertFalse(cursor.executions[0][1][-2])

