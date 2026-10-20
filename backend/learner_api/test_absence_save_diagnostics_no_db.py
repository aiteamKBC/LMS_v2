"""Absence save failures stay atomic and provide a safe support reference."""
from contextlib import contextmanager, nullcontext
from datetime import datetime, timezone
import inspect
import json
from types import SimpleNamespace
from unittest.mock import patch

from django.db import IntegrityError, OperationalError
from django.test import RequestFactory, SimpleTestCase

from .absence_reports import learner_absence_reports


def database_failure(error_type, sqlstate):
    driver = RuntimeError("private learner reason; learner@example.test; password=secret")
    driver.sqlstate = sqlstate
    driver.diag = SimpleNamespace(
        constraint_name="report_check", column_name="status", table_name="report_table",
    )
    error = error_type(str(driver))
    error.__cause__ = driver
    return error


class AbsenceSaveDiagnosticsTests(SimpleTestCase):
    def submit(self, stage, error, *, duplicate=None):
        request = RequestFactory().post("/", {
            "sessionId": "teams:occ-synthetic", "sessionTitle": "Synthetic lecture",
            "sessionDate": "2026-10-21", "sessionTime": "09:00",
            "reasonCategory": "other", "otherReason": "Pre-booked holiday.",
            "recoveryMethod": "recorded", "recordingDate": "2026-10-27",
            "recordingTime": "10:30",
        })
        source = SimpleNamespace(id=12, username="Synthetic learner", email="learner@example.test")
        profile = SimpleNamespace(id=99, coach_email="coach@example.test", coach_name="Coach")

        @contextmanager
        def failed_commit():
            yield
            raise error

        with patch("learner_api.absence_reports._source_learner", return_value=source), \
             patch("learner_api.absence_reports._resolve_absent_attendance", return_value=(8000000000000000001, "occ-synthetic")), \
             patch("learner_api.absence_reports.learner_profile_for_source", return_value=profile), \
             patch("learner_api.absence_reports.timezone.localtime",
                   return_value=datetime(2026, 10, 20, 9, tzinfo=timezone.utc)), \
             patch("learner_api.absence_reports.CoachAbsenceReport.objects") as reports, \
             patch("learner_api.absence_reports.record_reported_absence") as ledger, \
             patch("learner_api.absence_reports._recording_recovery_event") as recording, \
             patch("learner_api.absence_reports.transaction.atomic",
                   return_value=failed_commit() if stage == "commit" else nullcontext()), \
             patch("learner_api.absence_reports._send_after_commit") as notify, \
             patch("learner_api.absence_reports._serialize", return_value={"id": 7}):
            reports.filter.return_value.exists.return_value = False
            reports.filter.return_value.count.return_value = 0
            reports.filter.return_value.first.return_value = duplicate
            reports.create.return_value = SimpleNamespace(id=7)
            if stage == "report":
                reports.create.side_effect = error
            elif stage == "link":
                ledger.side_effect = error
            elif stage == "recording":
                recording.side_effect = error
            response = inspect.unwrap(learner_absence_reports)(request, "apprenticeship", 12)
        notify.assert_not_called()
        return response, ledger, recording

    def test_database_failure_identifies_its_stage_without_disclosing_private_values(self):
        for stage, tag in (("report", "RPT"), ("link", "LINK"), ("recording", "PLAN"), ("commit", "COMMIT")):
            with self.subTest(stage=stage), self.assertLogs("learner_api.absence_reports", "ERROR") as logs:
                response, ledger, recording = self.submit(stage, database_failure(OperationalError, "08006"))
            self.assertEqual(response.status_code, 502)
            payload = json.loads(response.content)
            self.assertEqual(payload["error"], "The absence report could not be saved. Please retry.")
            self.assertRegex(payload["reference"], rf"^ABS-{tag}-08006-[A-F0-9]{{12}}$")
            self.assertEqual(payload["code"], "absence_report_save_failed")
            logged = "\n".join(logs.output)
            self.assertIn(payload["reference"], logged)
            self.assertIn("OperationalError", logged)
            self.assertIn("report_check", logged)
            self.assertNotIn("learner@example.test", logged + response.content.decode())
            self.assertNotIn("private learner reason", logged + response.content.decode())
            self.assertNotIn("password=secret", logged + response.content.decode())
            self.assertIsNone(logs.records[0].exc_info)
            if stage == "report":
                ledger.assert_not_called()
                recording.assert_not_called()
            elif stage == "link":
                recording.assert_not_called()

    def test_constraint_failure_without_duplicate_gets_a_reference(self):
        with self.assertLogs("learner_api.absence_reports", "ERROR"):
            response, _, _ = self.submit("report", database_failure(IntegrityError, "23514"))
        self.assertEqual(response.status_code, 502)
        self.assertRegex(json.loads(response.content)["reference"], r"^ABS-RPT-23514-[A-F0-9]{12}$")

    def test_successful_duplicate_recovery_is_not_reported_as_a_save_failure(self):
        response, _, _ = self.submit(
            "report", database_failure(IntegrityError, "23505"),
            duplicate=SimpleNamespace(id=7, learner_id=12),
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content), {"id": 7})

    def test_application_exception_has_no_fabricated_database_code(self):
        with self.assertLogs("learner_api.absence_reports", "ERROR") as logs:
            response, _, _ = self.submit("recording", ValueError("sensitive text"))
        self.assertRegex(json.loads(response.content)["reference"], r"^ABS-PLAN-APP-[A-F0-9]{12}$")
        self.assertNotIn("sensitive text", "\n".join(logs.output))
