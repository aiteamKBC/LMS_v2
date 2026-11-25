"""Frozen-source contracts for the calendar, identity and storage extraction."""
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
from curriculum_api.meetings.tests.calendar_oracle import restore_tree
from curriculum_api.meetings.tests.policy_composition_oracle import assert_export_contract, assert_owner_imports
from curriculum_api.meetings.tests.approved_dev_contracts import DEV_PORTS, reference_source

SNAPSHOT_PATH = Path(__file__).parent / 'fixtures/calendar_snapshot.json'
SNAPSHOT = json.loads(SNAPSHOT_PATH.read_text(encoding='utf-8'))


class CalendarBoundaryContracts(unittest.TestCase):
    def test_frozen_source_and_unrelated_views_preserved(self):
        self.assertEqual(hashlib.sha256(SNAPSHOT_PATH.read_bytes()).hexdigest(),
                         'd2d58c330d5dfbcc8a30a53d3403b45d81892ce21a4682a70b714e5241963d9f')
        tree = ast.parse((ROOT / 'views.py').read_text(encoding='utf-8-sig'))
        self.assertEqual(hashlib.sha256(ast.dump(restore_tree(tree, 'views.py')).encode()).hexdigest(),
                         SNAPSHOT['views_ast_sha256'])

    def test_actual_bodies_preserve_queries_rules_and_exception_boundaries(self):
        class Normalize(ast.NodeTransformer):
            def visit_ImportFrom(self, node):
                return None

            def visit_Assign(self, node):
                if isinstance(node.value, ast.Call) and isinstance(node.value.func, ast.Name) and node.value.func.id == 'calendar_fallback':
                    return None
                return self.generic_visit(node)

        for name, entry in SNAPSHOT['functions'].items():
            old = ast.parse(reference_source(name, entry['source'])).body[0]
            tree = ast.parse((ROOT / (entry['owner'].replace('.', '/') + '.py')).read_text(encoding='utf-8'))
            actual = copy.deepcopy(next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == name))
            actual.args = copy.deepcopy(old.args)
            actual.decorator_list = copy.deepcopy(old.decorator_list)
            text = ast.unparse(actual)
            if entry['optional_owner']:
                text = text.replace('owner_resolver = teams_module_owner_id', "owner_resolver = globals().get('teams_module_owner_id')")
            with self.subTest(name=name):
                self.assertEqual(ast.dump(Normalize().visit(old)), ast.dump(Normalize().visit(ast.parse(text).body[0])))

    def test_public_facades_keep_signatures_decorators_and_bindings(self):
        tree = current_entry_tree()
        functions = {n.name: n for n in tree.body if isinstance(n, ast.FunctionDef)}
        for name, entry in SNAPSHOT['functions'].items():
            old = ast.parse(reference_source(name, entry['source'])).body[0]
            if assert_export_contract(self, tree, name, old):
                continue
            actual = functions[name]
            with self.subTest(name=name):
                self.assertEqual(ast.dump(actual.args), ast.dump(old.args))
                self.assertEqual([ast.dump(n) for n in actual.decorator_list], [ast.dump(n) for n in old.decorator_list])
                call = actual.body[-1].value
                self.assertEqual([ast.unparse(a) for a in call.args], [a.arg for a in old.args.args])
                self.assertEqual({k.arg for k in call.keywords}, set(entry['capabilities']) | set(DEV_PORTS.get(name, ())) | {a.arg for a in old.args.kwonlyargs})
                for k in call.keywords:
                    direct_owner_bindings = {'apply_shared_teams_settings_to_weeks', 'teams_delivery_metadata_from_live_session'}
                    self.assertEqual(ast.unparse(k.value), "globals().get('teams_module_owner_id')" if k.arg == 'teams_module_owner_id' and name not in direct_owner_bindings else k.arg)
                if entry['deferred_imports']:
                    deferred = next(n for n in actual.body if isinstance(n, ast.FunctionDef))
                    self.assertEqual(ast.unparse(deferred.body[0]), 'from .catalogue.infrastructure.country_calendar_reads import CalendarUnavailable')
                    delayed = deferred.body[1]
                    self.assertIsInstance(delayed, ast.FunctionDef)
                    self.assertEqual(ast.unparse(delayed.body[0]), 'from .catalogue.infrastructure.calendar_display import display_cohort_holidays as read_holidays')
                    self.assertEqual(ast.unparse(delayed.body[1]), 'return read_holidays(cohort_ids)')
                    self.assertEqual(ast.unparse(deferred.body[-1]), 'return (CalendarUnavailable, display_cohort_holidays)')

    def test_new_owners_have_no_reverse_dependencies_or_runtime_imports(self):
        before = set(sys.modules)
        for owner in {e['owner'] for e in SNAPSHOT['functions'].values()}:
            tree = ast.parse((ROOT / (owner.replace('.', '/') + '.py')).read_text(encoding='utf-8'))
            assert_owner_imports(self, tree, owner)
            importlib.import_module('curriculum_api.' + owner)
        self.assertFalse(any(n.split('.')[0] in {'django', 'psycopg', 'requests', 'httpx', 'redis', 'msal'} for n in set(sys.modules) - before))


if __name__ == '__main__':
    unittest.main()
