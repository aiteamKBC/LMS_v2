"""Cache relocation source contracts: stdlib only, no Django startup or I/O."""
import ast
import copy
import hashlib
import importlib.util
from pathlib import Path
import unittest

import importlib.util as _read_dependencies_util
_read_dependencies_spec = _read_dependencies_util.spec_from_file_location('read_dependencies_oracle', Path(__file__).with_name('read_dependencies_oracle.py'))
_read_dependencies = _read_dependencies_util.module_from_spec(_read_dependencies_spec)
_read_dependencies_spec.loader.exec_module(_read_dependencies)

spec = importlib.util.spec_from_file_location('cache_oracle', Path(__file__).with_name('cache_ownership_oracle.py'))
oracle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(oracle)
ROOT, SNAPSHOT = oracle.ROOT, oracle.SNAPSHOT
SNAPSHOT_HASH = '8927d2779fbd23395bc3dc03e6ec79400d06ca410a176f023d0ae402e7bd374f'
VIEWS_HASH = '706a627e5fe8d3a3f76102eb06f6b55499efcda29e4eeaeae363bec26ba12573'


def tree(path):
    return _read_dependencies.source_tree(path)


def function(path, name):
    return next(n for n in tree(path).body if isinstance(n, ast.FunctionDef) and n.name == name)


class CacheOwnershipContracts(unittest.TestCase):
    def test_frozen_original_has_not_changed(self):
        self.assertEqual(hashlib.sha256(oracle.SNAPSHOT_PATH.read_bytes()).hexdigest(), SNAPSHOT_HASH)

    def test_every_other_views_statement_is_unchanged(self):
        restored = oracle.restore_views_tree(tree(ROOT / 'views.py'))
        self.assertEqual(hashlib.sha256(ast.dump(restored).encode()).hexdigest(), VIEWS_HASH)

    def test_all_executable_bodies_and_sql_are_preserved(self):
        for name, entry in SNAPSHOT['functions'].items():
            with self.subTest(symbol=name):
                expected = oracle.relocated_source(entry['source']).body[0]
                class DeferredPorts(ast.NodeTransformer):
                    def visit_ImportFrom(self, node):
                        if node.module in {None, 'cache_scope', 'read_model', 'module_live', 'config.management_safety'}:
                            self_names = {a.name for a in node.names}
                            allowed = set(entry['callbacks']) | {'content_cache'}
                            assert self_names <= allowed
                            return None
                        if (node.module or '').startswith('catalogue.infrastructure.'):
                            node.module = node.module.removeprefix('catalogue.infrastructure.')
                        return node

                    def visit_Attribute(self, node):
                        if isinstance(node.value, ast.Name) and node.value.id == 'content_cache':
                            return ast.Name(id={'retire_all': 'retire_all_content', 'begin_write_scope': 'begin_content_write_scope', 'end_write_scope': 'end_content_write_scope'}[node.attr], ctx=node.ctx)
                        return self.generic_visit(node)
                expected = DeferredPorts().visit(expected)
                actual = function(ROOT.parent / (entry['owner'].replace('.', '/') + '.py'), name)
                self.assertEqual([ast.dump(n) for n in actual.body], [ast.dump(n) for n in expected.body])
                self.assertEqual([ast.unparse(n) for n in actual.decorator_list], entry['decorators'])
                self.assertEqual([a.arg for a in actual.args.kwonlyargs][-len(entry['deps']):] if entry['deps'] else [], entry['deps'])

    def test_original_state_values_have_exactly_one_owner(self):
        state = tree(ROOT / 'catalogue/infrastructure/runtime_state.py')
        assignments = {n.targets[0].id: ast.dump(n) for n in state.body if isinstance(n, ast.Assign)}
        self.assertEqual(assignments, {name: ast.dump(ast.parse(src).body[0]) for name, src in SNAPSHOT['initializers'].items()})
        for node in ast.walk(tree(ROOT / 'views.py')):
            if isinstance(node, ast.Name):
                self.assertNotIn(node.id, oracle.STATE)
        flags = next(n for n in tree(ROOT / 'views.py').body if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == '_SCHEMA_READY_FLAGS' for t in n.targets))
        old = ast.parse(SNAPSHOT['schema_ready_flags']).body[0]
        # The epoch latch moved to runtime_state; the uncalled name-based
        # programme deduplication path and its latch have now been deleted.
        old.value.elts = [n for n in old.value.elts if n.value not in {
            '_CURRICULUM_EPOCH_TABLE_READY', '_PROGRAMME_CONFIG_DEDUP_READY',
        }]
        self.assertEqual(ast.dump(flags), ast.dump(old))

    def test_public_signatures_and_explicit_bindings(self):
        views = tree(ROOT / 'views.py')
        for name, entry in SNAPSHOT['functions'].items():
            old = ast.parse(entry['source']).body[0]
            if entry['deps']:
                actual = next(n for n in views.body if isinstance(n, ast.FunctionDef) and n.name == name)
                self.assertEqual(ast.dump(actual.args), ast.dump(old.args), name)
                self.assertEqual([ast.unparse(n) for n in actual.decorator_list], entry['decorators'])
                call = actual.body[-1].value
                self.assertEqual(call.func.id, 'query')
                self.assertEqual({k.arg for k in call.keywords}, set(entry['deps']) | {n.arg for n in old.args.kwonlyargs})
                for keyword in call.keywords:
                    if name == 'scoped_curriculum_read' and keyword.arg == 'native_only':
                        self.assertEqual(ast.unparse(keyword.value), 'lambda: native_only()')
                    else:
                        self.assertIsInstance(keyword.value, ast.Name)
                        self.assertEqual(keyword.arg, keyword.value.id)
            else:
                exported = [n for n in views.body if isinstance(n, ast.ImportFrom) and n.module == entry['owner'].removeprefix('curriculum_api.') and any(a.name == name and a.asname is None for a in n.names)]
                self.assertEqual(len(exported), 1, name)

    def test_concrete_owners_have_no_outward_imports_or_runtime_tests(self):
        for filename in ('runtime_state', 'cache_epochs', 'cache_invalidation', 'cache_runtime'):
            for node in ast.walk(tree(ROOT / 'catalogue/infrastructure' / (filename + '.py'))):
                if isinstance(node, ast.Import):
                    self.assertTrue(all(a.name in {'contextlib', 'functools', 'hashlib', 'inspect', 'threading', 'time'} for a in node.names))
                if isinstance(node, ast.ImportFrom):
                    self.assertEqual(node.level, 1)
                    self.assertIn(node.module, {None, 'payload_cache', 'read_scope'})
                    self.assertFalse(any(a.name in {'views', 'tests'} for a in node.names))


if __name__ == '__main__':
    unittest.main()
