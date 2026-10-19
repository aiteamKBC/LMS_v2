"""Quiz placement regressions: real reader, scripted SELECTs, no Django/DB/network."""
import ast
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch


class QuizPlacementTests(unittest.TestCase):
    def setUp(self):
        guard = patch('socket.socket', side_effect=AssertionError('Network prohibited'))
        guard.start()
        self.addCleanup(guard.stop)
        self.cursor = MagicMock()
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = self.cursor
        self.scope = {'connections': {'enrolment': connection}, 'DatabaseError': RuntimeError,
                      'logger': MagicMock(), '_s': lambda value: '' if value is None else str(value),
                      '_MODULE_ASSESSMENTS_WEEK_LABEL': 'Module assessments'}
        path = Path(__file__).with_name('learner_detail.py')
        names = {'_resolve_week_ids', '_module_assessment_week_id', '_normalise_quiz_scope_value',
                 '_matching_module_ids_for_quiz_record', '_append_week_quizzes', '_display_quiz_title'}
        nodes = [node for node in ast.parse(path.read_text(encoding='utf-8')).body
                 if isinstance(node, ast.FunctionDef) and node.name in names]
        exec(compile(ast.Module(body=nodes, type_ignores=[]), str(path), 'exec'), self.scope)
        self.weeks = [{'moduleId': 'M1', 'module': 'Module', 'weekId': wid, 'week': wid} for wid in ('W1', 'W2')]
        self.component = {**self.weeks[0], 'componentId': 'C1', 'component': 'Quiz', 'isQuiz': True,
                          'quizMeta': {'quizId': 10}, 'quizAttempts': [{'passed': True, 'score': 100}]}

    def run_reader(self, components, *, quiz_week='', extra_quiz=False, other_module=False):
        modules = [('M1', 'Module', 'P1', 'Programme')]
        weeks = deepcopy(self.weeks)
        if other_module:
            modules.append(('M2', 'Other module', 'P1', 'Programme'))
            weeks.append({'moduleId': 'M2', 'module': 'Other module', 'weekId': 'OTHER', 'week': 'Other week'})
        quizzes = [(10, quiz_week, 'Quiz', 3, 10, 'Minutes', 'P1', 'Programme', 'Module')]
        if extra_quiz:
            quizzes.append((11, '', 'Independent quiz', 3, 10, 'Minutes', 'P1', 'Programme', 'Module'))
        links = [(10, 'M1', quiz_week)] + ([(10, 'M2', '')] if other_module else [])
        def execute(sql, params):
            self.assertTrue(sql.strip().startswith('SELECT'))
            if 'FROM curriculum.modules' in sql:
                result = modules
            elif 'FROM curriculum.quiz_course_links' in sql:
                result = links
            else:
                result = quizzes
            self.cursor.fetchall.return_value = result
        self.cursor.execute.side_effect = execute
        return self.scope['_append_week_quizzes'](weeks, components, [{'moduleId': row[0]} for row in modules], strict=True)

    def test_linked_component_with_missing_quiz_week_is_not_appended_or_given_empty_bucket(self):
        before = deepcopy(self.component)
        weeks, components = self.run_reader([self.component])
        self.assertEqual(weeks, self.weeks)
        self.assertEqual(components, [before])
        self.assertIs(components[0], self.component)

    def test_stale_published_week_does_not_duplicate_or_move_authored_placement(self):
        for week in ('W2', 'DELETED-WEEK', 'W1'):
            with self.subTest(week=week):
                weeks, components = self.run_reader([self.component], quiz_week=week)
                self.assertEqual(weeks, self.weeks)
                self.assertEqual(components, [self.component])

    def test_same_quiz_assigned_to_another_module_remains_visible_there(self):
        _, components = self.run_reader([self.component], other_module=True)
        self.assertEqual([(row['moduleId'], row['quizMeta']['quizId']) for row in components], [('M1', 10), ('M2', 10)])

    def test_independent_module_assessment_remains_available(self):
        weeks, components = self.run_reader([self.component], extra_quiz=True)
        self.assertEqual([row['quizMeta']['quizId'] for row in components], [10, 11])
        self.assertEqual(weeks[-1]['week'], 'Module assessments')

    def test_repeated_refresh_is_idempotent(self):
        _, first = self.run_reader([self.component], extra_quiz=True)
        _, second = self.run_reader(first, extra_quiz=True)
        self.assertEqual(first, second)

    def test_author_created_placements_and_attempts_are_not_removed(self):
        second = {**self.component, **self.weeks[1], 'componentId': 'C2'}
        _, components = self.run_reader([self.component, second])
        self.assertEqual(components, [self.component, second])


if __name__ == '__main__':
    unittest.main()
