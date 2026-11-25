"""Frozen-source preservation and cache-scope policy parity; no Django imports."""
import ast
import copy
import hashlib
import importlib.util
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT.parent))
from curriculum_api.catalogue.tests.parity import runtime_ownership_oracle as oracle
from curriculum_api.catalogue.tests.parity.required_read_assertions import assert_success_contract

MANIFEST = oracle.SNAPSHOT['manifest']


def tree(relative):
    from curriculum_api.catalogue.tests.parity.registry_composition_oracle import restore_tree
    return restore_tree(ast.parse((ROOT / relative).read_text(encoding='utf-8-sig')), relative)


def original(relative):
    return oracle.restore_tree(tree(relative), relative)


class OwnerImports(ast.NodeTransformer):
    def visit_ImportFrom(self, node):
        if node.level:
            node.module = importlib.util.resolve_name('.' * node.level + (node.module or ''), 'curriculum_api')
            node.level = 0
        if node.module == 'curriculum_api.module_live':
            node.module = 'curriculum_api.catalogue.infrastructure.module_epochs'
        if node.module == 'curriculum_api.cache_scope':
            node.module = 'curriculum_api.catalogue.infrastructure.scoped_epochs'
        return node


class DirectDependencies(ast.NodeTransformer):
    def visit_Assign(self, node):
        if ast.unparse(node) == 'views = _views()':
            return None
        return self.generic_visit(node)

    def visit_Attribute(self, node):
        if isinstance(node.value, ast.Name) and node.value.id == 'views' or isinstance(node.value, ast.Call) and isinstance(node.value.func, ast.Name) and node.value.func.id == '_views':
            return ast.copy_location(ast.Name(id=node.attr, ctx=node.ctx), node)
        return self.generic_visit(node)

    def visit_ImportFrom(self, node):
        if node.module == 'cache_scope' and node.level == 1:
            node.module = 'scoped_epochs'
        return node


class RuntimeOwnershipContracts(unittest.TestCase):
    def test_frozen_evidence_and_exact_source_changes(self):
        self.assertEqual(hashlib.sha256(oracle.SNAPSHOT_PATH.read_bytes()).hexdigest(),
                         'd4ec9554feb97ba028c68297a532e44aef341d0756d4b8dae92358ce74bb681a')
        for relative, record in oracle.SNAPSHOT['source_changes'].items():
            self.assertEqual([hashlib.sha256(ast.dump(n).encode()).hexdigest() for n in tree(relative).body], record['after'], relative)
            self.assertEqual([hashlib.sha256(ast.dump(n).encode()).hexdigest() for n in original(relative).body], record['order'], relative)

    def test_all_112_entry_bodies_signatures_decorators_preserved(self):
        old = {n.name: n for n in original('views.py').body if isinstance(n, ast.FunctionDef)}
        self.assertEqual(len(MANIFEST['functions']), 112)
        for name, owner in MANIFEST['functions'].items():
            actual = next(n for n in tree(owner.replace('.', '/') + '.py').body if getattr(n, 'name', None) == name)
            expected = OwnerImports().visit(copy.deepcopy(old[name]))
            if name in {'get_holiday_rows_safe', 'get_staff_profile_rows'}:
                assert_success_contract(self, expected, actual)
                continue
            if name == 'teams_delivery_metadata_from_live_session':
                resolver = next(n for n in ast.walk(expected) if isinstance(n, ast.keyword) and n.arg == 'teams_module_owner_id')
                self.assertEqual(ast.unparse(resolver.value), "globals().get('teams_module_owner_id')")
                resolver.value = ast.Name(id='teams_module_owner_id', ctx=ast.Load())
            self.assertEqual(ast.dump(expected), ast.dump(actual), (name, owner))

    def test_cache_counter_bodies_keep_sql_locks_limits_and_error_paths(self):
        for source, target in [('cache_scope.py', 'catalogue/infrastructure/scoped_epochs.py'),
                               ('module_live.py', 'catalogue/infrastructure/module_epochs.py')]:
            old = {n.name: n for n in original(source).body if isinstance(n, (ast.FunctionDef, ast.ClassDef))}
            for actual in tree(target).body:
                if isinstance(actual, (ast.FunctionDef, ast.ClassDef)):
                    self.assertEqual(ast.dump(DirectDependencies().visit(copy.deepcopy(old[actual.name]))), ast.dump(actual), (source, actual.name))

    def test_no_reverse_legacy_dependency_or_forbidden_layer_edge(self):
        for module in MANIFEST['modules']:
            for node in ast.walk(tree(module.replace('.', '/') + '.py')):
                if isinstance(node, ast.ImportFrom):
                    self.assertNotIn(node.module, ('curriculum_api.views', 'curriculum_api.cache_scope', 'curriculum_api.module_live'), module)
                    if '.domain.' in module:
                        self.assertFalse(any(x in (node.module or '') for x in ('django', '.infrastructure.', '.api.', 'settings')), (module, node.module))
                    if '.infrastructure.' in module:
                        self.assertNotIn('.api.', node.module or '', (module, node.module))
                if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
                    self.assertNotIn(node.func.id, ('globals', 'exec', 'eval', '__import__'), module)

    def test_scoped_paths_match_original_policy(self):
        from curriculum_api.catalogue.infrastructure import cache_scope_paths as cache_scopes
        names = set(oracle.SNAPSHOT['cache']['policy_symbols'])
        nodes = [n for n in original('cache_scope.py').body if getattr(n, 'name', None) in names or isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id in names for t in n.targets)]
        env = {'re': cache_scopes.re}
        exec(compile(ast.Module(body=nodes, type_ignores=[]), '<prior-cache-paths>', 'exec'), env)
        paths = ['/curriculum/modules/M/', '/curriculum/modules/M/structure/',
                 '/curriculum/modules/M/weeks/W/', '/curriculum/modules/M/components/C/',
                 '/curriculum/groups/G/', '/curriculum/cohorts/C/', '/curriculum/modules/bulk/',
                 '/curriculum/modules/restore/', '/curriculum/modules/M/unknown/', '', '/unrelated/']
        for method in ('GET', 'PUT', 'PATCH', 'POST', 'DELETE', 'put'):
            for path in paths:
                self.assertEqual(cache_scopes.write_seeds(method, path), env['write_seeds'](method, path), (method, path))

    def test_ready_flags_have_single_concrete_owner_and_no_dead_latch(self):
        current = tree('views.py')
        assigned = {t.id for n in current.body if isinstance(n, ast.Assign) for t in n.targets if isinstance(t, ast.Name)}
        self.assertFalse(assigned.intersection(oracle.SNAPSHOT['flags']))
        self.assertNotIn('_TRAINING_PLAN_CANONICAL_READY', ast.unparse(current))
        self.assertNotIn('_SCHEMA_READY_FLAGS', ast.unparse(current))
        for flag in oracle.SNAPSHOT['flags']:
            owner = MANIFEST['constants'][flag]
            definitions = [n for n in tree(owner.replace('.', '/') + '.py').body if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == flag for t in n.targets)]
            self.assertEqual(len(definitions), 1)
            self.assertIs(definitions[0].value.value, False)


if __name__ == '__main__':
    unittest.main()
