"""Stdlib-only checks of actual holiday ownership and immutable pre-batch source."""
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

spec = importlib.util.spec_from_file_location('holiday_oracle', Path(__file__).with_name('holiday_boundary_oracle.py'))
oracle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(oracle)
ROOT, SNAPSHOT = oracle.ROOT, oracle.SNAPSHOT


def tree(path):
    return _read_dependencies.source_tree(path)


def function(path, name):
    return next(n for n in tree(path).body if isinstance(n, ast.FunctionDef) and n.name == name)


class HolidaySourceContracts(unittest.TestCase):
    def test_frozen_source_is_immutable(self):
        self.assertEqual(hashlib.sha256(oracle.SNAPSHOT_PATH.read_bytes()).hexdigest(),
                         '42b8dba49a169a33158346aaa2c18b7a1053166f14892b58c9849e8b16e4d7fa')

    def test_unrelated_module_statements_remain_exact(self):
        for filename, entry in SNAPSHOT['modules'].items():
            restored = oracle.restore_module(tree(ROOT / filename), filename)
            self.assertEqual(hashlib.sha256(ast.dump(restored).encode()).hexdigest(), entry['ast_sha256'])

    def test_actual_bodies_and_sql_preserve_frozen_semantics(self):
        for key, entry in SNAPSHOT['functions'].items():
            name = key.split(':')[1]
            if name == 'curriculum_preview_cohort_end_date':
                continue  # The separate test checks BOTH pieces of this split.
            old = oracle.relocated_body(entry['source'])
            new = function(ROOT.parent / (entry['owner'].replace('.', '/') + '.py'), name)
            self.assertEqual([ast.dump(n) for n in old.body], [ast.dump(n) for n in new.body], key)

    def test_preview_computation_and_http_guards_preserve_exact_source(self):
        entry = SNAPSHOT['functions']['views.py:curriculum_preview_cohort_end_date']
        old = ast.parse(entry['source']).body[0]
        api = function(ROOT / 'catalogue/api/cohort_preview.py', old.name)
        app = function(ROOT / 'catalogue/application/cohort_calendar.py', 'cohort_end_preview')
        self.assertEqual([ast.dump(n) for n in api.body[:3]], [ast.dump(n) for n in old.body[:3]])
        computation = copy.deepcopy(old.body[3:])
        self.assertEqual(ast.unparse(computation[-1].value.func), 'JsonResponse')
        computation[-1].value = computation[-1].value.args[0]
        self.assertEqual([ast.dump(n) for n in app.body[1:]], [ast.dump(n) for n in computation])
        self.assertEqual(ast.unparse(api.body[-1].value.func), 'JsonResponse')
        call = api.body[-1].value.args[0]
        self.assertEqual(ast.unparse(call.func), 'cohort_end_preview')
        self.assertEqual([ast.unparse(a) for a in call.args], ['payload'])
        self.assertEqual({k.arg for k in call.keywords}, {a.arg for a in app.args.kwonlyargs})
        self.assertTrue(all(ast.unparse(k.value) == k.arg for k in call.keywords))

    def test_public_contracts_bind_exact_dependencies_without_reverse_imports(self):
        for key, entry in SNAPSHOT['functions'].items():
            filename, name = key.split(':')
            old = ast.parse(entry['source']).body[0]
            wrapper = function(ROOT / filename, name)
            self.assertEqual(ast.dump(wrapper.args), ast.dump(old.args), key)
            self.assertEqual([ast.unparse(d) for d in wrapper.decorator_list], entry['decorators'])
            self.assertEqual(wrapper.body[0].module, entry['owner'].removeprefix('curriculum_api.'))
            call = wrapper.body[-1].value
            self.assertEqual(ast.unparse(call.func), 'implementation')
            self.assertEqual([ast.unparse(a) for a in call.args], [a.arg for a in old.args.args])
            self.assertEqual({k.arg for k in call.keywords}, set(entry['deps']) | {a.arg for a in old.args.kwonlyargs})
            for k in call.keywords:
                self.assertEqual(ast.unparse(k.value), ('views.' if k.arg in entry['viewrefs'] else '') + k.arg)
            callbacks = {n.name: n for n in wrapper.body if isinstance(n, ast.FunctionDef)}
            self.assertEqual(set(callbacks), set(entry['callbacks']))
            for cb, cfg in entry['callbacks'].items():
                fn = callbacks[cb]
                self.assertEqual((fn.body[0].module, fn.body[0].level), (cfg['module'], 1))
                self.assertEqual(fn.body[0].names[0].name, cfg['name'])
                self.assertEqual(ast.unparse(fn.body[-1]), 'return operation' if cfg['loader'] else 'return operation(*args, **kwargs)')

    def test_concrete_owners_have_no_legacy_or_provider_imports(self):
        for owner in {e['owner'] for e in SNAPSHOT['functions'].values()}:
            for node in ast.walk(tree(ROOT.parent / (owner.replace('.', '/') + '.py'))):
                if isinstance(node, ast.Import):
                    self.assertTrue(all(a.name in {'json'} for a in node.names), owner)
                if isinstance(node, ast.ImportFrom):
                    self.assertIn((node.level, node.module), {(2, 'application.cohort_calendar')})


if __name__ == '__main__':
    unittest.main()
