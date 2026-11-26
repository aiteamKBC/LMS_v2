"""Assignment recording reads preserve ownership without refreshing Teams."""
import copy
import json
from types import SimpleNamespace
from unittest.mock import patch

from django.http import HttpResponse
from django.test import RequestFactory, SimpleTestCase

from coach_api import views as coach
from learner_api import calendar


class AssignmentRecordingReadsTests(SimpleTestCase):
    def setUp(self):
        self.account = SimpleNamespace(role="learner", subject_id=71)
        self.record = SimpleNamespace(pk=12, event_key="calendar:71", graph_event_id="graph-71",
                                      status="scheduled", event_type="mcr")
        self.snapshot = {
            "artifacts": [{"artifact_type": "recording", "graph_artifact_id": "saved-video"},
                          {"artifact_type": "transcript", "graph_artifact_id": "private-transcript"}],
            "attendance": {"records": [], "reportCount": 0}, "attendanceReports": [],
            "attendanceTracker": {}, "errors": [], "partial": False,
            "storage": {"stored": True},
        }
        self.enterContext(patch.dict("os.environ", {"LEARNER_API_REQUIRE_AUTH": "1"}))
        self.enterContext(patch("login.permissions.authenticate_request", side_effect=lambda request: self.account))
        self.reader = self.enterContext(patch.object(calendar, "_learner_calendar_record", return_value=self.record))
        self.stored = self.enterContext(patch.object(coach, "stored_coach_meeting_snapshot",
                                                    side_effect=lambda record: copy.deepcopy(self.snapshot)))
        self.enterContext(patch("coach_api.recording_archive.archived_recording_url",
                                return_value="https://storage.example.test/saved"))
        self.enterContext(patch("coach_api.imported_recording_playback.graph_playback_candidate", return_value=False))
        overlays = self.enterContext(patch("coach_api.models.ImportedReviewInstance.objects"))
        overlays.filter.return_value.__getitem__.return_value = []
        self.effects = {name: self.enterContext(patch.object(coach, name)) for name in (
            "fetch_coach_meeting_graph_snapshot", "persist_coach_meeting_snapshots",
            "apply_teams_attendance_status_transition", "ensure_coach_meeting_summary",
            "microsoft_graph_request",
        )}
        self.effects["fetch_coach_meeting_graph_snapshot"].side_effect = AssertionError(
            "Assignment recording reads must not refresh Teams.")
        self.attendance = self.enterContext(patch("coach_api.review_attendance_links.attendance_for_display",
                                                 side_effect=lambda record, data: data))

    def request(self, *, kind="commercial", target=71, recordings_only=True, method="get"):
        path = "/artifacts/?recordings_only=1" if recordings_only else "/artifacts/"
        request = getattr(RequestFactory(), method)(path)
        return calendar.learner_calendar_event_artifacts(request, kind=kind, pk=target,
                                                       event_key=self.record.event_key)

    def assert_read_only(self):
        for operation in self.effects.values():
            operation.assert_not_called()
        self.attendance.assert_not_called()

    def test_native_and_imported_assignment_reads_return_saved_recordings_without_attendance(self):
        for imported in (False, True):
            if imported:
                self.record._imported_review_event = {"reviewId": "901", "reviewSource": "aptem"}
            for kind in ("commercial", "apprenticeship"):
                for role in ("learner", "staff", "admin"):
                    with self.subTest(imported=imported, kind=kind, role=role):
                        self.account.role = role
                        response = self.request(kind=kind)
                        self.assertEqual(response.status_code, 200)
                        payload = json.loads(response.content)
                        self.assertEqual([row["graph_artifact_id"] for row in payload["artifacts"]], ["saved-video"])
                        self.assertTrue(payload["artifacts"][0]["content_available"])
                        self.assertEqual(payload["resourceMode"], "stored")
                        self.assertNotIn("attendance", payload)
                        self.assertIsNone(payload["meetingSummary"])
                        self.assertEqual(self.record.status, "scheduled")
                        self.assert_read_only()
        self.reader.assert_called_with("apprenticeship", 71, "calendar:71")

    def test_another_learner_cannot_read_the_recordings(self):
        response = self.request(target=72)
        self.assertEqual(response.status_code, 404)
        self.reader.assert_not_called()
        self.stored.assert_not_called()
        self.assert_read_only()

    def test_signed_out_and_employer_requests_are_refused_before_reading(self):
        for account, expected in ((None, 401), (SimpleNamespace(role="employer", subject_id=91), 403)):
            with self.subTest(expected=expected):
                self.account = account
                self.assertEqual(self.request().status_code, expected)
        self.reader.assert_not_called()
        self.stored.assert_not_called()
        self.assert_read_only()

    def test_a_booking_outside_the_resolved_learner_scope_is_not_found(self):
        self.reader.return_value = None
        self.assertEqual(self.request().status_code, 404)
        self.stored.assert_not_called()
        self.assert_read_only()

    def test_post_is_not_enabled_by_the_recordings_flag(self):
        self.assertEqual(self.request(method="post").status_code, 405)
        self.reader.assert_not_called()
        self.assert_read_only()

    def test_empty_saved_resources_do_not_trigger_a_live_refresh(self):
        self.snapshot["artifacts"] = []
        payload = json.loads(self.request().content)
        self.assertEqual(payload["artifacts"], [])
        self.assertNotIn("attendance", payload)
        self.assert_read_only()

    def test_existing_native_artifact_consumers_keep_their_current_behavior(self):
        self.effects["fetch_coach_meeting_graph_snapshot"].side_effect = None
        self.effects["fetch_coach_meeting_graph_snapshot"].return_value = (copy.deepcopy(self.snapshot), None, 200)
        self.effects["persist_coach_meeting_snapshots"].return_value = {"stored": True}
        response = self.request(recordings_only=False)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content)["attendance"], self.snapshot["attendance"])
        self.effects["fetch_coach_meeting_graph_snapshot"].assert_called_once_with(self.record)
        self.effects["persist_coach_meeting_snapshots"].assert_called_once()
        self.stored.assert_not_called()

    def test_a_saved_provider_recording_keeps_its_protected_playback_option(self):
        with patch("coach_api.recording_archive.archived_recording_url", return_value=None), \
             patch("coach_api.imported_recording_playback.graph_playback_candidate", return_value=True):
            payload = json.loads(self.request().content)
        recording = payload["artifacts"][0]
        self.assertEqual(recording["graph_artifact_id"], "saved-video")
        self.assertFalse(recording["content_available"])
        self.assertTrue(recording["graph_playback_candidate"])
        self.assert_read_only()

    def test_recording_playback_retains_its_ownership_guard(self):
        with patch.object(coach, "coach_meeting_artifact_content_response",
                          return_value=HttpResponse(b"video", content_type="video/mp4")) as play:
            for target, expected in ((71, 200), (72, 404)):
                response = calendar.learner_calendar_event_artifact_content(
                    RequestFactory().get("/content/"), kind="commercial", pk=target,
                    event_key=self.record.event_key, artifact_type="recording", artifact_id="saved-video")
                self.assertEqual(response.status_code, expected)
            play.assert_called_once()
        self.assert_read_only()
