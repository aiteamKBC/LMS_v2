"""Source fidelity and DB-free revision policy regression tests."""
import ast
from copy import deepcopy
from datetime import datetime, timezone
from decimal import Decimal
from functools import lru_cache
import importlib
import json
from pathlib import Path
import sys
import unittest

import importlib.util as _read_dependencies_util
_read_dependencies_spec = _read_dependencies_util.spec_from_file_location('read_dependencies_oracle', Path(__file__).with_name('read_dependencies_oracle.py'))
_read_dependencies = _read_dependencies_util.module_from_spec(_read_dependencies_spec)
_read_dependencies_spec.loader.exec_module(_read_dependencies)

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT.parent.parent))
from curriculum_api.catalogue.domain import structure_revision as policy

SNAPSHOT = json.loads((ROOT / 'tests/fixtures/legacy_snapshots/revisions_snapshot.json').read_text(encoding='utf-8'))


@lru_cache(None)
def tree(path):
    return _read_dependencies.source_tree(path)


def function(path, name):
    return deepcopy(next(n for n in tree(path).body if isinstance(n, ast.FunctionDef) and n.name == name))


def dump(nodes):
    return [ast.dump(n) for n in nodes]


class RevisionContracts(unittest.TestCase):
    def test_original_bodies_preserved_across_the_extraction(self):
        for name, entry in SNAPSHOT.items():
            old = ast.parse(entry['source']).body[0]
            new = function(ROOT.parent.parent.joinpath(*entry['module'].split('.')).with_suffix('.py'), name)

            class StripImports(ast.NodeTransformer):
                def visit_ImportFrom(self, node):
                    return None

                def visit_Call(self, node):
                    if isinstance(node.func, ast.Name) and node.func.id == 'connection_vendor':
                        return ast.parse('connection.vendor', mode='eval').body
                    return self.generic_visit(node)

            old = StripImports().visit(old)
            new = StripImports().visit(new)
            if name == 'module_structure_revision':
                old_loop = next(n for n in old.body if isinstance(n, ast.For))
                new_loop = next(n for n in new.body if isinstance(n, ast.For))
                rows = function(ROOT / 'domain/structure_revision.py', 'revision_rows')
                restored = ast.parse(ast.unparse(rows).replace('volatile_columns', 'STRUCTURE_REVISION_VOLATILE_COLUMNS')).body[0]
                self.assertEqual(ast.dump(restored.body[0]), ast.dump(old_loop.body[-2]))
                self.assertEqual(ast.dump(restored.body[-1].value), ast.dump(old_loop.body[-1].value.args[0].elts[1]))
                self.assertEqual(ast.unparse(new_loop.body[-1]),
                    'material.append([label, revision_rows(rows, stored, STRUCTURE_REVISION_VOLATILE_COLUMNS, sort_column, clean_str)])')
                new_loop.body[-1:] = old_loop.body[-2:]
                digest = function(ROOT / 'domain/structure_revision.py', 'revision_digest')
                self.assertEqual(ast.dump(digest.body[0]), ast.dump(old.body[-1]))
                self.assertEqual(ast.unparse(new.body[-1]), 'return revision_digest(material)')
                new.body[-1] = digest.body[0]
            with self.subTest(function=name):
                self.assertEqual(dump(new.body), dump(old.body))

    def test_public_signatures_decorators_and_dependency_bindings(self):
        self.assertEqual(len(SNAPSHOT), 5)
        for name, entry in SNAPSHOT.items():
            old = ast.parse(entry['source']).body[0]
            wrapper = function(ROOT.parent / 'views.py', name)
            self.assertEqual(ast.dump(wrapper.args), ast.dump(old.args))
            self.assertEqual([ast.unparse(d) for d in wrapper.decorator_list], entry['decorators'])
            call = wrapper.body[-1].value
            self.assertEqual([ast.unparse(a) for a in call.args], [a.arg for a in old.args.args])
            keywords = {k.arg: ast.unparse(k.value) for k in call.keywords}
            for dep in entry['deps']:
                self.assertEqual(keywords[dep], entry['bindings'].get(dep, dep))
            for arg in old.args.kwonlyargs:
                self.assertEqual(keywords[arg.arg], arg.arg)

    def test_dependency_direction_is_acyclic_and_framework_free(self):
        allowed = {
            'application/structure_revisions.py': {(2, 'domain.structure_revision')},
            'domain/structure_revision.py': {(0, 'hashlib'), (0, 'json')},
            'infrastructure/structure_sources.py': set(),
        }
        for path, imports in allowed.items():
            actual = set()
            for node in ast.walk(tree(ROOT / path)):
                if isinstance(node, ast.Import):
                    actual.update((0, a.name) for a in node.names)
                if isinstance(node, ast.ImportFrom):
                    actual.add((node.level, node.module))
            self.assertEqual(actual, imports)
        for module in ('application.structure_revisions', 'infrastructure.structure_sources'):
            importlib.import_module('curriculum_api.catalogue.' + module)
        self.assertNotIn('django', sys.modules)


class RevisionValuePolicy(unittest.TestCase):
    def setUp(self):
        # Actual original projection and digest expressions, not a copied oracle.
        old = ast.parse(SNAPSHOT['module_structure_revision']['source']).body[0]
        loop = next(n for n in old.body if isinstance(n, ast.For))
        self.original = ast.Module(body=loop.body[-2:] + [old.body[-1]], type_ignores=[])
        self.rows = [
            {'id': ' B ', 'title': 'محتوى 🙂', 'body': {'x': [None, '']}, 'amount': Decimal('0.125'),
             'date': datetime(2026, 1, 1, tzinfo=timezone.utc), 'updated_at': 'old', 'display_name': 'derived'},
            {'id': 'A', 'title': None, 'body': {}, 'amount': Decimal('0'), 'created_at': 'old'},
        ]

    def compare(self, rows, stored):
        clean = lambda value: str(value or '').strip()
        env = dict(rows=deepcopy(rows), stored=stored, STRUCTURE_REVISION_VOLATILE_COLUMNS=('created_at', 'updated_at'),
                   sort_column='id', clean_str=clean, material=[], label='components')
        import hashlib
        env.update(hashlib=hashlib, json=json)
        nodes = deepcopy(self.original.body)
        nodes[-1] = ast.Assign(targets=[ast.Name(id='result', ctx=ast.Store())], value=nodes[-1].value)
        exec(compile(ast.fix_missing_locations(ast.Module(body=nodes, type_ignores=[])), '<actual-old-projection>', 'exec'), env)
        before = deepcopy(rows)
        result = policy.revision_rows(rows, stored, ('created_at', 'updated_at'), 'id', clean)
        digest = policy.revision_digest([['components', result]])
        self.assertEqual(result, env['material'][0][1])
        self.assertEqual(digest, env['result'])
        self.assertEqual(rows, before)
        return digest

    def test_native_values_empty_columns_and_unknown_future_columns(self):
        for rows in ([], self.rows, list(reversed(self.rows)), self.rows * 2):
            for columns in (set(), {'id', 'title', 'body', 'amount', 'date'}, {'id'}):
                self.compare(rows, columns)

    def test_timestamps_derived_values_and_order_do_not_change_revision(self):
        columns = {'id', 'title', 'body', 'amount', 'date'}
        expected = self.compare(self.rows, columns)
        self.rows.reverse()
        self.rows[1].update(created_at='later', updated_at='later', display_name='changed')
        self.assertEqual(self.compare(self.rows, columns), expected)

    def test_content_and_duplicate_rows_do_change_revision(self):
        expected = self.compare(self.rows, set())
        self.rows[0]['body']['x'].append('external edit')
        self.assertNotEqual(self.compare(self.rows, set()), expected)
        self.assertNotEqual(self.compare(self.rows * 2, set()), self.compare(self.rows, set()))


if __name__ == '__main__':
    unittest.main()
