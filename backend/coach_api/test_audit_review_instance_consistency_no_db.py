"""No-database checks for the permanent Review consistency audit.

Run: python -I backend/coach_api/test_audit_review_instance_consistency_no_db.py

The first class is static (shape of the source). The second EXECUTES the
command's real ``handle()`` against a recording fake cursor, so the SQL and its
bound parameters are exercised rather than grepped -- that is what catches a
parameter whose Python type contradicts its SQL cast, the
``operator does not exist: text = smallint`` class of failure.
"""

import ast
import re
import sys
import unittest

from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock


BACKEND = Path(__file__).resolve().parents[1]
SOURCE = BACKEND / "coach_api/management/commands/audit_review_instance_consistency.py"

#: A ``%s`` placeholder, optionally followed by an explicit array cast.
PLACEHOLDER = re.compile(r"%s(?:::(\w+)\[\])?")


class ReviewConsistencyAuditSafetyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = SOURCE.read_text(encoding="utf-8-sig")
        cls.tree = ast.parse(cls.source)

    def test_command_contains_no_database_write_sql(self):
        sql_text = "\n".join(
            node.value.lower()
            for node in ast.walk(self.tree)
            if isinstance(node, ast.Constant) and isinstance(node.value, str)
        )
        for statement in ("insert into", "update ", "delete from", "truncate ", "alter table"):
            with self.subTest(statement=statement):
                self.assertNotIn(statement, sql_text)

    def test_confirmed_and_candidate_test_data_are_separate(self):
        self.assertIn("CONFIRMED_TEST_CALENDAR_IDS", self.source)
        self.assertIn("TEST_CANDIDATE_CALENDAR_IDS", self.source)
        self.assertIn("TEST_CANDIDATE_REVIEW_REQUIRED", self.source)

    def test_technical_findings_precede_test_labels(self):
        self.assertLess(
            self.source.index("REAL_RECONCILIATION_REQUIRED"),
            self.source.index("TEST_CANDIDATE_REVIEW_REQUIRED"),
        )
        self.assertIn("data_classification", self.source)
        self.assertIn("OFFICIAL_EVENTS_TO_PRESERVE", self.source)

    def test_required_audit_categories_are_present(self):
        for category in (
            "REAL_STATUS_MISMATCH",
            "REAL_RECONCILIATION_REQUIRED",
            "OK_APPROVED_LEGACY_TARGET",
            "ORPHAN_ACTIVE_INSTANCE_WITHOUT_CALENDAR",
            "ORPHAN_ANSWERS",
            "ORPHAN_SIGNATURES",
            "ORPHAN_ATTENDANCE",
            "MISSING_ASSIGNMENT_MEETINGS",
            "DUPLICATE_INSTANCE_IDENTITY",
            "EXTERNAL_RECONCILIATION_REQUIRED",
        ):
            with self.subTest(category=category):
                self.assertIn(category, self.source)

    def test_output_does_not_select_names_or_emails(self):
        self.assertNotIn("learner_name", self.source)
        self.assertNotIn("learner_email", self.source)


class RecordingCursor:
    """Executes nothing; records SQL + params and replays canned result sets."""

    def __init__(self, canned):
        self.canned = list(canned)
        self.calls = []
        self.description = None
        self._rows = []

    def execute(self, sql, params=None):
        self.calls.append((sql, params))
        normalised = " ".join(sql.lower().split())
        if normalised.startswith("select to_regclass"):
            self.description = [("to_regclass",)]
            self._rows = [("present",)]
            return
        if self.canned:
            columns, rows = self.canned.pop(0)
        elif normalised.startswith("select count("):
            # Aggregates are read with fetchone()[0].
            columns, rows = [("count",)], [(0,)]
        else:
            # Row queries are read with _rows(cursor); an empty set exercises
            # the SQL without needing to know its shape.
            columns, rows = [("placeholder",)], []
        self.description = columns
        self._rows = list(rows)

    def fetchone(self):
        return self._rows[0] if self._rows else None

    def fetchall(self):
        return list(self._rows)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def load_command(canned):
    """Load the real Command class with Django's surface faked out."""
    source = SOURCE.read_text(encoding="utf-8-sig")
    tree = ast.parse(source)
    body = [
        node for node in tree.body
        if not isinstance(node, (ast.Import, ast.ImportFrom))
    ]

    class CommandError(Exception):
        pass

    class BaseCommand:
        def __init__(self):
            self.stdout = SimpleNamespace(write=Mock())
            self.style = SimpleNamespace(
                WARNING=lambda value: value, SUCCESS=lambda value: value,
            )

    cursor = RecordingCursor(canned)
    namespace = {
        "BaseCommand": BaseCommand,
        "CommandError": CommandError,
        "CoachCalendarEvent": SimpleNamespace,
        "router": SimpleNamespace(db_for_read=lambda model: "default"),
        "connections": {"default": SimpleNamespace(cursor=lambda: cursor)},
        "OFFICIAL_EVENTS_TO_PRESERVE": frozenset({154, 160}),
    }
    exec(compile(ast.Module(body=body, type_ignores=[]), str(SOURCE), "exec"), namespace)
    return namespace, cursor, CommandError


class ReviewConsistencyAuditExecutionTests(unittest.TestCase):
    """Runs handle() for real and inspects every statement it issued."""

    def run_audit(self, canned=()):
        namespace, cursor, command_error = load_command(canned)
        command = namespace["Command"]()
        raised = None
        try:
            command.handle()
        except command_error as exc:
            raised = exc
        return namespace, cursor, raised

    def test_every_bound_parameter_matches_its_sql_cast(self):
        """An int[] cast must receive ints and a text[] cast must receive strs.

        Event 138's audit previously bound calendar learner ids (248, 647) into
        a comparison against a character-varying submission column, which
        Postgres rejects outright.
        """
        _namespace, cursor, _raised = self.run_audit()
        checked = 0
        for sql, params in cursor.calls:
            if not params or not isinstance(params, (list, tuple)):
                continue
            casts = PLACEHOLDER.findall(sql)
            if len(casts) != len(params):
                continue
            for cast, value in zip(casts, params):
                if not cast or not isinstance(value, (list, tuple)):
                    continue
                checked += 1
                with self.subTest(cast=cast, value=value):
                    if cast in {"int", "integer", "bigint", "smallint"}:
                        self.assertTrue(
                            all(isinstance(item, int) for item in value),
                            f"{cast}[] cast bound to non-int values: {value!r}",
                        )
                    elif cast in {"text", "varchar"}:
                        self.assertTrue(
                            all(isinstance(item, str) for item in value),
                            f"{cast}[] cast bound to non-str values: {value!r}",
                        )
        self.assertGreater(checked, 0, "no cast/parameter pairs were exercised")

    def test_submission_queries_never_bind_calendar_learner_ids(self):
        namespace, cursor, _raised = self.run_audit()
        calendar_ids = {
            str(value)
            for value in namespace["CONFIRMED_TEST_LEARNER_IDS"]
            | namespace["TEST_CANDIDATE_LEARNER_IDS"]
        }
        for sql, params in cursor.calls:
            if "learning_reflection_submissions" not in sql or not params:
                continue
            for value in params:
                if not isinstance(value, (list, tuple)):
                    continue
                with self.subTest(sql=sql[:60]):
                    self.assertFalse(
                        calendar_ids & {str(item) for item in value},
                        f"calendar-space learner id bound to a submission query: {value!r}",
                    )

    def test_id_space_constants_are_typed_apart(self):
        namespace, _cursor, _raised = self.run_audit()
        for name in ("CONFIRMED_TEST_LEARNER_IDS", "TEST_CANDIDATE_LEARNER_IDS",
                     "CONFIRMED_TEST_CALENDAR_IDS", "TEST_CANDIDATE_CALENDAR_IDS"):
            with self.subTest(name=name):
                self.assertTrue(all(isinstance(v, int) for v in namespace[name]))
        for name in ("CONFIRMED_TEST_SUBMISSION_LEARNER_IDS",
                     "TEST_CANDIDATE_SUBMISSION_LEARNER_IDS"):
            with self.subTest(name=name):
                self.assertTrue(all(isinstance(v, str) for v in namespace[name]))
        self.assertEqual(namespace["CONFIRMED_TEST_SUBMISSION_LEARNER_IDS"], frozenset({"499"}))
        self.assertEqual(
            namespace["TEST_CANDIDATE_SUBMISSION_LEARNER_IDS"], frozenset({"101", "501"}),
        )

    def test_audit_issues_no_write_statements(self):
        _namespace, cursor, _raised = self.run_audit()
        for sql, _params in cursor.calls:
            lowered = " ".join(sql.lower().split())
            for statement in ("insert into", "update ", "delete from", "truncate ", "alter table"):
                with self.subTest(statement=statement):
                    self.assertNotIn(statement, lowered)

    def test_test_candidates_alone_do_not_fail_the_audit(self):
        calendar_columns = [
            ("calendar_id",), ("learner_id",), ("event_type",), ("calendar_status",),
            ("sync_state",), ("calendar_template_id",), ("calendar_instance_id",),
            ("instance_id",), ("instance_status",), ("classification",),
            ("data_classification",),
        ]
        instance_columns = [
            ("instance_id",), ("learner_id",), ("instance_status",),
            ("calendar_event_id",), ("calendar_id",), ("calendar_status",),
            ("classification",), ("data_classification",),
        ]
        canned = [
            ([("event_type",), ("calendar_status",), ("instance_status",), ("rows",)], []),
            (calendar_columns, [(
                161, 248, "mcr", "scheduled", "synced", "REV-1", "REVI-1",
                "REVI-1", "scheduled", "TEST_CANDIDATE_REVIEW_REQUIRED", "TEST_CANDIDATE",
            )]),
            (instance_columns, [(
                "REVI-1", 248, "scheduled", 161, 161, "scheduled",
                "TEST_CANDIDATE_REVIEW_REQUIRED", "TEST_CANDIDATE",
            )]),
            ([("count",)], [(0,)]),  # ORPHAN_ANSWERS
            ([("count",)], [(0,)]),  # ORPHAN_SIGNATURES
            ([("count",)], [(0,)]),  # ORPHAN_MANUAL_OVERRIDES
            ([("count",)], [(0,)]),  # DUPLICATE_INSTANCE_IDENTITY
            ([("count",)], [(0,)]),  # ORPHAN_ATTENDANCE
            ([("count",)], [(0,)]),  # MISSING_ASSIGNMENT_MEETINGS
            ([("submission_id",), ("submission_learner_id",), ("status",),
              ("meeting_key",), ("referenced_calendar_id",),
              ("referenced_calendar_learner_id",), ("data_classification",)], []),
            ([("calendar_id",), ("learner_id",), ("event_type",), ("event_key",),
              ("target_date",), ("scheduled_date",), ("scheduled_time",), ("status",),
              ("sync_state",), ("instance_id",)], []),
        ]
        _namespace, _cursor, raised = self.run_audit(canned)
        self.assertIsNone(raised, f"test candidates alone must not fail: {raised}")

    def test_a_real_finding_on_test_data_still_fails_the_audit(self):
        """Technical classification is independent of data_classification."""
        calendar_columns = [
            ("calendar_id",), ("learner_id",), ("event_type",), ("calendar_status",),
            ("sync_state",), ("calendar_template_id",), ("calendar_instance_id",),
            ("instance_id",), ("instance_status",), ("classification",),
            ("data_classification",),
        ]
        canned = [
            ([("event_type",), ("calendar_status",), ("instance_status",), ("rows",)], []),
            (calendar_columns, [(
                134, 248, "mcr", "completed", "synced", None, None,
                None, None, "REAL_RECONCILIATION_REQUIRED", "TEST_CANDIDATE",
            )]),
        ]
        _namespace, _cursor, raised = self.run_audit(canned)
        self.assertIsNotNone(raised, "a REAL_ finding must fail even on Test data")
        self.assertIn("REAL_RECONCILIATION_REQUIRED", str(raised))


if __name__ == "__main__":
    if not sys.flags.isolated:
        raise RuntimeError("Run with python -I to avoid application imports.")
    unittest.main()
