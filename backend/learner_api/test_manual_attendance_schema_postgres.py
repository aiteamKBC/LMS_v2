"""Read-only normalized PostgreSQL regression for manual attendance reads."""
import os
import re
import unittest
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import patch

from django.conf import settings
from django.db import connections, transaction
from django.test.utils import CaptureQueriesContext

from .manual_attendance_completion import read_manual_context


RUN_TEST = os.environ.get("RUN_NORMALIZED_SCHEMA_POSTGRES_TESTS", "").strip() == "1"
EXPECTED_ENDPOINT = os.environ.get("LEARNER_NORMALIZED_SCHEMA_EXPECTED_ENDPOINT", "").strip()
WRITE_SQL = re.compile(
    r"^\s*(?:insert|update|delete|merge|create|alter|drop|truncate|grant|revoke|comment|vacuum|reindex|cluster|refresh|call|do)\b",
    re.IGNORECASE,
)


class _ReadOnlyGuard:
    def __call__(self, execute, sql, params, many, context):
        if WRITE_SQL.match(sql or "") or re.search(r"\bfor\s+(?:update|share)\b", sql or "", re.IGNORECASE):
            raise AssertionError(f"Write SQL is forbidden in this regression: {(sql or '')[:120]}")
        return execute(sql, params, many, context)


@unittest.skipUnless(
    RUN_TEST and EXPECTED_ENDPOINT,
    "Set RUN_NORMALIZED_SCHEMA_POSTGRES_TESTS=1 and the expected Development endpoint.",
)
class ManualAttendanceNormalizedSchemaPostgresTests(unittest.TestCase):
    def test_conditional_reader_uses_normalized_component_status(self):
        config = settings.DATABASES["enrolment"]
        self.assertEqual(str(config.get("HOST") or "").split(".")[0], EXPECTED_ENDPOINT)

        with ExitStack() as stack:
            stack.enter_context(transaction.atomic(using="enrolment"))
            connection = connections["enrolment"]
            with connection.cursor() as cursor:
                cursor.execute("SET LOCAL transaction_read_only=on")
                cursor.execute("SHOW transaction_read_only")
                self.assertEqual(cursor.fetchone()[0], "on")
                cursor.execute(
                    """SELECT column_name FROM information_schema.columns
                         WHERE table_schema='curriculum' AND table_name='components'
                           AND column_name=ANY(%s) ORDER BY column_name""",
                    [["deleted_at", "is_programme_deleted", "deleted_via_parent"]],
                )
                self.assertEqual(cursor.fetchall(), [])
                cursor.execute(
                    """SELECT l.id,l.enrolment_id,l.email,c.id,c.module_catalogue_id
                         FROM "Learner".learners l
                         JOIN "Coach".coach_attendance_adjustment a ON a.learner_id=l.id
                         JOIN "Learner".learner_training_plan_modules pm ON pm.learner_id=l.id
                         JOIN curriculum.components c
                           ON c.module_catalogue_id=pm.curriculum_module_id
                        WHERE l.learner_type='commercial'
                          AND l.enrolment_id IS NOT NULL
                          AND lower(replace(c.type,'-','_'))='live_session'
                          AND lower(btrim(coalesce(c.status,''))) <> 'inactive'
                        ORDER BY l.id,c.id LIMIT 1"""
                )
                row = cursor.fetchone()
            self.assertIsNotNone(row, "Development needs one commercial adjustment with an assigned live component")

            profile_id, enrolment_id, email, component_id, module_id = row
            profile = SimpleNamespace(pk=profile_id, enrolment_id=enrolment_id, email=email,
                                      learner_type="commercial")
            candidate = [{"componentId": str(component_id), "moduleId": str(module_id)}]
            stack.enter_context(connection.execute_wrapper(_ReadOnlyGuard()))
            stack.enter_context(patch("learner_api.attendance_lectures.read_native_occurrences", return_value=[]))
            with CaptureQueriesContext(connection) as queries:
                states, components, occurrences = read_manual_context(candidate, profile)

        component_sql = [q["sql"] for q in queries.captured_queries
                         if 'curriculum"."components' in q["sql"]]
        self.assertTrue(component_sql)
        self.assertTrue(all('"status"' in sql for sql in component_sql))
        for removed in ("deleted_at", "is_programme_deleted", "deleted_via_parent"):
            self.assertTrue(all(removed not in sql for sql in component_sql))
        self.assertTrue(components)
        self.assertEqual(occurrences, [])
        self.assertIsInstance(states, dict)


if __name__ == "__main__":
    unittest.main()
