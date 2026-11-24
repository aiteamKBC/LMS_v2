"""Read-only normalized PostgreSQL regression for attendance requirements."""
import os
import re
import unittest
from contextlib import ExitStack
from types import SimpleNamespace

from django.conf import settings
from django.db import connections, transaction

from curriculum_api.week_visibility import visible_child_sql
from .attendance_learning import with_learning_requirements


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
class AttendanceLearningNormalizedSchemaPostgresTests(unittest.TestCase):
    def test_requirement_projection_uses_status_without_removed_component_columns(self):
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
                    [["deleted_at", "is_programme_deleted"]],
                )
                self.assertEqual(cursor.fetchall(), [])
                cursor.execute(
                    f"""SELECT c.id,c.module_catalogue_id
                           FROM curriculum.components c
                          WHERE lower(replace(c.type,'-','_'))='live_session'
                            AND {visible_child_sql('c')}
                          ORDER BY c.id LIMIT 1"""
                )
                component = cursor.fetchone()
                cursor.execute(
                    """SELECT id,enrolment_id,learner_type
                         FROM "Learner".learners
                        WHERE enrolment_id IS NOT NULL
                        ORDER BY id LIMIT 1"""
                )
                owner = cursor.fetchone()
            self.assertIsNotNone(component)
            self.assertIsNotNone(owner)

            stack.enter_context(connection.execute_wrapper(_ReadOnlyGuard()))
            profile_id, enrolment_id, learner_type = owner
            source = SimpleNamespace(
                pk=enrolment_id,
                learner_type=learner_type,
                _case_file_profile=SimpleNamespace(pk=profile_id, enrolment_id=enrolment_id),
            )
            credit = {
                "componentId": str(component[0]),
                "moduleId": str(component[1]),
                "componentType": "live_session",
                "hours": 2.5,
                "verifiedSeconds": 7200,
                "submittedAt": "2026-11-21T12:00:00+00:00",
            }
            result = with_learning_requirements(source, [credit])

        self.assertEqual(result[0]["hours"], 2.5)
        self.assertEqual(result[0]["verifiedSeconds"], 7200)
        self.assertEqual(result[0]["liveSessionLearning"]["attendance"], "present")
        self.assertEqual(result[0]["liveSessionLearning"]["status"], "completed")


if __name__ == "__main__":
    unittest.main()
