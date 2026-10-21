"""Exercise the absence action with synthetic learners and mocked external IO."""
from contextlib import ExitStack, nullcontext
from datetime import date, datetime, time, timezone
import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import RequestFactory, SimpleTestCase

from . import absence_reports as absence
from .attendance_lectures import report_id, session_key
from .tests_attendance_lectures import register_row


class AbsenceSubmissionWorkflowTests(SimpleTestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.source = SimpleNamespace(id=12, username="Synthetic learner", email="learner@example.test")
        self.profile = SimpleNamespace(id=99, coach_name="Coach", coach_email="coach@example.test")
        self.now = datetime(2026, 10, 20, 9, tzinfo=timezone.utc)
        self.row = register_row(
            source="microsoft-teams", session_id="occ-1", occurrence_id="occ-1",
            session_title="Synthetic lecture", session_date=date(2026, 10, 21),
            session_start_time=time(9), attendance_status="upcoming",
        )
        self.source_lookup = self.mock("_source_learner", return_value=self.source)
        self.register = self.mock("_attendance_rows_for_learner", side_effect=lambda *a, **k: [self.row])
        self.mock("timezone.localtime", return_value=self.now)
        self.profiles = self.mock("learner_profile_for_source", return_value=self.profile)
        self.reports = self.mock("CoachAbsenceReport.objects")
        self.reports.filter.return_value.exists.return_value = False
        self.reports.filter.return_value.count.return_value = 0
        self.reports.create.side_effect = lambda **fields: SimpleNamespace(
            id=7, created_at=self.now, updated_at=self.now, **fields,
        )
        self.calendar = self.mock("CoachCalendarEvent.objects")
        self.ledger = self.mock("record_reported_absence", side_effect=self.persist_occurrence)
        self.mock("transaction.atomic", return_value=nullcontext())
        self.notify = self.mock("_send_after_commit")
        self.mock("resolve_read_url", side_effect=lambda url, *args: url)
        self.mock("alternative_target_details", return_value=None)
        self.alternatives = self.mock("validate_alternative_occurrence", return_value={"id": "occ-alternative"})
        self.booking = self.mock("_catchup_booking", return_value=SimpleNamespace(
            scheduled_date=date(2026, 10, 27), scheduled_time=time(10, 30),
        ))
        self.upload = self.mock("upload_to_quarantine")
        self.delete_blob = self.mock("delete_blob")
        self.mock("azure_configured", return_value=True)
        self.mock("blob_url", return_value="https://example.test/synthetic-evidence.pdf")
        self.stack.enter_context(patch("login.permissions._auth_gate_enabled", return_value=True))
        self.account = self.stack.enter_context(patch(
            "login.permissions.authenticate_request",
            return_value=SimpleNamespace(role="learner", subject_id=12),
        ))

    def mock(self, name, **kwargs):
        return self.stack.enter_context(patch(f"learner_api.absence_reports.{name}", **kwargs))

    def persist_occurrence(self, *, occurrence_id, **kwargs):
        # The ledger's FK accepts the stored occurrence, never a display alias.
        if occurrence_id != "occ-1":
            raise absence.LiveSessionAbsence.DoesNotExist("Unknown occurrence")

    def shared_row(self):
        self.row.update(
            session_id="occ-1:module-copy", occurrence_id="occ-1:module-copy",
            attendance_source_occurrence_id="occ-1", attendance_source_module_id="module-source",
            module_catalogue_id="module-copy",
        )

    def submit(self, *, kind="apprenticeship", recovery="recorded", **extra):
        payload = {
            "sessionId": session_key(self.row), "sessionTitle": self.row["session_title"],
            "sessionDate": self.row["session_date"].isoformat(), "sessionTime": "09:00",
            "reasonCategory": "other", "otherReason": "Pre-booked holiday.",
            "recoveryMethod": recovery,
        }
        if recovery == "recorded":
            payload.update(recordingDate="2026-10-27", recordingTime="10:30")
        elif recovery == "catch-up":
            payload["catchupEventKey"] = "catch-up:99:1"
        elif recovery == "alternative":
            payload["targetOccurrenceId"] = "occ-alternative"
        payload.update(extra)
        return absence.learner_absence_reports(
            RequestFactory().post("/", payload), kind=kind, learner_id=12,
        )

    def test_native_save_for_both_learner_types_and_all_recovery_plans(self):
        for kind in ("commercial", "apprenticeship"):
            for recovery in ("recorded", "catch-up", "alternative"):
                with self.subTest(kind=kind, recovery=recovery):
                    response = self.submit(kind=kind, recovery=recovery)
                    self.assertEqual(response.status_code, 201)
                    self.assertEqual(json.loads(response.content)["recoveryMethod"], recovery)
                    self.assertEqual(self.ledger.call_args.kwargs["source_kind"], kind)
                    self.assertEqual(self.ledger.call_args.kwargs["source_learner_id"], 12)
                    self.assertEqual(self.ledger.call_args.kwargs["learner_profile_id"], 99)

    def test_shared_session_saves_real_occurrence_and_keeps_report_display_identity(self):
        self.shared_row()
        for kind in ("commercial", "apprenticeship"):
            for recovery in ("recorded", "catch-up", "alternative"):
                with self.subTest(kind=kind, recovery=recovery):
                    response = self.submit(kind=kind, recovery=recovery)
                    self.assertEqual(response.status_code, 201)
                    self.assertEqual(json.loads(response.content)["attendanceId"], str(report_id(self.row)))
                    self.assertEqual(self.ledger.call_args.kwargs["occurrence_id"], "occ-1")
        self.alternatives.assert_called_with("occ-1", "occ-alternative")

    def test_shared_session_lists_alternatives_using_the_stored_occurrence(self):
        self.shared_row()
        choices = [{"id": "occ-alternative"}]
        lookup = self.mock("eligible_alternatives_by_occurrence", return_value={"occ-1": choices})
        sessions = absence._fetch_missed_sessions(self.source, 12)
        lookup.assert_called_once_with(["occ-1"])
        self.assertEqual(sessions[0]["sessionId"], "teams:occ-1:module-copy")
        self.assertEqual(sessions[0]["alternativeSessions"], choices)

    def test_replaced_meeting_keeps_current_occurrence_not_historical_evidence(self):
        self.row["attendance_source_occurrence_id"] = "replaced-old-occurrence"
        response = self.submit()
        self.assertEqual(response.status_code, 201)
        self.assertEqual(self.ledger.call_args.kwargs["occurrence_id"], "occ-1")

    def test_missing_client_session_id_still_links_the_server_resolved_occurrence(self):
        response = self.submit(sessionId="")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(self.ledger.call_args.kwargs["occurrence_id"], "occ-1")

    def test_legacy_recording_without_profile_is_saved_for_each_learner_type(self):
        self.row.update(source="kbc-attendance", session_id="legacy-owned-session")
        self.profiles.return_value = None
        for kind in ("commercial", "apprenticeship"):
            with self.subTest(kind=kind):
                response = self.submit(kind=kind)
                self.assertEqual(response.status_code, 201)
                self.assertEqual(self.calendar.create.call_args.kwargs["learner_id"], 12)
        self.ledger.assert_not_called()

    def test_missing_native_profile_returns_actionable_conflict_without_saving(self):
        self.profiles.return_value = None
        self.assertEqual(self.submit().status_code, 409)
        self.reports.create.assert_not_called()
        self.ledger.assert_not_called()
        self.calendar.create.assert_not_called()

    def test_other_learners_cannot_submit_this_action(self):
        self.account.return_value.subject_id = 13
        for kind in ("commercial", "apprenticeship"):
            with self.subTest(kind=kind):
                self.assertEqual(self.submit(kind=kind).status_code, 404)
        self.source_lookup.assert_not_called()
        self.reports.create.assert_not_called()

    def test_invalid_or_ambiguous_session_is_rejected_before_any_write(self):
        for extra in ({"sessionId": "teams:someone-elses-occurrence"},
                      {"sessionTitle": "Another lecture"}, {"sessionDate": "2026-10-22"}):
            with self.subTest(extra=extra):
                self.assertEqual(self.submit(**extra).status_code, 400)
        self.register.side_effect = lambda *a, **k: [self.row, self.row]
        self.assertEqual(self.submit().status_code, 400)
        self.reports.create.assert_not_called()
        self.ledger.assert_not_called()
        self.upload.assert_not_called()

    def test_optional_evidence_and_reason_are_saved_for_coach_view(self):
        evidence = SimpleUploadedFile("synthetic.pdf", b"%PDF-test", content_type="application/pdf")
        response = self.submit(evidence=evidence, explanation="Synthetic supporting details")
        self.assertEqual(response.status_code, 201)
        payload = json.loads(response.content)
        self.assertEqual(payload["reason"], "Pre-booked holiday.")
        self.assertEqual(payload["evidenceText"], "Synthetic supporting details")
        self.assertTrue(payload["evidenceProvided"])
        self.upload.assert_called_once()
        self.delete_blob.assert_not_called()

    def test_retry_returns_existing_report_without_another_calendar_event_or_notification(self):
        self.assertEqual(self.submit().status_code, 201)
        saved = SimpleNamespace(id=7, created_at=self.now, updated_at=self.now, **self.reports.create.call_args.kwargs)
        self.reports.filter.return_value.exists.return_value = True
        self.reports.filter.return_value.first.return_value = saved
        response = self.submit()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content)["id"], 7)
        self.reports.create.assert_called_once()
        self.calendar.create.assert_called_once()
        self.notify.assert_called_once()


class SharedAbsenceCatchupTests(SimpleTestCase):
    def test_later_catchup_links_only_the_ledger_for_the_owned_shared_session(self):
        from .session_recovery import _record_linked_catchup
        row = register_row(
            source="microsoft-teams", session_id="occ-1:module-copy",
            occurrence_id="occ-1:module-copy", module_catalogue_id="module-copy",
            attendance_source_occurrence_id="occ-1", attendance_source_module_id="module-source",
        )
        absences, attendance = MagicMock(), MagicMock()
        absences.filter.return_value.values.return_value = [
            {"id": 1, "occurrence_id": "occ-1", "learner_profile_id": 99, "source_kind": "commercial"},
            {"id": 2, "occurrence_id": "occ-other", "learner_profile_id": 99, "source_kind": "commercial"},
        ]
        source = SimpleNamespace(id=12)
        with patch("curriculum_api.models.LiveSessionAbsence.objects") as manager, \
             patch("curriculum_api.models.LiveSessionLearnerAttendance.objects") as register, \
             patch("learner_api.absence_reports._source_learner", return_value=source) as lookup, \
             patch("learner_api.attendance_lectures.read_native_occurrences", return_value=[row]) as schedule:
            manager.using.return_value = absences
            register.using.return_value = attendance
            linked = _record_linked_catchup(12, report_id(row), "catchup-synthetic")
        self.assertEqual(linked, 1)
        lookup.assert_called_once_with("commercial", 12)
        schedule.assert_called_once_with(source)
        absences.filter.assert_any_call(source_learner_id=12)
        absences.filter.assert_any_call(pk=1)
        self.assertNotIn(((), {"pk": 2}), absences.filter.call_args_list)
        self.assertEqual(absences.filter.return_value.update.call_args.kwargs["recovery_reference"], "catchup-synthetic")
        attendance.filter.assert_called_once_with(
            occurrence_id="occ-1", learner_profile_id=99, attendance_status="absent",
        )

    def test_unrelated_report_never_updates_a_shared_absence(self):
        from .session_recovery import _record_linked_catchup
        row = register_row(
            source="microsoft-teams", session_id="occ-1:module-copy",
            occurrence_id="occ-1:module-copy", module_catalogue_id="module-copy",
            attendance_source_occurrence_id="occ-1", attendance_source_module_id="module-source",
        )
        with patch("curriculum_api.models.LiveSessionAbsence.objects") as manager, \
             patch("learner_api.absence_reports._source_learner", return_value=SimpleNamespace(id=12)), \
             patch("learner_api.attendance_lectures.read_native_occurrences", return_value=[row]):
            absences = manager.using.return_value
            absences.filter.return_value.values.return_value = [
                {"id": 1, "occurrence_id": "occ-1", "learner_profile_id": 99, "source_kind": "apprenticeship"},
            ]
            self.assertEqual(_record_linked_catchup(12, report_id(register_row()), "catchup-synthetic"), 0)
        absences.filter.return_value.update.assert_not_called()
