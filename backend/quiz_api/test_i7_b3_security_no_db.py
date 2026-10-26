import ast
import json
import os
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, call, patch

from django.db import DatabaseError
from django.http import Http404
from django.test import RequestFactory, SimpleTestCase

from login.api_gate import refusal_for
from quiz_api import views


QUIZ_STUDENTS_PATH = "/quiz_api/quizzes/17/students/"


class QuizStudentsSafeErrorTests(SimpleTestCase):
    databases = set()

    def setUp(self):
        self.factory = RequestFactory()

    def test_database_errors_return_a_stable_502_without_disclosing_details(self):
        database_errors = (
            'syntax error at or near "SELECT" in curriculum.secret_quiz_table',
            "password=super-secret postgresql://admin:secret@example.test/neondb token=abc123",
        )

        for database_error in database_errors:
            with self.subTest(database_error=database_error), patch(
                "quiz_api.views.QuizPackage.objects.get",
                return_value=SimpleNamespace(id=17),
            ), patch(
                "quiz_api.views._quiz_question_lookup",
                side_effect=DatabaseError(database_error),
            ), patch("quiz_api.views.logger.error") as log_error:
                response = views.quiz_students(
                    self.factory.get(QUIZ_STUDENTS_PATH),
                    17,
                )

                self.assertEqual(response.status_code, 502)
                self.assertEqual(
                    json.loads(response.content),
                    {"error": views.QUIZ_STUDENTS_DATABASE_ERROR},
                )
                self.assertNotIn(database_error, response.content.decode())
                log_error.assert_called_once_with(
                    "Quiz Students database query failed",
                    extra={"quiz_id": 17, "exception_type": "DatabaseError"},
                )
                self.assertNotIn(database_error, str(log_error.call_args))

    @patch(
        "quiz_api.views.QuizPackage.objects.get",
        side_effect=views.QuizPackage.DoesNotExist,
    )
    def test_missing_quiz_keeps_the_existing_404_contract(self, _quiz_get):
        with self.assertRaisesMessage(Http404, "Quiz not found"):
            views.quiz_students(self.factory.get(QUIZ_STUDENTS_PATH), 17)


class QuizStudentsAuthorizationTests(SimpleTestCase):
    databases = set()

    def _refusal(self, account):
        with patch.dict(os.environ, {"API_REQUIRE_AUTH": "1"}, clear=False):
            return refusal_for(QUIZ_STUDENTS_PATH, account)

    def test_anonymous_callers_remain_unauthenticated(self):
        refusal = self._refusal(None)

        self.assertEqual(refusal.status_code, 401)
        self.assertEqual(json.loads(refusal.content)["code"], "unauthenticated")

    def test_learner_and_employer_callers_remain_forbidden(self):
        for role in ("learner", "employer"):
            with self.subTest(role=role):
                refusal = self._refusal(SimpleNamespace(role=role))
                self.assertEqual(refusal.status_code, 403)
                self.assertEqual(json.loads(refusal.content)["code"], "forbidden")

    @patch("learner_api.programme_access.refusal", return_value=None)
    @patch("old_otjh.gate.refusal", return_value=None)
    def test_staff_and_admin_callers_remain_authorized(
        self,
        _transition_refusal,
        _programme_refusal,
    ):
        for role in ("staff", "admin"):
            with self.subTest(role=role):
                self.assertIsNone(self._refusal(SimpleNamespace(role=role)))


class CurriculumHelperCleanupTests(SimpleTestCase):
    databases = set()

    def tearDown(self):
        views.curriculum_schema_gate.reset_verification_cache()
        views._CURRICULUM_COLUMNS_BY_TABLE.clear()
        super().tearDown()

    def test_targeted_helpers_each_have_one_active_definition(self):
        tree = ast.parse(Path(views.__file__).read_text(encoding="utf-8"))
        definitions = [
            node.name
            for node in tree.body
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        ]

        for helper_name in (
            "_quote_ident",
            "_curriculum_table_name",
            "_curriculum_table_exists",
            "_curriculum_column_exists",
        ):
            with self.subTest(helper_name=helper_name):
                self.assertEqual(definitions.count(helper_name), 1)

    def test_identifier_and_curriculum_table_contracts_are_unchanged(self):
        self.assertEqual(views._quote_ident('a"b'), '"a""b"')
        self.assertEqual(
            views._curriculum_table_name('a"b'),
            'curriculum."a""b"',
        )

    def test_curriculum_table_probe_uses_the_shared_schema_gate(self):
        with patch.object(views.curriculum_schema_gate, "table_exists", return_value=True) as probe:
            self.assertTrue(views._curriculum_table_exists("quizzes"))
            self.assertTrue(views._curriculum_table_exists("quizzes"))

        self.assertEqual(probe.call_args_list, [call("quizzes"), call("quizzes")])

    def test_failed_curriculum_table_probe_is_not_misreported_as_absent(self):
        with (
            patch.object(
                views.curriculum_schema_gate,
                "table_exists",
                side_effect=DatabaseError("unavailable"),
            ),
            self.assertRaises(DatabaseError),
        ):
            views._curriculum_table_exists("quizzes")

    def test_curriculum_columns_are_loaded_once_per_table(self):
        cursor = MagicMock()
        cursor.fetchall.return_value = [("programme_id",), ("title",)]
        mock_connection = MagicMock()
        mock_connection.cursor.return_value.__enter__.return_value = cursor

        with patch.object(views, "connection", mock_connection):
            self.assertTrue(views._curriculum_column_exists("modules", "title"))
            self.assertFalse(views._curriculum_column_exists("modules", "missing"))

        mock_connection.cursor.assert_called_once_with()
        cursor.execute.assert_called_once_with(
            """
                select column_name
                from information_schema.columns
                where table_schema = 'curriculum'
                  and table_name = %s
                """,
            ["modules"],
        )

    def test_failed_curriculum_column_probe_propagates_database_error(self):
        mock_connection = MagicMock()
        mock_connection.cursor.side_effect = DatabaseError("unavailable")
        with (
            patch.object(views, "connection", mock_connection),
            self.assertRaises(DatabaseError),
        ):
            views._curriculum_column_exists("modules", "title")
