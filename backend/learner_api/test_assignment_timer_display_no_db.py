"""Pure display-correction checks; no application startup or database access."""
import ast
import unittest
from pathlib import Path


class AssignmentTimerDisplayTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        source = Path(__file__).with_name('reflection_submissions.py')
        names = {'_dict', 'corrected_timer_display_seconds'}
        nodes = [node for node in ast.parse(source.read_text(encoding='utf-8')).body
                 if isinstance(node, ast.FunctionDef) and node.name in names]
        namespace = {}
        exec(compile(ast.Module(body=nodes, type_ignores=[]), str(source), 'exec'), namespace)
        cls.corrected_seconds = staticmethod(namespace['corrected_timer_display_seconds'])

    def test_submitted_display_override_keeps_original_elapsed_seconds(self):
        record = {'assignmentElapsedSeconds': 426695,
                  'timerDisplayCorrection': {'displaySeconds': 28800, 'originalElapsedSeconds': 426695}}
        self.assertEqual(self.corrected_seconds(record, 'submitted_for_tutor_review'), 28800)
        self.assertEqual(record['assignmentElapsedSeconds'], 426695)

    def test_drafts_and_invalid_overrides_do_not_change_display(self):
        for status, seconds in [('draft', 28800), ('accepted', True), ('partial', -1), ('accepted', '28800')]:
            with self.subTest(status=status, seconds=seconds):
                self.assertIsNone(self.corrected_seconds({'timerDisplayCorrection': {'displaySeconds': seconds}}, status))
