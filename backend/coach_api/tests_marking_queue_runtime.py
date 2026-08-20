"""Production-safety regression tests for the Coach marking queue."""

from __future__ import annotations

import re
import json
import uuid
from datetime import timedelta
from unittest.mock import MagicMock, patch

from django.db import DatabaseError, connections
from django.test import Client, TestCase
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from learner_api.models import StaffUser
from login.identity import ensure_account
from login.models import LoginAccount, LoginSession
from login.sessions import COOKIE_NAME, issue_session


DDL_PATTERN = re.compile(
    r"\b(?:create\s+(?:schema|table|index)|alter\s+table|drop\s+(?:schema|table|index))\b",
    re.IGNORECASE,
)


class CoachMarkingQueueRuntimeTests(TestCase):
    databases = {"default", "enrolment"}

    def setUp(self):
        self.client = Client(SERVER_NAME="localhost")
        email = f"marking-{uuid.uuid4().hex[:10]}@kbc.invalid"
        self.staff = StaffUser.objects.create(
            username=email.split("@", 1)[0],
            email=email,
            position="Caseowner",
            access="coach",
            type="Admin",
            status="FullUser",
        )
        self.account, _ = ensure_account("staff", self.staff.id, subject=self.staff)
        token, _session, _ttl = issue_session(self.account)
        self.client.cookies[COOKIE_NAME] = token

    def _insert_submission(
        self,
        learner_id="101",
        *,
        status="submitted_for_tutor_review",
        submitted_at=None,
        learner_name="Test Learner",
        submission_id=None,
    ):
        submission_id = submission_id or uuid.uuid4()
        submitted_at = submitted_at or timezone.now()
        with connections["enrolment"].cursor() as cursor:
            cursor.execute(
                """
                insert into "Learner".learning_reflection_submissions (
                    id, learner_kind, learner_id, learner_name, activity_type,
                    activity_id, learning_reflection, status, submitted_at
                ) values (%s, 'apprenticeship', %s, %s, 'reflection', %s, %s, %s, %s)
                """,
                [
                    submission_id,
                    learner_id,
                    learner_name,
                    f"component-{submission_id}",
                    "Test reflection",
                    status,
                    submitted_at,
                ],
            )
        return submission_id

    def tearDown(self):
        LoginSession.objects.filter(account_id=self.account.id).delete()
        LoginAccount.objects.filter(id=self.account.id).delete()
        StaffUser.objects.filter(id=self.staff.id).delete()
        super().tearDown()

    @patch("coach_api.views.LearnerProfile.objects.annotate")
    def test_get_executes_no_schema_ddl(self, annotate):
        submission_id = self._insert_submission()
        annotate.return_value.filter.return_value.values_list.return_value = [101]

        with CaptureQueriesContext(connections["enrolment"]) as captured:
            response = self.client.get("/coach_api/coach/marking-queue")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            [item["id"] for item in response.json()["items"]],
            [str(submission_id)],
        )
        ddl = [query["sql"] for query in captured.captured_queries if DDL_PATTERN.search(query["sql"])]
        self.assertEqual(ddl, [], f"Coach GET executed schema-changing SQL: {ddl}")

    @patch("coach_api.views.LearnerProfile.objects.annotate")
    def test_patch_executes_dml_only(self, annotate):
        submission_id = self._insert_submission()
        annotate.return_value.filter.return_value.values_list.return_value = [101]

        with CaptureQueriesContext(connections["enrolment"]) as captured:
            response = self.client.patch(
                f"/coach_api/coach/marking-queue/{submission_id}",
                data=json.dumps({"decision": "accepted"}),
                content_type="application/json",
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "accepted")
        sql = [query["sql"] for query in captured.captured_queries]
        self.assertTrue(any("update" in statement.lower() for statement in sql))
        self.assertFalse(any(DDL_PATTERN.search(statement) for statement in sql))

    @patch("coach_api.views.LearnerProfile.objects.annotate")
    def test_ownership_filter_is_applied_in_sql(self, annotate):
        owned_id = self._insert_submission("101")
        self._insert_submission("999")
        annotate.return_value.filter.return_value.values_list.return_value = [101]

        with CaptureQueriesContext(connections["enrolment"]) as captured:
            response = self.client.get("/coach_api/coach/marking-queue")

        self.assertEqual(response.status_code, 200)
        self.assertEqual([item["id"] for item in response.json()["items"]], [str(owned_id)])
        queue_sql = [
            query["sql"].lower()
            for query in captured.captured_queries
            if "learning_reflection_submissions" in query["sql"]
        ]
        self.assertTrue(queue_sql)
        self.assertTrue(all("learner_id = any" in statement for statement in queue_sql))

    @patch("coach_api.views.LearnerProfile.objects.annotate")
    def test_pagination_is_deterministic_and_page_size_is_bounded(self, annotate):
        submitted_at = timezone.now() - timedelta(days=1)
        ids = [
            uuid.UUID("00000000-0000-0000-0000-000000000003"),
            uuid.UUID("00000000-0000-0000-0000-000000000001"),
            uuid.UUID("00000000-0000-0000-0000-000000000002"),
        ]
        for submission_id in ids:
            self._insert_submission("101", submitted_at=submitted_at, submission_id=submission_id)
        annotate.return_value.filter.return_value.values_list.return_value = [101]

        first = self.client.get("/coach_api/coach/marking-queue?page=1&page_size=1")
        second = self.client.get("/coach_api/coach/marking-queue?page=2&page_size=1")
        bounded = self.client.get("/coach_api/coach/marking-queue?page_size=1000000")

        self.assertEqual(first.json()["items"][0]["id"], str(sorted(ids)[0]))
        self.assertEqual(second.json()["items"][0]["id"], str(sorted(ids)[1]))
        self.assertEqual(first.json()["pagination"]["totalPages"], 3)
        self.assertEqual(bounded.json()["pagination"]["pageSize"], 100)

    @patch("coach_api.views.LearnerProfile.objects.annotate")
    def test_status_date_filters_and_summary_are_database_aggregated(self, annotate):
        now = timezone.now()
        pending_id = self._insert_submission("101", submitted_at=now - timedelta(days=10))
        self._insert_submission("101", status="accepted", submitted_at=now - timedelta(days=2))
        self._insert_submission("102", status="referred", submitted_at=now - timedelta(days=1))
        self._insert_submission("999", status="accepted", submitted_at=now)
        annotate.return_value.filter.return_value.values_list.return_value = [101, 102]

        response = self.client.get(
            "/coach_api/coach/marking-queue",
            {
                "status": "pending",
                "date_from": (now - timedelta(days=20)).date().isoformat(),
                "date_to": now.date().isoformat(),
            },
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual([item["id"] for item in body["items"]], [str(pending_id)])
        self.assertEqual(body["summary"]["totalItems"], 3)
        self.assertEqual(body["summary"]["activeLearners"], 2)
        self.assertEqual(body["summary"]["pendingItems"], 1)
        self.assertEqual(body["summary"]["acceptedItems"], 1)
        self.assertEqual(body["summary"]["referredItems"], 1)
        self.assertEqual(body["summary"]["overdueItems"], 1)

    @patch("coach_api.views.LearnerProfile.objects.annotate")
    def test_empty_caseload_does_not_query_reflection_table(self, annotate):
        annotate.return_value.filter.return_value.values_list.return_value = []

        with CaptureQueriesContext(connections["enrolment"]) as captured:
            response = self.client.get("/coach_api/coach/marking-queue")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["items"], [])
        reflection_queries = [
            query["sql"] for query in captured.captured_queries
            if "learning_reflection_submissions" in query["sql"]
        ]
        self.assertEqual(reflection_queries, [])

    @patch("coach_api.views.LearnerProfile.objects.annotate")
    def test_owned_submission_can_be_loaded_directly(self, annotate):
        submission_id = self._insert_submission("101")
        annotate.return_value.filter.return_value.values_list.return_value = [101]

        response = self.client.get(f"/coach_api/coach/marking-queue/{submission_id}")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["item"]["id"], str(submission_id))

    @patch("coach_api.views.LearnerProfile.objects.annotate")
    def test_missing_schema_fails_safely_without_repair(self, annotate):
        annotate.return_value.filter.return_value.values_list.return_value = [101]
        cursor = MagicMock()
        cursor.execute.side_effect = DatabaseError(
            'relation "Learner.learning_reflection_submissions" does not exist'
        )
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor

        with patch("coach_api.views.connections", {"enrolment": connection}):
            with self.assertLogs("coach_api.views", level="ERROR"):
                response = self.client.get("/coach_api/coach/marking-queue")

        self.assertEqual(response.status_code, 502)
        body = response.json()
        self.assertEqual(body["error"], "marking_queue_unavailable")
        self.assertEqual(body["message"], "Could not load the marking queue.")
        self.assertTrue(body["request_id"])
        self.assertNotIn("relation", response.content.decode().lower())
        attempted_sql = [call.args[0] for call in cursor.execute.call_args_list]
        self.assertTrue(attempted_sql)
        self.assertFalse(any(DDL_PATTERN.search(sql) for sql in attempted_sql))
