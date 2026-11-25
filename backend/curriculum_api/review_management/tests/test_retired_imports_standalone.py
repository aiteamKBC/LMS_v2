"""Prevent callers and mocks from restoring removed Review compatibility paths."""
import ast
import json
from pathlib import Path
import unittest


BACKEND = Path(__file__).resolve().parents[3]
RETIRED = frozenset(json.loads(
    (Path(__file__).parent / 'fixtures/retired_review_exports.json').read_text()
))


class RetiredReviewImportsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sources = []
        for path in sorted(BACKEND.rglob('*.py')):
            if '__pycache__' in path.parts or 'fixtures' in path.parts:
                continue
            relative = path.relative_to(BACKEND)
            parts = list(relative.with_suffix('').parts)
            package = parts[:-1]
            cls.sources.append((relative, package, ast.parse(path.read_bytes())))

    def test_retired_modules_are_absent(self):
        for module in RETIRED:
            with self.subTest(module=module):
                self.assertFalse(BACKEND.joinpath(*module.split('.')).with_suffix('.py').exists())

    def test_no_backend_import_resolves_to_retired_modules(self):
        violations = []
        for relative, package, tree in self.sources:
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    targets = [alias.name for alias in node.names]
                elif isinstance(node, ast.ImportFrom):
                    base = node.module or ''
                    if node.level:
                        base = '.'.join(package[:len(package) - node.level + 1] + ([base] if base else []))
                    targets = [base] + [base + '.' + alias.name for alias in node.names]
                else:
                    continue
                for target in targets:
                    if target in RETIRED:
                        violations.append((str(relative), node.lineno, target))
        self.assertEqual(violations, [])

    def test_mock_and_dynamic_import_targets_use_actual_owners(self):
        violations = []
        for relative, _, tree in self.sources:
            for node in ast.walk(tree):
                if not isinstance(node, ast.Call) or not node.args:
                    continue
                name = node.func.id if isinstance(node.func, ast.Name) else getattr(node.func, 'attr', '')
                if name not in ('patch', 'import_module', '__import__'):
                    continue
                argument = node.args[0]
                if not isinstance(argument, ast.Constant) or not isinstance(argument.value, str):
                    continue
                target = argument.value
                if any(target == old or target.startswith(old + '.') for old in RETIRED):
                    violations.append((str(relative), node.lineno, target))
        self.assertEqual(violations, [])


if __name__ == '__main__':
    unittest.main()
