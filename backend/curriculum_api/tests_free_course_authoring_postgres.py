"""Opt-in read-only PostgreSQL integration checks for Phase B.1.

Set ``FREE_COURSE_AUTHORING_POSTGRES_TESTS=1`` only when Django is configured
for an isolated disposable PostgreSQL database.  These tests issue no writes,
but the explicit opt-in prevents accidental use of an unverified environment.
"""
import os
from unittest import skipUnless

from django.db import connection, transaction
from django.test import SimpleTestCase, override_settings
from django.test.utils import CaptureQueriesContext

from curriculum_api import free_course_authoring as authoring
from curriculum_api import free_course_authoring_mutations as mutations
from curriculum_api import free_course_catalogue, schema_gate


@skipUnless(
    os.environ.get("FREE_COURSE_AUTHORING_POSTGRES_TESTS") == "1",
    "requires an explicitly verified isolated PostgreSQL database",
)
class FreeCourseAuthoringPostgresTests(SimpleTestCase):
    databases = {"default"}

    def setUp(self):
        if connection.vendor != "postgresql":
            self.skipTest("PostgreSQL only")
        schema_gate.require_tables(
            free_course_catalogue.FREE_COURSES_TABLE,
            free_course_catalogue.FREE_COURSE_WEEKS_TABLE,
            free_course_catalogue.FREE_COMPONENTS_TABLE,
            authoring.QUIZZES_TABLE,
            authoring.QUIZ_LINKS_TABLE,
        )

    def test_catalogue_uses_one_snapshot_and_one_data_query(self):
        with CaptureQueriesContext(connection) as queries:
            document = authoring.catalogue_document()
        sql = [query["sql"].lower() for query in queries.captured_queries]
        selects = [item for item in sql if item.lstrip().startswith("select")]
        self.assertEqual(document["scope"], "catalogue")
        self.assertEqual(sum("set transaction isolation level repeatable read, read only" in item for item in sql), 1)
        self.assertEqual(sum('from "curriculum"."free_courses"' in item for item in selects), 1)
        self.assertEqual(len(selects), 1)
        self.assertLessEqual(len(sql), 4)  # BEGIN + SET + SELECT + COMMIT

    def test_course_avoids_n_plus_one_and_normal_curriculum_tables(self):
        rows = free_course_catalogue.courses(columns=["id"])
        if not rows:
            self.skipTest("isolated database has no seeded Free Courses")
        with CaptureQueriesContext(connection) as queries:
            document = authoring.course_document(rows[0]["id"])
        sql = [query["sql"].lower() for query in queries.captured_queries]
        selects = [item for item in sql if item.lstrip().startswith("select")]
        combined = "\n".join(sql)
        self.assertEqual(document["scope"], "course")
        self.assertEqual(sum("set transaction isolation level repeatable read, read only" in item for item in sql), 1)
        self.assertLessEqual(len(selects), 5)
        self.assertLessEqual(len(sql), 8)  # BEGIN + SET + five bulk reads + COMMIT
        self.assertNotIn('from "curriculum"."modules"', combined)
        self.assertNotIn('from "curriculum"."weeks"', combined)
        self.assertNotIn('from "curriculum"."components"', combined)


@skipUnless(
    os.environ.get("FREE_COURSE_AUTHORING_WRITE_POSTGRES_TESTS") == "1",
    "requires an explicitly verified disposable PostgreSQL database",
)
@override_settings(FREE_COURSE_AUTHORING_WRITE_MODE="canonical")
class FreeCourseAuthoringWritePostgresTests(SimpleTestCase):
    """Real SQL create/update/replay/delete, always rolled back by this test."""
    databases = {"default"}

    def setUp(self):
        if connection.vendor != "postgresql":
            self.skipTest("PostgreSQL only")
        with connection.cursor() as cursor:
            cursor.execute("select to_regclass('curriculum.free_course_authoring_idempotency')")
            if cursor.fetchone()[0] is None:
                self.skipTest("migration 0084 is not applied to the disposable database")

    def test_create_replay_update_reload_and_delete_are_atomic(self):
        with transaction.atomic():
            try:
                catalogue = authoring.catalogue_document(read_snapshot=False)
                payload = {
                    "expectedRevision": catalogue["revision"],
                    "clientId": "course:postgres",
                    "course": {"courseName": "Disposable integration course", "courseType": "free"},
                    "weeks": [{
                        "clientId": "week:postgres", "title": "Week one", "status": "active", "displayOrder": 0,
                        "components": [{
                            "clientId": "component:postgres", "type": "reading", "title": "Read", "displayOrder": 0,
                            "settings": {},
                        }],
                    }],
                }
                first = mutations.create_course(payload, staff_id=999999, idempotency_key="postgres:create:0001")
                replay = mutations.create_course(payload, staff_id=999999, idempotency_key="postgres:create:0001")
                self.assertFalse(first["replayed"])
                self.assertTrue(replay["replayed"])
                course_id = first["body"]["course"]["courseId"]
                week = first["body"]["weeks"][0]
                component = week["components"][0]
                updated = mutations.update_course(course_id, {
                    "expectedRevision": first["body"]["revision"],
                    "course": {"courseName": "Disposable integration course edited"},
                    "weeks": [{
                        "freeCourseWeekId": week["freeCourseWeekId"], "title": "Week renamed", "status": "active", "displayOrder": 0,
                        "components": [{
                            "id": component["id"], "type": component["type"], "title": "Read edited", "displayOrder": 0,
                            "settings": component["settings"],
                        }],
                    }],
                })
                reloaded = authoring.course_document(course_id, read_snapshot=False)
                self.assertEqual(reloaded["revision"], updated["revision"])
                self.assertEqual(reloaded["course"]["courseName"], "Disposable integration course edited")
                deleted = mutations.delete_course(course_id, {"expectedRevision": reloaded["revision"]})
                self.assertTrue(deleted["deleted"])
            finally:
                transaction.set_rollback(True)
