"""Exact source, public binding and import-boundary contracts for delivery extraction."""
import ast
from curriculum_api.catalogue.tests.parity.current_entry_source import current_entry_tree
import copy
import hashlib
import importlib
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT.parent))
from curriculum_api.meetings.tests.delivery_oracle import restore_tree
from curriculum_api.meetings.tests.policy_composition_oracle import assert_export_contract, assert_owner_imports

SNAPSHOT_PATH = Path(__file__).parent / 'fixtures/delivery_snapshot.json'
SNAPSHOT = json.loads(SNAPSHOT_PATH.read_text(encoding='utf-8'))


class DeliveryBoundaryContracts(unittest.TestCase):
    def test_frozen_source_and_unrelated_views_preserved(self):
        self.assertEqual(hashlib.sha256(SNAPSHOT_PATH.read_bytes()).hexdigest(),
                         'ac42f074846c4c2d99c020859e3d5a82e1032a81c40aaaa5f5e193f7d2d2e153')
        tree = ast.parse((ROOT / 'views.py').read_text(encoding='utf-8-sig'))
        self.assertEqual(hashlib.sha256(ast.dump(restore_tree(tree, 'views.py')).encode()).hexdigest(),
                         SNAPSHOT['views_ast_sha256'])

    def test_actual_bodies_preserve_every_statement_and_lazy_import_position(self):
        for name, entry in SNAPSHOT['functions'].items():
            factories = {f['name']: f for f in entry['factories']}

            class RestoreImports(ast.NodeTransformer):
                def visit_Assign(self, node):
                    value = node.value
                    if isinstance(value, ast.Call) and isinstance(value.func, ast.Name) and value.func.id in factories:
                        factory = factories[value.func.id]
                        self_outer.assertIsInstance(node.targets[0], ast.Tuple)
                        self_outer.assertEqual([ast.unparse(n) for n in node.targets[0].elts], factory['names'])
                        self_outer.assertEqual(value.args, [])
                        self_outer.assertEqual(value.keywords, [])
                        return ast.parse(factory['source']).body[0]
                    return self.generic_visit(node)

            self_outer = self
            old = ast.parse(entry['source']).body[0]
            tree = ast.parse((ROOT / (entry['owner'].replace('.', '/') + '.py')).read_text(encoding='utf-8'))
            actual = copy.deepcopy(next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == name))
            actual.args = copy.deepcopy(old.args)
            actual.decorator_list = copy.deepcopy(old.decorator_list)
            with self.subTest(name=name):
                self.assertEqual(ast.dump(old), ast.dump(RestoreImports().visit(actual)))

    def test_public_signatures_decorators_factories_and_capabilities(self):
        tree = current_entry_tree()
        functions = {n.name: n for n in tree.body if isinstance(n, ast.FunctionDef)}
        for name, entry in SNAPSHOT['functions'].items():
            old = ast.parse(entry['source']).body[0]
            if assert_export_contract(self, tree, name, old):
                continue
            actual = functions[name]
            with self.subTest(name=name):
                self.assertEqual(ast.dump(actual.args), ast.dump(old.args))
                self.assertEqual([ast.dump(n) for n in actual.decorator_list], [ast.dump(n) for n in old.decorator_list])
                call = actual.body[-1].value
                positional = [a.arg for a in old.args.args]
                if old.args.vararg:
                    positional.append('*' + old.args.vararg.arg)
                self.assertEqual([ast.unparse(a) for a in call.args], positional)
                self.assertEqual({k.arg for k in call.keywords}, set(entry['capabilities']) | {a.arg for a in old.args.kwonlyargs})
                self.assertTrue(all(ast.unparse(k.value) == k.arg for k in call.keywords))
                imports = [n for n in actual.body if isinstance(n, ast.ImportFrom)]
                self.assertEqual(len(imports), 1)
                self.assertEqual((imports[0].level, imports[0].module), (1, entry['owner']))
                loaders = {n.name: n for n in actual.body if isinstance(n, ast.FunctionDef)}
                self.assertEqual(set(loaders), {f['name'] for f in entry['factories']})
                for factory in entry['factories']:
                    body = loaders[factory['name']].body
                    self.assertEqual(len(body), 2)
                    self.assertEqual(ast.unparse(body[0]), factory['source'])
                    self.assertEqual(ast.dump(body[1].value), ast.dump(ast.Tuple(
                        elts=[ast.Name(id=n, ctx=ast.Load()) for n in factory['names']], ctx=ast.Load())))

    def test_owners_import_without_framework_or_provider_dependencies(self):
        before = set(sys.modules)
        for owner in {entry['owner'] for entry in SNAPSHOT['functions'].values()}:
            tree = ast.parse((ROOT / (owner.replace('.', '/') + '.py')).read_text(encoding='utf-8'))
            assert_owner_imports(self, tree, owner)
            importlib.import_module('curriculum_api.' + owner)
        self.assertFalse(any(n.split('.')[0] in {'django', 'psycopg', 'requests', 'httpx', 'redis', 'msal'}
                             for n in set(sys.modules) - before))


if __name__ == '__main__':
    unittest.main()
