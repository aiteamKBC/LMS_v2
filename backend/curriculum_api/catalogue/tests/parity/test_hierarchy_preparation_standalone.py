"""Source contracts and pure imports; no Django/settings/database initialization."""
import ast
import importlib.util
import json
from pathlib import Path
import re
import calendar
from datetime import date, datetime, timedelta
import unittest

import importlib.util as _read_dependencies_util
_read_dependencies_spec = _read_dependencies_util.spec_from_file_location('read_dependencies_oracle', Path(__file__).with_name('read_dependencies_oracle.py'))
_read_dependencies = _read_dependencies_util.module_from_spec(_read_dependencies_spec)
_read_dependencies_spec.loader.exec_module(_read_dependencies)

ROOT = Path(__file__).resolve().parents[3]
SNAPSHOT = json.loads((ROOT / 'catalogue/tests/fixtures/legacy_snapshots/hierarchy_preparation_snapshot.json').read_text())


def tree(path):
    return _read_dependencies.source_tree(path)


def owner_path(entry):
    return ROOT.parent / (entry['owner'].replace('.', '/') + '.py')


class HierarchySourceContracts(unittest.TestCase):
    def test_exact_original_function_bodies_are_preserved(self):
        for name, entry in SNAPSHOT.items():
            old = ast.parse(entry['source']).body[0]
            old.body = [n for n in old.body if not (isinstance(n, ast.ImportFrom) and any(a.name in entry['local_ports'] for a in n.names))]
            class Ports(ast.NodeTransformer):
                def visit_ImportFrom(self, node):
                    return None if any(a.name in entry['local_ports'] for a in node.names) else node
            old = Ports().visit(old)
            current = next(n for n in tree(owner_path(entry)).body if isinstance(n, ast.FunctionDef) and n.name == name)
            self.assertEqual([ast.dump(n) for n in current.body], [ast.dump(n) for n in old.body], name)

    def test_public_signatures_and_decorators_are_unchanged(self):
        current = {n.name: n for n in tree(ROOT / 'views.py').body if isinstance(n, ast.FunctionDef)}
        for name, entry in SNAPSHOT.items():
            old = ast.parse(entry['source']).body[0]
            self.assertEqual(ast.dump(current[name].args), ast.dump(old.args), name)
            self.assertEqual([ast.unparse(d) for d in current[name].decorator_list], entry['decorators'], name)

    def test_all_compatibility_exports_call_the_actual_owner(self):
        current = {n.name: n for n in tree(ROOT / 'views.py').body if isinstance(n, ast.FunctionDef)}
        for name, entry in SNAPSHOT.items():
            function = current[name]
            self.assertEqual(function.body[0].module, entry['owner'].removeprefix('curriculum_api.'))
            self.assertEqual(function.body[0].names[0].name, name)
            self.assertIsInstance(function.body[-1], ast.Return)
            self.assertEqual(function.body[-1].value.func.id, 'implementation')
            self.assertEqual({kw.arg for kw in function.body[-1].value.keywords}, set(entry['dependencies']) | {a.arg for a in ast.parse(entry['source']).body[0].args.kwonlyargs})

    def test_new_owners_have_no_framework_or_reverse_imports(self):
        for path in {owner_path(entry) for entry in SNAPSHOT.values()}:
            for node in ast.walk(tree(path)):
                if isinstance(node, ast.Import):
                    self.fail(f'Unexpected import in {path.name}')
                if isinstance(node, ast.ImportFrom):
                    self.assertEqual((node.level, node.module), (0, 'collections'))
                    self.assertEqual([alias.name for alias in node.names], ['Counter'])
                if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
                    self.assertNotIn(node.func.attr, {'save', 'create', 'delete', 'bulk_create'})
                    if node.func.attr == 'execute':
                        self.assertEqual(path.parent.name, 'infrastructure')

    def test_pure_owners_import_without_loading_application_modules(self):
        namespace = dict(re=re, calendar=calendar, date=date, datetime=datetime, timedelta=timedelta)
        helpers = [n for n in tree(ROOT / 'views.py').body
                   if isinstance(n, ast.FunctionDef) and n.name in {'clean_str', 'parse_int', 'parse_date'}]
        self.assertEqual(len(helpers), 3)
        exec(compile(ast.Module(body=helpers, type_ignores=[]), '<actual-pure-normalizers>', 'exec'), namespace)
        cases = {'calculate_cohort_end_date': [('2026-09-01', 24), ('2024-01-31', 1), ('bad', 2)],
                 'append_notes_meta': [('Text\n__a: old', {'a': 'new'}), ('', {})]}
        for name, inputs in cases.items():
            spec = importlib.util.spec_from_file_location('pure_' + name, owner_path(SNAPSHOT[name]))
            owner = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(owner)
            dependencies = {dep: namespace[dep] for dep in SNAPSHOT[name]['dependencies']}
            exec(compile(SNAPSHOT[name]['source'], '<original>', 'exec'), namespace)
            for args in inputs:
                self.assertEqual(getattr(owner, name)(*args, **dependencies), namespace[name](*args))

    def test_no_persistence_or_provider_capabilities_in_pure_domain(self):
        forbidden = {'ensure_module_authoring_tables', 'fetch_all', 'authoring_fetch_all',
                     'authoring_upsert', 'connection', 'transaction', 'settings', 'logger'}
        for name, entry in SNAPSHOT.items():
            if '.domain.' in entry['owner']:
                self.assertFalse(set(entry['dependencies']) & forbidden, name)


if __name__ == '__main__':
    unittest.main()
