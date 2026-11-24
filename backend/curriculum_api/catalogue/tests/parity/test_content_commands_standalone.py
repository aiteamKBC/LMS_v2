"""Source contracts for content relocation and removal of fabricated training data."""
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

spec = importlib.util.spec_from_file_location('storage_oracle', Path(__file__).with_name('content_commands_oracle.py'))
oracle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(oracle)
ROOT, SNAPSHOT = oracle.ROOT, oracle.SNAPSHOT


def tree(path):
    return _read_dependencies.source_tree(path)


@lru_cache
def functions(path):
    return {n.name: n for n in tree(path).body if isinstance(n, ast.FunctionDef)}


class ContentCommandSourceContracts(unittest.TestCase):
    def test_training_get_has_only_the_reviewed_read_only_change(self):
        old = next(n for n in ast.parse(SNAPSHOT['structure_api']).body if isinstance(n, ast.FunctionDef))
        expected = oracle.readonly_training_get(old)
        i = next(i for i, a in enumerate(expected.args.kwonlyargs) if a.arg == 'ensure_training_module_authoring_structure')
        del expected.args.kwonlyargs[i]
        del expected.args.kw_defaults[i]
        actual = functions(ROOT / 'catalogue/api/module_structure.py')['curriculum_module_structure']
        self.assertEqual(ast.dump(actual), ast.dump(expected))

    def test_removed_placeholders_have_no_runtime_references(self):
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
                         '92b870f6ad8b3279bd4db243f7471bd7ad9c6d04729e9b01d098448c28c849fb')

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

    def test_new_owners_do_not_import_legacy_views_or_settings(self):
        for owner in {e['owner'] for e in SNAPSHOT['functions'].values()}:
            for node in ast.walk(tree(ROOT.parent / (owner.replace('.', '/') + '.py'))):
                if isinstance(node, ast.Import):
                    self.assertTrue(all(a.name in {'json'} for a in node.names), (owner, ast.unparse(node)))
                if isinstance(node, ast.ImportFrom):
                    self.assertIn((node.level, node.module), {(2, 'application.week_templates')})
                if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
                    self.assertNotIn(node.func.id, {'exec', 'eval', '__import__'})


if __name__ == '__main__':
    unittest.main()
