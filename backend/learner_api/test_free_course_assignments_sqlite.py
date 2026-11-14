"""Isolated in-memory SQLite checks for canonical assignment reconciliation."""
from unittest import TestCase

from django.db import connections

from .free_course_assignments import _replace_assignment_rows
from .free_courses_view import _record_completion
from .models import LearnerFreeCourse, LearnerFreeCourseProgress


class IsolatedAssignmentWriteTests(TestCase):
    table_name = "isolated_free_course_assignments"

    def setUp(self):
        database = connections["enrolment"]
        self.assertEqual(database.vendor, "sqlite")
        self.original_table = LearnerFreeCourse._meta.db_table
        LearnerFreeCourse._meta.db_table = self.table_name
        with database.cursor() as cursor:
            cursor.execute(f'''CREATE TABLE "{self.table_name}" (
                id integer PRIMARY KEY AUTOINCREMENT,
                learner_id integer NOT NULL,
                position integer NOT NULL,
                free_course_ref text NOT NULL
            )''')

    def tearDown(self):
        database = connections["enrolment"]
        with database.cursor() as cursor:
            cursor.execute(f'DROP TABLE IF EXISTS "{self.table_name}"')
        LearnerFreeCourse._meta.db_table = self.original_table

    def rows(self):
        return list(
            LearnerFreeCourse.objects.using("enrolment")
            .filter(learner_id=501)
            .order_by("position")
            .values_list("id", "free_course_ref", "position")
        )

    def test_reorder_add_remove_and_repeat_preserve_existing_record_ids(self):
        manager = LearnerFreeCourse.objects.using("enrolment")
        first = manager.create(learner_id=501, free_course_ref="A", position=1)
        second = manager.create(learner_id=501, free_course_ref="B", position=2)

        _replace_assignment_rows(501, ["B", "A", "C"], {"A": "A", "B": "B", "C": "C"})
        shifted = self.rows()
        self.assertEqual([(ref, position) for _pk, ref, position in shifted], [("B", 1), ("A", 2), ("C", 3)])
        self.assertEqual({ref: pk for pk, ref, _position in shifted}["A"], first.pk)
        self.assertEqual({ref: pk for pk, ref, _position in shifted}["B"], second.pk)

        _replace_assignment_rows(501, ["B", "A", "C"], {"A": "A", "B": "B", "C": "C"})
        self.assertEqual(self.rows(), shifted)

        _replace_assignment_rows(501, ["B"], {"B": "B"})
        self.assertEqual(self.rows(), [(second.pk, "B", 1)])


class IsolatedProgressWriteTests(TestCase):
    table_name = "isolated_free_course_progress"

    def setUp(self):
        database = connections["enrolment"]
        self.assertEqual(database.vendor, "sqlite")
        self.original_table = LearnerFreeCourseProgress._meta.db_table
        LearnerFreeCourseProgress._meta.db_table = self.table_name
        with database.cursor() as cursor:
            cursor.execute(f'''CREATE TABLE "{self.table_name}" (
                id integer PRIMARY KEY AUTOINCREMENT,
                learner_id integer NOT NULL,
                component_ref text NOT NULL,
                free_course_ref text NOT NULL,
                completed_at datetime NULL,
                status varchar(20) NOT NULL,
                deleted_at datetime NULL,
                UNIQUE (learner_id, component_ref)
            )''')

    def tearDown(self):
        database = connections["enrolment"]
        with database.cursor() as cursor:
            cursor.execute(f'DROP TABLE IF EXISTS "{self.table_name}"')
        LearnerFreeCourseProgress._meta.db_table = self.original_table

    def test_repeated_completion_is_idempotent_and_inactive_row_stays_inactive(self):
        first = _record_completion(501, "COMP-1", "FREE-1")
        second = _record_completion(501, "COMP-1", "FREE-1")
        self.assertTrue(first)
        self.assertTrue(second)
        manager = LearnerFreeCourseProgress.objects.using("enrolment")
        row = manager.get(learner_id=501, component_ref="COMP-1")
        original_id = row.pk
        self.assertEqual(manager.count(), 1)

        row.status = "inactive"
        row.save(update_fields=["status"])
        self.assertFalse(_record_completion(501, "COMP-1", "FREE-1"))
        row.refresh_from_db()
        self.assertEqual(row.pk, original_id)
        self.assertEqual(row.status, "inactive")
        self.assertEqual(manager.count(), 1)
