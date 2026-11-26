import json
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import patch

from django.test import RequestFactory, SimpleTestCase

from .calendar import (
    _learner_visible_review_definition,
    learner_calendar_event_artifact_content,
    learner_calendar_event_artifacts,
)


def review_definition(status):
    return {
        "instance": {"status": status},
        "template": {"reviewTypeCode": "mcm"},
        "sections": [{"fields": [{
            "id": "REVF-SUMMARY",
            "configuration": {"semanticKey": "meeting_summary"},
            "answer": "Formal coach-approved summary",
            "answeredBy": "coach@example.test",
            "answeredAt": "2026-09-20T10:00:00",
        }]}],
    }


class LearnerMcmSummaryVisibilityTests(SimpleTestCase):
    def test_formal_summary_is_hidden_before_send_for_signatures(self):
        definition = _learner_visible_review_definition(review_definition("in-progress"))
        field = definition["sections"][0]["fields"][0]
        self.assertIsNone(field["answer"])
        self.assertIsNone(field["answeredBy"])
        self.assertIsNone(field["answeredAt"])

    def test_formal_summary_is_visible_during_signature_stage_and_after_completion(self):
        for status in ("awaiting-signature", "completed"):
            with self.subTest(status=status):
                definition = _learner_visible_review_definition(review_definition(status))
                self.assertEqual(
                    definition["sections"][0]["fields"][0]["answer"],
                    "Formal coach-approved summary",
                )

    def test_artifact_response_filters_transcripts_and_never_returns_ai_draft(self):
        request = RequestFactory().get("/learner/artifacts")
        record = SimpleNamespace(event_type="mcr")
        snapshot = {
            "artifacts": [
                {"artifact_type": "recording", "id": "recording-1"},
                {"artifact_type": "transcript", "id": "transcript-1"},
            ],
            "attendanceReports": [], "attendanceTracker": {},
            "attendance": {"records": []}, "errors": [], "partial": False,
        }
        with patch("learner_api.calendar._learner_calendar_record", return_value=record), patch(
            "coach_api.views.fetch_coach_meeting_graph_snapshot", return_value=(snapshot, None, 200),
        ), patch("coach_api.views.apply_teams_attendance_status_transition"), patch(
            "coach_api.views.persist_coach_meeting_snapshots", return_value={"stored": True},
        ):
            response = unwrap(learner_calendar_event_artifacts)(request, "commercial", 1, "event")
        payload = json.loads(response.content)
        self.assertIsNone(payload["meetingSummary"])
        self.assertEqual([row["artifact_type"] for row in payload["artifacts"]], ["recording"])

    def test_transcript_content_is_denied_server_side(self):
        request = RequestFactory().get("/learner/transcript")
        with patch("learner_api.calendar._learner_calendar_record", return_value=SimpleNamespace()):
            response = unwrap(learner_calendar_event_artifact_content)(
                request, "commercial", 1, "event", "transcript", "transcript-1",
            )
        self.assertEqual(response.status_code, 403)
