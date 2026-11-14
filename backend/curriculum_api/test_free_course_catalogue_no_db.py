"""DB-free contracts for canonical Free Course reads."""
import json
from types import SimpleNamespace
from unittest import mock

from django.test import RequestFactory, SimpleTestCase
from django.db import DatabaseError

from curriculum_api import free_course_catalogue as catalogue
from curriculum_api import free_course_authoring as authoring
from curriculum_api import views


class CanonicalFreeCourseCatalogueTests(SimpleTestCase):
    def test_compatibility_catalogue_get_uses_canonical_courses_only(self):
        rows = [{
            "id": "FREE-1", "course_name": "Canonical",
            "week_count": 2, "component_count": 4,
        }]
        with mock.patch.object(authoring.free_course_catalogue, "courses", return_value=rows) as courses, \
             mock.patch("login.permissions.authenticate_request", return_value=SimpleNamespace(role="staff")):
            response = authoring.catalogue(
                RequestFactory().get("/curriculum/free-courses/"),
            )
        self.assertEqual(response.status_code, 200)
        payload = json.loads(response.content)
        self.assertEqual(payload["results"][0]["courseId"], "FREE-1")
        self.assertIsNone(payload["results"][0]["moduleCatalogueId"])
        self.assertTrue(payload["results"][0]["editable"])
        self.assertTrue(payload["results"][0]["structureUrl"].endswith("/FREE-1/authoring/"))
        courses.assert_called_once_with(columns=[
            "id", "course_name", "week_count", "component_count",
        ])

    def test_batch_uses_one_execute_and_preserves_result_order(self):
        cursor = mock.MagicMock()
        cursor.description = [("id",)]
        cursor.fetchall.side_effect = [[("COURSE",)], [("WEEK",)], [("COMPONENT",)]]
        cursor.nextset.side_effect = [True, True, False]
        database = mock.MagicMock(vendor="postgresql")
        database.cursor.return_value.__enter__.return_value = cursor
        reads = [(table, 'id = %s', [ident], 'id', ['id']) for table, ident in (
            ('free_courses', 'COURSE'), ('free_course_weeks', 'WEEK'),
            ('free_programme_components', 'COMPONENT'),
        )]
        with mock.patch.object(catalogue, 'connection', database), \
             mock.patch.object(catalogue.schema_gate, 'require_tables'), \
             mock.patch.dict('os.environ', {'CURRICULUM_BATCHED_READS': 'true'}):
            result = catalogue.fetch_many(reads)
        self.assertEqual(result, [[{'id': 'COURSE'}], [{'id': 'WEEK'}], [{'id': 'COMPONENT'}]])
        cursor.execute.assert_called_once()
        sql, params = cursor.execute.call_args.args
        self.assertEqual(params, ['COURSE', 'WEEK', 'COMPONENT'])
        self.assertNotIn('"curriculum"."weeks"', sql)
        self.assertNotIn(' join ', sql.lower())
        self.assertNotIn('COURSE', sql)

    def test_batch_rejects_incomplete_results(self):
        database = mock.MagicMock(vendor='postgresql')
        cursor = database.cursor.return_value.__enter__.return_value
        cursor.description = []
        cursor.fetchall.return_value = []
        cursor.nextset.return_value = False
        with mock.patch.object(catalogue, 'connection', database), \
             mock.patch.object(catalogue.schema_gate, 'require_tables'), \
             mock.patch.dict('os.environ', {'CURRICULUM_BATCHED_READS': 'true'}):
            with self.assertRaises(DatabaseError):
                catalogue.fetch_many([('free_courses', '', [], 'id', ['id'])] * 2)

    def test_batch_disabled_reads_sequentially_without_nextset(self):
        database = mock.MagicMock(vendor='postgresql')
        cursor = database.cursor.return_value.__enter__.return_value
        cursor.description = []
        cursor.fetchall.return_value = []
        with mock.patch.object(catalogue, 'connection', database), \
             mock.patch.object(catalogue.schema_gate, 'require_tables'), \
             mock.patch.dict('os.environ', {'CURRICULUM_BATCHED_READS': 'false'}):
            self.assertEqual(catalogue.fetch_many([('free_courses', '', [], 'id', ['id'])] * 2), [[], []])
        self.assertEqual(cursor.execute.call_count, 2)
        cursor.nextset.assert_not_called()

    def test_selectors_read_only_the_three_canonical_tables(self):
        cursor = mock.MagicMock()
        cursor.description = []
        cursor.fetchall.return_value = []
        database = mock.MagicMock(vendor="postgresql")
        database.cursor.return_value.__enter__.return_value = cursor

        with mock.patch.object(catalogue, "connection", database), \
             mock.patch.object(catalogue.schema_gate, "require_tables") as require:
            catalogue.courses(course_ids=["FREE-1"], columns=["id", "course_name"])
            catalogue.weeks(course_ids=["FREE-1"], columns=["id", "course_id", "title"])
            catalogue.components(week_ids=["FREEWEEK-1"], programme_id="FREE-COURSES",
                                 columns=["id", "free_module_id"])

        sql = "\n".join(call.args[0] for call in cursor.execute.call_args_list)
        self.assertIn('from "curriculum"."free_courses"', sql)
        self.assertIn('from "curriculum"."free_course_weeks"', sql)
        self.assertIn('from "curriculum"."free_programme_components"', sql)
        self.assertNotIn('from "curriculum"."weeks"', sql)
        self.assertNotIn(" join ", sql.lower())
        self.assertNotIn("legacy_copied_from_week_id", sql)
        self.assertEqual(
            [call.args[0] for call in require.call_args_list],
            ["free_courses", "free_course_weeks", "free_programme_components"],
        )

    def test_week_identity_is_canonical_and_provenance_is_only_compatibility(self):
        identity = catalogue.week_api_identity({
            "id": "FREEWEEK-1",
            "legacy_copied_from_week_id": "NORMAL-WEEK-9",
        })
        self.assertEqual(identity, {
            "freeCourseWeekId": "FREEWEEK-1",
            "weekId": "NORMAL-WEEK-9",
            "legacyCopiedFromWeekId": "NORMAL-WEEK-9",
        })
        self.assertEqual(catalogue.week_api_identity({"id": "FREEWEEK-2"}), {
            "freeCourseWeekId": "FREEWEEK-2",
            "weekId": "",
            "legacyCopiedFromWeekId": None,
        })

    def test_curriculum_get_keeps_inactive_weeks_visible_with_explicit_identity(self):
        weeks = [
            {"id": "FREEWEEK-1", "course_id": "FREE-1", "week_number": 1,
             "title": "Current", "status": "active", "display_order": 0,
             "legacy_copied_from_week_id": "NORMAL-WEEK-1"},
            {"id": "FREEWEEK-2", "course_id": "FREE-1", "week_number": 2,
             "title": "Historical", "status": "inactive", "display_order": 1,
             "legacy_copied_from_week_id": None},
        ]
        with mock.patch.object(catalogue, "fetch_many", return_value=[
                 [{"id": "FREE-1", "course_name": "Canonical", "description": "Course"}], weeks, [],
             ]), \
             mock.patch("curriculum_api.legacy_free_course_adoption.adopted_courses", return_value={}):
            with mock.patch("login.permissions.authenticate_request", return_value=SimpleNamespace(role="staff")), \
                 mock.patch("login.permissions._accesses_of", return_value={"curriculum"}):
                response = views.curriculum_free_programme_modules(
                    RequestFactory().get("/curriculum/free-programmes/FREE-COURSES/modules/"),
                    "FREE-COURSES",
                )

        self.assertEqual(response.status_code, 200)
        payload = json.loads(response.content)
        self.assertEqual(payload["count"], 2)
        self.assertEqual(
            [row["freeCourseWeekId"] for row in payload["results"]],
            ["FREEWEEK-1", "FREEWEEK-2"],
        )
        self.assertEqual(payload["results"][0]["weekId"], "NORMAL-WEEK-1")
        self.assertEqual(payload["results"][1]["weekId"], "")
        self.assertEqual(payload["results"][1]["status"], "inactive")

