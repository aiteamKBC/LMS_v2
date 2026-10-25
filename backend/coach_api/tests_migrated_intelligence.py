"""Hermetic Phase E tests: synthetic meetings only; no Graph, AI or live DB."""
import inspect
import json
from copy import deepcopy
from contextlib import nullcontext
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.test import RequestFactory, SimpleTestCase, override_settings
from django.utils import timezone
from django.conf import settings

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
                           sync_state="synced", status="in-progress", scheduled_date=date.today() - timedelta(days=1), scheduled_time=time(14),
                           duration_minutes=60, learner_name="Synthetic learner")


def graph_snapshot(*, transcript=False, fetch_error=False, attendance=False):
    # Real Graph evidence includes call timing; selection must not trust bare IDs.
    start = datetime.combine(date.today() - timedelta(days=1), time(14), ZoneInfo(settings.TIME_ZONE))
    end = start + timedelta(minutes=30)
    artifacts = []
    if transcript:
        artifacts.append({"artifact_type": "transcript", "graph_artifact_id": "transcript-1",
                          "call_id": "synthetic-call", "created_datetime": start.isoformat(), "end_datetime": end.isoformat(),
                          "transcript_text": "Synthetic transcript" if not fetch_error else "",
                          "transcript_vtt": "WEBVTT\n\nSynthetic transcript" if not fetch_error else "",
                          **({"transcript_fetch_error": "Content unavailable"} if fetch_error else {})})
    reports = [{"id": "report-1", "records": [], "meetingStartDateTime": start.isoformat(), "meetingEndDateTime": end.isoformat()}] if attendance else []
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
        saved = deepcopy(stored_snapshot)
        def store(_record, **kwargs):
            rows = {(row['artifact_type'], row['graph_artifact_id']): row for row in saved['artifacts']}
            rows.update({(row['artifact_type'], row['graph_artifact_id']): row for row in kwargs['artifacts']})
            saved.update(artifacts=list(rows.values()), attendanceReports=kwargs['attendance_reports'],
                         attendanceTracker=kwargs['attendance_tracker'], partial=False, storage={'stored': True})
            return {'stored': True}
        def fetched(current, **options):
            options['target_resolver'](current)
            return snapshot, None, 200
        with (
            patch("coach_api.migrated_intelligence_views._association", return_value=(self.overlay, self.record, {})),
            patch("coach_api.migrated_intelligence_views.transaction.atomic", return_value=nullcontext()),
            patch("coach_api.migrated_intelligence_views.ImportedReviewInstance.objects.select_for_update") as locked,
            patch("coach_api.views.fetch_coach_meeting_graph_snapshot", side_effect=fetched),
            patch("coach_api.actual_session_resolution.review_meeting_target",
                  side_effect=lambda _record, *, identity_out: (
                      identity_out.update(target=SimpleNamespace(online_meeting_id='synthetic-meeting'))
                      or ('users/synthetic/onlineMeetings/synthetic-meeting', None))),
            patch("coach_api.views.persist_coach_meeting_snapshots", side_effect=store) as persist,
            patch("coach_api.views.stored_coach_meeting_snapshot", side_effect=lambda *a, **kw: deepcopy(saved)),
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
             patch("coach_api.reconciliation_links.active_links") as links, \
             patch("coach_api.migrated_intelligence_views.CoachCalendarEvent.objects.filter") as rows:
            links.return_value.select_related.return_value.first.return_value = None
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

    @override_settings(TIME_ZONE="Europe/London")
    def test_ended_call_can_be_checked_before_booked_end_for_both_review_families(self):
        self.record.scheduled_date = date(2026, 10, 22)
        self.record.scheduled_time = time(10)
        now = datetime(2026, 10, 22, 10, 35, tzinfo=ZoneInfo("Europe/London"))
        snapshot = graph_snapshot(attendance=True)
        snapshot["attendanceReports"][0].update(
            meetingStartDateTime="2026-10-22T09:00:00Z", meetingEndDateTime="2026-10-22T09:30:00Z")
        for family in ("mcr", "progress-review"):
            for status in ("scheduled", "in-progress"):
                with self.subTest(family=family, status=status), patch("coach_api.migrated_intelligence_views.timezone.now", return_value=now):
                    self.record.event_type = family
                    self.overlay.status = status
                    result, persist = self.call_check(snapshot)
                    self.assertEqual(result.status_code, 200)
                    persist.assert_called_once()
                    self.assertEqual(self.overlay.status, status)
                    self.assertEqual(self.overlay.meeting_intelligence["transcriptStatus"], "pending")

    @override_settings(TIME_ZONE="Europe/London")
    def test_unconfirmed_early_end_persists_resources_but_does_not_generate(self):
        self.record.scheduled_date = date(2026, 10, 22)
        self.record.scheduled_time = time(10)
        now = datetime(2026, 10, 22, 10, 35, tzinfo=ZoneInfo("Europe/London"))
        cases = [
            {},
            {"meetingStartDateTime": "2026-10-21T09:00:00Z", "meetingEndDateTime": "2026-10-21T09:30:00Z"},
            {"meetingStartDateTime": "2026-10-22T08:00:00Z", "meetingEndDateTime": "2026-10-22T08:30:00Z"},
            {"meetingStartDateTime": "2026-10-22T09:00:00Z", "meetingEndDateTime": "2026-10-22T09:45:00Z"},
            {"meetingStartDateTime": "2026-10-22T09:30:00Z", "meetingEndDateTime": "2026-10-22T09:00:00Z"},
            {"meetingStartDateTime": "invalid", "meetingEndDateTime": "invalid"},
            {"meetingStartDateTime": "2026-10-22T09:00:00", "meetingEndDateTime": "2026-10-22T09:30:00"},
        ]
        for report in cases:
            with self.subTest(report=report), patch("coach_api.migrated_intelligence_views.timezone.now", return_value=now), \
                    patch("coach_api.views.openai_meeting_summary") as ai:
                snapshot = graph_snapshot(transcript=True)
                snapshot["attendanceReports"] = [report] if report else []
                result, persist = self.call_check(snapshot, {"artifactId": "t1", "text": "Partial transcript"})
                self.assertEqual(result.status_code, 207)
                self.assertEqual(self.overlay.meeting_intelligence['meetingEndCode'], 'MEETING_END_PENDING')
                persist.assert_called_once()
                ai.assert_not_called()
                self.assertEqual(self.overlay.answers, {})

    @override_settings(TIME_ZONE="Europe/London")
    def test_scheduled_end_still_allows_check_without_attendance_report(self):
        self.record.scheduled_date = date(2026, 10, 26)
        self.record.scheduled_time = time(10)
        now = datetime(2026, 10, 26, 11, tzinfo=ZoneInfo("Europe/London"))
        with patch("coach_api.migrated_intelligence_views.timezone.now", return_value=now):
            result, persist = self.call_check(graph_snapshot())
        self.assertEqual(result.status_code, 200)
        persist.assert_called_once()

    def test_missing_booking_time_does_not_fetch_or_write(self):
        self.record.scheduled_time = None
        with patch("coach_api.migrated_intelligence_views._association", return_value=(self.overlay, self.record, {})), \
                patch("coach_api.views.fetch_coach_meeting_graph_snapshot") as graph:
            response = inspect.unwrap(migrated_review_check_session)(self.factory.post("/"), ID)
        self.assertEqual(response.status_code, 409)
        graph.assert_not_called()

    def test_transcript_generates_once_and_preserves_edited_summary(self):
        transcript = {"artifactId": "transcript-1", "text": "Synthetic meeting facts"}
        with patch("coach_api.views.openai_meeting_summary", return_value=({"title": "MCM", "overview": "Facts"}, "model")) as ai:
            self.call_check(graph_snapshot(transcript=True, attendance=True), transcript)
            self.assertEqual(self.overlay.meeting_intelligence["summaryStatus"], "ready")
            self.assertEqual(self.overlay.meeting_intelligence["transcriptArtifactId"], "transcript-1")
            self.overlay.meeting_intelligence["summary"] = {"title": "Coach edit", "overview": "Edited facts"}
            self.overlay.meeting_intelligence["summaryStatus"] = "edited"
            self.call_check(graph_snapshot(transcript=True, attendance=True), transcript)
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
        previous = {**graph_snapshot(attendance=True), "attendanceTracker": {"tracker": [{"id": "old-learner"}]}}
        previous['attendanceReports'][0].update(
            _lms_graph_event_id=self.record.graph_event_id,
            _lms_verified_online_meeting_id='synthetic-meeting')
        with patch("coach_api.views.openai_meeting_summary", return_value=({"title": "MCM", "overview": "Facts"}, "model")):
            _result, persist = self.call_check(snapshot, {"artifactId": "transcript-1", "text": "Facts"}, stored_snapshot=previous)
        self.assertEqual(persist.call_args.kwargs["attendance_reports"], previous["attendanceReports"])
        self.assertEqual(persist.call_args.kwargs["attendance_tracker"], previous["attendanceTracker"])
        self.assertEqual(self.overlay.meeting_intelligence["transcriptStatus"], "available")

    def test_empty_graph_response_retains_last_verified_attendance_and_recording(self):
        previous = graph_snapshot(transcript=True, attendance=True)
        previous['attendanceReports'][0].update(
            _lms_graph_event_id=self.record.graph_event_id,
            _lms_verified_online_meeting_id='synthetic-meeting')
        previous['artifacts'][0].update(artifact_type='recording', graph_artifact_id='recording-1',
                                         metadata={'_lms_graph_event_id': self.record.graph_event_id,
                                                   '_lms_verified_online_meeting_id': 'synthetic-meeting'})
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

    def test_unresolved_graph_identity_does_not_claim_permission_denial_or_persist(self):
        with patch("coach_api.migrated_intelligence_views._association", return_value=(self.overlay, self.record, {})), \
             patch("coach_api.views.stored_coach_meeting_snapshot", return_value={"storage": {"stored": True}}) as stored, \
             patch("coach_api.views.fetch_coach_meeting_graph_snapshot", return_value=(None, {"code": "coach_online_meeting_unresolved", "detail": "Online meeting unavailable"}, 409)), \
             patch("coach_api.views.persist_coach_meeting_snapshots") as persist:
            result = inspect.unwrap(migrated_review_check_session)(self.factory.post("/"), ID)
        self.assertEqual(result.status_code, 409)
        self.assertEqual(json.loads(result.content)["code"], "GRAPH_MEETING_UNRESOLVED")
        persist.assert_not_called()
        stored.assert_called_once_with(self.record)

    def test_summary_edit_allows_scheduled_without_starting_and_retains_provenance(self):
        request = self.factory.patch("/", data=json.dumps({"summary": {"title": "Edited", "overview": "Coach edit"}}), content_type="application/json")
        request.login_account = SimpleNamespace(email="coach@example.invalid")
        with patch("coach_api.migrated_intelligence_views._association", return_value=(self.overlay, self.record, {})), \
             patch("coach_api.migrated_intelligence_views.transaction.atomic", return_value=nullcontext()), \
             patch("coach_api.migrated_intelligence_views.ImportedReviewInstance.objects.select_for_update") as locked:
            locked.return_value.get.return_value = self.overlay
            for status in ("scheduled", "in-progress"):
                with self.subTest(status=status):
                    self.overlay.status = status
                    original = {"title": "Original", "overview": "Initial"}
                    self.overlay.meeting_intelligence = {"summary": original, "summaryStatus": "ready"}
                    result = inspect.unwrap(migrated_review_summary)(request, ID)
                    self.assertEqual(result.status_code, 200)
                    self.assertEqual(self.overlay.meeting_intelligence["summaryStatus"], "edited")
                    self.assertEqual(self.overlay.meeting_intelligence["aiSummaryOriginal"], original)
                    self.assertEqual(self.overlay.status, status)
                    self.assertEqual(self.overlay.answers, {})
                    self.overlay.save.assert_called_with(update_fields=["meeting_intelligence", "updated_at"])
            for status in ("not-scheduled", "awaiting-signature", "completed"):
                with self.subTest(status=status):
                    self.overlay.status = status
                    self.overlay.save.reset_mock()
                    self.assertEqual(inspect.unwrap(migrated_review_summary)(request, ID).status_code, 409)
                    self.overlay.save.assert_not_called()
            self.overlay.status = "scheduled"
            self.overlay.meeting_intelligence = {}
            self.assertEqual(inspect.unwrap(migrated_review_summary)(request, ID).status_code, 409)
            self.overlay.save.assert_not_called()

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
