"""Execute dashboard SQL on FK-only modules without an application database."""
import ast
import inspect
import re
import sqlite3

from django.test import SimpleTestCase

from . import bulk_register, weekly_learning


class DashboardModuleSchemaTests(SimpleTestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.addCleanup(self.db.close)
        self.db.create_function('btrim', 1, lambda value: value.strip() if value is not None else None)
        self.db.create_function('regexp', 2, lambda pattern, value: bool(re.search(pattern, str(value or ''), re.I)))
        self.db.executescript('''
            ATTACH DATABASE ':memory:' AS curriculum;
            CREATE TABLE curriculum.modules (module_catalogue_id TEXT PRIMARY KEY, title TEXT);
            INSERT INTO curriculum.modules VALUES ('M1','First'), ('M2','Other'), ('M3',' ');
        ''')

    def test_weekly_membership_and_child_visibility_on_normalized_modules(self):
        self.db.executescript('''
            CREATE TABLE curriculum.components (id TEXT,week_id TEXT,module_catalogue_id TEXT,
                type TEXT,settings_json TEXT,live_sessions_link TEXT,deleted_at TEXT,display_order INTEGER);
            CREATE TABLE curriculum.quiz_component_links (component_id TEXT,quiz_id INTEGER);
            CREATE TABLE curriculum.quizzes (id INTEGER);
            INSERT INTO curriculum.components VALUES
                ('C1','W1','M1','reading','{}',NULL,NULL,1),
                ('C2','W1','M1','reading','{}',NULL,'removed',2),
                ('C3','W2','M2','reading','{}',NULL,NULL,1),
                ('C4','W3','M3','reading','{}',NULL,NULL,1);
        ''')
        tree = ast.parse(inspect.getsource(weekly_learning.read_weekly_learning))
        query = next(node.args[0] for node in ast.walk(tree)
                     if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                     and node.func.attr == 'execute' and node.args
                     and isinstance(node.args[0], ast.JoinedStr)
                     and any(isinstance(value, ast.Constant) and isinstance(value.value, str)
                             and 'SELECT c.id,c.week_id,c.module_catalogue_id,c.type' in value.value
                             for value in node.args[0].values))
        # Exercise the production SELECT and visibility predicates. These fixtures
        # are readings, so the video-only content expression is immaterial.
        sql = eval(compile(ast.Expression(query), '<weekly-select>', 'eval'),
                   {**vars(weekly_learning), 'content_presence': '1', 'detail_filter': ''})
        sql = sql.replace('=ANY(%s)', ' IN (?, ?)').replace('::bigint', '')
        sql = sql.replace(' ~* ', ' REGEXP ').replace(' ~ ', ' REGEXP ')
        rows = self.db.execute(sql, ['M1', 'M3']).fetchall()
        self.assertEqual([row[0] for row in rows], ['C1'])
        self.assertEqual([row[0] for row in self.db.execute(sql, ['M2', 'M3'])], ['C3'])

    def test_saved_register_preserves_profile_scope_and_session_status(self):
        self.db.executescript('''
            CREATE TABLE curriculum.live_sessions (id TEXT,module_catalogue_id TEXT,status TEXT);
            CREATE TABLE curriculum.live_session_occurrences (id TEXT,live_session_id TEXT,
                scheduled_start TEXT,scheduled_end TEXT,session_number INTEGER,status TEXT);
            CREATE TABLE curriculum.live_session_learner_attendance (learner_profile_id INTEGER,
                occurrence_id TEXT,live_session_id TEXT,module_catalogue_id TEXT,attendance_status TEXT,
                updated_at TEXT,attended_seconds INTEGER,attendance_report_id TEXT);
            INSERT INTO curriculum.live_sessions VALUES ('S1','M1','scheduled');
            INSERT INTO curriculum.live_session_occurrences VALUES
                ('O1','S1','2026-10-01 09:00','2026-10-01 10:00',1,'completed');
            INSERT INTO curriculum.live_session_learner_attendance VALUES
                (11,'O1','S1','M1','present',NULL,3600,'R1'),
                (12,'O1','S1','M1','absent',NULL,0,'R1'),
                (11,'O1','S1','M2','present',NULL,3600,'R1');
        ''')
        sql = bulk_register.REGISTER_SQL.replace('=ANY(%s)', ' IN (?)')
        rows = self.db.execute(sql, [11]).fetchall()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0][:5], (11, 'O1', 'S1', 'M1', 'present'))
        self.assertEqual(len(self.db.execute(sql, [12]).fetchall()), 1)
        self.assertEqual(self.db.execute(sql, [13]).fetchall(), [])
        for table in ('live_sessions', 'live_session_occurrences'):
            for status in ('cancelled', 'canceled', 'deleted', 'failed', 'superseded'):
                with self.subTest(table=table, status=status):
                    self.db.execute(f'UPDATE curriculum.{table} SET status=?', [status])
                    self.assertEqual(self.db.execute(sql, [11]).fetchall(), [])
            self.db.execute(f"UPDATE curriculum.{table} SET status='completed'")
