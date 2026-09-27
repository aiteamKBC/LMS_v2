"""Pure identity-alias checks; this file never imports Django or opens a database."""
import ast
import re
import types
import unicodedata
import unittest
from pathlib import Path


SOURCE = Path(__file__).with_name('teams_attendance.py')
POLICY = SOURCE.parent.parent / 'curriculum_api' / 'session_results_policy.py'


def load_functions(*names, namespace=None):
    tree = ast.parse(SOURCE.read_text(encoding='utf-8-sig'))
    selected = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names]
    namespace = dict(namespace or {})
    exec(compile(ast.Module(body=selected, type_ignores=[]), str(SOURCE), 'exec'), namespace)
    return namespace


class AttendanceAliasTests(unittest.TestCase):
    def setUp(self):
        policy = ast.parse(POLICY.read_text(encoding='utf-8-sig'))
        node = next(item for item in policy.body if isinstance(item, ast.FunctionDef) and item.name == 'attendance_name_key')
        shared = {'re': re, 'unicodedata': unicodedata}
        exec(compile(ast.Module(body=[node], type_ignores=[]), str(POLICY), 'exec'), shared)
        self.functions = load_functions(
            '_email', '_canonical_attendance_email', '_unique_exact_name_email',
            namespace={'attendance_name_key': shared['attendance_name_key']},
        )
        self.subject = self.functions['_canonical_attendance_email']

    def test_reviewed_alias_resolves_only_inside_its_module(self):
        aliases = {'MOD-1': {'other@example.test': 'learner@example.test'}}

        self.assertEqual(
            self.subject('MOD-1', ' Other@Example.Test ', aliases),
            'learner@example.test',
        )
        self.assertEqual(
            self.subject('MOD-2', ' Other@Example.Test ', aliases),
            'other@example.test',
        )

    def test_unknown_email_remains_normalized_and_never_matches_by_name(self):
        self.assertEqual(
            self.subject('MOD-1', 'UNKNOWN@EXAMPLE.TEST', {}),
            'unknown@example.test',
        )

    def test_unique_exact_full_name_matches_but_partial_and_ambiguous_names_do_not(self):
        match = self.functions['_unique_exact_name_email']
        learners = {
            'curtis@example.test': types.SimpleNamespace(full_name='Curtis Cooper'),
            'other@example.test': types.SimpleNamespace(full_name='Other Learner'),
        }
        self.assertEqual(match('Curtis Cooper (Unverified)', set(learners), learners), 'curtis@example.test')
        self.assertEqual(match('Curtis', set(learners), learners), '')

        learners['duplicate@example.test'] = types.SimpleNamespace(full_name='Curtis Cooper')
        self.assertEqual(match('Curtis Cooper', set(learners), learners), '')


if __name__ == '__main__':
    unittest.main()
