"""DB-free safety tests for the temporary Upcoming 503 file diagnostic."""
import inspect
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
from unittest.mock import patch

from django.db import OperationalError, ProgrammingError
from django.test import RequestFactory, SimpleTestCase, override_settings

from . import training_plan_dashboard as dashboard
from . import upcoming_503_diagnostic as diagnostic


SECRET = "password=synthetic-secret host=db.internal person@example.test token=abc"
GENERIC = {"error": "Could not load your training plan. Please try again."}


class DriverError(Exception):
    def __init__(self, sqlstate, primary):
        super().__init__(f"{primary} {SECRET}")
        self.sqlstate = sqlstate
        self.diag = SimpleNamespace(message_primary=primary)


def database_failure(wrapper, sqlstate, primary):
    try:
        raise DriverError(sqlstate, primary)
    except DriverError as cause:
        try:
            raise wrapper(f"{primary} {SECRET}") from cause
        except wrapper as error:
            return error


class Measurement:
    failed_stage = "upcoming"
    current_stage = "source"

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def stage(self, _name):
        return self


@override_settings(DEBUG=True)
class Upcoming503DiagnosticTests(SimpleTestCase):
    def setUp(self):
        super().setUp()
        self.temp = self.enterContext(tempfile.TemporaryDirectory())

    def capture(self, error, *, enabled=True, pid=7357):
        environment = {diagnostic._ENABLE_ENV: "1"} if enabled else {}
        with patch.dict(os.environ, environment, clear=True), \
             patch.object(diagnostic.tempfile, "gettempdir", return_value=self.temp), \
             patch.object(diagnostic.os, "getpid", return_value=pid):
            path = diagnostic.capture_upcoming_database_error(error, stage="upcoming")
        return path

    def test_disabled_by_default_creates_no_file(self):
        error = database_failure(ProgrammingError, "42703", "column c.deleted_at does not exist")
        self.assertIsNone(self.capture(error, enabled=False))
        self.assertEqual(list(Path(self.temp).rglob("*")), [])

    @override_settings(DEBUG=False)
    def test_enabled_flag_still_does_nothing_outside_debug(self):
        error = database_failure(ProgrammingError, "42703", "column c.deleted_at does not exist")
        self.assertIsNone(self.capture(error))
        self.assertEqual(list(Path(self.temp).rglob("*")), [])

    def test_schema_error_records_only_the_allowed_diagnostic_fields(self):
        error = database_failure(ProgrammingError, "42703", "column c.deleted_at does not exist")
        path = self.capture(error)
        self.assertEqual(path.name, "upcoming-503-7357.log")
        record = json.loads(path.read_text(encoding="utf-8").split(" ", 2)[2])
        self.assertEqual(record, {
            "event": "learner_upcoming_database_error",
            "exception_class": "ProgrammingError",
            "sqlstate": "42703",
            "stage": "upcoming",
            "location": record["location"],
            "postgres_primary": "column c.deleted_at does not exist",
        })
        self.assertRegex(record["location"], r"test_upcoming_503_diagnostic_no_db\.py:\d+$")
        text = path.read_text(encoding="utf-8")
        for secret in ("synthetic-secret", "db.internal", "person@example.test", "token=abc"):
            self.assertNotIn(secret, text)

    def test_non_schema_error_withholds_postgres_message(self):
        error = database_failure(OperationalError, "08006", "connection to db.internal failed")
        path = self.capture(error)
        record = json.loads(path.read_text(encoding="utf-8").split(" ", 2)[2])
        self.assertNotIn("postgres_primary", record)
        self.assertNotIn("db.internal", path.read_text(encoding="utf-8"))

    def test_schema_message_with_a_user_shaped_identifier_is_withheld(self):
        error = database_failure(ProgrammingError, "42703", 'column "person@example.test" does not exist')
        path = self.capture(error)
        record = json.loads(path.read_text(encoding="utf-8").split(" ", 2)[2])
        self.assertNotIn("postgres_primary", record)
        self.assertNotIn("person@example.test", path.read_text(encoding="utf-8"))

    def test_processes_have_distinct_log_files(self):
        with patch.object(diagnostic.tempfile, "gettempdir", return_value=self.temp):
            self.assertNotEqual(diagnostic.diagnostic_log_path(101), diagnostic.diagnostic_log_path(202))

    def test_endpoint_response_is_unchanged_and_capture_is_upcoming_only(self):
        error = database_failure(ProgrammingError, "42703", "column c.deleted_at does not exist")
        view = inspect.unwrap(dashboard.training_plan_dashboard)
        request = RequestFactory().get("/?section=upcoming")
        with patch.object(dashboard, "measure_projection", return_value=Measurement()), \
             patch("learner_api.case_file_sources.source_for_case_file", return_value=SimpleNamespace(pk=285)), \
             patch.object(dashboard.canonical_learning, "require_profile", return_value={"id": 1}), \
             patch.object(dashboard, "read_dashboard", side_effect=error), \
             patch.object(dashboard, "capture_upcoming_database_error") as capture, \
             self.assertLogs("learner_api.training_plan_dashboard", level="ERROR"):
            response = view(request, "commercial", 285)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(json.loads(response.content), GENERIC)
        capture.assert_called_once_with(error, stage="upcoming")

        request = RequestFactory().get("/?section=overview")
        with patch.object(dashboard, "measure_projection", return_value=Measurement()), \
             patch("learner_api.case_file_sources.source_for_case_file", return_value=SimpleNamespace(pk=285)), \
             patch.object(dashboard.canonical_learning, "require_profile", return_value={"id": 1}), \
             patch.object(dashboard, "read_dashboard", side_effect=error), \
             patch.object(dashboard, "capture_upcoming_database_error") as other_capture, \
             self.assertLogs("learner_api.training_plan_dashboard", level="ERROR"):
            response = view(request, "commercial", 285)
        self.assertEqual(json.loads(response.content), GENERIC)
        other_capture.assert_not_called()
