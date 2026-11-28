"""Hermetic native -> decorated canonical absence workflow tests.

Real facade, permission decorator, canonical validation and serialization run
against in-memory learner/session/report fixtures. Database transactions,
storage, mail and calendar writes are replaced before invocation. No application
settings, database connection, session creation or provider call is used.
"""
import importlib.util
import json
from contextlib import nullcontext
from datetime import date, datetime, time, timezone
from pathlib import Path
import sys
import types
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

import test_mobile_contract as base
from django.db import DatabaseError
from django.http import JsonResponse
from django.test import override_settings

SOURCE_ROOT = Path(__file__).resolve().parent.parent
PACKAGE = "_mobile_absence_contract"


def fixture(name, **members):
    module = types.ModuleType(name)
    module.__dict__.update(members)
    sys.modules[name] = module
    return module


def source_module(name, filename):
    spec = importlib.util.spec_from_file_location(name, SOURCE_ROOT / filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


class Reports(list):
    def filter(self, **fields):
        return Reports(row for row in self if all(getattr(row, key) == value for key, value in fields.items()))

    def order_by(self, *fields):
        return self

    def exists(self):
        return bool(self)

    def first(self):
        return self[0] if self else None

    def count(self):
        return len(self)

    def create(self, **fields):
        row = SimpleNamespace(id=len(self) + 1, created_at=datetime(2026, 10, 14, tzinfo=timezone.utc),
                              updated_at=datetime(2026, 10, 14, tzinfo=timezone.utc), **fields)
        self.append(row)
        return row


class MobileAbsenceTests(unittest.TestCase):
    request = base.MobileFacadeTests.request
    body = base.MobileFacadeTests.body

    def setUp(self):
        base.MobileFacadeTests.setUp(self)
        settings_patch = override_settings(USE_TZ=True, TIME_ZONE="Europe/London",
                                          AZURE_QUARANTINE_CONTAINER="test-only",
                                          AZURE_APPROVED_CONTAINER="test-only-approved")
        settings_patch.enable()
        self.addCleanup(settings_patch.disable)
        module_patch = patch.dict(sys.modules)
        module_patch.start()
        self.addCleanup(module_patch.stop)
        package = fixture(PACKAGE, mobile=base.mobile)
        package.__path__ = [str(SOURCE_ROOT / "learner_api")]
        self.source.id = self.source.pk
        self.source.email = "synthetic@example.test"
        self.source.username = "Synthetic learner"
        self.profile.id = self.profile.pk
        self.profile.coach_name = "Synthetic coach"
        self.profile.coach_email = "coach@example.test"
        canonical_source = Mock()
        canonical_source.all_learners.filter.side_effect = lambda **fields: SimpleNamespace(
            first=lambda: self.source if fields.get("pk") == self.source.pk else None)
        fixture(PACKAGE + ".models", CommercialUser=canonical_source, EnrolmentUser=canonical_source)
        self.profile_lookup = Mock(return_value=self.profile)
        fixture(PACKAGE + ".identity", learner_profile_for_source=self.profile_lookup)
        self.reports = Reports()
        report_model = SimpleNamespace(objects=self.reports, STATUS_PENDING="pending", STATUS_APPROVED="approved",
                                       STATUS_DECLINED="declined")
        fixture("coach_api", __path__=[])
        fixture("coach_api.models", CoachAbsenceReport=report_model, CoachCalendarEvent=Mock())
        fixture("curriculum_api", __path__=[])
        self.record_absence = Mock()
        fixture("curriculum_api.live_session_absences", record_reported_absence=self.record_absence)
        fixture("curriculum_api.models", LiveSessionAbsence=Mock())
        fixture("login.email_azure", send_mail=Mock(side_effect=AssertionError("Unexpected mail call")))
        permissions = source_module("login._mobile_absence_permissions", "login/permissions.py")
        permissions._auth_gate_enabled = lambda: True
        sys.modules["login.permissions"] = permissions

        self.lecture = {"session_id": "teams:lecture-1", "session_date": date(2026, 10, 20),
                        "session_title": "Synthetic lecture", "session_type": "live-session",
                        "session_start_time": time(18), "session_end_time": time(19),
                        "attendance_status": "upcoming", "source": "fixture", "learner_id": 501}
        self.meeting = {**self.lecture, "session_id": "meeting:501:appointment-1:2026-10-21:10:00",
                        "session_date": date(2026, 10, 21), "session_title": "Monthly coaching",
                        "session_type": "mcr", "session_start_time": time(10)}
        self.lecture_rows = [self.lecture]
        self.meeting_rows = [self.meeting]
        fixture(PACKAGE + ".attendance_lectures", lecture_register=lambda learner: self.lecture_rows,
                session_key=lambda row: row["session_id"],
                can_report_absence_status=lambda status, day: status in {"absent", "unmarked", "upcoming", "in_progress"},
                report_id=lambda row: self.canonical._kbc_attendance_report_id(row["session_id"]))
        fixture(PACKAGE + ".meeting_attendance", absence_rows=lambda learner, kind: self.meeting_rows)
        fixture(PACKAGE + ".evidence_storage", azure_configured=lambda: False, blob_url=Mock(),
                delete_blob=Mock(side_effect=AssertionError("Unexpected storage call")),
                upload_to_quarantine=Mock(side_effect=AssertionError("Unexpected storage call")),
                resolve_read_url=lambda *args: "")
        fixture(PACKAGE + ".alternative_recovery", ALTERNATIVE_METHOD="alternative",
                alternative_event_key=lambda value: "alternative:" + value,
                alternative_target_details=lambda *args, **kwargs: {"id": "allowed-target"},
                eligible_alternative_occurrences=Mock(), eligible_alternatives_by_occurrence=lambda ids: {},
                validate_alternative_occurrence=lambda source, target: {"dateIso": "2026-10-22"}
                if source == "lecture-1" and target == "allowed-target" else None)
        self.canonical = source_module(PACKAGE + ".absence_reports", "learner_api/absence_reports.py")
        self.adapter = source_module(PACKAGE + ".mobile_absence", "learner_api/mobile_absence.py")
        for target, name, value in (
            (self.canonical.transaction, "atomic", Mock(return_value=nullcontext())),
            (self.canonical.router, "db_for_write", Mock(return_value="default")),
            (self.canonical, "_send_after_commit", Mock()),
            (self.canonical, "_recording_recovery_event", Mock()),
        ):
            replacement = patch.object(target, name, value)
            replacement.start()
            self.addCleanup(replacement.stop)
        self.notify = self.canonical._send_after_commit
        self.enterContext(patch.object(
            self.canonical.timezone, "localtime", return_value=datetime(2026, 10, 14, 9, tzinfo=timezone.utc)))

    def payload(self, *, meetings=False):
        row = self.meeting if meetings else self.lecture
        return {"scope": "meetings" if meetings else "lectures", "sessionId": row["session_id"],
                "sessionTitle": row["session_title"], "sessionDate": row["session_date"].isoformat(),
                "sessionTime": row["session_start_time"].strftime("%H:%M"), "reasonCategory": "illness",
                "explanation": "Synthetic explanation", "recoveryMethod": "" if meetings else "recorded",
                **({} if meetings else {"recordingDate": "2026-10-22", "recordingTime": "18:00",
                                       "recordingDurationMinutes": "60"})}

    def test_get_uses_canonical_owned_scope_and_identity_for_both_kinds(self):
        for kind in ("apprenticeship", "commercial"):
            self.source.learner_type = kind
            for scope, row in (("lectures", self.lecture), ("meetings", self.meeting)):
                with self.subTest(kind=kind, scope=scope):
                    response = self.adapter.absence_reports(self.request(query="?scope=" + scope))
                    self.assertEqual(response.status_code, 200)
                    data = self.body(response)
                    self.assertEqual(data["learner"], {"id": "501", "kind": kind})
                    self.assertEqual(data["missedSessions"][0]["sessionId"], row["session_id"])
                    self.assertEqual(response["Cache-Control"], "private, no-store")

    def test_canonical_meeting_report_stays_pending_and_does_not_change_calendar(self):
        response = self.adapter.absence_reports(self.request("POST", self.payload(meetings=True)))
        self.assertEqual(response.status_code, 201)
        self.assertEqual(self.body(response)["status"], "pending")
        self.assertEqual((self.reports[0].learner_id, self.reports[0].recovery_method), (501, ""))
        self.canonical._recording_recovery_event.assert_not_called()
        self.record_absence.assert_not_called()
        self.notify.assert_called_once()

    def test_lecture_recording_uses_canonical_approval_and_native_absence_record(self):
        response = self.adapter.absence_reports(self.request("POST", self.payload()))
        self.assertEqual(response.status_code, 201)
        self.assertEqual(self.body(response)["status"], "approved")
        self.record_absence.assert_called_once()
        self.assertEqual(self.record_absence.call_args.kwargs["source_learner_id"], 501)
        self.canonical._recording_recovery_event.assert_called_once()

    def test_lecture_alternative_is_revalidated_by_canonical_handler(self):
        payload = {key: value for key, value in self.payload().items() if not key.startswith("recording")}
        payload.update(recoveryMethod="alternative", targetOccurrenceId="foreign-target")
        self.assertEqual(self.adapter.absence_reports(self.request("POST", payload)).status_code, 409)
        self.assertFalse(self.reports)
        payload["targetOccurrenceId"] = "allowed-target"
        self.assertEqual(self.adapter.absence_reports(self.request("POST", payload)).status_code, 201)
        self.assertEqual(self.reports[0].catchup_event_key, "alternative:allowed-target")

    def test_commercial_report_keeps_source_identity_distinct_from_profile(self):
        self.source.learner_type = "commercial"
        response = self.adapter.absence_reports(self.request("POST", self.payload()))
        self.assertEqual(response.status_code, 201)
        fields = self.record_absence.call_args.kwargs
        self.assertEqual((fields["source_kind"], fields["source_learner_id"], fields["learner_profile_id"]),
                         ("commercial", 501, 991))
        self.assertEqual(self.reports[0].learner_id, 501)

    def test_canonical_rejects_changed_or_foreign_session_without_saving(self):
        for field, value in (("sessionId", "teams:foreign"), ("sessionTitle", "Someone else's lecture"),
                             ("sessionDate", "2026-10-23")):
            with self.subTest(field=field):
                response = self.adapter.absence_reports(self.request("POST", {**self.payload(), field: value}))
                self.assertEqual(response.status_code, 400)
        self.assertFalse(self.reports)
        self.notify.assert_not_called()

    def test_canonical_retry_returns_existing_report_without_duplicate_notifications(self):
        first = self.adapter.absence_reports(self.request("POST", self.payload(meetings=True)))
        second = self.adapter.absence_reports(self.request("POST", self.payload(meetings=True)))
        self.assertEqual((first.status_code, second.status_code), (201, 200))
        self.assertEqual(self.body(first)["id"], self.body(second)["id"])
        self.assertEqual(len(self.reports), 1)
        self.notify.assert_called_once()

    def test_paused_profile_keeps_canonical_reporting_permission(self):
        base.Profile.objects.filter.return_value.exists.return_value = False
        self.profile_lookup.side_effect = [None, self.profile]
        self.assertEqual(self.adapter.absence_reports(self.request("POST", self.payload())).status_code, 201)
        self.assertEqual(self.profile_lookup.call_count, 2)

    def test_unknown_identity_decision_upload_and_incomplete_catchup_fields_are_rejected(self):
        for key in ("learnerId", "kind", "profileId", "status", "ownerEmail", "evidence", "catchupPending", "attendanceRate"):
            with self.subTest(key=key):
                self.assertEqual(self.adapter.absence_reports(self.request("POST", {**self.payload(), key: "1"})).status_code, 400)
        self.assertFalse(self.reports)

    def test_nonstring_fields_missing_id_wrong_scope_and_unsupported_recovery_fail(self):
        for change in ({"recordingDurationMinutes": 60}, {"reasonCategory": ["illness"]}, {"scope": None},
                       {"scope": "other"}, {"scope": "meetings"}, {"sessionId": ""},
                       {"recoveryMethod": "catch-up"}):
            with self.subTest(change=change):
                self.assertEqual(self.adapter.absence_reports(self.request("POST", {**self.payload(), **change})).status_code, 400)
        self.assertFalse(self.reports)

    def test_meeting_recovery_fields_are_refused_by_canonical_handler(self):
        payload = {**self.payload(meetings=True), "recoveryMethod": "recorded"}
        self.assertEqual(self.adapter.absence_reports(self.request("POST", payload)).status_code, 400)
        self.assertFalse(self.reports)

    def test_get_unknown_duplicate_scope_or_identity_query_is_rejected(self):
        for query in ("?scope=other", "?scope=lectures&scope=meetings", "?learnerId=999"):
            self.assertEqual(self.adapter.absence_reports(self.request(query=query)).status_code, 400)

    def test_facade_requires_active_account_auth_feature_and_security_header(self):
        base.mobile.authenticate_request.return_value = None
        self.assertEqual(self.adapter.absence_reports(self.request()).status_code, 401)
        base.mobile.authenticate_request.return_value = self.account
        self.account.role = "staff"
        self.assertEqual(self.adapter.absence_reports(self.request()).status_code, 403)
        self.account.role = "learner"
        self.account.is_active = False
        self.assertEqual(self.adapter.absence_reports(self.request()).status_code, 401)
        self.account.is_active = True
        with override_settings(KBC_MOBILE_API_ENABLED=False):
            self.assertEqual(self.adapter.absence_reports(self.request()).status_code, 503)
        request = self.request("POST", self.payload())
        del request.META["HTTP_X_REQUESTED_WITH"]
        self.assertEqual(self.adapter.absence_reports(request).status_code, 403)
        self.assertFalse(self.reports)

    def test_canonical_permission_decorator_is_still_invoked(self):
        permissions = sys.modules["login._mobile_absence_permissions"]
        with patch.object(permissions, "authenticate_request", return_value=SimpleNamespace(role="learner", subject_id=999)):
            self.assertEqual(self.adapter.absence_reports(self.request("POST", self.payload())).status_code, 404)
        self.assertFalse(self.reports)

    def test_canonical_api_gate_refusal_prevents_handler_and_is_preserved(self):
        base.mobile.refusal_for.return_value = JsonResponse({"code": "blocked"}, status=403)
        response = self.adapter.absence_reports(self.request("POST", self.payload()))
        self.assertEqual((response.status_code, self.body(response)), (403, {"code": "blocked"}))
        self.assertEqual(base.mobile.refusal_for.call_args.args[0], "/learner_api/absence-reports/apprenticeship/501/")
        self.assertFalse(self.reports)

    def test_temporary_form_and_path_are_restored_even_when_canonical_raises(self):
        request = self.request("POST", self.payload(), query="?ignored=1")
        original_path, original_get, original_post, original_files = request.path, request.GET, request.POST, request.FILES
        original_body = request.body
        with patch.object(self.canonical, "learner_absence_reports", side_effect=DatabaseError("synthetic failure")):
            response = self.adapter.absence_reports(request)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(request.path, original_path)
        self.assertIs(request.GET, original_get)
        self.assertIs(request.POST, original_post)
        self.assertIs(request.FILES, original_files)
        self.assertEqual(request.body, original_body)

    def test_unsupported_http_method_does_not_dispatch(self):
        response = self.adapter.absence_reports(self.factory.put("/", data="{}", content_type="application/json"))
        self.assertEqual(response.status_code, 405)
        self.assertFalse(self.reports)
