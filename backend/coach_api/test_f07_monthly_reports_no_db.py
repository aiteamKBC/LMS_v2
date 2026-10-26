import json
from datetime import datetime, timezone
from inspect import unwrap
from unittest.mock import patch

from django.test import RequestFactory, SimpleTestCase

from coach_api import monthly_reports


class ScriptedCursor:
    def __init__(self):
        now = datetime(2026, 10, 24, tzinfo=timezone.utc)
        self.one = [(3, 2, 4, 1)]
        self.all_rows = [
            [(
                "report-2", "commercial", "42", "Synthetic Learner", "Programme",
                "2026-09", "September 2026", "submitted", {"totalEvents": 2},
                [{"id": "file-1"}], "Reflection", now, now, [{"code": "K1"}],
                True, "Synthetic Learner", now, 2,
            )],
            [("2026-09", "September 2026")],
            [("42", "Synthetic Learner")],
        ]
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


class CoachMonthlyReportPaginationTests(SimpleTestCase):
    databases = set()

    def setUp(self):
        self.factory = RequestFactory()

    def test_list_returns_page_and_whole_filter_summary(self):
        cursor = ScriptedCursor()
        request = self.factory.get("/coach_api/coach/monthly-reports", {
            "page": "2", "pageSize": "1", "search": "Synthetic",
        })

        with patch.object(
            monthly_reports, "connections", {"enrolment": Connection(cursor)},
        ), patch.object(
            monthly_reports, "authenticated_coach_email", return_value="coach@example.test",
        ), patch.object(
            monthly_reports, "_allowed_learner_ids", return_value=["42", "43"],
        ):
            response = unwrap(monthly_reports.coach_monthly_reports)(request)

        payload = json.loads(response.content)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload["pagination"]["page"], 2)
        self.assertEqual(payload["pagination"]["total"], 3)
        self.assertEqual(payload["summary"], {
            "reports": 3, "learners": 2, "attachments": 4, "unsigned": 1,
        })
        self.assertEqual([item["id"] for item in payload["items"]], ["report-2"])
        page_sql, page_params = cursor.executions[1]
        self.assertIn(
            "order by learner_name asc nulls last, month_key desc, id desc limit %s offset %s",
            page_sql.lower(),
        )
        self.assertEqual(page_params[-2:], [1, 1])

    def test_empty_caseload_keeps_paginated_contract(self):
        request = self.factory.get("/coach_api/coach/monthly-reports", {
            "page": "1", "pageSize": "25",
        })
        with patch.object(
            monthly_reports, "authenticated_coach_email", return_value="coach@example.test",
        ), patch.object(monthly_reports, "_allowed_learner_ids", return_value=[]):
            response = unwrap(monthly_reports.coach_monthly_reports)(request)

        payload = json.loads(response.content)
        self.assertEqual(payload["pagination"]["total"], 0)
        self.assertEqual(payload["summary"]["reports"], 0)

