"""Assignment MCM booking and own-meeting artifacts; no database or Graph calls."""
import inspect
import json
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import Mock, patch
from django.http import HttpResponse
from django.test import SimpleTestCase, RequestFactory
from . import calendar as module


class AssignmentMcmTests(SimpleTestCase):
    def test_permission_warning_explains_administrator_action(self):
        from coach_api.views import public_graph_sync_warning
        warning = public_graph_sync_warning("Microsoft Graph failed: HTTP 403; code=ErrorAccessDenied")
        result = module._friendly_sync_warning(warning)
        self.assertIn("administrator", result)
        self.assertIn("permission", result)
        self.assertNotIn("reconnect", result)

    def test_direct_booking_uses_shared_reservation_and_sync(self):
        from coach_api import views as coach
        source = Mock()
        source.all_learners.filter.return_value.first.return_value = SimpleNamespace(username="Learner", email="learner@example.com")
        mirror = SimpleNamespace(id=42, coach_email="coach@example.com", coach_name="Coach", full_name="Learner", email="learner@example.com")
        record = SimpleNamespace(pk=8, event_key="mcr:42:1:2026-09-22")
        with ExitStack() as stack:
            stack.enter_context(patch.object(module, "SOURCE_MODELS", {"commercial": source}))
            stack.enter_context(patch.object(module, "learner_profile_for_source", return_value=mirror))
            stack.enter_context(patch.object(module, "booking_date_restriction", return_value=None))
            manager = stack.enter_context(patch.object(module.CoachCalendarEvent, "objects"))
            manager.filter.return_value.first.return_value = None
            stack.enter_context(patch("learner_api.calendar_connections.booking_conflicts", return_value=False))
            reserve = stack.enter_context(patch.object(coach, "reserve_coach_calendar_booking", return_value=(record, True)))
            sync = stack.enter_context(patch.object(coach, "synchronize_reserved_calendar_event", return_value=(record, "", True)))
            stack.enter_context(patch.object(coach, "build_booked_calendar_event", return_value={"source": "mcr"}))
            stack.enter_context(patch.object(module, "_serialize_event", return_value={"eventKey": record.event_key}))
            stack.enter_context(patch.object(module, "_record_enrolment_review"))
            request = RequestFactory().post("/book/", data=json.dumps({"sessionType": "mcr", "assignmentMonth": "2026-09", "scheduledDate": "2026-10-05", "scheduledTime": "09:00", "durationMinutes": 60}), content_type="application/json")
            response = inspect.unwrap(module.learner_calendar_book)(request, "commercial", 1)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(reserve.call_args.kwargs["owner_email"], "coach@example.com")
        self.assertEqual(reserve.call_args.kwargs["idempotency_key"], "learner-book:mcm:commercial:1:2026-09")
        self.assertEqual(reserve.call_args.kwargs["initial_status"], "scheduled")
        sync.assert_called_once_with(8, {"source": "mcr"})

    def test_transcript_content_is_allowed_only_for_own_mcm(self):
        from coach_api import views as coach
        view = inspect.unwrap(module.learner_calendar_event_artifact_content)
        request = RequestFactory().get("/content/")
        for event_type, status in [("mcr", 200), ("progress-review", 403), (None, 404)]:
            record = SimpleNamespace(event_type=event_type) if event_type else None
            with self.subTest(event_type=event_type), patch.object(module, "_learner_calendar_record", return_value=record), patch.object(coach, "coach_meeting_artifact_content_response", return_value=HttpResponse("transcript")) as content:
                response = view(request, "commercial", 1, "meeting", "transcript", "artifact")
                self.assertEqual(response.status_code, status)
                self.assertEqual(content.call_count, int(status == 200))

    def test_mcm_lists_recording_transcript_and_attendance(self):
        from coach_api import views as coach
        snapshot = {"artifacts": [{"artifact_type": "transcript"}, {"artifact_type": "recording"}], "attendance": {"participantCount": 2}, "attendanceReports": [], "attendanceTracker": {}, "errors": [], "partial": False}
        with patch.object(module, "_learner_calendar_record", return_value=SimpleNamespace(event_type="mcr")), patch.object(coach, "fetch_coach_meeting_graph_snapshot", return_value=(snapshot, None, 200)), patch.object(coach, "persist_coach_meeting_snapshots", return_value={}):
            response = inspect.unwrap(module.learner_calendar_event_artifacts)(RequestFactory().get("/artifacts/"), "commercial", 1, "meeting")
        payload = json.loads(response.content)
        self.assertEqual(len(payload["artifacts"]), 2)
        self.assertEqual(payload["attendance"], snapshot["attendance"])
