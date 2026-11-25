"""Exact source/capability guards for module command relocation; stdlib only."""
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

spec = importlib.util.spec_from_file_location('module_oracle', Path(__file__).with_name('module_commands_oracle.py'))
oracle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(oracle)
ROOT, SNAPSHOT = oracle.ROOT, oracle.SNAPSHOT


def tree(path):
    return _read_dependencies.source_tree(path)


@lru_cache
def functions(path):
    return {n.name: n for n in tree(path).body if isinstance(n, ast.FunctionDef)}


def dump(nodes):
    return [ast.dump(n) for n in nodes]


class ModuleCommandSourceContracts(unittest.TestCase):
    def test_frozen_originals_are_immutable(self):
        self.assertEqual(hashlib.sha256(oracle.SNAPSHOT_PATH.read_bytes()).hexdigest(),
                         '5bb4a3232da1bbbd4a52ccdc8a695081f0ed86c080edf09fa81d2e120b8f566d')

    def test_every_unrelated_views_statement_is_unchanged(self):
        restored = oracle.restore_views_tree(tree(ROOT / 'views.py'))
        self.assertEqual(hashlib.sha256(ast.dump(restored).encode()).hexdigest(), SNAPSHOT['views_ast_sha256'])

    def test_moved_decisions_transactions_and_call_order_are_exact(self):
        for name, entry in SNAPSHOT['functions'].items():
            if name == '_update_module_cover':
                continue
            with self.subTest(symbol=name):
                old = oracle.relocated_body(entry['source'])
                new = functions(ROOT.parent / (entry['owner'].replace('.', '/') + '.py'))[name]
                self.assertEqual(dump(new.body), dump(old.body))

    def test_cover_sql_cursor_and_http_error_boundaries_are_exact(self):
        old = oracle.relocated_body(SNAPSHOT['functions']['_update_module_cover']['source'])
        new = copy.deepcopy(functions(ROOT / 'catalogue/api/module_commands.py')['_update_module_cover'])
        infra = functions(ROOT / 'catalogue/infrastructure/module_cover.py')['update_module_cover_row']
        before = [n for n in old.body if isinstance(n, ast.Try)][1]
        after = [n for n in new.body if isinstance(n, ast.Try)][1]
        cursor = copy.deepcopy(infra.body[0])
        self.assertEqual(dump(cursor.items), dump(before.body[0].items))
        self.assertEqual(dump(cursor.body), dump(before.body[0].body[:2]))
        self.assertEqual(ast.unparse(infra.body[-1]), 'return updated_row')
        self.assertEqual(ast.unparse(after.body[1]), 'updated_row = update_module_cover_row(identifier, image, connection=connection, archive_state=archive_state)')
        cursor.body.append(after.body[2])
        after.body[:3] = [cursor]
        self.assertEqual(dump(new.body), dump(old.body))

    def test_public_signatures_decorators_and_all_named_bindings(self):
        for name, entry in SNAPSHOT['functions'].items():
            if name == 'curriculum_module_structure':
                entry = {**entry, 'deps': [d for d in entry['deps'] if d != 'ensure_training_module_authoring_structure']}
            old = ast.parse(entry['source']).body[0]
            wrapper = functions(ROOT / 'views.py')[name]
            self.assertEqual(ast.dump(wrapper.args), ast.dump(old.args), name)
            self.assertEqual([ast.unparse(d) for d in wrapper.decorator_list], entry['decorators'])
            self.assertEqual(wrapper.body[0].module, entry['owner'].removeprefix('curriculum_api.'))
            call = wrapper.body[-1].value
            self.assertEqual(call.func.id, 'implementation')
            self.assertEqual([ast.unparse(a) for a in call.args], [a.arg for a in old.args.args])
            self.assertEqual({k.arg for k in call.keywords}, set(entry['deps']) | {a.arg for a in old.args.kwonlyargs})
            self.assertTrue(all(ast.unparse(k.value) == k.arg for k in call.keywords))
            new = functions(ROOT.parent / (entry['owner'].replace('.', '/') + '.py'))[name]
            public = copy.deepcopy(new.args)
            self.assertEqual([a.arg for a in public.kwonlyargs][-len(entry['deps']):], entry['deps'])
            public.kwonlyargs = public.kwonlyargs[:-len(entry['deps'])]
            public.kw_defaults = public.kw_defaults[:-len(entry['deps'])]
            self.assertEqual(ast.dump(public), ast.dump(old.args), name)

    def test_deferred_legacy_bindings_are_explicit_and_lazy(self):
        for name, entry in SNAPSHOT['functions'].items():
            wrapper = functions(ROOT / 'views.py')[name]
            callbacks = {n.name: n for n in wrapper.body if isinstance(n, ast.FunctionDef)}
            self.assertEqual(set(callbacks), set(entry['callbacks']))
            for cb, cfg in entry['callbacks'].items():
                node = callbacks[cb]
                self.assertEqual((node.body[0].module, node.body[0].level), (cfg['module'], cfg['level']))
                self.assertEqual([a.name for a in node.body[0].names], cfg.get('names', [cfg.get('name')]))
                if 'names' in cfg:
                    self.assertEqual([n.id for n in node.body[-1].value.elts], cfg['names'])
                else:
                    self.assertEqual(ast.unparse(node.body[-1].value), 'operation(*args, **kwargs)')

    def test_owners_have_no_reverse_imports_or_dynamic_runtime(self):
        owners = {e['owner'] for e in SNAPSHOT['functions'].values()} | {'curriculum_api.catalogue.infrastructure.module_cover'}
        allowed = {(0, 'contextlib'), (1, 'module_reads'), (2, 'application.structure_payloads'), (2, 'infrastructure.module_cover')}
        for owner in owners:
            for node in ast.walk(tree(ROOT.parent / (owner.replace('.', '/') + '.py'))):
                if isinstance(node, ast.Import):
                    self.fail((owner, ast.unparse(node)))
                if isinstance(node, ast.ImportFrom):
                    self.assertIn((node.level, node.module), allowed)
                if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
                    self.assertNotIn(node.func.id, {'exec', 'eval', '__import__'})


if __name__ == '__main__':
    unittest.main()
