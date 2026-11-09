"""Learner readers resolve tutor, coach and cohort names through canonical FKs.

curriculum.modules no longer stores tutor_name (tutor_id -> curriculum.tutors),
curriculum.groups no longer stores a coach (curriculum.group_coaches -> curriculum.coaches),
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
        CREATE TABLE curriculum.group_coaches (group_id TEXT, coach_id TEXT,
            PRIMARY KEY (group_id, coach_id));
        INSERT INTO curriculum.tutors VALUES ('T1','Dr Tutor');
        INSERT INTO curriculum.coaches VALUES ('C1','Coach One'),('C2','   '),('C3','Adam Coach');
        CREATE TABLE main.modules (module_catalogue_id TEXT, tutor_id TEXT, group_id TEXT);
        CREATE TABLE main.groups (group_id TEXT PRIMARY KEY);
        INSERT INTO main.modules VALUES ('M1','T1','G1'),('M2',NULL,'G2'),('M3','  ','G3'),('M4','T9','G9'),
                                        ('M5','T1','G5');
        INSERT INTO main.groups VALUES ('G1'),('G2'),('G3'),('G5');
        INSERT INTO curriculum.group_coaches VALUES ('G1','C1'),('G3','C2'),('G5','C1'),('G5','C3'),('G5','C2');
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
            ('M3', '', None),       # blank tutor id; only blank coach names
            ('M4', '', None),       # unknown tutor; module whose group row is missing -> NULL
            ('M5', 'Dr Tutor', 'Adam Coach, Coach One'),  # several coaches: name order, blank skipped
        ])

    def test_attendance_keeps_its_organizer_fallback(self):
        sql = (f"SELECT coalesce(nullif({module_tutor_name_sql('m')},''),'organizer@example.test') "
               f"FROM modules m ORDER BY m.module_catalogue_id")
        self.assertEqual([row[0] for row in self.db.execute(sql)],
                         ['Dr Tutor', 'organizer@example.test', 'organizer@example.test', 'organizer@example.test',
                          'Dr Tutor'])

    def test_group_names_are_trimmed_unique_and_stably_ordered(self):
        self.db.executescript("""
            INSERT INTO curriculum.coaches VALUES
                ('C4',' Coach One '),('C5','adam Coach'),('C6',NULL);
            INSERT INTO curriculum.group_coaches VALUES
                ('G5','C6'),('G5','C5'),('G5','C4');
        """)
        sql = f"SELECT {group_coach_name_sql('g')} FROM groups g WHERE group_id='G5'"
        self.assertEqual(self.db.execute(sql).fetchone()[0], 'Adam Coach, adam Coach, Coach One')
        self.db.execute('DELETE FROM curriculum.group_coaches WHERE group_id=?', ('G5',))
        self.db.executemany('INSERT INTO curriculum.group_coaches VALUES (?,?)',
                            [('G5', key) for key in ('C4', 'C3', 'C2', 'C1', 'C5', 'C6')])
        self.assertEqual(self.db.execute(sql).fetchone()[0], 'Adam Coach, adam Coach, Coach One')

    def test_learner_assignment_is_independent_of_group_and_legacy_contacts(self):
        from copy import deepcopy
        from . import coach_assignment
        source = SimpleNamespace(coach_name='Legacy coach', coach_email='legacy@example.test',
                                 case_owner='Different owner')
        group_sql = f"SELECT {group_coach_name_sql('g')} FROM groups g WHERE group_id='G5'"
        for email in ('assigned@example.test', None, '', '   '):
            with self.subTest(email=email):
                profile = SimpleNamespace(coach_name='Assigned Coach', coach_email=email)
                before = deepcopy(vars(profile))
                expected = {'coach_name': 'Assigned Coach' if email and email.strip() else '',
                            'coach_email': email.strip() if email else ''}
                with patch.object(coach_assignment, '_unique_staff_for_name',
                                  side_effect=AssertionError('Do not infer an assignment')):
                    for reader in (dashboard_header.current_coach, training_plan_dashboard.current_coach):
                        self.assertEqual(reader(source, profile, {'coach_email': 'old@example.test'}), expected)
                        self.assertEqual(self.db.execute(group_sql).fetchone()[0], 'Adam Coach, Coach One')
                self.assertEqual(vars(profile), before)
        self.assertEqual(dashboard_header.current_coach(source, None),
                         {'coach_name': '', 'coach_email': ''})

    def test_dashboard_never_presents_group_names_as_the_learner_coach(self):
        from contextlib import ExitStack
        from unittest.mock import MagicMock
        source = SimpleNamespace(programme='P', cohort='C', group='G',
                                 coach_name=None, coach_email=None)
        names = self.db.execute(
            f"SELECT {group_coach_name_sql('g')} FROM groups g WHERE group_id='G5'"
        ).fetchone()[0]
        module = {'id': 'M5', 'title': 'Module', 'programme_name': 'P',
                  'cohort_name': 'C', 'group_name': 'G', 'coach_name': names,
                  'start_date': None, 'end_date': None}
        for email in ('assigned@example.test', None, ''):
            with self.subTest(email=email), ExitStack() as stack:
                profile = SimpleNamespace(coach_name='Assigned Coach', coach_email=email)
                for target, value in (
                    ('header_identity', {'programmeStatus': 'Active'}),
                    ('header_profile', (profile, {'id': 17})),
                    ('dashboard_modules', (['M5'], [module])),
                    ('header_sessions', []), ('lecture_href', None),
                    ('plan_reviews', []), ('upcoming_assignment_deadlines', []),
                    ('coach_phone', None),
                ):
                    stack.enter_context(patch.object(dashboard_header, target, return_value=value))
                stack.enter_context(patch.object(dashboard_header, 'connections',
                                                 {'enrolment': MagicMock()}))
                result = dashboard_header.build_minimal_header(source, 'commercial', 7)
                self.assertEqual(result['coach'],
                    {'name': 'Assigned Coach', 'email': email} if email else {'name': ''})
                self.assertEqual(profile.coach_email, email)


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
