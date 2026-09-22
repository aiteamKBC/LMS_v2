import hashlib
import json
from contextlib import nullcontext
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import RequestFactory, SimpleTestCase, override_settings

from coach_api.models import CoachCalendarEvent
from coach_api.views import (
    COACH_MEETING_SUMMARY_TRANSCRIPT_CHARS,
    MeetingSummaryContext,
    coach_meeting_transcript_text,
    coach_review_instance_meeting_summary,
    coach_review_instance_previous,
    coach_timetable_event_artifacts,
    ensure_coach_meeting_summary,
    meeting_summary_transcript_excerpt,
    openai_meeting_summary,
    should_reuse_coach_meeting_summary,
    uploaded_coach_meeting_transcript_text,
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

            request_options = openai_client.return_value.chat.completions.create.call_args.kwargs
            self.assertEqual(request_options["max_completion_tokens"], 4000)
            self.assertEqual(request_options["reasoning_effort"], "low")

    @override_settings(OPENAI_API_KEY="test-key")
    def test_openai_summary_reports_safe_empty_response_diagnostics(self):
        response = SimpleNamespace(
            choices=[SimpleNamespace(
                message=SimpleNamespace(content=""),
                finish_reason="length",
            )],
            usage=SimpleNamespace(
                completion_tokens=1200,
                completion_tokens_details=SimpleNamespace(reasoning_tokens=1200),
            ),
        )

        with patch("openai.OpenAI") as openai_client:
            openai_client.return_value.chat.completions.create.return_value = response
            with self.assertRaisesMessage(
                RuntimeError,
                "finish_reason=length, completion_tokens=1200, reasoning_tokens=1200",
            ):
                openai_meeting_summary(self.record, "A useful transcript.")

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

    def test_uploaded_vtt_generates_without_graph_or_artifact_storage(self):
        request = RequestFactory().post(
            "/coach/reviews/REVI-1/meeting-summary",
            {"transcript": SimpleUploadedFile(
                "meeting.vtt",
                b"WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nUploaded discussion.",
                content_type="text/vtt",
            )},
        )
        request.coach_email = "coach@example.test"
        summary = {
            "title": "Monthly Coaching Meeting",
            "overview": "The uploaded discussion was summarised.",
            "keyPoints": [], "actions": [], "nextSteps": [], "support": [],
        }
        contexts = self.patches()
        with contexts[0], contexts[1], contexts[2], contexts[3], patch(
            "coach_api.views.openai_meeting_summary", return_value=(summary, "test-model"),
        ) as generate, patch(
            "coach_api.views.fetch_coach_meeting_graph_snapshot",
        ) as graph, patch(
            "coach_api.views.ensure_coach_meeting_summary",
        ) as stored_generation:
            response = unwrap(coach_review_instance_meeting_summary)(request, "REVI-1")

        payload = json.loads(response.content)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload["meetingSummarySource"]["status"], "ready")
        self.assertIn("uploaded discussion was summarised", payload["meetingSummarySource"]["summaryText"])
        generate.assert_called_once_with(self.record, "Uploaded discussion.")
        graph.assert_not_called()
        stored_generation.assert_not_called()

    def test_progress_review_uploaded_vtt_generates_for_its_mapped_summary_field(self):
        """Progress Reviews use the same transcript pipeline as MCM reviews."""
        self.definition["template"]["reviewTypeCode"] = "progress_review"
        self.record.event_type = "progress-review"

        response = self.upload_transcript("Progress was reviewed and next steps agreed.")

        payload = json.loads(response.content)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload["meetingSummarySource"]["status"], "ready")
        self.assertEqual(payload["meetingSummarySource"]["fieldId"], "REVF-SUMMARY")

    def test_uploaded_vtt_works_without_a_linked_teams_meeting(self):
        """The whole point of the fallback: the meeting was not held in Teams.

        Requiring a linked meeting here made the upload unreachable in exactly
        the case it exists for, so the review returned 409 instead.
        """
        request = RequestFactory().post(
            "/coach/reviews/REVI-1/meeting-summary",
            {"transcript": SimpleUploadedFile(
                "meeting.vtt",
                b"WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nHeld over a phone call.",
                content_type="text/vtt",
            )},
        )
        request.coach_email = "coach@example.test"
        summary = {
            "title": "Monthly Coaching Meeting",
            "overview": "The call was summarised.",
            "keyPoints": [], "actions": [], "nextSteps": [], "support": [],
        }
        context = MeetingSummaryContext(
            review_template_id="REVT-1", learner_name="Test Learner", owner_name="Test Coach",
        )
        contexts = self.patches()
        with contexts[0], contexts[1], contexts[2], patch(
            "coach_api.views._review_instance_calendar_record", return_value=None,
        ), patch(
            "coach_api.views._review_instance_meeting_summary_context", return_value=context,
        ), patch(
            "coach_api.views.openai_meeting_summary", return_value=(summary, "test-model"),
        ) as generate, patch(
            "coach_api.views.fetch_coach_meeting_graph_snapshot",
        ) as graph:
            response = unwrap(coach_review_instance_meeting_summary)(request, "REVI-1")

        payload = json.loads(response.content)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload["meetingSummarySource"]["status"], "ready")
        self.assertIn("call was summarised", payload["meetingSummarySource"]["summaryText"])
        generate.assert_called_once_with(context, "Held over a phone call.")
        graph.assert_not_called()

    def test_generating_from_teams_still_requires_a_linked_meeting(self):
        """Only the upload was unblocked: there is no transcript to fetch."""
        contexts = self.patches()
        with contexts[0], contexts[1], contexts[2], patch(
            "coach_api.views._review_instance_calendar_record", return_value=None,
        ), patch("coach_api.views.fetch_coach_meeting_graph_snapshot") as graph, patch(
            "coach_api.views.openai_meeting_summary",
        ) as generate:
            response = unwrap(coach_review_instance_meeting_summary)(self.request, "REVI-1")

        self.assertEqual(response.status_code, 409)
        self.assertIn("not linked to a scheduled Teams meeting", response.content.decode())
        graph.assert_not_called()
        generate.assert_not_called()

    def test_a_clean_upload_sends_no_caveat_message(self):
        response = self.upload_transcript("A short discussion.")
        self.assertEqual(json.loads(response.content)["meetingSummarySource"]["message"], "")

    def test_a_truncated_upload_says_only_part_of_the_meeting_was_used(self):
        """A partial recap must never be handed over as a complete one."""
        response = self.upload_transcript(
            "Long discussion. " * (COACH_MEETING_SUMMARY_TRANSCRIPT_CHARS // 10)
        )
        message = json.loads(response.content)["meetingSummarySource"]["message"]
        self.assertIn("longer than this summary can cover", message)

    def upload_transcript(self, spoken_text: str):
        """POST one valid .vtt carrying ``spoken_text`` as its only cue."""
        request = RequestFactory().post(
            "/coach/reviews/REVI-1/meeting-summary",
            {"transcript": SimpleUploadedFile(
                "meeting.vtt",
                ("WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n" + spoken_text).encode("utf-8"),
                content_type="text/vtt",
            )},
        )
        request.coach_email = "coach@example.test"
        summary = {
            "title": "Monthly Coaching Meeting", "overview": "Summarised.",
            "keyPoints": [], "actions": [], "nextSteps": [], "support": [],
        }
        contexts = self.patches()
        with contexts[0], contexts[1], contexts[2], contexts[3], patch(
            "coach_api.views.openai_meeting_summary", return_value=(summary, "test-model"),
        ):
            return unwrap(coach_review_instance_meeting_summary)(request, "REVI-1")

    def test_uploaded_non_vtt_is_rejected_before_generation(self):
        request = RequestFactory().post(
            "/coach/reviews/REVI-1/meeting-summary",
            {"transcript": SimpleUploadedFile("meeting.txt", b"Meeting notes")},
        )
        request.coach_email = "coach@example.test"
        contexts = self.patches()
        with contexts[0], contexts[1], contexts[2], contexts[3], patch(
            "coach_api.views.openai_meeting_summary",
        ) as generate:
            response = unwrap(coach_review_instance_meeting_summary)(request, "REVI-1")

        self.assertEqual(response.status_code, 400)
        self.assertIn(".vtt", response.content.decode())
        generate.assert_not_called()


class UploadedMeetingTranscriptTests(SimpleTestCase):
    def test_rejects_a_vtt_extension_without_a_webvtt_header(self):
        upload = SimpleUploadedFile("meeting.vtt", b"Plain text pretending to be VTT")
        with self.assertRaisesMessage(ValueError, "not a valid WebVTT"):
            uploaded_coach_meeting_transcript_text(upload)

    def test_keeps_the_webvtt_header_block_out_of_the_transcript(self):
        upload = SimpleUploadedFile(
            "meeting.vtt",
            b"WEBVTT\nKind: captions\nLanguage: en-GB\n\n"
            b"00:00:01.000 --> 00:00:03.000\nWe agreed the next milestone.\n",
        )
        self.assertEqual(
            uploaded_coach_meeting_transcript_text(upload),
            "We agreed the next milestone.",
        )


class MeetingTranscriptExtractionTests(SimpleTestCase):
    """A real Teams export, not the simplified shape the fixtures above use."""

    TEAMS_EXPORT = (
        "WEBVTT\n"
        "\n"
        "0d0e2c4a-1111-4b22-9c33-aaaabbbbcccc/6-0\n"
        "00:00:02.416 --> 00:00:05.128\n"
        "<v Coach Example>Shall we start with last month?</v>\n"
        "\n"
        "0d0e2c4a-1111-4b22-9c33-aaaabbbbcccc/7-0\n"
        "00:00:05.700 --> 00:00:09.004\n"
        "<v Learner Example>Yes, I finished the budgeting module.</v>\n"
    )

    def test_drops_the_guid_cue_identifier_teams_writes(self):
        extracted = coach_meeting_transcript_text(self.TEAMS_EXPORT)
        self.assertNotIn("0d0e2c4a", extracted)

    def test_keeps_speaker_attribution(self):
        self.assertEqual(
            coach_meeting_transcript_text(self.TEAMS_EXPORT),
            "Coach Example: Shall we start with last month?\n"
            "Learner Example: Yes, I finished the budgeting module.",
        )

    def test_keeps_payload_lines_when_the_export_has_no_cue_identifiers(self):
        # The cue identifier is optional in WebVTT. A payload line must not be
        # mistaken for one just because the next cue's timing line follows it.
        extracted = coach_meeting_transcript_text(
            "WEBVTT\n\n"
            "00:00:01.000 --> 00:00:03.000\nFirst point.\n\n"
            "00:00:04.000 --> 00:00:06.000\nSecond point.\n"
        )
        self.assertEqual(extracted, "First point.\nSecond point.")

    def test_keeps_a_multi_line_cue_payload(self):
        extracted = coach_meeting_transcript_text(
            "WEBVTT\n\n"
            "00:00:01.000 --> 00:00:03.000\n<v Coach Example>First half</v>\n"
            "<v Coach Example>second half.</v>\n"
        )
        self.assertEqual(
            extracted, "Coach Example: First half\nCoach Example: second half.",
        )


class MeetingSummaryTranscriptBudgetTests(SimpleTestCase):
    def test_a_transcript_within_the_budget_is_sent_whole(self):
        transcript = "A short coaching conversation."
        self.assertEqual(
            meeting_summary_transcript_excerpt(transcript), (transcript, False),
        )

    def test_an_over_long_transcript_reports_that_it_was_cut(self):
        excerpt, truncated = meeting_summary_transcript_excerpt(
            "x" * (COACH_MEETING_SUMMARY_TRANSCRIPT_CHARS + 1)
        )
        self.assertTrue(truncated)
        self.assertEqual(len(excerpt), COACH_MEETING_SUMMARY_TRANSCRIPT_CHARS)

    def test_an_hour_of_coaching_is_no_longer_cut(self):
        # The previous 18,000-character budget cut a normal meeting short and
        # said nothing, so the agreed actions stated at the end never reached
        # the model.
        hour_of_speech = "Coach Example: A sentence of about sixty characters here.\n" * 1000
        self.assertGreater(len(hour_of_speech), 18_000)
        self.assertFalse(meeting_summary_transcript_excerpt(hour_of_speech)[1])


class PreviousReviewSessionTests(SimpleTestCase):
    def test_resolves_the_immediately_previous_occurrence_without_live_services(self):
        current = {
            "id": "mcm-3",
            "review_template_id": "template-mcm",
            "learner_id": 42,
            "occurrence_number": 3,
            "coach_email": "coach@example.test",
        }
        previous = {
            "id": "mcm-2",
            "review_template_id": "template-mcm",
            "learner_id": 42,
            "occurrence_number": 2,
            "coach_email": "coach@example.test",
            "target_date": "2026-08-14",
            "completed_at": "2026-08-15T10:00:00+00:00",
            "status": "completed",
        }
        definition = {
            "template": {"name": "Monthly coaching", "reviewTypeCode": "mcm"},
            "sections": [],
        }
        request = RequestFactory().get("/coach_api/coach/reviews/mcm-3/previous")
        request.coach_email = "coach@example.test"
        record = SimpleNamespace(event_key="mcm:42:2")

        with patch("coach_api.views._authorized_review_instance", return_value=(current, None)), \
             patch("coach_api.views.curriculum_review_instances.find_review_instance", return_value=previous) as find_instance, \
             patch("coach_api.views.curriculum_review_instances.review_instance_form_definition", return_value=definition), \
             patch("coach_api.views._review_instance_calendar_record", return_value=record), \
             patch("coach_api.views.stored_coach_meeting_summary", return_value={
                 "status": "ready",
                 "summary": {"overview": "The learner completed the agreed action."},
             }), \
             patch("coach_api.views.stored_coach_meeting_transcript_for_summary", return_value={
                 "text": "Coach: Let us review the agreed action.",
             }):
            response = unwrap(coach_review_instance_previous)(request, "mcm-3")

        self.assertEqual(response.status_code, 200)
        payload = json.loads(response.content)
        self.assertTrue(payload["available"])
        self.assertEqual(payload["instance"]["id"], "mcm-2")
        self.assertEqual(payload["instance"]["occurrenceNumber"], 2)
        self.assertEqual(payload["summaryText"], "The learner completed the agreed action.")
        self.assertEqual(payload["transcriptText"], "Coach: Let us review the agreed action.")
        find_instance.assert_called_once_with("template-mcm", 42, 2)
