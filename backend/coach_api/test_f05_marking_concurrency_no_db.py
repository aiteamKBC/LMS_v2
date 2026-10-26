import json
import uuid
from contextlib import nullcontext
from datetime import datetime, timezone
from inspect import unwrap
from unittest.mock import MagicMock, patch

from django.test import RequestFactory, SimpleTestCase

from coach_api.views import coach_marking_queue


class CoachMarkingConcurrencyTests(SimpleTestCase):
    databases = set()

    def setUp(self):
        self.factory = RequestFactory()
        self.submission_id = uuid.uuid4()

    @patch("coach_api.views.LearnerProfile.objects.annotate")
    def test_stale_review_token_returns_conflict_without_overwriting(self, annotate):
        annotate.return_value.filter.return_value.values_list.return_value = [101]
        cursor = MagicMock()
        cursor.fetchone.side_effect = [None, (1,)]
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor
        expected = "2026-10-24T10:00:00Z"
        request = self.factory.patch(
            f"/coach_api/coach/marking-queue/{self.submission_id}",
            data=json.dumps({
                "decision": "accepted",
                "feedback": "Reviewed.",
                "reviewedBy": "Coach",
                "expectedReviewedAt": expected,
            }),
            content_type="application/json",
        )
        request.coach_email = "coach@example.test"

        with patch("coach_api.views.connections", {"enrolment": connection}), \
                patch("coach_api.views.transaction.atomic", return_value=nullcontext()), \
                patch("coach_api.views.record_submission_row") as audit:
            response = unwrap(coach_marking_queue)(request, self.submission_id)

        self.assertEqual(response.status_code, 409)
        self.assertEqual(json.loads(response.content)["code"], "marking_conflict")
        update_sql, update_params = cursor.execute.call_args_list[0].args
        self.assertIn("reviewed_at = %s", update_sql)
        self.assertEqual(update_params[-1], datetime(2026, 10, 24, 10, tzinfo=timezone.utc))
        audit.assert_not_called()

    @patch("coach_api.views.LearnerProfile.objects.annotate")
    def test_unowned_submission_still_returns_not_found(self, annotate):
        annotate.return_value.filter.return_value.values_list.return_value = [101]
        cursor = MagicMock()
        cursor.fetchone.side_effect = [None, None]
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor
        request = self.factory.patch(
            f"/coach_api/coach/marking-queue/{self.submission_id}",
            data=json.dumps({"decision": "accepted", "expectedReviewedAt": None}),
            content_type="application/json",
        )
        request.coach_email = "coach@example.test"

        with patch("coach_api.views.connections", {"enrolment": connection}), \
                patch("coach_api.views.transaction.atomic", return_value=nullcontext()):
            response = unwrap(coach_marking_queue)(request, self.submission_id)

        self.assertEqual(response.status_code, 404)
        update_sql = cursor.execute.call_args_list[0].args[0]
        self.assertIn("reviewed_at is null", update_sql)
