"""Run affected SELECTs on FK-only tables; no application DB or Graph access."""
import ast
import inspect
import sqlite3
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase

from curriculum_api import attendance_link_store
from . import alternative_recovery, student_activity, teams_attendance


class AttendanceModuleSchemaTests(SimpleTestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.addCleanup(self.db.close)
        self.db.executescript('''
            ATTACH DATABASE ':memory:' AS curriculum;
            ATTACH DATABASE ':memory:' AS Learner;
            CREATE TABLE curriculum.modules (module_catalogue_id TEXT PRIMARY KEY,
                title TEXT, programme_id TEXT, cohort_id TEXT, group_id TEXT,
                teams_shared_source_module_id TEXT, status TEXT);
            CREATE TABLE curriculum.groups (group_id TEXT PRIMARY KEY, group_name TEXT);
            CREATE TABLE curriculum.cohorts (cohort_id TEXT PRIMARY KEY, cohort_name TEXT);
            INSERT INTO curriculum.modules VALUES
                ('M1','Module','P1','C1','G1',NULL,'active'),
                ('M2','Module copy','P1','C1','G2','M1','active'),
                ('M3','Unassigned',NULL,NULL,NULL,NULL,'active');
            INSERT INTO curriculum.groups VALUES ('G1','First group'), ('G2','Second group');
            INSERT INTO curriculum.cohorts VALUES ('C1','Cohort');
        ''')

    def query_rows(self, query):
        sql, params = query.query.sql_with_params()
        cursor = self.db.execute(sql.replace('%s', '?'), params)
        return [dict(zip([c[0] for c in cursor.description], row)) for row in cursor.fetchall()]

    def test_plan_module_model_uses_the_normalized_curriculum_fk(self):
        from .models import LearnerTrainingPlanModule

        field = LearnerTrainingPlanModule._meta.get_field('curriculum_module')
        self.assertEqual(field.db_column, 'curriculum_module_id')
        sql = str(LearnerTrainingPlanModule.objects.all().query)
        self.assertIn('curriculum_module_id', sql)
        self.assertNotIn('learner_training_plan_modules"."module_ref', sql)
        self.assertNotIn('learner_training_plan_modules"."module_title', sql)

    def test_verified_attendance_projects_group_label_through_fk(self):
        # Execute the production queryset construction without running the full
        # attendance pipeline or replacing its SQL with a mock response.
        tree = ast.parse(inspect.getsource(teams_attendance.fetch_verified_teams_attendance_rows))
        assignment = next(node for node in ast.walk(tree) if isinstance(node, ast.Assign)
                          and any(isinstance(t, ast.Name) and t.id == 'module_rows' for t in node.targets))
        scope = {**vars(teams_attendance), 'database': 'default', 'module_refs_needed': {'M1', 'M3'}}
        exec(compile(ast.Module(body=[assignment], type_ignores=[]), '<attendance-query>', 'exec'), scope)
        rows = {row['module_catalogue_id']: row for row in self.query_rows(scope['module_rows'])}
        self.assertEqual(set(rows), {'M1', 'M3'})
        self.assertEqual(rows['M1']['_group_display_name'], 'First group')
        self.assertIsNone(rows['M3']['_group_display_name'])

    def test_recovery_projects_cohort_and_group_without_removed_model_fields(self):
        rows = self.query_rows(alternative_recovery._recovery_modules('default').filter(group_id='G2'))
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['module_catalogue_id'], 'M2')
        self.assertEqual(rows[0]['_group_display_name'], 'Second group')
        self.assertEqual(rows[0]['_cohort_display_name'], 'Cohort')
        self.assertTrue(alternative_recovery._usable_module(SimpleNamespace(**rows[0])))

    def test_identity_history_still_rejects_ambiguous_shared_module_matches(self):
        self.db.executescript('''
            CREATE TABLE curriculum.live_session_attendance_identity_links
                (id TEXT, occurrence_id TEXT, display_name TEXT, learner_profile_id INTEGER, canonical_email TEXT);
            CREATE TABLE curriculum.live_session_occurrences (id TEXT, live_session_id TEXT);
            CREATE TABLE curriculum.live_sessions (id TEXT, module_catalogue_id TEXT);
            CREATE TABLE Learner.learner_training_plan_modules (curriculum_module_id TEXT, learner_id INTEGER);
            INSERT INTO curriculum.live_session_attendance_identity_links VALUES ('L1','O1','Example',11,'example@example.invalid');
            INSERT INTO curriculum.live_session_occurrences VALUES ('O1','S1');
            INSERT INTO curriculum.live_sessions VALUES ('S1','M1');
            INSERT INTO Learner.learner_training_plan_modules VALUES ('M1',11);
        ''')
        tree = ast.parse(inspect.getsource(attendance_link_store.identity_rules))
        sql = next(node.value for node in ast.walk(tree) if isinstance(node, ast.Constant)
                   and isinstance(node.value, str) and node.value.startswith('WITH candidates'))
        sql = sql.replace('=ANY(%s)', ' IN (?, ?)')
        self.assertEqual([row[0] for row in self.db.execute(sql, ['M1','M2'])], ['M1'])
        self.db.execute("INSERT INTO Learner.learner_training_plan_modules VALUES ('M2',11)")
        self.assertEqual(list(self.db.execute(sql, ['M1','M2'])), [])

    def test_current_subject_titles_keep_saved_order_and_scope(self):
        db = self.db

        class Cursor:
            def execute(self, sql, params):
                self.result = db.execute(sql.replace('=ANY(%s)', ' IN (?, ?)'), params[0]).fetchall()

            def fetchall(self):
                return self.result

        with patch.object(student_activity, 'EnrolmentUser'), \
             patch.object(student_activity, '_effective_plan_ids', return_value=['M2', 'M1']):
            rows = student_activity._effective_current_subjects(Cursor(), 11)
        self.assertEqual(rows, [{'id':'M2','title':'Module copy'}, {'id':'M1','title':'Module'}])
