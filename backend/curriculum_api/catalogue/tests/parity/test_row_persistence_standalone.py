"""Source contracts for shared row persistence and removal of uncalled maintenance paths."""
import ast
import copy
import hashlib
import importlib.util
from functools import lru_cache
from pathlib import Path
import unittest

import importlib.util as _read_dependencies_util
_read_dependencies_spec = _read_dependencies_util.spec_from_file_location('read_dependencies_oracle', Path(__file__).with_name('read_dependencies_oracle.py'))
_read_dependencies = _read_dependencies_util.module_from_spec(_read_dependencies_spec)
_read_dependencies_spec.loader.exec_module(_read_dependencies)

spec = importlib.util.spec_from_file_location('storage_oracle', Path(__file__).with_name('row_persistence_oracle.py'))
oracle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(oracle)
ROOT, SNAPSHOT = oracle.ROOT, oracle.SNAPSHOT


def tree(path):
    return _read_dependencies.source_tree(path)


@lru_cache
def functions(path):
    return {n.name: n for n in tree(path).body if isinstance(n, ast.FunctionDef)}


class RowPersistenceSourceContracts(unittest.TestCase):
    def test_uncalled_maintenance_paths_have_no_runtime_references(self):
        removed = set(SNAPSHOT['removed'])
        for path in ROOT.parent.rglob('*.py'):
            if path.name.startswith('test') or any(p in {'tests', 'phase1f_tests', '.venv', '__pycache__'} for p in path.parts):
                continue
            parsed = tree(path)
            names = {n.id for n in ast.walk(parsed) if isinstance(n, ast.Name)}
            names |= {n.attr for n in ast.walk(parsed) if isinstance(n, ast.Attribute)}
            names |= {n.name for n in ast.walk(parsed) if isinstance(n, (ast.FunctionDef, ast.alias))}
            names |= {n.value for n in ast.walk(parsed) if isinstance(n, ast.Constant) and isinstance(n.value, str)}
            self.assertFalse(names & removed, (path, names & removed))

    def test_frozen_baseline_is_immutable(self):
        self.assertEqual(hashlib.sha256(oracle.SNAPSHOT_PATH.read_bytes()).hexdigest(),
                         '7bc305f65a17e5c467e20c5da701bbc41dcb63cdb75c33116e0c64ec8e135f88')

    def test_every_other_views_statement_and_schema_gate_is_unchanged(self):
        restored = oracle.restore_views_tree(tree(ROOT / 'views.py'))
        self.assertEqual(hashlib.sha256(ast.dump(restored).encode()).hexdigest(), SNAPSHOT['views_ast_sha256'])

    def test_actual_owner_sql_decisions_and_transactions_are_exact(self):
        for name, entry in SNAPSHOT['functions'].items():
            with self.subTest(symbol=name):
                old = oracle.relocated_body(entry['source'])
                new = functions(ROOT.parent / (entry['owner'].replace('.', '/') + '.py'))[name]
                self.assertEqual([ast.dump(n) for n in new.body], [ast.dump(n) for n in old.body])

    def test_public_signatures_decorators_and_explicit_capabilities(self):
        for name, entry in SNAPSHOT['functions'].items():
            old = ast.parse(entry['source']).body[0]
            wrapper = functions(ROOT / 'views.py')[name]
            self.assertEqual(ast.dump(wrapper.args), ast.dump(old.args), name)
            self.assertEqual([ast.unparse(d) for d in wrapper.decorator_list], entry['decorators'])
            imp = next(n for n in wrapper.body if isinstance(n, ast.ImportFrom))
            self.assertEqual((imp.level, imp.module), (1, entry['owner'].removeprefix('curriculum_api.')))
            call = wrapper.body[-1].value
            self.assertEqual(call.func.id, 'implementation')
            self.assertEqual([ast.unparse(a) for a in call.args], [a.arg for a in old.args.args])
            self.assertEqual({k.arg for k in call.keywords if k.arg is not None}, set(entry['deps']) | {a.arg for a in old.args.kwonlyargs})
            self.assertTrue(all(ast.unparse(k.value) == k.arg for k in call.keywords if k.arg is not None))
            owner = functions(ROOT.parent / (entry['owner'].replace('.', '/') + '.py'))[name]
            args = copy.deepcopy(owner.args)
            self.assertEqual([a.arg for a in args.kwonlyargs][-len(entry['deps']):], entry['deps'])
            args.kwonlyargs = args.kwonlyargs[:-len(entry['deps'])]
            args.kw_defaults = args.kw_defaults[:-len(entry['deps'])]
            self.assertEqual(ast.dump(args), ast.dump(old.args))

    def test_deferred_imports_are_lazy_and_have_exact_bindings(self):
        for name, entry in SNAPSHOT['functions'].items():
            wrapper = functions(ROOT / 'views.py')[name]
            callbacks = {n.name: n for n in wrapper.body if isinstance(n, ast.FunctionDef)}
            self.assertEqual(set(callbacks), set(entry['callbacks']))
            for cb, cfg in entry['callbacks'].items():
                fn = callbacks[cb]
                self.assertEqual((fn.body[0].module, fn.body[0].level), (cfg['module'], 1))
                self.assertEqual(fn.body[0].names[0].name, cfg['name'])
                self.assertEqual(ast.unparse(fn.body[-1]), 'return operation' if cfg['loader'] else 'return operation(*args, **kwargs)')

    def test_relocated_functions_have_no_imports_or_dynamic_dispatch(self):
        for name, entry in SNAPSHOT['functions'].items():
            fn = functions(ROOT.parent / (entry['owner'].replace('.', '/') + '.py'))[name]
            for node in ast.walk(fn):
                self.assertNotIsInstance(node, (ast.Import, ast.ImportFrom))
                if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
                    self.assertNotIn(node.func.id, {'exec', 'eval', '__import__'})


if __name__ == '__main__':
    unittest.main()
