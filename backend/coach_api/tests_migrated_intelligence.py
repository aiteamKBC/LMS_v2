"""Hermetic Phase E tests: synthetic meetings only; no Graph, AI or live DB."""
import inspect
import json
from contextlib import nullcontext
from datetime import date, time, timedelta
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.test import RequestFactory, SimpleTestCase
from django.utils import timezone

from coach_api.migrated_intelligence_views import (
    _association, _response, migrated_review_check_session,
    migrated_review_intelligence, migrated_review_summary,
)
from coach_api.models import ImportedReviewInstance


ID = "imported-review:C5-TEST-MCM-20261002-001"


def review(status="in-progress"):
    return SimpleNamespace(pk=1, event_key=ID, owner_email="coach@example.invalid", learner_id=42,
                           status=status, meeting_intelligence={}, answers={}, template_snapshot={"sections": []}, updated_at=timezone.now(), save=Mock())


def meeting():
    return SimpleNamespace(event_key=ID, owner_email="coach@example.invalid", learner_id=42,
                           event_type="mcr", review_instance_id="", review_template_id="",
                           graph_event_id="synthetic-graph-event", meeting_link="https://teams.microsoft.com/test",
                           sync_state="synced", scheduled_date=date.today() - timedelta(days=1), scheduled_time=time(14),
                           duration_minutes=60, learner_name="Synthetic learner")


def graph_snapshot(*, transcript=False, fetch_error=False, attendance=False):
    artifacts = []
    if transcript:
        artifacts.append({"artifact_type": "transcript", "graph_artifact_id": "transcript-1",
                          "transcript_text": "Synthetic transcript" if not fetch_error else "",
                          **({"transcript_fetch_error": "Content unavailable"} if fetch_error else {})})
    reports = [{"id": "report-1", "records": []}] if attendance else []
    return {
        "artifacts": artifacts, "attendanceReports": reports,
        "attendanceTracker": {"tracker": []},
        "attendance": {"records": [], "reports": reports},
        "errors": ["Microsoft Graph could not return transcript content."] if fetch_error else [],
        "partial": fetch_error,
    }


class MigratedMeetingIntelligenceTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.overlay = review()
        self.record = meeting()

    def call_check(self, snapshot, transcript=None, stored_snapshot=None):
        stored_snapshot = stored_snapshot or {"artifacts": [], "attendanceReports": [], "attendanceTracker": {"tracker": []}}
        with (
            patch("coach_api.migrated_intelligence_views._association", return_value=(self.overlay, self.record, {})),
            patch("coach_api.migrated_intelligence_views.transaction.atomic", return_value=nullcontext()),
            patch("coach_api.migrated_intelligence_views.ImportedReviewInstance.objects.select_for_update") as locked,
            patch("coach_api.views.fetch_coach_meeting_graph_snapshot", return_value=(snapshot, None, 200)),
            patch("coach_api.views.persist_coach_meeting_snapshots", return_value={"stored": True}) as persist,
            patch("coach_api.views.stored_coach_meeting_snapshot", return_value=stored_snapshot),
            patch("coach_api.views.stored_coach_meeting_transcript_for_summary", return_value=transcript),
            patch("coach_api.migrated_intelligence_views._response") as respond,
        ):
            locked.return_value.get.return_value = self.overlay
            respond.side_effect = lambda overlay, record, **kwargs: SimpleNamespace(status_code=kwargs.get("status", 200))
            result = inspect.unwrap(migrated_review_check_session)(self.factory.post("/", data="{}", content_type="application/json"), ID)
            return result, persist

    def test_association_uses_overlay_calendar_key_and_rejects_native_links(self):
        definition = {"template": {"reviewTypeCode": "aptem_mcm"}}
        with patch("coach_api.migrated_intelligence_views._coach_review", return_value=("coach@example.invalid", definition)), \
             patch("coach_api.views._owned_migrated_overlay", return_value=self.overlay), \
             patch("coach_api.migrated_intelligence_views.CoachCalendarEvent.objects.filter") as rows:
            rows.return_value.__getitem__.return_value = [self.record]
            assert _association(self.factory.get("/"), ID)[1] is self.record
            self.record.review_instance_id = "native-review-id"
            assert _association(self.factory.get("/"), ID)[1] is None

    def test_get_is_stored_only_and_never_fetches_graph(self):
        with patch("coach_api.migrated_intelligence_views._association", return_value=(self.overlay, self.record, {})), \
             patch("coach_api.views.stored_coach_meeting_snapshot", return_value={
                 "attendance": {"records": [], "reports": []}, "artifacts": [], "errors": [], "partial": False,
             }), \
             patch("coach_api.views.fetch_coach_meeting_graph_snapshot") as graph:
            result = inspect.unwrap(migrated_review_intelligence)(self.factory.get("/"), ID)
            self.assertEqual(result.status_code, 200)
            self.assertEqual(json.loads(result.content)["intelligence"]["transcriptStatus"], "not-checked")
            graph.assert_not_called()

    def test_attendance_and_pending_transcript_do_not_fabricate_summary(self):
        result, persist = self.call_check(graph_snapshot(attendance=True))
        self.assertEqual(result.status_code, 200)
        self.assertEqual(self.overlay.meeting_intelligence["attendanceStatus"], "available")
        self.assertEqual(self.overlay.meeting_intelligence["transcriptStatus"], "pending")
        self.assertNotIn("summary", self.overlay.meeting_intelligence)
        self.assertEqual(persist.call_count, 1)

    def test_transcript_generates_once_and_preserves_edited_summary(self):
        transcript = {"artifactId": "transcript-1", "text": "Synthetic meeting facts"}
        with patch("coach_api.views.openai_meeting_summary", return_value=({"title": "MCM", "overview": "Facts"}, "model")) as ai:
            self.call_check(graph_snapshot(transcript=True), transcript)
            self.assertEqual(self.overlay.meeting_intelligence["summaryStatus"], "ready")
            self.assertEqual(self.overlay.meeting_intelligence["transcriptArtifactId"], "transcript-1")
            self.overlay.meeting_intelligence["summary"] = {"title": "Coach edit", "overview": "Edited facts"}
            self.overlay.meeting_intelligence["summaryStatus"] = "edited"
            self.call_check(graph_snapshot(transcript=True), transcript)
            self.assertEqual(ai.call_count, 1)
            self.assertEqual(self.overlay.meeting_intelligence["summary"]["overview"], "Edited facts")

    def test_transcript_failure_does_not_erase_stored_artifact_or_attendance(self):
        result, persist = self.call_check(graph_snapshot(transcript=True, fetch_error=True, attendance=True))
        self.assertEqual(result.status_code, 207)
        self.assertEqual(persist.call_args.kwargs["artifacts"], [])
        self.assertEqual(len(persist.call_args.kwargs["attendance_reports"]), 1)
        self.assertIn("TRANSCRIPT_FETCH_FAILED", self.overlay.meeting_intelligence["errorCodes"])

    def test_missing_transcript_is_pending_and_explicit_gone_is_unavailable(self):
        self.call_check(graph_snapshot())
        self.assertEqual(self.overlay.meeting_intelligence["transcriptStatus"], "pending")
        snapshot = graph_snapshot(transcript=True, fetch_error=True)
        snapshot["artifacts"][0]["transcript_fetch_error"] = "Microsoft Graph returned 410 for transcript content."
        self.call_check(snapshot)
        self.assertEqual(self.overlay.meeting_intelligence["transcriptStatus"], "unavailable")
        self.assertIn("TRANSCRIPT_UNAVAILABLE", self.overlay.meeting_intelligence["errorCodes"])

    def test_attendance_failure_preserves_previous_snapshot_and_transcript_can_continue(self):
        snapshot = graph_snapshot(transcript=True)
        snapshot["errors"] = ["Microsoft Graph could not return attendance reports for this meeting."]
        previous = {"artifacts": [], "attendanceReports": [{"id": "old-report"}], "attendanceTracker": {"tracker": [{"id": "old-learner"}]}}
        with patch("coach_api.views.openai_meeting_summary", return_value=({"title": "MCM", "overview": "Facts"}, "model")):
            _result, persist = self.call_check(snapshot, {"artifactId": "transcript-1", "text": "Facts"}, stored_snapshot=previous)
        self.assertEqual(persist.call_args.kwargs["attendance_reports"], previous["attendanceReports"])
        self.assertEqual(persist.call_args.kwargs["attendance_tracker"], previous["attendanceTracker"])
        self.assertEqual(self.overlay.meeting_intelligence["transcriptStatus"], "available")

    def test_empty_graph_response_retains_last_verified_attendance_and_recording(self):
        previous = {"artifacts": [{"artifact_type": "recording", "graph_artifact_id": "recording-1"}],
                    "attendanceReports": [{"id": "report-1"}], "attendanceTracker": {"tracker": []}}
        _result, persist = self.call_check(graph_snapshot(), stored_snapshot=previous)
        self.assertEqual(persist.call_args.kwargs["attendance_reports"], previous["attendanceReports"])
        self.assertEqual(self.overlay.meeting_intelligence["attendanceStatus"], "available")
        self.assertEqual(self.overlay.meeting_intelligence["recordingStatus"], "available")

    def test_ai_failure_keeps_attendance_and_can_retry_explicitly(self):
        transcript = {"artifactId": "transcript-1", "text": "Synthetic meeting facts"}
        with patch("coach_api.views.openai_meeting_summary", side_effect=RuntimeError("synthetic failure")):
            self.call_check(graph_snapshot(transcript=True, attendance=True), transcript)
        self.assertEqual(self.overlay.meeting_intelligence["summaryStatus"], "failed")
        self.assertEqual(self.overlay.meeting_intelligence["attendanceStatus"], "available")
        with patch("coach_api.views.openai_meeting_summary", return_value=({"title": "MCM", "overview": "Facts"}, "model")):
            self.call_check(graph_snapshot(transcript=True, attendance=True), transcript)
        self.assertEqual(self.overlay.meeting_intelligence["summaryStatus"], "ready")

    def test_graph_failure_and_completed_status_do_not_write(self):
        self.overlay.status = ImportedReviewInstance.STATUS_COMPLETED
        result, persist = self.call_check(graph_snapshot())
        self.assertEqual(result.status_code, 409)
        persist.assert_not_called()
        self.overlay.save.assert_not_called()

    def test_unresolved_graph_identity_reports_permission_and_never_persists(self):
        with patch("coach_api.migrated_intelligence_views._association", return_value=(self.overlay, self.record, {})), \
             patch("coach_api.views.fetch_coach_meeting_graph_snapshot", return_value=(None, {"code": "coach_online_meeting_unresolved", "detail": "Online meeting unavailable"}, 409)), \
             patch("coach_api.views.persist_coach_meeting_snapshots") as persist:
            result = inspect.unwrap(migrated_review_check_session)(self.factory.post("/"), ID)
        self.assertEqual(result.status_code, 409)
        self.assertEqual(json.loads(result.content)["code"], "GRAPH_PERMISSION_ERROR")
        persist.assert_not_called()

    def test_edit_requires_in_progress_and_generated_summary(self):
        self.overlay.meeting_intelligence = {"summary": {"title": "Original", "overview": "Initial"}}
        request = self.factory.patch("/", data=json.dumps({"summary": {"title": "Edited", "overview": "Coach edit"}}), content_type="application/json")
        request.login_account = SimpleNamespace(email="coach@example.invalid")
        with patch("coach_api.migrated_intelligence_views._association", return_value=(self.overlay, self.record, {})), \
             patch("coach_api.migrated_intelligence_views.transaction.atomic", return_value=nullcontext()), \
             patch("coach_api.migrated_intelligence_views.ImportedReviewInstance.objects.select_for_update") as locked:
            locked.return_value.get.return_value = self.overlay
            result = inspect.unwrap(migrated_review_summary)(request, ID)
            self.assertEqual(result.status_code, 200)
            self.assertEqual(self.overlay.meeting_intelligence["summaryStatus"], "edited")
            self.overlay.status = ImportedReviewInstance.STATUS_COMPLETED
            result = inspect.unwrap(migrated_review_summary)(request, ID)
            self.assertEqual(result.status_code, 409)

    def test_source_completed_or_unowned_review_is_not_available(self):
        with patch("coach_api.migrated_intelligence_views._association", return_value=(None, None, None)), \
             patch("coach_api.views.fetch_coach_meeting_graph_snapshot") as graph:
            result = inspect.unwrap(migrated_review_intelligence)(self.factory.get("/"), ID)
            self.assertEqual(result.status_code, 404)
            graph.assert_not_called()

    def test_admin_view_as_and_non_coach_cannot_trigger_graph(self):
        request = self.factory.post("/?viewAsCoach=coach%40example.invalid")
        request.login_account = SimpleNamespace(role="admin", subject_type="staff", subject_id=99)
        with patch("login.permissions.authenticate_request", return_value=request.login_account), \
             patch("login.permissions._accesses_of", return_value=frozenset({"super-admin"})), \
             patch("coach_api.auth.StaffUser.objects.filter") as staff_query, \
             patch("coach_api.auth._staff_access", return_value="super-admin"), \
             patch("coach_api.views.fetch_coach_meeting_graph_snapshot") as graph:
            staff_query.return_value.only.return_value.first.return_value = SimpleNamespace(id=99)
            result = migrated_review_check_session(request, ID)
            self.assertEqual(result.status_code, 403)
            self.assertEqual(json.loads(result.content)["code"], "coach_view_as_read_only")
            graph.assert_not_called()
            edit = self.factory.patch("/?viewAsCoach=coach%40example.invalid", data=json.dumps({"summary": {"overview": "changed"}}), content_type="application/json")
            edit.login_account = request.login_account
            with patch("login.permissions.authenticate_request", return_value=edit.login_account):
                edit_result = migrated_review_summary(edit, ID)
            self.assertEqual(edit_result.status_code, 403)
        with patch("login.permissions.authenticate_request", return_value=request.login_account), \
             patch("login.permissions._accesses_of", return_value=frozenset({"super-admin"})), \
             patch("coach_api.auth.StaffUser.objects.filter") as staff_query, \
             patch("coach_api.auth._staff_access", return_value="tutor"), \
             patch("coach_api.views.fetch_coach_meeting_graph_snapshot") as graph:
            staff_query.return_value.only.return_value.first.return_value = SimpleNamespace(id=99)
            result = migrated_review_check_session(request, ID)
            self.assertEqual(result.status_code, 403)
            graph.assert_not_called()

    def test_view_as_artifact_content_cannot_fall_through_to_graph(self):
        from coach_api.views import coach_timetable_event_artifact_content

        request = self.factory.get("/")
        request.coach_view_as = True
        request.coach_email = "coach@example.invalid"
        with patch("coach_api.views.coach_meeting_artifact_record", return_value=self.record), \
             patch("coach_api.views.coach_meeting_artifact_content_response") as content:
            response = inspect.unwrap(coach_timetable_event_artifact_content)(request, ID, "transcript", "transcript-1")
            self.assertEqual(response.status_code, 403)
            content.assert_not_called()
            content.return_value = SimpleNamespace(status_code=200)
            native = inspect.unwrap(coach_timetable_event_artifact_content)(request, "mcr:42:1", "transcript", "transcript-1")
            self.assertEqual(native.status_code, 200)
            content.assert_called_once()
