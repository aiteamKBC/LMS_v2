"""Exercise the actual shared hours SQL on isolated in-memory SQLite."""
import ast
import sqlite3
import unittest
from pathlib import Path

class ProgressHourTotalsTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.addCleanup(self.db.close)
        self.db.execute("ATTACH DATABASE ':memory:' AS Learner")
        self.db.executescript('''
            CREATE TABLE Learner.learners(id INTEGER PRIMARY KEY, aptem_id INTEGER);
            CREATE TABLE Learner.learner_progress_entries(
                id INTEGER,learner_id INTEGER,actual_seconds INTEGER,accepted BOOLEAN,
                deleted_at TEXT,canonical_activity_key TEXT);
            CREATE TABLE Learner.learner_monthly_targets(learner_id INTEGER,target_hours NUMERIC);
            CREATE TABLE Learner.learner_activity_reporting_segments(
                progress_id INTEGER,learner_id INTEGER,actual_seconds INTEGER);
            INSERT INTO Learner.learners VALUES(1,101),(2,202),(3,303),(4,303);
            INSERT INTO Learner.learner_progress_entries VALUES
                (10,1,3600,1,NULL,'same'),(11,1,1800,1,NULL,'same'),
                (12,1,7200,0,NULL,'rejected'),(13,1,9000,1,'deleted','deleted'),
                (14,1,NULL,1,NULL,'unknown'),(20,2,7200,1,NULL,'other'),
                (30,3,3600,1,NULL,'ambiguous');
            INSERT INTO Learner.learner_monthly_targets VALUES(1,12.5),(2,20);
            INSERT INTO Learner.learner_activity_reporting_segments VALUES(10,1,99999);
        ''')
        tree = ast.parse(Path(__file__).with_name('student_activity_data.py').read_text(encoding='utf-8'))
        names = {'read_audit_hour_totals', 'read_audit_hour_totals_bulk'}
        self.scope = {}
        exec(compile(ast.Module(body=[n for n in tree.body if isinstance(n, ast.FunctionDef)
                                      and n.name in names], type_ignores=[]), 'hour-readers', 'exec'), self.scope)
        connection = self.db
        class Cursor:
            def execute(inner, sql, params):
                self.sql = sql
                ids = params[0]
                sql = sql.replace('=ANY(%s)', ' IN (' + ','.join('?' for _ in ids) + ')')
                inner.cursor = connection.execute(sql, ids)
            def fetchall(inner):
                return inner.cursor.fetchall()
        self.cursor = Cursor()

    def test_sums_all_accepted_progress_rows_and_ignores_segments(self):
        result = self.scope['read_audit_hour_totals'](self.cursor, 101)
        self.assertEqual(result, {'audit_tp_planned': 12.5, 'audit_lms_actual': 1.5})
        self.assertNotIn('reporting_segments', self.sql)

    def test_batch_totals_keep_learners_separate_and_identity_ambiguity_closed(self):
        result = self.scope['read_audit_hour_totals_bulk'](self.cursor, [101, 202, 303, 'invalid'])
        self.assertEqual(set(result), {101, 202})
        self.assertEqual(result[101]['audit_lms_actual'], 1.5)
        self.assertEqual(result[202]['audit_lms_actual'], 2)

    def test_empty_input_does_not_read_the_database(self):
        self.assertEqual(self.scope['read_audit_hour_totals_bulk'](None, []), {})

if __name__ == '__main__':
    unittest.main()

