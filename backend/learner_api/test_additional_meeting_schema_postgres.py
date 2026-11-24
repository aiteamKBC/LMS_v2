"""Read-only normalized PostgreSQL regression for additional-meeting access."""
import os
import re
import unittest
from contextlib import ExitStack

from django.conf import settings
from django.db import connections, transaction

from curriculum_api.session_results import read
from curriculum_api.week_visibility import visible_child_sql, visible_week_sql
from .module_placement_sql import current_module_sql
from .replaced_teams_attendance import additional_module_context


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
class AdditionalMeetingNormalizedSchemaPostgresTests(unittest.TestCase):
    def test_assigned_additional_meeting_uses_normalized_visibility(self):
        for alias in ("default", "enrolment"):
            config = settings.DATABASES[alias]
            self.assertEqual(str(config.get("HOST") or "").split(".")[0], EXPECTED_ENDPOINT)

        with ExitStack() as stack:
            for alias in ("default", "enrolment"):
                connection = connections[alias]
                stack.enter_context(transaction.atomic(using=alias))
                with connection.cursor() as cursor:
                    cursor.execute("SET LOCAL transaction_read_only=on")
                    cursor.execute("SHOW transaction_read_only")
                    self.assertEqual(cursor.fetchone()[0], "on")
                stack.enter_context(connection.execute_wrapper(_ReadOnlyGuard()))

            with connections["enrolment"].cursor() as cursor:
                cursor.execute(
                    """SELECT table_name,column_name FROM information_schema.columns
                         WHERE table_schema='curriculum'
                           AND table_name=ANY(%s)
                           AND column_name=ANY(%s)
                         ORDER BY table_name,column_name""",
                    [["components", "modules", "weeks"],
                     ["deleted_at", "is_programme_deleted", "deleted_via_parent"]],
                )
                self.assertEqual(cursor.fetchall(), [])
                cursor.execute(
                    """SELECT pm.curriculum_module_id,s.id,s.status,s.meeting_type,s.join_url
                         FROM "Learner".learners l
                         JOIN "Learner".learner_training_plan_modules pm ON pm.learner_id=l.id
                         JOIN curriculum.components c
                           ON c.module_catalogue_id=pm.curriculum_module_id
                         JOIN curriculum.weeks w
                           ON w.id=c.week_id AND w.module_catalogue_id=c.module_catalogue_id
                         JOIN curriculum.modules m
                           ON m.module_catalogue_id=c.module_catalogue_id
                         JOIN curriculum.live_sessions s
                           ON s.id=c.settings_json->>'extraTeamsLiveSessionId'
                        WHERE l.learner_type='commercial'
                          AND nullif(btrim(c.settings_json->>'extraTeamsMeetingUrl'),'') IS NOT NULL
                          AND s.status='week-meeting'
                          AND s.meeting_type='week-additional'
                          AND """ + visible_child_sql("c") + """
                          AND """ + current_module_sql("m") + """
                          AND """ + visible_week_sql("w") + """
                        ORDER BY l.id,c.id LIMIT 1"""
                )
                row = cursor.fetchone()
            self.assertIsNotNone(row, "Development needs one assigned commercial additional meeting")

            module_id, series_id, status, meeting_type, join_url = row
            series = {"id": series_id, "status": status, "meeting_type": meeting_type,
                      "join_url": join_url}
            self.assertEqual(additional_module_context([module_id], series, read), [str(module_id)])
            self.assertEqual(additional_module_context(["not-assigned"], series, read), [])


if __name__ == "__main__":
    unittest.main()
