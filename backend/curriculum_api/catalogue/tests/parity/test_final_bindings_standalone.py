"""Exact transfer and ownership checks for the final HTTP/runtime bindings.

Reads source only. Runtime/HTTP suites separately exercise the real imports.
"""
import ast
import copy
import hashlib
import importlib.util
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT.parent))
from curriculum_api.catalogue.tests.parity import final_bindings_oracle as oracle

MANIFEST = oracle.SNAPSHOT['manifest']


def tree(relative):
    from curriculum_api.catalogue.tests.parity.approved_dev_contracts import source_tree
    return source_tree(ROOT / relative)


class AbsoluteImports(ast.NodeTransformer):
    def visit_ImportFrom(self, node):
        if node.level:
            node.module = importlib.util.resolve_name('.' * node.level + (node.module or ''), 'curriculum_api')
            node.level = 0
        return node


class FinalBindingsContracts(unittest.TestCase):
    def test_frozen_source_evidence_and_exact_reviewed_change(self):
        self.assertEqual(hashlib.sha256(oracle.SNAPSHOT_PATH.read_bytes()).hexdigest(),
                         'bb37700980b7030fa4f01c69a66c6e4eaef4c99f44113f6278b1fe3603597de5')
        for relative, entry in oracle.SNAPSHOT['source_changes'].items():
            with self.subTest(file=relative):
                current = tree(relative)
                self.assertEqual([hashlib.sha256(ast.dump(n).encode()).hexdigest() for n in current.body], entry['after'])
                restored = oracle.restore_tree(current, relative)
                self.assertEqual([hashlib.sha256(ast.dump(n).encode()).hexdigest() for n in restored.body], entry['order'])

    def test_all_137_bodies_signatures_defaults_and_decorators_preserved(self):
        old = {n.name: n for source in oracle.SNAPSHOT['source_changes']['views.py']['removed']
               for n in ast.parse(source).body if isinstance(n, ast.FunctionDef)}
        self.assertEqual(len(old), 137)
        self.assertEqual(set(old), set(MANIFEST['functions']))
        for name, owner in MANIFEST['functions'].items():
            actual = next(n for n in tree(owner.replace('.', '/') + '.py').body
                          if isinstance(n, ast.FunctionDef) and n.name == name)
            self.assertEqual(ast.dump(AbsoluteImports().visit(copy.deepcopy(old[name]))), ast.dump(actual), name)

    def test_constant_values_and_derived_field_selection_unchanged(self):
        old = {n.targets[0].id: n for source in oracle.SNAPSHOT['source_changes']['views.py']['removed']
               for n in ast.parse(source).body if isinstance(n, ast.Assign)}
        self.assertEqual(set(old), set(MANIFEST['constants']))
        for name, owner in MANIFEST['constants'].items():
            actual = next(n for n in tree(owner.replace('.', '/') + '.py').body
                          if isinstance(n, ast.Assign) and isinstance(n.targets[0], ast.Name) and n.targets[0].id == name)
            self.assertEqual(ast.dump(old[name]), ast.dump(actual), name)

    def test_exports_preserved_without_duplicate_implementations(self):
        facade = tree('views.py')
        exports = {a.asname or a.name: (n.module, a.name) for n in facade.body
                   if isinstance(n, ast.ImportFrom) for a in n.names}
        for name, owner in {**MANIFEST['functions'], **MANIFEST['constants']}.items():
            self.assertEqual(exports[name], (owner, name))
        self.assertEqual([n.name for n in facade.body if isinstance(n, ast.FunctionDef)], ['reset_schema_ready_flags'])

    def test_new_owners_have_no_views_or_dynamic_module_lookup(self):
        for owner in MANIFEST['modules']:
            for node in ast.walk(tree(owner.replace('.', '/') + '.py')):
                if isinstance(node, ast.ImportFrom):
                    self.assertNotEqual(node.module, 'curriculum_api.views', owner)
                    self.assertFalse(node.module == 'curriculum_api' and any(a.name == 'views' for a in node.names), owner)
                if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
                    self.assertNotIn(node.func.id, {'eval', 'exec', '__import__'}, owner)

    def test_no_cycles_between_new_concrete_owners(self):
        owners = {'curriculum_api.' + name for name in MANIFEST['modules']}
        graph = {owner: set() for owner in owners}
        for owner in owners:
            for n in ast.walk(tree(owner.removeprefix('curriculum_api.').replace('.', '/') + '.py')):
                if isinstance(n, ast.ImportFrom) and n.module in owners:
                    graph[owner].add(n.module)
        def visit(name, active, done):
            self.assertNotIn(name, active, name)
            if name in done:
                return
            active.add(name)
            for target in graph[name]:
                visit(target, active, done)
            active.remove(name)
            done.add(name)
        done = set()
        for name in graph:
            visit(name, set(), done)


if __name__ == '__main__':
    unittest.main()
