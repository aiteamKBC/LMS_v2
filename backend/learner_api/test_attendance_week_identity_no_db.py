"""Attendance projection contract without Django setup, databases or external services."""
import ast
from copy import deepcopy
from datetime import date, datetime, timezone
from pathlib import Path
import re
import unittest


def projection_functions():
    source = Path(__file__).with_name('attendance_lectures.py')
    tree = ast.parse(source.read_text(encoding='utf-8-sig'))
    names = {'_text', '_key', '_component_for', 'build_lectures'}
    nodes = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names]
    scope = {
        're': re,
        'LIVE_SESSION_MINUTES': 120,
        'session_key': lambda row: 'teams:' + row['session_id'],
        'report_id': lambda row: 1,
        'attendance_outcome': lambda row: ('completed', True),
        '_aware': lambda value: value,
        'as_json': lambda value, default: value if isinstance(value, dict) else default,
        '_component_ksbs': lambda component: [],
        '_activity_ksbs': lambda components: [],
        '_fill_ksbs': lambda *args: None,
    }
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(source), 'exec'), scope)
    return scope['build_lectures']


class AttendanceWeekIdentityTests(unittest.TestCase):
    def setUp(self):
        self.build = projection_functions()
        self.row = {
            'source': 'microsoft-teams', 'session_id': 'occ-one', 'live_session_id': 'series-one',
            'session_number': 1, 'module_catalogue_id': 'module-one', 'module_title': 'Example module',
            'session_title': 'Example lecture', 'session_date': date(2026, 11, 9),
            'scheduled_start': datetime(2026, 11, 9, 10, tzinfo=timezone.utc),
            'scheduled_end': datetime(2026, 11, 9, 11, tzinfo=timezone.utc),
            'attendance_status': 'present', 'updated_at': None,
        }
        self.component = {
            'id': 'component-one', 'module_catalogue_id': 'module-one', 'week_id': 'week-one',
            'week_title': 'Week one', 'type': 'live_session', 'title': 'Example live session',
            'description': '', 'completed': False,
            'settings': {'teamsOccurrenceId': 'occ-one', 'sessionDate': '2026-11-06'},
        }

    def test_moved_occurrence_retains_its_authored_week_and_exact_component(self):
        before = deepcopy((self.row, self.component))
        for kind in ('commercial', 'apprenticeship'):
            with self.subTest(kind=kind):
                lecture = self.build([self.row], {}, [], [self.component], kind, 12)[0]
                self.assertEqual(lecture['weekId'], 'week-one')
                self.assertEqual(lecture['date'], '2026-11-09')
                self.assertEqual(lecture['componentHref'], f'/learner/component/{kind}/12/component-one')
                self.assertEqual(lecture['joinUrl'], f'/learner_api/session-results/{kind}/12/series-one/sessions/1/join/')
                self.assertEqual(lecture['status'], 'completed')
        self.assertEqual((self.row, self.component), before)

    def test_does_not_assign_a_different_modules_week(self):
        component = {**self.component, 'module_catalogue_id': 'different-module', 'week_id': 'different-week'}
        lecture = self.build([self.row], {}, [], [component], 'commercial', 12)[0]
        self.assertNotIn('weekId', lecture)
        self.assertNotIn('componentHref', lecture)

    def test_unplaced_component_does_not_fabricate_a_week(self):
        component = {**self.component, 'week_id': None}
        lecture = self.build([self.row], {}, [], [component], 'commercial', 12)[0]
        self.assertNotIn('weekId', lecture)
        self.assertEqual(lecture['componentHref'], '/learner/component/commercial/12/component-one')


if __name__ == '__main__':
    unittest.main()
