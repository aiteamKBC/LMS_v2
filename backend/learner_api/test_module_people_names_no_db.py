"""Learner readers resolve tutor, coach and cohort names through canonical FKs.

curriculum.modules no longer stores tutor_name (tutor_id -> curriculum.tutors),
curriculum.groups no longer stores coach_name or coach_id (the canonical
group_coaches relation points to curriculum.coaches),
programme_name or cohort_name. No Django database connection: SQL is captured
from recording cursors, and the name expressions run on in-memory sqlite3.
"""
import inspect
import json
import re
import sqlite3
from types import SimpleNamespace
from unittest.mock import patch

from django.test import RequestFactory, SimpleTestCase

from . import (active_users, attendance_lectures, curriculum, dashboard_header, dashboard_training, my_learning,
               training_plan_dashboard)
from .module_placement_sql import group_coach_name_sql, module_tutor_name_sql

#: A removed physical column read through a curriculum.modules (m) alias, or a
#: curriculum.groups (g) alias. groups keeps group_name; modules lost it.
REMOVED_READ = re.compile(r'\bm\.(tutor_name|tutor_email|coach_name|programme_name|cohort_name|group_name)\b'
                          r'|\bg\.(coach_id|coach_name|programme_name|cohort_name|module_ids|module_names)\b')


class Cursor:
    def __init__(self):
        self.sql, self.description = [], []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=None):
        self.sql.append(' '.join(sql.split()))

    def fetchall(self):
        return []

    def fetchone(self):
        return None


def name_db():
    db = sqlite3.connect(':memory:')
    db.create_function('btrim', 1, lambda value: value.strip() if isinstance(value, str) else value)
    db.execute("ATTACH DATABASE ':memory:' AS curriculum")
    db.executescript('''
        CREATE TABLE curriculum.tutors (id TEXT PRIMARY KEY, name TEXT);
        CREATE TABLE curriculum.coaches (id TEXT PRIMARY KEY, name TEXT);
        INSERT INTO curriculum.tutors VALUES ('T1','Dr Tutor');
        INSERT INTO curriculum.coaches VALUES ('C1','Coach One'),('C2','   ');
        CREATE TABLE main.modules (module_catalogue_id TEXT, tutor_id TEXT, group_id TEXT);
        CREATE TABLE main.groups (group_id TEXT PRIMARY KEY);
        CREATE TABLE curriculum.group_coaches (group_id TEXT, coach_id TEXT,
            PRIMARY KEY (group_id, coach_id));
        INSERT INTO main.modules VALUES ('M1','T1','G1'),('M2',NULL,'G2'),('M3','  ','G3'),('M4','T9','G9');
        INSERT INTO main.groups VALUES ('G1'),('G2'),('G3');
        INSERT INTO curriculum.group_coaches VALUES ('G1','C1'),('G3','C1'),('G3','C2');
    ''')
    return db


class NameExpressionTests(SimpleTestCase):
    def setUp(self):
        self.db = name_db()
        self.addCleanup(self.db.close)

    def test_tutor_and_coach_names_follow_their_foreign_keys(self):
        sql = (f"SELECT m.module_catalogue_id, {module_tutor_name_sql('m')} AS tutor_name, "
               f"{group_coach_name_sql('g')} AS coach_name FROM modules m "
               f"LEFT JOIN groups g ON g.group_id = m.group_id ORDER BY m.module_catalogue_id")
        result = self.db.execute(sql).fetchall()
        self.assertEqual(result, [
            ('M1', 'Dr Tutor', 'Coach One'),
            ('M2', '', None),       # no tutor -> '' default; group without a coach -> NULL
            ('M3', '', None),       # blank tutor id; multiple coaches are deliberately ambiguous
            ('M4', '', None),       # unknown tutor; module whose group row is missing -> NULL
        ])

    def test_attendance_keeps_its_organizer_fallback(self):
        sql = (f"SELECT coalesce(nullif({module_tutor_name_sql('m')},''),'organizer@example.test') "
               f"FROM modules m ORDER BY m.module_catalogue_id")
        self.assertEqual([row[0] for row in self.db.execute(sql)],
                         ['Dr Tutor', 'organizer@example.test', 'organizer@example.test', 'organizer@example.test'])


class ReaderSqlTests(SimpleTestCase):
    def test_dashboard_training_module_rows(self):
        cursor = Cursor()
        dashboard_training.module_rows(cursor, ['M1'])
        statement = cursor.sql[0]
        self.assertIsNone(REMOVED_READ.search(statement), statement)
        self.assertIn('curriculum.tutors', statement)
        self.assertIn('curriculum.group_coaches', statement)
        self.assertIn('curriculum.coaches', statement)
        self.assertIn('AS tutor_name', statement)
        self.assertIn('AS coach_name', statement)

    def test_my_learning_catalogue_module_rows(self):
        cursor = Cursor()
        with patch('learner_api.subject_origins.imported_course_links', return_value={}):
            my_learning.catalogue_module_rows(cursor, ['M1'], identity_metadata={})
        statement = cursor.sql[0]
        self.assertIsNone(REMOVED_READ.search(statement), statement)
        self.assertIn('curriculum.tutors', statement)
        self.assertIn('AS tutor_name', statement)

    def test_dashboard_header_modules_with_and_without_coach(self):
        for include_coach in (True, False):
            with self.subTest(include_coach=include_coach):
                cursor = Cursor()
                with patch.object(dashboard_header, '_effective_plan_ids', return_value=['M1']), \
                     patch.object(dashboard_header.canonical_learning, 'curriculum_module_ids_for', return_value=[]), \
                     patch.object(dashboard_header, 'connections', {'enrolment': SimpleNamespace(cursor=lambda: cursor)}), \
                     patch.object(dashboard_header, 'rows', return_value=[]):
                    dashboard_header.dashboard_modules(SimpleNamespace(), {}, include_coach=include_coach)
                statement = cursor.sql[0]
                self.assertIsNone(REMOVED_READ.search(statement), statement)
                self.assertEqual('curriculum.group_coaches' in statement, include_coach)
                self.assertEqual('curriculum.coaches' in statement, include_coach)
                self.assertEqual('coach_name' in statement, include_coach)
                self.assertNotIn('g.coach_id', statement)

    def test_training_plan_dashboard_and_attendance_and_active_users_read_no_removed_column(self):
        for source in (inspect.getsource(training_plan_dashboard.read_dashboard),
                       attendance_lectures.NATIVE_OCCURRENCES_SQL,
                       inspect.getsource(active_users)):
            self.assertIsNone(REMOVED_READ.search(source), REMOVED_READ.search(source))
        self.assertIn('curriculum.tutors', attendance_lectures.NATIVE_OCCURRENCES_SQL)

    def test_group_picker_matches_a_named_cohort_through_cohort_id(self):
        captured = []
        request = RequestFactory().get('/', {'programme': 'Marketing', 'cohort': 'October 2026'})
        with patch.object(curriculum, '_rows', side_effect=lambda sql, params: captured.append((sql, params)) or []):
            response = curriculum.groups(request)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content), {'results': []})
        sql, params = captured[0]
        self.assertNotRegex(sql, r'\(\s*cohort_name\s*=')            # groups has no cohort_name
        self.assertIn('cohort_id IN (SELECT cohort_id FROM curriculum.cohorts WHERE cohort_name = %s)', sql)
        self.assertNotIn('programme_name =', sql.replace('programme_name_source', ''))
        self.assertEqual(params, ['Marketing', 'Marketing', 'October 2026', 'October 2026'])
