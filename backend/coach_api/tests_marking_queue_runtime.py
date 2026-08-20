"""Production-safety regression tests for the Coach marking queue."""

from __future__ import annotations

import re
import json
import uuid
from unittest.mock import MagicMock, patch

from django.db import DatabaseError, connections
from django.test import Client, TestCase
from django.test.utils import CaptureQueriesContext

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

    def _insert_submission(self, learner_id="101"):
        submission_id = uuid.uuid4()
        with connections["enrolment"].cursor() as cursor:
            cursor.execute(
                """
                insert into "Learner".learning_reflection_submissions (
                    id, learner_kind, learner_id, activity_type, activity_id,
                    learning_reflection
                ) values (%s, 'apprenticeship', %s, 'reflection', %s, %s)
                """,
                [submission_id, learner_id, f"component-{submission_id}", "Test reflection"],
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
    def test_missing_schema_fails_safely_without_repair(self, annotate):
        annotate.return_value.filter.return_value.values_list.return_value = []
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
        self.assertEqual(body, {"detail": "Could not load the marking queue."})
        self.assertNotIn("relation", response.content.decode().lower())
        attempted_sql = [call.args[0] for call in cursor.execute.call_args_list]
        self.assertTrue(attempted_sql)
        self.assertFalse(any(DDL_PATTERN.search(sql) for sql in attempted_sql))
