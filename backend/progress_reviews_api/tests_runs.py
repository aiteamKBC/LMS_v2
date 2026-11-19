from datetime import date
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from . import runs


def _connection_with_cursor():
    connection = MagicMock()
    cursor = MagicMock()
    connection.cursor.return_value.__enter__.return_value = cursor
    return connection, cursor


class CanonicalRunSqlTests(SimpleTestCase):
    @patch("progress_reviews_api.runs._record_run")
    @patch("progress_reviews_api.runs.ensure_progress_review_tables")
    @patch("progress_reviews_api.runs._conn")
    def test_create_run_writes_only_the_canonical_learner_id(self, connection, _ensure, _record):
        db, cursor = _connection_with_cursor()
        connection.return_value = db
        period = SimpleNamespace(
            review_number=2,
            review_date=date(2026, 10, 26),
            review_period_start=date(2026, 8, 4),
            review_period_end=date(2026, 10, 26),
            action_period_start=date(2026, 10, 27),
            action_period_end=date(2027, 1, 18),
        )

        runs.create_run(
            run_id="run-1",
            learner_kind="apprenticeship",
            learner_id=501,
            period=period,
            generated_by="coach@example.invalid",
        )

        sql, params = cursor.execute.call_args.args
        normalised = " ".join(sql.split())
        self.assertIn("id, learner_kind, learner_id, review_number", normalised)
        self.assertNotIn("learner_profile_id", normalised)
        self.assertEqual(params[2], 501)
        self.assertEqual(sql.count("%s"), len(params))

    @patch("progress_reviews_api.runs.ensure_progress_review_tables")
    @patch("progress_reviews_api.runs._conn")
    def test_latest_run_filters_by_canonical_learner_id(self, connection, _ensure):
        db, cursor = _connection_with_cursor()
        connection.return_value = db
        cursor.fetchone.return_value = None

        runs.get_latest_completed_run_for_period(501, date(2026, 10, 26))

        sql, params = cursor.execute.call_args.args
        self.assertIn("where learner_id = %s", " ".join(sql.split()))
        self.assertEqual(params[0], 501)
        self.assertNotIn("learner_profile_id", " ".join(sql.split()))

    @patch("progress_reviews_api.runs.ensure_progress_review_tables")
    @patch("progress_reviews_api.runs._conn")
    def test_list_runs_filters_by_canonical_learner_id(self, connection, _ensure):
        db, cursor = _connection_with_cursor()
        connection.return_value = db
        cursor.description = [("id",)]
        cursor.fetchall.return_value = []

        runs.list_runs_for_learner(501)

        sql, params = cursor.execute.call_args.args
        self.assertIn("where learner_id = %s", " ".join(sql.split()))
        self.assertEqual(params, [501, 20])

    @patch("progress_reviews_api.runs.ensure_progress_review_tables")
    @patch("progress_reviews_api.runs._conn")
    def test_get_run_returns_only_the_canonical_identity_column(self, connection, _ensure):
        db, cursor = _connection_with_cursor()
        connection.return_value = db
        cursor.description = [
            ("id",), ("learner_kind",), ("learner_id",),
        ]
        cursor.fetchone.return_value = ("run-1", "apprenticeship", 501)

        row = runs.get_run("run-1")

        sql = cursor.execute.call_args.args[0]
        self.assertIn("learner_kind, learner_id, review_number", " ".join(sql.split()))
        self.assertNotIn("learner_profile_id", " ".join(sql.split()))
        self.assertEqual(row["learner_id"], 501)
