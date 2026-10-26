"""Database-free collision and failure tests for B4E marking tallies."""

import json
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, patch

from django.db import DatabaseError
from django.test import RequestFactory, SimpleTestCase

from coach_api.selectors.dashboard.marking import dashboard_marking_projection
from coach_api.services.dashboard.context import CoachDashboardContext
from coach_api.views import coach_marking_queue
from learner_api import marking_tally
from learner_api.submission_audit import SUBMISSION_AUDIT_COLUMNS
from login.advanced_admin import learner_submissions


class CursorContext:
    def __init__(self, cursor):
        self.cursor = cursor

    def __enter__(self):
        return self.cursor

    def __exit__(self, exc_type, exc, traceback):
        return False


class ScriptedCursor:
    def __init__(self, results):
        self.results = list(results)
        self.executions = []
        self.current = {}
        self.description = None

    def execute(self, sql, params=None):
        self.executions.append((sql, params))
        self.current = self.results[len(self.executions) - 1]
        self.description = self.current.get("description")

    def fetchall(self):
        return list(self.current.get("all", []))

    def fetchone(self):
        return self.current.get("one")


def canonical_row(**changes):
    row = {
        "requested_enrolment_id": 42,
        "requested_position": 1,
        "account_match_count": 1,
        "id": 901,
        "enrolment_id": 42,
        "aptem_id": "7001",
        "learner_type": "commercial",
        "email": "learner@example.test",
        "account_record_id": 42,
        "account_email": "LEARNER@example.test",
        "account_aptem_id": "007001",
    }
    row.update(changes)
    return row


def connection_for(cursor):
    connection = Mock()
    connection.cursor.return_value = CursorContext(cursor)
    return connection


def audit_row(**changes):
    values = {
        "id": uuid.UUID("00000000-0000-0000-0000-000000000123"),
        "learner_kind": "commercial",
        "learner_id": "42",
        "learner_name": "Synthetic Learner",
        "programme_name": "Synthetic Programme",
        "activity_type": "assignment",
        "activity_id": "activity-1",
        "activity_title": "Activity",
        "module_title": "Module",
        "week_title": "Week",
        "planned_otjh": "1",
        "actual_time_hours": "1",
        "quality_score": 0,
        "status": "accepted",
        "coach_feedback": "",
        "reviewed_by": "Synthetic Coach",
        "reviewed_at": datetime(2026, 10, 24, tzinfo=timezone.utc),
        "submitted_at": datetime(2026, 10, 23, tzinfo=timezone.utc),
        "component_ref": "component-1",
    }
    values.update(changes)
    return tuple(values[column] for column in SUBMISSION_AUDIT_COLUMNS)


class MarkingTallyIdentityTests(SimpleTestCase):
    databases = set()

    def resolve(self, rows, *, learner_kind="commercial", learner_id="42"):
        cursor = ScriptedCursor([{"all": rows}])
        with patch.object(
            marking_tally,
            "connections",
            {"enrolment": connection_for(cursor)},
        ), patch.object(
            marking_tally,
            "refresh_tally",
            return_value={"accepted_assignments": 1},
        ) as refresh:
            result = marking_tally.refresh_tally_for_submission(
                learner_kind,
                learner_id,
            )
        return result, cursor, refresh

    def test_explicit_enrolment_bridge_resolves_with_one_bounded_query(self):
        result, cursor, refresh = self.resolve([canonical_row()])

        self.assertEqual(result, {"accepted_assignments": 1})
        refresh.assert_called_once_with(901)
        self.assertEqual(len(cursor.executions), 1)
        sql, params = cursor.executions[0]
        normalized_sql = " ".join(sql.lower().split())
        self.assertIn("l.enrolment_id=accounts.account_record_id", normalized_sql)
        self.assertNotIn("id::text =", normalized_sql)
        self.assertNotIn("order by id limit 1", normalized_sql)
        self.assertEqual([[int(value) for value in params[0]]], [[42]])

    def test_numeric_profile_collision_never_selects_equal_profile_pk(self):
        result, cursor, refresh = self.resolve([canonical_row(id=901)])

        refresh.assert_called_once_with(901)
        self.assertEqual(result, {"accepted_assignments": 1})
        sql = cursor.executions[0][0].lower()
        self.assertNotIn("where id", sql)
        self.assertNotIn("or enrolment_id", sql)

    def test_two_explicit_profiles_fail_closed_without_refresh(self):
        rows = [canonical_row(id=901), canonical_row(id=902)]
        with self.assertLogs("learner_api.marking_tally", level="WARNING") as logs:
            result, _cursor, refresh = self.resolve(rows)

        self.assertIsNone(result)
        refresh.assert_not_called()
        self.assertIn("reason=identity_ambiguous", " ".join(logs.output))

    def test_missing_profile_and_wrong_namespace_fail_closed(self):
        for learner_id in ("42", "901"):
            with self.subTest(learner_id=learner_id):
                with self.assertLogs("learner_api.marking_tally", level="WARNING"):
                    result, cursor, refresh = self.resolve([], learner_id=learner_id)
                self.assertIsNone(result)
                refresh.assert_not_called()
                requested = cursor.executions[0][1][0]
                self.assertEqual([int(value) for value in requested], [int(learner_id)])

    def test_email_and_aptem_mismatches_fail_closed(self):
        for changes in (
            {"account_email": "different@example.test"},
            {"account_aptem_id": "9999"},
        ):
            with self.subTest(changes=changes):
                with self.assertLogs("learner_api.marking_tally", level="WARNING") as logs:
                    result, _cursor, refresh = self.resolve([canonical_row(**changes)])
                self.assertIsNone(result)
                refresh.assert_not_called()
                self.assertIn("reason=identity_mismatch", " ".join(logs.output))

    def test_learner_kind_mismatch_and_noncanonical_id_fail_closed(self):
        with self.assertLogs("learner_api.marking_tally", level="WARNING") as logs:
            result, _cursor, refresh = self.resolve(
                [canonical_row()],
                learner_kind="apprenticeship",
            )
        self.assertIsNone(result)
        refresh.assert_not_called()
        self.assertIn("reason=identity_kind_mismatch", " ".join(logs.output))

        for invalid in ("042", " 42 ", "profile:42", "", None, -1):
            with self.subTest(invalid=invalid), self.assertLogs(
                "learner_api.marking_tally",
                level="WARNING",
            ):
                result, cursor, refresh = self.resolve([], learner_id=invalid)
            self.assertIsNone(result)
            self.assertEqual(cursor.executions, [])
            refresh.assert_not_called()

    def test_legacy_profile_keyed_submissions_remain_in_tally_scope(self):
        cursor = ScriptedCursor([{"one": ("901", "42")}])
        self.assertEqual(marking_tally._learner_ids_for_profile(cursor, 901), ["42", "901"])
        sql, params = cursor.executions[0]
        self.assertIn("where id = %s", sql.lower())
        self.assertEqual(params, [901])

    def test_database_diagnostics_are_opaque(self):
        secret_error = 'relation "Learner.private_42" missing password=secret'
        connection = Mock()
        connection.cursor.side_effect = DatabaseError(secret_error)
        with patch.object(
            marking_tally,
            "connections",
            {"enrolment": connection},
        ), patch.object(marking_tally, "refresh_tally") as refresh, self.assertLogs(
            "learner_api.marking_tally",
            level="WARNING",
        ) as logs:
            result = marking_tally.refresh_tally_for_submission("commercial", "42")

        rendered = " ".join(logs.output)
        self.assertIsNone(result)
        refresh.assert_not_called()
        self.assertIn("reason=identity_lookup_unavailable", rendered)
        self.assertNotIn("private_42", rendered)
        self.assertNotIn("password", rendered)
        self.assertNotIn("secret", rendered)
        self.assertNotIn("learner_id", rendered)

    def test_resolution_executes_no_healing_or_write_sql(self):
        _result, cursor, _refresh = self.resolve([canonical_row()])
        statements = [" ".join(sql.lower().split()) for sql, _params in cursor.executions]
        self.assertEqual(len(statements), 1)
        self.assertTrue(statements[0].startswith("with requested"))
        self.assertFalse(any(token in statements[0] for token in (" update ", " insert ", " delete ")))

    def test_full_refresh_remains_four_bounded_sql_operations(self):
        identity_cursor = ScriptedCursor([{"all": [canonical_row()]}])
        aggregate_cursor = ScriptedCursor([
            {"one": ("901", "42")},
            {"all": [("assignment", "accepted", 2)]},
        ])
        update_cursor = ScriptedCursor([{}])
        connection = Mock()
        connection.cursor.side_effect = [
            CursorContext(identity_cursor),
            CursorContext(aggregate_cursor),
            CursorContext(update_cursor),
        ]

        with patch.object(
            marking_tally,
            "connections",
            {"enrolment": connection},
        ):
            result = marking_tally.refresh_tally_for_submission("commercial", "42")

        self.assertEqual(result["accepted_assignments"], 2)
        self.assertEqual(
            sum(len(cursor.executions) for cursor in (
                identity_cursor,
                aggregate_cursor,
                update_cursor,
            )),
            4,
        )
        update_sql, update_params = update_cursor.executions[0]
        self.assertIn('update "Learner".learners', update_sql)
        self.assertEqual(update_params[-1], 901)


class MarkingDecisionCompatibilityTests(SimpleTestCase):
    databases = set()

    def setUp(self):
        self.factory = RequestFactory()

    def test_authorized_coach_decision_stays_successful_when_tally_is_skipped(self):
        updated = audit_row()
        cursor = ScriptedCursor([{"one": updated}])
        request = self.factory.patch(
            "/coach_api/coach/marking-queue/00000000-0000-0000-0000-000000000123",
            data=json.dumps({"decision": "accepted"}),
            content_type="application/json",
        )
        request.coach_email = "coach@example.test"
        with patch("coach_api.views.LearnerProfile.objects.annotate") as profiles, patch(
            "coach_api.views.connections",
            {"enrolment": connection_for(cursor)},
        ), patch(
            "learner_api.submission_audit.record_submission_row",
        ), patch(
            "learner_api.marking_tally.refresh_tally_for_submission",
            return_value=None,
        ) as refresh:
            profiles.return_value.filter.return_value.values_list.return_value = [42]
            response = coach_marking_queue.__wrapped__.__wrapped__(
                request,
                updated[0],
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content)["status"], "accepted")
        refresh.assert_called_once_with("commercial", "42")
        self.assertEqual(cursor.executions[0][1][-1], ["42"])

    def test_advanced_admin_decision_remains_scoped_to_profile_enrolment_id(self):
        updated = audit_row(reviewed_by="Synthetic Admin (Advanced Admin)")
        cursor = ScriptedCursor([{"one": updated}])
        request = self.factory.patch(
            "/login_api/advanced-admin/learners/901/submissions/123/",
            data=json.dumps({"decision": "accepted"}),
            content_type="application/json",
        )
        request.login_account = SimpleNamespace(
            display_name="Synthetic Admin",
            email="admin@example.test",
        )
        with patch(
            "login.advanced_admin._profile_in_scope",
            return_value=SimpleNamespace(id=901, enrolment_id=42),
        ), patch(
            "login.advanced_admin.connections",
            {"enrolment": connection_for(cursor)},
        ), patch(
            "learner_api.submission_audit.record_submission_row",
        ), patch(
            "learner_api.marking_tally.refresh_tally_for_submission",
            return_value=None,
        ) as refresh:
            response = learner_submissions.__wrapped__(request, 901, "123")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content)["status"], "accepted")
        refresh.assert_called_once_with("commercial", "42")
        self.assertEqual(cursor.executions[0][1][-1], "42")

    def test_dashboard_projection_remains_one_query_and_caseload_scoped(self):
        now = datetime(2026, 10, 24, tzinfo=timezone.utc)
        cursor = ScriptedCursor([{
            "all": [
                ("42", "Owned Learner", 2, now, now),
                ("99", "Outside Caseload", 7, now, now),
            ]
        }])
        profile = SimpleNamespace(
            id=901,
            enrolment_id=42,
            full_name="Owned Learner",
            programme="Programme",
            group_name="Group",
        )
        context = CoachDashboardContext(
            owner_email="coach@example.test",
            today=now.date(),
            rows=[profile],
        )
        with patch(
            "coach_api.selectors.dashboard.marking.connections",
            {"enrolment": connection_for(cursor)},
        ):
            result = dashboard_marking_projection(context)

        self.assertEqual(len(cursor.executions), 1)
        self.assertEqual(cursor.executions[0][1], [["42"]])
        self.assertEqual(result["summary"], {"pendingItems": 2})
        self.assertEqual([item["learnerId"] for item in result["items"]], ["901"])

