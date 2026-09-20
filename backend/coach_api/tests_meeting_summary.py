import hashlib
import json
from contextlib import nullcontext
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import RequestFactory, SimpleTestCase, override_settings

from coach_api.models import CoachCalendarEvent
from coach_api.views import (
    coach_review_instance_meeting_summary,
    coach_timetable_event_artifacts,
    ensure_coach_meeting_summary,
    openai_meeting_summary,
    should_reuse_coach_meeting_summary,
)


class CoachMeetingSummaryGenerationTests(SimpleTestCase):
    def setUp(self):
        self.record = CoachCalendarEvent(
            event_key="mcr:42:1:2026-09-19",
            owner_email="coach@example.test",
            owner_name="Test Coach",
            learner_id=42,
            learner_name="Test Learner",
            event_type="mcr",
        )

    @override_settings(OPENAI_API_KEY="test-key")
    def test_openai_summary_normalizes_with_the_calendar_event_type(self):
        payload = {
            "title": "Monthly Coaching Recap",
            "overview": "The learner and coach reviewed progress.",
            "keyPoints": [],
            "actions": [],
            "nextSteps": [],
            "support": [],
        }
        response = SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps(payload)))]
        )

        with patch("openai.OpenAI") as openai_client, patch(
            "coach_api.views.normalize_meeting_summary_payload",
            return_value=payload,
        ) as normalize:
            openai_client.return_value.chat.completions.create.return_value = response
            for event_type in ("mcr", "progress-review", "review"):
                with self.subTest(event_type=event_type):
                    self.record.event_type = event_type
                    summary, _model = openai_meeting_summary(
                        self.record,
                        "A useful transcript.",
                    )
                    self.assertEqual(summary["overview"], payload["overview"])
                    normalize.assert_called_once_with(payload, event_type)
                    normalize.reset_mock()

    @override_settings(OPENAI_API_KEY="test-key")
    def test_openai_summary_rejects_an_empty_overview(self):
        payload = {
            "title": "Monthly Coaching Recap",
            "overview": "",
            "keyPoints": ["Progress was discussed."],
            "actions": [],
            "nextSteps": [],
            "support": [],
        }
        response = SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps(payload)))]
        )

        with patch("openai.OpenAI") as openai_client:
            openai_client.return_value.chat.completions.create.return_value = response
            with self.assertRaisesMessage(
                RuntimeError,
                "The AI service returned a meeting summary without an overview.",
            ):
                openai_meeting_summary(self.record, "A useful transcript.")

    def test_summary_reuse_preserves_idempotency_and_edited_content(self):
        fallback = {"overview": ""}

        self.assertTrue(
            should_reuse_coach_meeting_summary(("same", "ready", fallback), "same")
        )
        self.assertTrue(
            should_reuse_coach_meeting_summary(("same", "failed", fallback), "same")
        )
        self.assertFalse(
            should_reuse_coach_meeting_summary(
                ("same", "failed", fallback),
                "same",
                retry_failed=True,
            )
        )
        self.assertTrue(
            should_reuse_coach_meeting_summary(
                ("old", "edited", {"overview": "Coach wording"}),
                "new",
                retry_failed=True,
            )
        )

    def test_explicit_retry_replaces_failed_fallback_with_ready_summary(self):
        transcript_text = "The learner and coach reviewed progress and agreed next steps."
        transcript_hash = hashlib.sha256(transcript_text.encode("utf-8")).hexdigest()
        generated_summary = {
            "title": "Monthly Coaching Recap",
            "overview": "The learner and coach reviewed progress and agreed next steps.",
            "keyPoints": ["Progress was reviewed."],
            "actions": [],
            "nextSteps": ["Continue with the agreed plan."],
            "support": [],
        }
        returned_summary = {
            "summary": generated_summary,
            "status": "ready",
            "generatedAt": "2026-09-19T19:49:00+00:00",
            "editedAt": None,
            "editedBy": "",
            "model": "test-model",
            "error": "",
        }
        cursor = MagicMock()
        cursor.fetchone.return_value = (
            transcript_hash,
            "failed",
            {"title": "Monthly Coaching Recap", "overview": ""},
        )
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor

        with patch("coach_api.views.router.db_for_write", return_value="default"), patch(
            "coach_api.views.connections", {"default": connection}
        ), patch(
            "coach_api.views.transaction.atomic", return_value=nullcontext()
        ), patch(
            "coach_api.views.coach_meeting_summaries_table_ready", return_value=True
        ), patch(
            "coach_api.views.stored_coach_meeting_transcript_for_summary",
            return_value={"artifactId": "transcript-1", "text": transcript_text},
        ), patch(
            "coach_api.views.openai_meeting_summary",
            return_value=(generated_summary, "test-model"),
        ) as generate, patch(
            "coach_api.views.stored_coach_meeting_summary",
            return_value=returned_summary,
        ):
            result = ensure_coach_meeting_summary(self.record, retry_failed=True)

        generate.assert_called_once_with(self.record, transcript_text)
        self.assertEqual(result["summary"]["overview"], generated_summary["overview"])
        upsert_params = cursor.execute.call_args_list[1].args[1]
        self.assertEqual(json.loads(upsert_params[9]), generated_summary)
        self.assertEqual(json.loads(upsert_params[10]), generated_summary)
        self.assertEqual(upsert_params[13], "ready")
        self.assertEqual(upsert_params[15], "")


class CoachMeetingSummaryRetryEndpointTests(SimpleTestCase):
    def test_check_teams_explicitly_retries_a_failed_summary(self):
        record = CoachCalendarEvent(
            event_key="mcr:42:1:2026-09-19",
            owner_email="coach@example.test",
            event_type="mcr",
            status="completed",
        )
        request = RequestFactory().get(
            "/coach_api/coach/timetable/events/mcr:42:1:2026-09-19/artifacts?refresh=1"
        )
        request.coach_email = record.owner_email
        snapshot = {
            "attendance": {"records": []},
            "artifacts": [],
            "attendanceReports": [],
            "attendanceTracker": {"tracker": []},
            "errors": [],
            "partial": False,
        }

        with patch(
            "coach_api.views.coach_meeting_artifact_record", return_value=record
        ), patch(
            "coach_api.views.fetch_coach_meeting_graph_snapshot",
            return_value=(snapshot, None, 200),
        ), patch(
            "coach_api.views.apply_teams_attendance_status_transition", return_value=False
        ), patch(
            "coach_api.views.persist_coach_meeting_snapshots",
            return_value={"stored": True},
        ), patch(
            "coach_api.views.ensure_coach_meeting_summary",
            return_value=None,
        ) as ensure:
            response = unwrap(coach_timetable_event_artifacts)(request, record.event_key)

        self.assertEqual(response.status_code, 200)
        ensure.assert_called_once_with(record, retry_failed=True)


class ReviewMeetingSummaryEndpointTests(SimpleTestCase):
    def setUp(self):
        self.instance = {
            "id": "REVI-1", "status": "in-progress", "calendar_event_id": 17,
            "coach_email": "coach@example.test",
        }
        self.definition = {
            "template": {"reviewTypeCode": "mcm"},
            "sections": [{"fields": [{
                "id": "REVF-SUMMARY", "configuration": {"semanticKey": "meeting_summary"},
            }]}],
        }
        self.record = CoachCalendarEvent(
            id=17, event_key="mcr:42:1:2026-09-19", owner_email="coach@example.test",
            review_instance_id="REVI-1", event_type="mcr",
        )
        self.request = RequestFactory().post("/coach/reviews/REVI-1/meeting-summary")
        self.request.coach_email = "coach@example.test"

    def patches(self):
        return (
            patch("coach_api.views._authorized_review_instance", return_value=(self.instance, None)),
            patch("coach_api.views.curriculum_review_instances.review_instance_form_definition", return_value=self.definition),
            patch("coach_api.views.curriculum_review_instances.meeting_summary_field", return_value=self.definition["sections"][0]["fields"][0]),
            patch("coach_api.views._review_instance_calendar_record", return_value=self.record),
        )

    def test_valid_stored_summary_is_returned_without_graph_or_openai(self):
        contexts = self.patches()
        with contexts[0], contexts[1], contexts[2], contexts[3], patch(
            "coach_api.views.stored_coach_meeting_summary", return_value={"status": "ready"},
        ), patch(
            "coach_api.views._review_instance_meeting_summary_source",
            return_value={"fieldId": "REVF-SUMMARY", "status": "ready", "summaryText": "Stored"},
        ), patch("coach_api.views.fetch_coach_meeting_graph_snapshot") as graph, patch(
            "coach_api.views.ensure_coach_meeting_summary"
        ) as generate:
            response = unwrap(coach_review_instance_meeting_summary)(self.request, "REVI-1")
        self.assertEqual(response.status_code, 200)
        graph.assert_not_called()
        generate.assert_not_called()

    def test_missing_transcript_returns_clear_state_without_generation(self):
        snapshot = {"artifacts": [], "attendanceReports": [], "attendanceTracker": {}}
        contexts = self.patches()
        with contexts[0], contexts[1], contexts[2], contexts[3], patch(
            "coach_api.views.stored_coach_meeting_summary", return_value=None,
        ), patch(
            "coach_api.views.fetch_coach_meeting_graph_snapshot", return_value=(snapshot, None, 200),
        ), patch("coach_api.views.persist_coach_meeting_snapshots"), patch(
            "coach_api.views.stored_coach_meeting_transcript_for_summary", return_value=None,
        ), patch("coach_api.views.ensure_coach_meeting_summary") as generate:
            response = unwrap(coach_review_instance_meeting_summary)(self.request, "REVI-1")
        self.assertEqual(response.status_code, 409)
        self.assertIn("transcript is not available", response.content.decode())
        generate.assert_not_called()

    def test_failed_summary_gets_one_explicit_retry(self):
        snapshot = {"artifacts": [], "attendanceReports": [], "attendanceTracker": {}}
        source = {"fieldId": "REVF-SUMMARY", "status": "ready", "summaryText": "Generated"}
        contexts = self.patches()
        with contexts[0], contexts[1], contexts[2], contexts[3], patch(
            "coach_api.views.stored_coach_meeting_summary", return_value={"status": "failed"},
        ), patch(
            "coach_api.views.fetch_coach_meeting_graph_snapshot", return_value=(snapshot, None, 200),
        ), patch("coach_api.views.persist_coach_meeting_snapshots"), patch(
            "coach_api.views.stored_coach_meeting_transcript_for_summary", return_value={"text": "Transcript"},
        ), patch(
            "coach_api.views.ensure_coach_meeting_summary", return_value={"status": "ready"},
        ) as generate, patch(
            "coach_api.views._review_instance_meeting_summary_source", return_value=source,
        ):
            response = unwrap(coach_review_instance_meeting_summary)(self.request, "REVI-1")
        self.assertEqual(response.status_code, 200)
        generate.assert_called_once_with(self.record, retry_failed=True)
