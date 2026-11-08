"""Module Visibility Option A: inactive modules leave CURRENT lists, history stays.

curriculum.modules has no deletion marker (deleted_at, deleted_via_parent,
is_programme_deleted were removed); status replaces it. No Django database:
SQL is inspected or captured from recording cursors, and the visibility
predicate runs on in-memory sqlite3.
"""
import inspect
import re
import sqlite3
from unittest.mock import patch

from django.test import SimpleTestCase

from . import (attendance_lectures, learner_detail, linked_recordings, mobile, overview_week,
               personal_learning_reads, student_activity, student_activity_data)
from .module_placement_sql import current_module_sql

REMOVED_MODULE_DELETION = re.compile(r'\b(?:m|cm)\.(?:deleted_at|deleted_via_parent|is_programme_deleted)\b')
PREDICATE = "lower(btrim(coalesce(cm.status, ''))) <> 'inactive'"


class Cursor:
    def __init__(self, rows=()):
        self.sql, self.rows = [], list(rows)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=None):
        self.sql.append(' '.join(sql.split()))

    def fetchall(self):
        return list(self.rows)

    def fetchone(self):
        return None


class VisibilityPredicateTests(SimpleTestCase):
    def test_only_inactive_is_hidden(self):
        db = sqlite3.connect(':memory:')
        self.addCleanup(db.close)
        db.create_function('btrim', 1, lambda value: value.strip() if isinstance(value, str) else value)
        db.execute('CREATE TABLE modules (id TEXT, status TEXT)')
        db.executemany('INSERT INTO modules VALUES (?, ?)', [
            ('active', 'active'), ('inactive', 'inactive'), ('spaced', ' INACTIVE '),
            ('null', None), ('blank', ''), ('planned', 'planned')])
        visible = {row[0] for row in db.execute(f"SELECT id FROM modules m WHERE {current_module_sql('m')}")}
        # Active is visible; inactive is hidden; no other value is reinterpreted.
        self.assertEqual(visible, {'active', 'null', 'blank', 'planned'})


class CurrentListTests(SimpleTestCase):
    def test_current_subjects_hide_inactive_and_keep_the_assignment_scope(self):
        sql = student_activity.CURRENT_SUBJECTS_SQL
        self.assertTrue(sql.startswith(student_activity.ASSIGNED_SUBJECTS_SQL))     # same placement/assignment
        self.assertIn(f'WHERE {PREDICATE}', sql)
        self.assertIn('FROM enrolment."Created_users" WHERE id=%s', sql)
        self.assertIn('"Learner".learner_training_plan_modules', sql)
        self.assertIsNone(REMOVED_MODULE_DELETION.search(sql))

    def test_home_current_flag_hides_inactive_without_dropping_rows(self):
        sql = overview_week.HOME_SUBJECTS_SQL
        self.assertIn(f'bool_or(assigned.current_plan) AND bool_or({PREDICATE})', sql)
        self.assertNotRegex(sql, r'WHERE[^)]*status')                    # every assigned row returned
        self.assertIsNone(REMOVED_MODULE_DELETION.search(sql))
        # Upcoming assignments follow the current flag.
        self.assertIn('WHERE home.current_plan', overview_week.UPCOMING_ASSIGNMENTS_SQL)

    def test_content_and_schedule_readers_use_the_current_rule(self):
        cursor = Cursor()
        with patch.object(learner_detail, 'effective_training_plan', return_value=[{'moduleId': 'M1'}]), \
             patch.object(learner_detail, 'connections', {'enrolment': type('C', (), {'cursor': lambda self: cursor})()}):
            learner_detail._authored_setting(object(), 'C1', 'readingContent', 'readingContent')
        self.assertIn(current_module_sql('m'), cursor.sql[0])
        self.assertIsNone(REMOVED_MODULE_DELETION.search(cursor.sql[0]))
        for source in (inspect.getsource(mobile._presentation_metadata), inspect.getsource(mobile.transcript),
                       inspect.getsource(personal_learning_reads.learning_schedule),
                       linked_recordings.REMOTE_SESSIONS_SQL):
            self.assertIn('current_module_sql' if 'def ' in source else current_module_sql('m'), source)
            self.assertIsNone(REMOVED_MODULE_DELETION.search(source))


class HistoricalReadTests(SimpleTestCase):
    def test_assignment_scope_used_for_history_has_no_status_filter(self):
        sql = student_activity.ASSIGNED_SUBJECTS_SQL
        self.assertNotIn('status', sql)
        self.assertIsNone(REMOVED_MODULE_DELETION.search(sql))

    def test_exported_activity_lineage_reads_assigned_not_current_modules(self):
        for reader in (student_activity._activity_sources, student_activity._activity_source_issues):
            with self.subTest(reader=reader.__name__):
                cursor = Cursor()
                target = 'read_activity_sources' if reader is student_activity._activity_sources else 'read_activity_source_issues'
                with patch.object(student_activity, 'connections', {'enrolment': type('C', (), {'cursor': lambda self: cursor})()}), \
                     patch.object(student_activity, target, return_value={}):
                    reader(101, [9])
                self.assertEqual(cursor.sql[0], ' '.join(student_activity.ASSIGNED_SUBJECTS_SQL.split()))
                self.assertNotIn('status', cursor.sql[0])

    def test_curriculum_schedule_lineage_keeps_inactive_modules(self):
        sql = student_activity_data.CURRICULUM_SCHEDULE_SQL
        self.assertNotIn('m.status', sql)
        self.assertIsNone(REMOVED_MODULE_DELETION.search(sql))
        # Component and week deletion filters are untouched.
        self.assertIn('c.deleted_at IS NULL', sql)
        self.assertIn('w.deleted_at IS NULL', sql)

    def test_attendance_scope_is_not_filtered_by_status(self):
        self.assertNotIn('status', attendance_lectures.ATTENDANCE_SUBJECTS_SQL)
