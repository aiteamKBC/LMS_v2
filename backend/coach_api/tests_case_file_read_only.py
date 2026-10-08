"""Case File attendance reads must not settle/write catch-up outcomes."""
import inspect
import json
from types import SimpleNamespace
from unittest.mock import patch
from django.test import RequestFactory, SimpleTestCase
from learner_api.attendance import learner_attendance

class CaseFileAttendanceReadOnlyTests(SimpleTestCase):
    def test_case_file_skips_settlement_but_student_retains_it(self):
        source = SimpleNamespace(id=201, email="learner@example.test")
        for case_file in (True, False):
            with self.subTest(case_file=case_file):
                request = RequestFactory().get("/")
                if case_file:
                    request._case_file_context = SimpleNamespace(request=SimpleNamespace(path="/coach/case-file/101/overview"))
                with patch("learner_api.case_file_sources.source_for_case_file", return_value=source), \
                     patch("learner_api.catchup_outcomes.sync_catchup_outcomes") as sync, \
                     patch("learner_api.attendance_lectures.lecture_register", return_value=[{"session_id": "stored-occurrence"}]) as register, \
                     patch("learner_api.attendance._summarize_attendance", return_value={"sessions": 1, "present": 1}) as summarize:
                    response = inspect.unwrap(learner_attendance)(request, "apprenticeship", 201)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(json.loads(response.content), {"attendance": {"sessions": 1, "present": 1}})
                register.assert_called_once_with(source)
                summarize.assert_called_once_with([{"session_id": "stored-occurrence"}], overview_only=case_file)
                if case_file:
                    sync.assert_not_called()
                else:
                    sync.assert_called_once_with(learner_email="learner@example.test")

    def test_attendance_read_rejects_mutation_methods(self):
        with patch("learner_api.case_file_sources.source_for_case_file") as lookup:
            for method in ("POST", "PUT", "PATCH", "DELETE"):
                response = inspect.unwrap(learner_attendance)(RequestFactory().generic(method, "/"), "commercial", 201)
                self.assertEqual(response.status_code, 405)
            lookup.assert_not_called()
