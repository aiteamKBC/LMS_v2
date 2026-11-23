"""Isolated in-memory SQLite checks for canonical assignment reconciliation."""
from unittest import TestCase
from unittest.mock import patch
from datetime import datetime, timezone

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
        from . import free_courses_view as view
        self.enterContext(patch.object(view, 'accepted_activity_seconds', return_value={}))
        self.enterContext(patch.object(view.free_course_attempts, 'activity_times', return_value={}))
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
                is_completed boolean NOT NULL DEFAULT 0,
                activity_state text NOT NULL DEFAULT 'not_started',
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

    def progress(self, **values):
        defaults = dict(learner_id=501, component_ref="COMP-1", free_course_ref="FREE-1")
        return LearnerFreeCourseProgress.objects.using("enrolment").create(**(defaults | values))

    def test_completion_with_unknown_date_is_counted_and_never_backfilled(self):
        from .free_course_progress import completed_component_refs
        row = self.progress(is_completed=True, activity_state="completed", completed_at=None)
        self.assertEqual(completed_component_refs(501), {"COMP-1"})
        self.assertTrue(_record_completion(501, "COMP-1", "FREE-1"))
        row.refresh_from_db()
        self.assertIsNone(row.completed_at)

    def test_incomplete_and_archived_records_do_not_count_even_with_dates(self):
        from .free_course_progress import completed_component_refs
        at = datetime(2026, 1, 1, tzinfo=timezone.utc)
        for index, (state, completed, status, deleted) in enumerate([
            ("not_started", False, "active", None),
            ("reading_viewed", False, "active", None),
            ("completed", True, "inactive", at),
            ("not_started", False, "inactive", at),
            ("completed", True, "active", at),
        ]):
            self.progress(component_ref=str(index), activity_state=state, is_completed=completed,
                          status=status, deleted_at=deleted, completed_at=at)
        self.assertEqual(completed_component_refs(501), set())

    def test_events_advance_without_downgrades_or_duplicate_rows(self):
        from .free_course_progress import save_activity_state, completed_component_refs
        manager = LearnerFreeCourseProgress.objects.using("enrolment")
        for state in ("not_started", "reading_viewed", "not_started"):
            self.assertTrue(save_activity_state(501, "COMP-1", "FREE-1", state))
        row = manager.get()
        self.assertEqual((row.activity_state, row.is_completed, row.completed_at),
                         ("reading_viewed", False, None))
        self.assertEqual(completed_component_refs(501), set())
        self.assertTrue(_record_completion(501, "COMP-1", "FREE-1"))
        row.refresh_from_db()
        at = row.completed_at
        for state in ("reading_viewed", "not_started", "completed"):
            self.assertTrue(save_activity_state(501, "COMP-1", "FREE-1", state,
                                                datetime(2026, 2, 1, tzinfo=timezone.utc)))
        row.refresh_from_db()
        self.assertEqual((row.activity_state, row.is_completed, row.completed_at), ("completed", True, at))
        self.assertEqual(manager.count(), 1)
        self.assertEqual(completed_component_refs(501), {"COMP-1"})
        self.assertEqual(completed_component_refs(502), set())

    def test_archived_history_and_wrong_course_are_unchanged_by_any_event(self):
        from .free_course_progress import save_activity_state
        manager = LearnerFreeCourseProgress.objects.using("enrolment")
        self.progress(is_completed=True, activity_state="completed", status="inactive",
                      deleted_at=datetime(2026, 1, 1, tzinfo=timezone.utc))
        before = list(manager.values())
        for state in ("not_started", "reading_viewed", "completed"):
            self.assertFalse(save_activity_state(501, "COMP-1", "FREE-1", state,
                                                 datetime(2026, 2, 1, tzinfo=timezone.utc)))
        self.assertEqual(list(manager.values()), before)
        row = self.progress(component_ref="COMP-2")
        self.assertFalse(_record_completion(501, "COMP-2", "OTHER-COURSE"))
        row.refresh_from_db()
        self.assertEqual(row.free_course_ref, "FREE-1")
        self.assertFalse(row.is_completed)

    def test_live_card_and_detail_count_only_explicit_eligible_completions(self):
        import json
        from unittest.mock import patch
        from django.test import RequestFactory
        from . import free_courses_view as view
        from .test_free_course_progress_status_no_db import inner
        from types import SimpleNamespace
        self.progress(is_completed=True, activity_state="completed")
        self.progress(component_ref="READ", activity_state="reading_viewed")
        self.progress(component_ref="ARCHIVE", is_completed=True, activity_state="completed",
                      status="inactive", deleted_at=datetime(2026, 1, 1, tzinfo=timezone.utc))
        catalogue = ({"FREE-1": {"id": "FREE-1", "course_name": "Synthetic"}},
                     [{"id": "W", "course_id": "FREE-1"}],
                     [{"id": ref, "free_module_id": "W", "type": "reading"}
                      for ref in ("COMP-1", "READ", "ARCHIVE", "NEW")])
        with patch.object(view, '_resolve_source', return_value=(SimpleNamespace(pk=501), None)), \
             patch.object(view, 'assigned_course_ids', return_value=['FREE-1']), \
             patch.object(view, '_scoped_rows', return_value=catalogue):
            request = RequestFactory().get('/')
            summary = json.loads(inner(view.free_courses)(request, 'commercial', 19).content)['freeCourses'][0]
            detail = json.loads(inner(view.free_course_detail)(request, 'commercial', 19, 'FREE-1').content)
        self.assertEqual((summary['completedActivities'], summary['progressPercentage']), (1, 25))
        activities = detail['freeCourse']['weeks'][0]['activities']
        self.assertEqual([(a['is_completed'], a['activity_state']) for a in activities],
                         [(True, 'completed'), (False, 'reading_viewed'),
                          (False, 'not_started'), (False, 'not_started')])
