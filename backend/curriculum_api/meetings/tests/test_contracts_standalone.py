"""No runtime setup: protect moved bodies, facade bindings and import direction."""
import ast
import copy
import hashlib
import importlib
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT.parent))
from curriculum_api.meetings.tests.layout_oracle import restore_tree
SNAPSHOT_PATH = Path(__file__).parent / 'fixtures/legacy_snapshot.json'
SNAPSHOT = json.loads(SNAPSHOT_PATH.read_text(encoding='utf-8'))


class BoundaryContracts(unittest.TestCase):
    def test_frozen_source_and_unrelated_views_nodes_are_preserved(self):
        self.assertEqual(hashlib.sha256(SNAPSHOT_PATH.read_bytes()).hexdigest(),
            'e00146e80ef2d4e5826255511370c47174aff9480b7957fafddafb00460c12d1')
        tree = ast.parse((ROOT / 'views.py').read_text(encoding='utf-8-sig'))
        self.assertEqual(hashlib.sha256(ast.dump(restore_tree(tree, 'views.py')).encode()).hexdigest(),
                         SNAPSHOT['views_ast_sha256'])

    def test_exact_bodies_except_explicit_capability_binding(self):
        class Normalize(ast.NodeTransformer):
            def visit_ImportFrom(self, node):
                return None
            def visit_Import(self, node):
                return None
        for name, entry in SNAPSHOT['functions'].items():
            old = ast.parse(entry['source']).body[0]
            current = ast.parse((ROOT / (entry['owner'].replace('.', '/') + '.py')).read_text(encoding='utf-8')).body[-1]
            current = copy.deepcopy(current)
            current.args = copy.deepcopy(old.args)
            current.decorator_list = copy.deepcopy(old.decorator_list)
            text = ast.unparse(current)
            if name == 'curriculum_teams_meeting':
                text = text.replace('owner_resolver = teams_module_owner_id', "owner_resolver = globals().get('teams_module_owner_id')")
            if name == 'curriculum_teams_meeting_schedule':
                text = text.replace('original_calendar_request(schedule_request)', 'original_calendar_request(curriculum_teams_meeting_schedule)')
            with self.subTest(name=name):
                self.assertEqual(ast.dump(Normalize().visit(old)), ast.dump(ast.parse(text).body[0]))

    def test_public_signatures_decorators_and_explicit_ports(self):
        from curriculum_api.catalogue.tests.parity.current_entry_source import current_entry_tree
        tree = current_entry_tree()
        functions = {n.name:n for n in tree.body if isinstance(n,ast.FunctionDef)}
        for name, entry in SNAPSHOT['functions'].items():
            fn = functions[name]
            old = ast.parse(entry['source']).body[0]
            self.assertEqual(ast.dump(fn.args), ast.dump(old.args))
            self.assertEqual([ast.dump(n) for n in fn.decorator_list], [ast.dump(n) for n in old.decorator_list])
            call = fn.body[-1].value
            expected = set(entry['capabilities']) | {a.arg for a in old.args.kwonlyargs}
            self.assertEqual({k.arg for k in call.keywords}, expected)
            for kw in call.keywords:
                if kw.arg not in ('schedule_request','teams_module_owner_id'):
                    self.assertEqual(ast.unparse(kw.value),kw.arg)
            if name == 'curriculum_teams_meeting_schedule':
                self.assertEqual(ast.unparse(next(k.value for k in call.keywords if k.arg=='schedule_request')),name)

    def test_owners_import_without_runtime_and_have_no_reverse_edges(self):
        before = set(sys.modules)
        for entry in SNAPSHOT['functions'].values():
            path = ROOT / (entry['owner'].replace('.', '/') + '.py')
            tree = ast.parse(path.read_text(encoding='utf-8'))
            self.assertFalse(any(isinstance(n,(ast.Import,ast.ImportFrom)) for n in ast.walk(tree)))
            importlib.import_module('curriculum_api.' + entry['owner'])
        self.assertFalse(any(n.split('.')[0] in {'django','psycopg','requests','httpx','redis','msal'} for n in set(sys.modules)-before))


if __name__ == '__main__':
    unittest.main()
