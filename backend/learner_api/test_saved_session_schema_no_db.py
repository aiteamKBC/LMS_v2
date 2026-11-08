"""Saved-plan date reads work with normalized modules and preserve learner history."""
import copy
import json
import sqlite3
from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase

from . import active_users


class SavedSessionSchemaTests(SimpleTestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.addCleanup(self.db.close)
        self.db.executescript('''
            ATTACH DATABASE ':memory:' AS curriculum;
            CREATE TABLE curriculum.modules (module_catalogue_id TEXT,session_overrides TEXT,end_date TEXT);
            INSERT INTO curriculum.modules VALUES
                ('M1','{"reviewed":true}','2026-11-10'),
                ('M2','{}','2026-11-20'),
                ('M3','{"reviewed":true}','2026-12-10');
        ''')
        db = self.db

        class Cursor:
            def execute(self, sql, params):
                # Translate PostgreSQL row JSON and array binding only. Execute
                # the production WHERE clauses against a table with no flags.
                sql = sql.replace("to_jsonb(m)->'session_overrides'", 'session_overrides')
                sql = sql.replace('to_jsonb(m)', "json_object('module_catalogue_id',module_catalogue_id,"
                                  "'session_overrides',json(session_overrides),'end_date',end_date)")
                sql = sql.replace('::jsonb', '').replace('= ANY(%s)',
                    ' IN (' + ','.join('?' for _ in params[0]) + ')')
                self.rows = [(json.loads(row[0]),) for row in db.execute(sql, params[0])]

            def fetchall(self):
                return self.rows

        self.enterContext(patch.object(active_users, 'connections', {
            'default': SimpleNamespace(cursor=lambda: nullcontext(Cursor()))}))

    def test_overlay_keeps_membership_history_and_original_snapshot(self):
        plan = [{'moduleId': 'M1', 'assignmentMode': 'explicit', 'weeks': [
            {'weekId': 'W1', 'sessionDate': '2026-11-01', 'components': [
                {'componentId': 'C1', 'type': 'live_session', 'completed': True}]}]},
            {'moduleId': 'M2', 'weeks': []}]
        original = copy.deepcopy(plan)

        def overlay(module, group, weeks):
            self.assertEqual(module['module_catalogue_id'], 'M1')
            self.assertEqual(module['session_overrides'], {'reviewed': True})
            weeks[0].update(sessionRescheduled=True, sessionDate='2026-11-10')
            weeks[0]['components'][0]['settings'].update(
                sessionRescheduled=True, sessionDate='2026-11-10')

        with patch('curriculum_api.views.apply_module_session_plan_to_weeks', side_effect=overlay) as apply:
            result = active_users.refresh_saved_session_dates(plan)
        apply.assert_called_once()
        self.assertEqual(plan, original)
        self.assertEqual([m['moduleId'] for m in result], ['M1', 'M2'])
        self.assertEqual(result[0]['assignmentMode'], 'explicit')
        self.assertEqual(result[0]['weeks'][0]['sessionDate'], '2026-11-10')
        self.assertTrue(result[0]['weeks'][0]['components'][0]['completed'])
        self.assertEqual(result[0]['endDate'], '2026-11-10')
        self.assertEqual(result[1], original[1])

    def test_no_exceptions_or_missing_module_keeps_same_plan(self):
        for plan in ([], [{'moduleId': 'M2', 'weeks': []}], [{'moduleId': 'missing', 'weeks': []}]):
            with self.subTest(plan=plan):
                self.assertIs(active_users.refresh_saved_session_dates(plan), plan)
