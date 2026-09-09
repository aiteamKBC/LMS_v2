"""Database-free tests for the historical modules pilot and ownership gate."""

import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.db import DatabaseError
from django.test import RequestFactory, SimpleTestCase

from learner_api.student_activity import student_activity
from learner_api.student_activity_data import read_student_activity, summarize_activities, read_student_material
from learner_api.student_activity_access import student_activity_available


class StudentActivityTests(SimpleTestCase):
    def test_material_is_membership_scoped_and_omits_grading_keys(self):
        cursor = MagicMock()
        row = dict(learner_name='Anna', title='Quiz', video_iframe_url=None,
                   reading_iframe_url=None, reading_text_body=None, audio_url=None,
                   quiz_body='Brief', quiz_questions=[{'question_body': 'Question',
                       'correct_answer': 'Secret', 'options': [{'option_body': 'A', 'is_correct': True}]}])
        with patch('learner_api.student_activity_data._dict_rows', return_value=[row]):
            result = read_student_material(cursor, 4176, 1, 10)
        self.assertEqual(cursor.execute.call_args.args[1], [4176, 1, 10])
        self.assertEqual(result['questions'], [{'text': 'Question', 'options': ['A']}])
        with patch('learner_api.student_activity_data._dict_rows', return_value=[]):
            self.assertIsNone(read_student_material(cursor, 4176, 2, 10))

    def test_every_valid_aptem_identity_is_eligible(self):
        for value in (92, "4176", " 2030 ", 14183, 999999):
            self.assertTrue(student_activity_available(value))
        for value in (None, "", "Anna Rundell", 0, -1, "4176.0"):
            self.assertFalse(student_activity_available(value))

    def test_missing_hours_are_not_zero_and_shared_activities_count_once(self):
        item = {"source_activity_id": 10, "group_id": 1, "completed": True,
                "hours_mapped": True, "actual": 1.5,
                "planned_hours_mapped": False, "planned": 0}
        payload = summarize_activities([item, {**item, "group_id": 2}])
        self.assertEqual(payload["count"], 2)
        self.assertEqual(payload["unique_activity_count"], 1)
        self.assertEqual(payload["module_count"], 2)
        self.assertEqual(payload["actual_total"], 1.5)
        self.assertIsNone(payload["planned_total"])
        self.assertEqual(payload["mapped_count"], 1)
        self.assertIsNone(summarize_activities([])["actual_total"])

    def test_recorded_zero_is_available(self):
        payload = summarize_activities([{
            "source_activity_id": 10, "group_id": 1, "completed": False,
            "hours_mapped": True, "actual": 0,
            "planned_hours_mapped": True, "planned": 0,
        }])
        self.assertEqual(payload["actual_total"], 0)
        self.assertEqual(payload["planned_total"], 0)
        self.assertEqual(payload["mapped_count"], 1)

    def test_shared_activity_uses_available_hours_even_if_first_placement_is_unmapped(self):
        missing = {"source_activity_id": 10, "group_id": 1, "completed": False,
                   "hours_mapped": False, "actual": 0,
                   "planned_hours_mapped": False, "planned": 0}
        mapped = {**missing, "group_id": 2, "hours_mapped": True, "actual": 1.5}
        self.assertEqual(summarize_activities([missing, mapped])["actual_total"], 1.5)
        self.assertFalse(missing["hours_mapped"])

    def test_reader_uses_pipeline_hours_and_reserved_hours_fallback(self):
        cursor = MagicMock()
        cursor.fetchone.return_value = (623, "Anna Rundell")
        base = {"group_id": 1, "learner_id": 623, "aptem_id": 4176,
                "learner_name": "Anna Rundell", "activity_id": 10,
                "activity_type": "Video", "title": "Lesson", "status": "completed",
                "mapped_seconds": 7200, "otjh_actual": 1.25, "otjh_planned": None}
        with patch("learner_api.student_activity_data._dict_rows", return_value=[base]):
            payload = read_student_activity(cursor, 4176)
        self.assertEqual(payload["actual_total"], 1.25)
        self.assertTrue(payload["activities"][0]["completed"])
        self.assertFalse(payload["activities"][0]["planned_hours_mapped"])
        self.assertNotIn("iframe_url", payload["activities"][0])
        self.assertEqual(cursor.execute.call_args.args[1], [4176])
        with patch("learner_api.student_activity_data._dict_rows", return_value=[{**base, "otjh_actual": None}]):
            self.assertEqual(read_student_activity(cursor, 4176)["actual_total"], 2)

    def test_unknown_audit_identity_is_not_an_empty_success(self):
        cursor = MagicMock()
        cursor.fetchone.return_value = None
        self.assertIsNone(read_student_activity(cursor, 4176))
        self.assertEqual(cursor.execute.call_count, 1)

    def setUp(self):
        self.factory = RequestFactory()
        state_patch = patch('learner_api.student_activity.subject_store.state', return_value={
            'ready': False, 'progress': [], 'history': [], 'covers': {},
        })
        state_patch.start()
        self.addCleanup(state_patch.stop)

    @patch("login.permissions._auth_gate_enabled", return_value=True)
    @patch("login.permissions.authenticate_request")
    def test_learner_cannot_read_another_learners_activity(self, authenticate, _gate):
        authenticate.return_value = SimpleNamespace(role="learner", subject_id=133)
        with patch("learner_api.student_activity.read_student_activity") as reader:
            response = student_activity(self.factory.get("/"), kind="commercial", pk=132)
        self.assertEqual(response.status_code, 404)
        reader.assert_not_called()

    @patch("login.permissions._auth_gate_enabled", return_value=True)
    @patch("login.permissions.authenticate_request")
    def test_identity_resolved_from_enrolment_ignores_query_filters(self, authenticate, _gate):
        authenticate.return_value = SimpleNamespace(role="learner", subject_id=132)
        model = MagicMock()
        model.all_learners.only.return_value.get.return_value = SimpleNamespace(aptem_id="4176")
        expected = {"learner_name": "Anna Rundell", **summarize_activities([])}
        with patch("learner_api.student_activity.SOURCE_MODELS", {"commercial": model}), \
             patch("learner_api.student_activity._connection") as connection, \
             patch("learner_api.student_activity.read_student_activity", return_value=expected) as reader:
            request = self.factory.get("/?aptem_id=92&offset=999&category=attendance")
            response = student_activity(request, kind="commercial", pk=132)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content)["learner_name"], "Anna Rundell")
        model.all_learners.only.return_value.get.assert_called_once_with(pk=132)
        reader.assert_called_once_with(connection.return_value.cursor.return_value.__enter__.return_value, 4176)
        self.assertEqual(request.GET["aptem_id"], "92")

    @patch("login.permissions._auth_gate_enabled", return_value=True)
    @patch("login.permissions.authenticate_request")
    def test_unknown_audit_identity_returns_not_found(self, authenticate, _gate):
        authenticate.return_value = SimpleNamespace(role="staff")
        model = MagicMock()
        model.all_learners.only.return_value.get.return_value = SimpleNamespace(aptem_id="999999")
        with patch("learner_api.student_activity.SOURCE_MODELS", {"commercial": model}), \
             patch("learner_api.student_activity._connection") as connection, \
             patch("learner_api.student_activity.read_student_activity", return_value=None) as reader:
            response = student_activity(self.factory.get("/"), kind="commercial", pk=900)
        self.assertEqual(response.status_code, 404)
        reader.assert_called_once_with(connection.return_value.cursor.return_value.__enter__.return_value, 999999)

    @patch("login.permissions._auth_gate_enabled", return_value=True)
    @patch("login.permissions.authenticate_request")
    def test_audit_database_failure_returns_retryable_response(self, authenticate, _gate):
        authenticate.return_value = SimpleNamespace(role="staff")
        model = MagicMock()
        model.all_learners.only.return_value.get.return_value = SimpleNamespace(aptem_id="4176")
        with patch("learner_api.student_activity.SOURCE_MODELS", {"commercial": model}), \
             patch("learner_api.student_activity._connection", side_effect=DatabaseError("private connection details")):
            response = student_activity(self.factory.get("/"), kind="commercial", pk=132)
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("private connection details", response.content.decode())
