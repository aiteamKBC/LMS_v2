"""Exact hierarchy relocation guards without Django, databases or providers."""
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

spec = importlib.util.spec_from_file_location('hierarchy_oracle', Path(__file__).with_name('hierarchy_commands_oracle.py'))
oracle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(oracle)
ROOT, SNAPSHOT = oracle.ROOT, oracle.SNAPSHOT


def tree(path):
    return _read_dependencies.source_tree(path)


@lru_cache
def functions(path):
    return {n.name: n for n in tree(path).body if isinstance(n, ast.FunctionDef)}


def function(path, name):
    return functions(path)[name]


class HierarchySourceContracts(unittest.TestCase):
    def test_frozen_originals_are_immutable(self):
        self.assertEqual(hashlib.sha256(oracle.SNAPSHOT_PATH.read_bytes()).hexdigest(),
                         '59589a6e21548c4cf1f161974099aabef1032129dacb978d060bd57540854c33')

    def test_every_unrelated_views_statement_is_unchanged(self):
        restored = oracle.restore_views_tree(tree(ROOT / 'views.py'))
        self.assertEqual(hashlib.sha256(ast.dump(restored).encode()).hexdigest(), SNAPSHOT['views_ast_sha256'])

    def test_all_moved_bodies_preserve_decisions_sql_and_call_order(self):
        for name, entry in SNAPSHOT['functions'].items():
            if name == 'curriculum_programme_tree_save':
                continue  # The split atomic block has its own stricter assertion.
            with self.subTest(symbol=name):
                old = oracle.relocated_body(entry['source'])
                new = function(ROOT.parent / (entry['owner'].replace('.', '/') + '.py'), name)
                self.assertEqual([ast.dump(n) for n in new.body], [ast.dump(n) for n in old.body])

    def test_tree_transaction_and_result_mapping_remain_exact(self):
        old = ast.parse(SNAPSHOT['functions']['curriculum_programme_tree_save']['source']).body[0]
        api = function(ROOT / 'catalogue/api/programme_commands.py', old.name)
        app = function(ROOT / 'catalogue/application/programme_tree.py', 'save_programme_tree')
        old_try = next(n for n in old.body if isinstance(n, ast.Try))
        api_try = next(n for n in api.body if isinstance(n, ast.Try))
        self.assertEqual(ast.dump(app.body[0]), ast.dump(old_try.body[0]))
        self.assertEqual([ast.dump(n) for n in api_try.handlers], [ast.dump(n) for n in old_try.handlers])
        self.assertEqual([ast.dump(n) for n in api.body[:3]], [ast.dump(n) for n in old.body[:3]])
        self.assertEqual(ast.dump(api.body[-1]), ast.dump(old.body[-1]))
        self.assertEqual([n.id for n in app.body[-1].value.elts],
                         [n.id for n in api_try.body[1].targets[0].elts])
        call = api_try.body[1].value
        self.assertEqual(call.func.id, 'save_programme_tree')
        self.assertEqual(ast.unparse(call.args[0]), 'payload')
        self.assertEqual([k.arg for k in call.keywords], SNAPSHOT['tree_application_deps'])
        self.assertTrue(all(ast.unparse(k.value) == k.arg for k in call.keywords))

    def test_public_signatures_decorators_and_named_bindings(self):
        for name, entry in SNAPSHOT['functions'].items():
            old = ast.parse(entry['source']).body[0]
            wrapper = function(ROOT / 'views.py', name)
            self.assertEqual(ast.dump(wrapper.args), ast.dump(old.args), name)
            self.assertEqual([ast.unparse(d) for d in wrapper.decorator_list], entry['decorators'])
            self.assertEqual(wrapper.body[0].module, entry['owner'].removeprefix('curriculum_api.'))
            call = wrapper.body[-1].value
            self.assertEqual(call.func.id, 'implementation')
            self.assertEqual({k.arg for k in call.keywords}, set(entry['deps']) | {a.arg for a in old.args.kwonlyargs})
            self.assertTrue(all(ast.unparse(k.value) == k.arg for k in call.keywords))
            new = function(ROOT.parent / (entry['owner'].replace('.', '/') + '.py'), name)
            self.assertEqual([a.arg for a in new.args.kwonlyargs][-len(entry['deps']):], entry['deps'])
            public = copy.deepcopy(new.args)
            public.kwonlyargs = public.kwonlyargs[:-len(entry['deps'])]
            public.kw_defaults = public.kw_defaults[:-len(entry['deps'])]
            self.assertEqual(ast.dump(public), ast.dump(old.args), name)

    def test_deferred_imports_stay_at_composition_seam(self):
        for name, entry in SNAPSHOT['functions'].items():
            wrapper = function(ROOT / 'views.py', name)
            callbacks = {n.name: n for n in wrapper.body if isinstance(n, ast.FunctionDef)}
            self.assertEqual(set(callbacks), set(entry['callbacks']))
            for name, config in entry['callbacks'].items():
                callback = callbacks[name]
                self.assertEqual(callback.body[0].module, config['module'])
                self.assertEqual(callback.body[0].level, config['level'])
                if name == 'cohort_rename_bindings':
                    self.assertEqual([a.name for a in callback.body[0].names], config['names'])
                    self.assertEqual(ast.unparse(callback.body[-1].value), '(CohortRenameConflict, propagate_cohort_name)')
                else:
                    self.assertEqual(callback.body[0].names[0].name, name)
                    self.assertEqual(ast.unparse(callback.body[-1].value), 'operation(*args, **kwargs)')

    def test_new_owners_do_not_import_legacy_runtime_or_tests(self):
        owners = {e['owner'] for e in SNAPSHOT['functions'].values()}
        owners.add('curriculum_api.catalogue.application.programme_tree')
        for owner in owners:
            for node in ast.walk(tree(ROOT.parent / (owner.replace('.', '/') + '.py'))):
                if isinstance(node, ast.Import):
                    self.fail((owner, ast.unparse(node)))
                if isinstance(node, ast.ImportFrom):
                    self.assertIn((node.level, node.module), {(1, 'module_reads'), (2, 'application.programme_tree')})
                if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
                    self.assertNotIn(node.func.id, {'exec', 'eval', '__import__'})


if __name__ == '__main__':
    unittest.main()
