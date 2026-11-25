"""Stdlib-only source and dependency contracts; no application initialization."""
import ast
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[3]
SNAPSHOT = json.loads((ROOT / 'directory/tests/fixtures/legacy_snapshots/boundary_snapshot.json').read_text(encoding='utf-8'))


def function(path, name):
    return next(n for n in ast.parse(path.read_text(encoding='utf-8-sig')).body
                if isinstance(n, ast.FunctionDef) and n.name == name)


def dumped(nodes):
    return ast.dump(ast.Module(body=nodes, type_ignores=[]))


class DirectorySourceContracts(unittest.TestCase):
    def test_public_signatures_and_decorators_preserved(self):
        for key, entry in SNAPSHOT.items():
            filename, name = key.split(':')
            with self.subTest(symbol=key):
                old = ast.parse(entry['source']).body[0]
                new = function(ROOT / filename, name)
                self.assertEqual(ast.dump(old.args), ast.dump(new.args))
                self.assertEqual(entry['decorators'], [ast.unparse(d) for d in new.decorator_list])

    def test_programme_sql_and_projection_statements_are_exact(self):
        old = ast.parse(SNAPSHOT['views.py:assigned_learners_for_programme']['source']).body[0]
        reader = function(ROOT / 'directory/infrastructure/assigned_reads.py', 'read_programme_profiles')
        application = function(ROOT / 'directory/application/assigned_reads.py', 'assigned_learners_for_programme')
        self.assertEqual(dumped(old.body[1:2]), dumped(reader.body[:-1]))
        self.assertEqual(dumped(old.body[2:]), dumped(application.body[1:]))

    def test_workspace_sql_join_and_order_statements_are_exact(self):
        old = ast.parse(SNAPSHOT['views.py:curriculum_tutor_workspace']['source']).body[0]
        branch = next(n for n in old.body if isinstance(n, ast.If) and ast.unparse(n.test) == 'module_ids')
        reader = function(ROOT / 'catalogue/infrastructure/workspace_reads.py', 'tutor_workspace_module_rows')
        self.assertEqual(dumped(branch.body[:-1]), dumped(reader.body[:-1]))

    def test_pure_placement_and_progress_rules_are_exact(self):
        for filename, name, owner in (
            ('views.py', 'scope_programme_identifier', 'directory/domain/placement.py'),
            ('views.py', 'narrow_learners_to_placement', 'directory/domain/placement.py'),
            ('learner_directory_details.py', 'activity_summary', 'directory/domain/progress.py'),
        ):
            old = ast.parse(SNAPSHOT[filename + ':' + name]['source']).body[0]
            self.assertEqual(dumped(old.body), dumped(function(ROOT / owner, name).body))

    def test_owners_have_no_legacy_reverse_imports_or_application_infrastructure_edges(self):
        paths = list((ROOT / 'directory').rglob('*.py')) + [
            ROOT / 'catalogue/application/tutor_workspace.py',
            ROOT / 'catalogue/infrastructure/workspace_reads.py',
            ROOT / 'catalogue/api/tutor_workspace.py',
        ]
        for path in paths:
            if path.name.startswith('test_'):
                continue
            for node in ast.walk(ast.parse(path.read_text(encoding='utf-8'))):
                if isinstance(node, (ast.Import, ast.ImportFrom)):
                    imports = [a.name for a in node.names]
                    if isinstance(node, ast.ImportFrom):
                        imports.append(node.module or '')
                    self.assertFalse(any('views' in name.split('.') for name in imports), path)
                    if path.parent.name in {'application', 'domain'}:
                        self.assertFalse(any(name.startswith(('django', 'config')) or
                                             'infrastructure' in name.split('.') for name in imports), path)


if __name__ == '__main__':
    unittest.main()
