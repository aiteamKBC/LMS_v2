"""Original-source, public binding and pure dependency contracts; no Django."""
import ast
from copy import deepcopy
from functools import lru_cache
import importlib
import json
from pathlib import Path
import sys
import unittest

import importlib.util as _read_dependencies_util
_read_dependencies_spec = _read_dependencies_util.spec_from_file_location('read_dependencies_oracle', Path(__file__).with_name('read_dependencies_oracle.py'))
_read_dependencies = _read_dependencies_util.module_from_spec(_read_dependencies_spec)
_read_dependencies_spec.loader.exec_module(_read_dependencies)

ROOT = Path(__file__).resolve().parents[2]
SNAPSHOT = json.loads((ROOT / 'tests/fixtures/legacy_snapshots/session_plans_snapshot.json').read_text(encoding='utf-8'))


@lru_cache(None)
def tree(path):
    return _read_dependencies.source_tree(path)


def function(path, name):
    return deepcopy(next(n for n in tree(path).body if isinstance(n, ast.FunctionDef) and n.name == name))


class SessionPlanContracts(unittest.TestCase):
    def test_original_bodies_preserved_except_named_lazy_capabilities(self):
        for name, entry in SNAPSHOT.items():
            old = ast.parse(entry['source']).body[0]
            new = function(ROOT.parent.parent.joinpath(*entry['module'].split('.')).with_suffix('.py'), name)
            if name == 'module_delivery_session_plan':
                for before, after in zip(old.body, new.body):
                    if isinstance(before, ast.If) and isinstance(before.body[0], ast.ImportFrom):
                        self.assertEqual(ast.dump(before.test), ast.dump(after.test))
                        if before.body[0].module.endswith('country_calendars'):
                            call = after.body[0].value
                            self.assertEqual(call.func.id, 'raise_calendar_unavailable')
                            self.assertEqual(ast.dump(call.args[0]), ast.dump(before.body[1].exc.args[0]))
                        else:
                            self.assertEqual(ast.unparse(after.body[0]), 'holidays = read_module_holidays(module, holidays)')
                        after.body = deepcopy(before.body)
            # Exclude documentation: four orchestration docstrings now describe
            # the actual flag-only behavior, not the obsolete shifting model.
            def executable_body(node):
                body = node.body
                if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant) and isinstance(body[0].value.value, str):
                    body = body[1:]
                return [ast.dump(n) for n in body]
            self.assertEqual(executable_body(new), executable_body(old), name)

    def test_public_signatures_defaults_and_callback_bindings(self):
        for name, entry in SNAPSHOT.items():
            old = ast.parse(entry['source']).body[0]
            wrapper = function(ROOT.parent / 'views.py', name)
            self.assertEqual(ast.dump(old.args), ast.dump(wrapper.args))
            self.assertEqual([ast.unparse(n) for n in wrapper.decorator_list], entry['decorators'])
            call = wrapper.body[-1].value
            self.assertEqual([ast.unparse(n) for n in call.args], [n.arg for n in old.args.args])
            self.assertEqual({k.arg: ast.unparse(k.value) for k in call.keywords}, entry['bindings'])

    def test_lazy_error_and_country_read_adapters_are_explicit(self):
        wrapper = function(ROOT.parent / 'views.py', 'module_delivery_session_plan')
        error, read = wrapper.body[:2]
        self.assertEqual(ast.unparse(error.body[0]), 'from curriculum_api.country_calendars import CalendarUnavailable')
        self.assertEqual(ast.unparse(error.body[1]), 'raise CalendarUnavailable(message)')
        self.assertEqual(ast.unparse(read.body[0]), 'from curriculum_api.delivery_calendar import module_holidays')
        self.assertEqual(ast.unparse(read.body[1]), 'return module_holidays(module, holidays)')

    def test_owners_import_only_stdlib_without_runtime_cycles_or_legacy_edges(self):
        sys.path.insert(0, str(ROOT.parent.parent))
        for module in {e['module'] for e in SNAPSHOT.values()}:
            path = ROOT.parent.parent.joinpath(*module.split('.')).with_suffix('.py')
            for node in ast.walk(tree(path)):
                if isinstance(node, ast.Import):
                    self.assertTrue(all(n.name in {'re', 'json'} for n in node.names))
                if isinstance(node, ast.ImportFrom):
                    self.assertEqual(node.module, 'datetime')
            importlib.import_module(module)
        for forbidden in ('django', 'requests', 'curriculum_api.views', 'curriculum_api.country_calendars'):
            self.assertNotIn(forbidden, sys.modules)


if __name__ == '__main__':
    unittest.main()
