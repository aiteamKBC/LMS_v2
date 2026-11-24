"""Exact source, public binding and import-boundary contracts for lifecycle extraction."""
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
from curriculum_api.meetings.tests.lifecycle_oracle import restore_tree

SNAPSHOT_PATH = Path(__file__).parent / 'fixtures/lifecycle_snapshot.json'
SNAPSHOT = json.loads(SNAPSHOT_PATH.read_text(encoding='utf-8'))


class LifecycleBoundaryContracts(unittest.TestCase):
    def test_frozen_source_and_unrelated_views_preserved(self):
        self.assertEqual(hashlib.sha256(SNAPSHOT_PATH.read_bytes()).hexdigest(),
                         '4c978b8f1af7deeec51ac2b74471a2980b136c35fc50b2b04128e32cad5fa0e6')
        tree = ast.parse((ROOT / 'views.py').read_text(encoding='utf-8-sig'))
        self.assertEqual(hashlib.sha256(ast.dump(restore_tree(tree, 'views.py')).encode()).hexdigest(),
                         SNAPSHOT['views_ast_sha256'])

    def test_actual_bodies_preserve_every_statement_and_lazy_import_position(self):
        for name, entry in SNAPSHOT['functions'].items():
            if entry.get('composed'):
                continue  # Exact split-body contracts are checked separately below.
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
            flag = entry.get('ready_flag')
            if flag:
                old.body = [n for n in old.body if not (isinstance(n, ast.Global) or
                    isinstance(n, ast.If) and isinstance(n.test, ast.Name) and n.test.id == flag or
                    isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == flag for t in n.targets))]
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
            old, actual = ast.parse(entry['source']).body[0], functions[name]
            with self.subTest(name=name):
                self.assertEqual(ast.dump(actual.args), ast.dump(old.args))
                self.assertEqual([ast.dump(n) for n in actual.decorator_list], [ast.dump(n) for n in old.decorator_list])
                if entry.get('composed'):
                    self.assertEqual(ast.unparse(actual.body[-1]),
                        'return implementation(request, module_catalogue_id, clean_str=clean_str, json_error=json_error, JsonResponse=JsonResponse, read_invitees=read_invitees)')
                    continue
                flag = entry.get('ready_flag')
                if flag:
                    self.assertEqual(ast.unparse(actual.body[-1]), flag + ' = True')
                    self.assertEqual(ast.unparse(actual.body[2]), 'global ' + flag)
                    self.assertEqual(ast.unparse(actual.body[3]), 'if ' + flag + ':\n    return')
                call = actual.body[-2 if flag else -1].value
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
                    expected_import = factory['source']
                    if name == 'teams_non_delivery_reason':
                        expected_import = expected_import.replace(
                            'from curriculum_api.delivery_calendar ', 'from .catalogue.infrastructure.delivery_calendar_runtime ')
                        expected_import = expected_import.replace('from curriculum_api.calendar_policy ', 'from .calendar_policy ')
                    self.assertEqual(ast.unparse(body[0]), expected_import)
                    self.assertEqual(ast.dump(body[1].value), ast.dump(ast.Tuple(
                        elts=[ast.Name(id=n, ctx=ast.Load()) for n in factory['names']], ctx=ast.Load())))

    def test_invitee_split_preserves_exact_reads_deduplication_and_transport(self):
        old = ast.parse(SNAPSHOT['functions']['curriculum_module_meeting_invitees']['source']).body[0]
        def owner(relative):
            tree = ast.parse((ROOT / relative).read_text(encoding='utf-8'))
            return next(n for n in tree.body if isinstance(n, ast.FunctionDef))
        reads = owner('meetings/infrastructure/invitee_reads.py')
        app = owner('meetings/application/invitee_queries.py')
        api = owner('meetings/api/invitees.py')
        dumps = lambda nodes: [ast.dump(n) for n in nodes]
        self.assertEqual(dumps(reads.body[:-1]), dumps(old.body[3:8]))
        self.assertEqual(ast.unparse(reads.body[-1]), 'return (tutor_email, plan_emails, mirror_emails)')
        expected = copy.deepcopy(old.body[8:])
        expected[-1].value = expected[-1].value.args[0]
        self.assertEqual(dumps(app.body[1:]), dumps(expected))
        self.assertEqual(ast.unparse(app.body[0]), 'tutor_email, plan_emails, mirror_emails = read_sources(module_catalogue_id)')
        self.assertEqual(dumps(api.body[:3]), dumps(old.body[:3]))
        self.assertEqual(ast.unparse(api.body[-1]), 'return JsonResponse(read_invitees(module_catalogue_id))')

    def test_owners_import_without_framework_or_provider_dependencies(self):
        before = set(sys.modules)
        for owner in {entry['owner'] for entry in SNAPSHOT['functions'].values()} | {
                'meetings.application.invitee_queries', 'meetings.infrastructure.invitee_reads'}:
            tree = ast.parse((ROOT / (owner.replace('.', '/') + '.py')).read_text(encoding='utf-8'))
            self.assertFalse(any(isinstance(n, (ast.Import, ast.ImportFrom)) for n in ast.walk(tree)))
            importlib.import_module('curriculum_api.' + owner)
        self.assertFalse(any(n.split('.')[0] in {'django', 'psycopg', 'requests', 'httpx', 'redis', 'msal'}
                             for n in set(sys.modules) - before))


if __name__ == '__main__':
    unittest.main()
