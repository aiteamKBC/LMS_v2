"""DB-free extraction contracts against frozen production source."""
import ast
import builtins
from copy import deepcopy
import json
from pathlib import Path
import symtable
import unittest

import importlib.util as _read_dependencies_util
_read_dependencies_spec = _read_dependencies_util.spec_from_file_location('read_dependencies_oracle', Path(__file__).with_name('read_dependencies_oracle.py'))
_read_dependencies = _read_dependencies_util.module_from_spec(_read_dependencies_spec)
_read_dependencies_spec.loader.exec_module(_read_dependencies)

ROOT = Path(__file__).resolve().parents[2]
SNAPSHOT = json.loads((ROOT / 'tests/fixtures/legacy_snapshots/programme_builder_snapshot.json').read_text())
DOMAIN_RULES = {'programme_identity', 'programme_config_identity', 'unique_program_configs_for_display'}
ORIGINAL = ast.parse(SNAPSHOT['source']).body[0]
MODULE = _read_dependencies.source_tree(ROOT / 'application/programme_builder.py')
EXTRACTED = next(n for n in MODULE.body if isinstance(n, ast.FunctionDef))


class ProgrammeBuilderContracts(unittest.TestCase):
    def test_original_body_is_preserved(self):
        class OriginalCalls(ast.NodeTransformer):
            def visit_Call(self, node):
                self.generic_visit(node)
                if isinstance(node.func, ast.Name) and node.func.id in DOMAIN_RULES:
                    expected = {
                        'programme_identity': {'clean_str', 'normalise', 'slugify'},
                        'programme_config_identity': {'clean_str'},
                        'unique_program_configs_for_display': {'normalise', 'clean_str', 'parse_int', 'is_archived_program_config'},
                    }[node.func.id]
                    assert {k.arg for k in node.keywords} == expected
                    assert all(isinstance(k.value, ast.Name) and k.value.id == k.arg for k in node.keywords)
                    node.keywords = []
                return node
        restored = OriginalCalls().visit(deepcopy(EXTRACTED))
        self.assertEqual([ast.dump(n) for n in ORIGINAL.body], [ast.dump(n) for n in restored.body])

    def test_public_signature_and_all_dependency_bindings(self):
        tree = _read_dependencies.source_tree(ROOT.parent / 'views.py')
        wrapper = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'build_programmes')
        self.assertEqual(ast.dump(wrapper.args), ast.dump(ORIGINAL.args))
        self.assertEqual(wrapper.body[1].module, 'catalogue.application.programme_builder')
        call = wrapper.body[2].value
        bindings = {k.arg: ast.unparse(k.value) for k in call.keywords}
        for dep in set(SNAPSHOT['dependencies']) - DOMAIN_RULES:
            self.assertEqual(bindings[dep], dep)
        self.assertTrue(DOMAIN_RULES.isdisjoint(bindings))
        self.assertEqual([ast.unparse(a) for a in call.args],
                         ['training_rows', 'program_configs', 'ksb_profiles', 'include_config_only', 'only_stats_for_ids'])
        for key in ('include_learner_counts', 'include_structure_counts', 'structure_counts', 'learner_counts'):
            self.assertEqual(bindings[key], key)

    def test_dependencies_are_complete(self):
        def tables(table):
            yield table
            for child in table.get_children():
                yield from tables(child)
        symbols = symtable.symtable(SNAPSHOT['source'], '<oracle>', 'exec')
        actual = {symbol.get_name() for table in tables(symbols) for symbol in table.get_symbols()
                  if symbol.is_global() and symbol.is_referenced()}
        self.assertEqual(actual - set(dir(builtins)) - {'Counter', 'defaultdict'}, set(SNAPSHOT['dependencies']))

    def test_no_outward_imports_or_database_startup(self):
        imports = [ast.unparse(n) for n in ast.walk(MODULE) if isinstance(n, (ast.Import, ast.ImportFrom))]
        self.assertEqual(imports, ['from collections import Counter, defaultdict',
                                 'from ..domain.programme_identity import programme_config_identity, programme_identity, unique_program_configs_for_display'])
        self.assertEqual([type(n) for n in MODULE.body], [ast.Expr, ast.ImportFrom, ast.ImportFrom, ast.FunctionDef])


if __name__ == '__main__':
    unittest.main()
