"""Static extraction contracts: no Django import, database or provider execution."""
import ast
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import unittest

import importlib.util as _read_dependencies_util
_read_dependencies_spec = _read_dependencies_util.spec_from_file_location('read_dependencies_oracle', Path(__file__).with_name('read_dependencies_oracle.py'))
_read_dependencies = _read_dependencies_util.module_from_spec(_read_dependencies_spec)
_read_dependencies_spec.loader.exec_module(_read_dependencies)

ROOT = Path(__file__).resolve().parents[3]
DATA = (ROOT / 'catalogue/tests/fixtures/legacy_snapshots/prebatch03_snapshot.json').read_bytes()
assert hashlib.sha256(DATA).hexdigest() == 'df45c28e0d47de2e705afacfd39c9eb2b2a3c56ceec04e163271b2eba1afe19c'
SNAPSHOT = json.loads(DATA)


def function(path, name):
    return next(n for n in _read_dependencies.source_tree(path).body
                if isinstance(n, ast.FunctionDef) and n.name == name)


class CatalogueBoundaryTests(unittest.TestCase):
    def test_bodies_preserved_except_explicit_dependency_references(self):
        for key, entry in SNAPSHOT.items():
            with self.subTest(function=key):
                original = ast.parse(entry['source']).body[0]
                path = ROOT.parent.joinpath(*entry['module'].split('.')).with_suffix('.py')
                actual = deepcopy(function(path, original.name))
                attrs = set(entry['view_attrs'])
                class RestoreReferences(ast.NodeTransformer):
                    def visit_Name(self, node):
                        if node.id in attrs and isinstance(node.ctx, ast.Load):
                            return ast.copy_location(ast.Attribute(
                                value=ast.Name(id='views', ctx=ast.Load()), attr=node.id, ctx=ast.Load()), node)
                        return node
                actual = RestoreReferences().visit(actual)
                self.assertEqual([ast.dump(n) for n in original.body], [ast.dump(n) for n in actual.body])

    def test_wrapper_signatures_and_bindings(self):
        for key, entry in SNAPSHOT.items():
            filename, name = key.split(':')
            with self.subTest(function=key):
                original = ast.parse(entry['source']).body[0]
                wrapper = function(ROOT / 'views.py', name)
                self.assertEqual(ast.dump(wrapper.args), ast.dump(original.args))
                imports = [n for n in wrapper.body if isinstance(n, ast.ImportFrom)
                           and any(a.asname == 'query' for a in n.names)]
                self.assertEqual(len(imports), 1)
                self.assertEqual('curriculum_api.' + imports[0].module, entry['module'])
                self.assertTrue(all(isinstance(n, (ast.Expr, ast.ImportFrom, ast.Return)) for n in wrapper.body))
                call = wrapper.body[-1].value
                keywords = {k.arg: ast.unparse(k.value) for k in call.keywords}
                for dep in entry['deps']:
                    expected = {
                        'ksb_counts_selection': 'partial(ksb_counts_selection, live_authoring_rows_sql=live_authoring_rows_sql, AUTHORING_KSB_MAPPINGS_TABLE=AUTHORING_KSB_MAPPINGS_TABLE, relation=ksb_mapping_placement.relation)',
                        'apply_authoring_facts': 'partial(apply_authoring_facts, format_created_at=format_created_at)',
                    }.get(dep, dep)
                    self.assertEqual(keywords[dep], expected)

    def test_no_outward_import_edges(self):
        for module in {e['module'] for e in SNAPSHOT.values()}:
            path = ROOT.parent.joinpath(*module.split('.')).with_suffix('.py')
            tree = _read_dependencies.source_tree(path)
            for node in ast.walk(tree):
                if isinstance(node, ast.ImportFrom):
                    self.assertEqual(node.level, 0)
                    self.assertEqual(node.module, 'collections')
                elif isinstance(node, ast.Import):
                    self.assertEqual([a.name for a in node.names], ['json'])
            # Only stdlib imports: there can be no return edge to the legacy adapters.

    def test_no_mutation_or_provider_capabilities_added(self):
        for module in {e['module'] for e in SNAPSHOT.values()}:
            path = ROOT.parent.joinpath(*module.split('.')).with_suffix('.py')
            tree = _read_dependencies.source_tree(path)
            imports = [ast.unparse(n) for n in ast.walk(tree) if isinstance(n, (ast.Import, ast.ImportFrom))]
            self.assertFalse(any(word in value for value in imports
                                 for word in ('django', 'views', 'requests', 'httpx', 'graph', 'redis')))


if __name__ == '__main__':
    unittest.main()
