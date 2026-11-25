"""Source contracts for the batched read extraction; stdlib only."""
import ast
import copy
import json
from pathlib import Path
import unittest

import importlib.util as _read_dependencies_util
_read_dependencies_spec = _read_dependencies_util.spec_from_file_location('read_dependencies_oracle', Path(__file__).with_name('read_dependencies_oracle.py'))
_read_dependencies = _read_dependencies_util.module_from_spec(_read_dependencies_spec)
_read_dependencies_spec.loader.exec_module(_read_dependencies)

ROOT = Path(__file__).resolve().parents[3]
SNAPSHOT = json.loads((ROOT / 'catalogue/tests/fixtures/legacy_snapshots/read_runtime_snapshot.json').read_text(encoding='utf-8'))


class ReadRuntimeContracts(unittest.TestCase):
    def test_extracted_bodies_preserve_all_original_statements(self):
        for name, entry in SNAPSHOT.items():
            with self.subTest(symbol=name):
                original = ast.parse(entry['source']).body[0]
                path = ROOT.parent.joinpath(*entry['owner'].split('.')).with_suffix('.py')
                actual = next(n for n in _read_dependencies.source_tree(path).body
                              if isinstance(n, ast.FunctionDef) and n.name == name)
                replacements = entry['transforms']

                class LiveState(ast.NodeTransformer):
                    def visit_Name(self, node):
                        if node.id in replacements:
                            return ast.parse(replacements[node.id], mode='eval').body
                        return node

                expected = LiveState().visit(copy.deepcopy(original))
                if name in {'table_exists', 'learner_schema_table_exists', 'learner_schema_columns'}:
                    from curriculum_api.catalogue.tests.parity.required_read_assertions import assert_success_contract
                    # The legacy signature is checked separately; this owner
                    # already adds its explicit infrastructure capabilities.
                    expected.args = copy.deepcopy(actual.args)
                    # Request memoization lives on database_reads' public
                    # wrappers; their original decorators are checked below.
                    expected.decorator_list = copy.deepcopy(actual.decorator_list)
                    assert_success_contract(self, expected, actual)
                    continue
                # Two obsolete docstrings were corrected; all executable
                # statements, SQL and response expressions remain exact.
                if name in {'cached_curriculum_value', 'scope_placement_lineage'}:
                    for function in (expected, actual):
                        self.assertIsInstance(function.body[0], ast.Expr)
                        self.assertIsInstance(function.body[0].value, ast.Constant)
                        self.assertIsInstance(function.body[0].value.value, str)
                        function.body = function.body[1:]
                self.assertEqual(ast.dump(ast.Module(body=actual.body, type_ignores=[])),
                                 ast.dump(ast.Module(body=expected.body, type_ignores=[])))

    def test_legacy_signatures_and_decorators_are_unchanged(self):
        functions = {n.name: n for n in _read_dependencies.source_tree(ROOT / 'views.py').body
                     if isinstance(n, ast.FunctionDef)}
        runtime = _read_dependencies.source_tree(ROOT / 'catalogue/infrastructure/cache_runtime.py')
        for node in runtime.body:
            if isinstance(node, ast.FunctionDef) and node.name not in functions:
                functions[node.name] = node
        for name, entry in SNAPSHOT.items():
            with self.subTest(symbol=name):
                self.assertEqual(ast.dump(functions[name].args), ast.dump(ast.parse(entry['source']).body[0].args))
                self.assertEqual([ast.unparse(n) for n in functions[name].decorator_list], entry['decorators'])

    def test_new_owners_do_not_import_legacy_views_or_frameworks(self):
        for module in {entry['owner'] for entry in SNAPSHOT.values()}:
            path = ROOT.parent.joinpath(*module.split('.')).with_suffix('.py')
            for node in ast.walk(_read_dependencies.source_tree(path)):
                if isinstance(node, ast.ImportFrom):
                    self.assertNotIn('views', [alias.name for alias in node.names])
                    self.assertFalse((node.module or '').startswith(('django', 'config', 'curriculum_api.views')))
                if isinstance(node, ast.Import):
                    self.assertFalse(any(alias.name.startswith(('django', 'config', 'curriculum_api.views')) for alias in node.names))

    def test_cache_epoch_and_scope_are_read_live(self):
        functions = {n.name: n for n in _read_dependencies.source_tree(ROOT / 'catalogue/infrastructure/cache_runtime.py').body
                     if isinstance(n, ast.FunctionDef)}
        for name, keyword, state in (
            ('cached_curriculum_value', 'read_local_epoch', '_CURRICULUM_CACHE_EPOCH'),
            ('curriculum_read_scope', 'read_scope_state', '_CURRICULUM_READ_SCOPE'),
            ('scoped_curriculum_read', 'read_scope_state', '_CURRICULUM_READ_SCOPE'),
        ):
            argument = next(k.value for n in ast.walk(functions[name]) if isinstance(n, ast.Call)
                            for k in n.keywords if k.arg == keyword)
            self.assertIsInstance(argument, ast.Lambda)
            self.assertEqual(ast.unparse(argument.body), "cache_state." + state)


if __name__ == '__main__':
    unittest.main()
