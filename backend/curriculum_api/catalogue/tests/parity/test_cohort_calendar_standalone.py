"""Frozen-source and boundary contracts; never imports Django or settings."""
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
SNAPSHOT = json.loads((ROOT / 'tests/fixtures/legacy_snapshots/cohort_calendar_snapshot.json').read_text(encoding='utf-8'))


@lru_cache(None)
def tree(path):
    return _read_dependencies.source_tree(path)


def function(path, name):
    return deepcopy(next(n for n in tree(path).body if isinstance(n, ast.FunctionDef) and n.name == name))


class CohortCalendarContracts(unittest.TestCase):
    def test_original_read_and_rule_bodies_with_reviewed_capability_substitution(self):
        for name, entry in SNAPSHOT.items():
            source = entry['source'].replace('calendar_holidays.in_use()', 'calendar_in_use()').replace('calendar_holidays.rows()', 'calendar_rows()')
            old = ast.parse(source).body[0]
            new = function(ROOT.parent.parent.joinpath(*entry['module'].split('.')).with_suffix('.py'), name)
            if name == 'serialize_cohort_authoring_detail':
                old_branch = next(n for n in old.body if isinstance(n, ast.If))
                new_branch = next(n for n in new.body if isinstance(n, ast.If))
                self.assertEqual(ast.dump(new_branch.test), ast.dump(old_branch.test))
                self.assertEqual(ast.unparse(new_branch.body[0]), 'calendar_rows, calendar_error = read_policy_calendar(row, calendar_rows)')
                new_branch.body = deepcopy(old_branch.body)
            self.assertEqual([ast.dump(n) for n in new.body], [ast.dump(n) for n in old.body], name)

    def test_lazy_calendar_adapter_keeps_original_call_and_exception_mapping(self):
        name = 'serialize_cohort_authoring_detail'
        old = ast.parse(SNAPSHOT[name]['source']).body[0]
        branch = next(n for n in old.body if isinstance(n, ast.If))
        wrapper = function(ROOT.parent / 'views.py', name)
        adapter = wrapper.body[0]
        self.assertEqual(adapter.name, 'read_policy_calendar')
        self.assertEqual([ast.dump(n) for n in adapter.body[:3]], [ast.dump(n) for n in branch.body[:3]])
        old_try, new_try = branch.body[3], adapter.body[3]
        self.assertEqual(ast.dump(new_try.body[0].value.elts[0]), ast.dump(old_try.body[0].value))
        self.assertEqual(new_try.body[0].value.elts[1].value, '')
        self.assertEqual(ast.dump(new_try.handlers[0].type), ast.dump(old_try.handlers[0].type))
        self.assertEqual([ast.dump(n) for n in new_try.handlers[0].body[0].value.elts],
                         [ast.dump(n.value) for n in old_try.handlers[0].body])

    def test_signatures_scope_decorator_and_named_bindings_preserved(self):
        for name, entry in SNAPSHOT.items():
            old = ast.parse(entry['source']).body[0]
            wrapper = function(ROOT.parent / 'views.py', name)
            self.assertEqual(ast.dump(wrapper.args), ast.dump(old.args))
            self.assertEqual([ast.unparse(d) for d in wrapper.decorator_list], entry['decorators'])
            call = wrapper.body[-1].value
            self.assertEqual([ast.unparse(a) for a in call.args], [a.arg for a in old.args.args])
            self.assertEqual({k.arg: ast.unparse(k.value) for k in call.keywords}, entry['bindings'])

    def test_all_three_owners_import_without_framework_views_or_provider_edges(self):
        sys.path.insert(0, str(ROOT.parent.parent))
        for module in {entry['module'] for entry in SNAPSHOT.values()}:
            path = ROOT.parent.parent.joinpath(*module.split('.')).with_suffix('.py')
            self.assertFalse(any(isinstance(n, (ast.Import, ast.ImportFrom)) for n in ast.walk(tree(path))))
            importlib.import_module(module)
        for forbidden in ('django', 'requests', 'curriculum_api.views', 'curriculum_api.country_calendars'):
            self.assertNotIn(forbidden, sys.modules)


if __name__ == '__main__':
    unittest.main()
