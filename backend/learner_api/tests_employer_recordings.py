"""Employer access to a progress review's Teams recording.

Employers watch the formal recording of a review they can already open, and
nothing else: no transcript, no attendance rows, no meeting summary, and no
status side effect from opening the panel. Every reader is mocked; no schema
setup, no database and no Microsoft call is needed.
"""
import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import RequestFactory, SimpleTestCase

from learner_api import employer_portal

ROWS = [{"id": "review:1", "eventKey": "review:1", "calendarEventKey": "cal:1"}]
SNAPSHOT = {
    "artifacts": [
        {"artifact_type": "recording", "graph_artifact_id": "rec-1"},
        {"artifact_type": "transcript", "graph_artifact_id": "tr-1"},
    ],
    "attendance": {"records": [{"displayName": "Someone else"}], "reportCount": 1},
    "attendanceReports": [{"id": "report-1"}],
    "attendanceTracker": {"tracker": []},
    "errors": [],
    "partial": False,
}


class EmployerReviewRecordingTests(SimpleTestCase):
    def setUp(self):
        self.account = SimpleNamespace(role="employer", subject_id=7)
        self.learner = SimpleNamespace(pk=101, employer_id=7, email="learner@example.test")
        self.model = MagicMock()
        self.model.all_learners.get.return_value = self.learner
        self.record = SimpleNamespace(event_key="cal:1")
        self.rows = ROWS
        patches = [
            patch.dict("os.environ", {"LEARNER_API_REQUIRE_AUTH": "1"}),
            patch("login.permissions.authenticate_request", side_effect=lambda request: self.account),
            patch.object(employer_portal, "_employer_or_404", return_value=(SimpleNamespace(pk=7), None)),
            patch.object(employer_portal, "SOURCE_MODELS", {"apprenticeship": self.model}),
        ]
        for item in patches:
            item.start()
            self.addCleanup(item.stop)
        rows_patch = patch.object(employer_portal, "_employer_progress_review_rows",
                                  side_effect=lambda learner, event_key=None: (self.rows, {}, None))
        self.rows_reader = rows_patch.start()
        self.addCleanup(rows_patch.stop)
        record_patch = patch("learner_api.calendar._learner_calendar_record",
                             side_effect=lambda kind, pk, key: self.record)
        self.record_reader = record_patch.start()
        self.addCleanup(record_patch.stop)
        graph_patch = patch("coach_api.views.fetch_coach_meeting_graph_snapshot",
                            return_value=(SNAPSHOT, None, 200))
        self.graph = graph_patch.start()
        self.addCleanup(graph_patch.stop)
        persist_patch = patch("coach_api.views.persist_coach_meeting_snapshots",
                              return_value={"stored": True})
        self.persist = persist_patch.start()
        self.addCleanup(persist_patch.stop)
        transition_patch = patch("coach_api.views.apply_teams_attendance_status_transition")
        self.transition = transition_patch.start()
        self.addCleanup(transition_patch.stop)

    def artifacts(self, *, employer_id=7, learner_id=101, event_key="review:1", method="get"):
        request = getattr(RequestFactory(), method)("/artifacts/")
        return employer_portal.employer_portal_review_artifacts(
            request, employer_id=employer_id, kind="apprenticeship", learner_id=learner_id, event_key=event_key)

    def content(self, *, artifact_type="recording", employer_id=7, event_key="review:1"):
        with patch("coach_api.views.coach_meeting_artifact_content_response") as stream:
            stream.return_value = SimpleNamespace(status_code=200)
            response = employer_portal.employer_portal_review_artifact_content(
                RequestFactory().get("/content/"), employer_id=employer_id, kind="apprenticeship",
                learner_id=101, event_key=event_key, artifact_type=artifact_type, artifact_id="rec-1")
        return response, stream

    def test_returns_the_recording_without_transcript_attendance_or_summary(self):
        response = self.artifacts()
        self.assertEqual(response.status_code, 200)
        body = json.loads(response.content)
        self.assertEqual([artifact["graph_artifact_id"] for artifact in body["artifacts"]], ["rec-1"])
        self.assertNotIn("attendance", body)
        self.assertIsNone(body["meetingSummary"])
        self.assertEqual(response["Cache-Control"], "private, no-store")
        self.persist.assert_called_once()

    def test_opening_the_panel_never_moves_the_review_or_writes_attendance(self):
        self.artifacts()
        self.transition.assert_not_called()

    def test_reads_the_meeting_of_the_review_the_employer_asked_for(self):
        self.artifacts()
        self.assertEqual(self.rows_reader.call_args.args[0], self.learner)
        self.assertEqual(self.rows_reader.call_args.args[1], "review:1")
        # The calendar event behind the review, not the review key itself.
        self.assertEqual(self.record_reader.call_args.args, ("apprenticeship", 101, "cal:1"))

    def test_a_review_outside_the_employers_own_list_is_not_found(self):
        self.rows = []
        response = self.artifacts(event_key="review:other")
        self.assertEqual(response.status_code, 404)
        self.graph.assert_not_called()

    def test_a_learner_of_another_employer_is_refused(self):
        self.learner.employer_id = 99
        self.assertEqual(self.artifacts().status_code, 403)
        self.graph.assert_not_called()

    def test_a_review_without_its_own_meeting_is_not_found(self):
        self.record = None
        self.assertEqual(self.artifacts().status_code, 404)
        self.graph.assert_not_called()

    def test_only_get_is_allowed(self):
        self.assertEqual(self.artifacts(method="post").status_code, 405)
        self.graph.assert_not_called()

    def test_content_streams_a_recording_under_its_calendar_event_key(self):
        response, stream = self.content()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(stream.call_args.args[2], "cal:1")
        self.assertEqual(stream.call_args.args[3:], ("recording", "rec-1"))

    def test_content_refuses_a_transcript(self):
        response, stream = self.content(artifact_type="transcript")
        self.assertEqual(response.status_code, 403)
        stream.assert_not_called()

    def test_content_refuses_a_review_the_employer_cannot_open(self):
        self.rows = []
        response, stream = self.content(event_key="review:other")
        self.assertEqual(response.status_code, 404)
        stream.assert_not_called()
