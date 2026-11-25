"""Source fidelity and dependency checks without importing the application."""
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
SNAPSHOT = json.loads((ROOT / 'tests/fixtures/legacy_snapshots/inherited_calendar_snapshot.json').read_text(encoding='utf-8'))


@lru_cache(None)
def tree(path):
    return _read_dependencies.source_tree(path)


def function(path, name):
    return deepcopy(next(n for n in tree(path).body if isinstance(n, ast.FunctionDef) and n.name == name))


def policy_branch(node):
    loop = next(n for n in node.body if isinstance(n, ast.For))
    return next(n for n in loop.body if isinstance(n, ast.If) and
                (isinstance(n.test, ast.BoolOp) or isinstance(n.test, ast.Call)))


class InheritedCalendarContracts(unittest.TestCase):
    def test_original_bodies_except_the_two_explicit_lazy_read_adapters(self):
        for name, entry in SNAPSHOT.items():
            old = ast.parse(entry['source']).body[0]
            new = function(ROOT / 'application/inherited_calendar.py', name)
            if name in ('cohort_selected_holidays_by_id', 'cohort_selected_holidays_by_cohort'):
                before, after = policy_branch(old), policy_branch(new)
                self.assertEqual(ast.dump(before.test), ast.dump(after.test))
                expected = ('calendar_rows, calendar_error = read_overview_calendar(cohort, holiday_rows)\n'
                            'if calendar_error is not None:\n    cohort["calendarError"] = calendar_error'
                            if name.endswith('_id') else
                            'calendar_rows = read_cohort_calendar(cohort, holiday_rows)')
                self.assertEqual([ast.dump(n) for n in after.body], [ast.dump(n) for n in ast.parse(expected).body])
                after.body = deepcopy(before.body)
            self.assertEqual([ast.dump(n) for n in new.body], [ast.dump(n) for n in old.body], name)

    def test_lazy_adapters_preserve_arguments_imports_and_exception_contract(self):
        for name in ('cohort_selected_holidays_by_id', 'cohort_selected_holidays_by_cohort'):
            old = policy_branch(ast.parse(SNAPSHOT[name]['source']).body[0])
            adapter = function(ROOT.parent / 'views.py', name).body[0]
            count = 3 if name.endswith('_id') else 2
            self.assertEqual([ast.dump(n) for n in adapter.body[:count]], [ast.dump(n) for n in old.body[:count]])
            if count == 3:
                before, after = old.body[3], adapter.body[3]
                self.assertEqual(ast.dump(before.body[0].value), ast.dump(after.body[0].value.elts[0]))
                self.assertIsNone(after.body[0].value.elts[1].value)
                self.assertEqual(ast.dump(before.handlers[0].type), ast.dump(after.handlers[0].type))
                self.assertEqual([ast.dump(n.value) for n in reversed(before.handlers[0].body)],
                                 [ast.dump(n) for n in after.handlers[0].body[0].value.elts])
            else:
                self.assertEqual(ast.dump(old.body[2].value), ast.dump(adapter.body[2].value))

    def test_public_signatures_and_narrow_bindings_preserved(self):
        for name, entry in SNAPSHOT.items():
            old = ast.parse(entry['source']).body[0]
            wrapper = function(ROOT.parent / 'views.py', name)
            self.assertEqual(ast.dump(old.args), ast.dump(wrapper.args))
            self.assertEqual([ast.unparse(n) for n in wrapper.decorator_list], entry['decorators'])
            call = wrapper.body[-1].value
            self.assertEqual([ast.unparse(n) for n in call.args], [n.arg for n in old.args.args])
            self.assertEqual({k.arg: ast.unparse(k.value) for k in call.keywords}, entry['bindings'])

    def test_owner_has_no_framework_legacy_or_provider_imports(self):
        self.assertFalse(any(isinstance(n, (ast.Import, ast.ImportFrom))
                             for n in ast.walk(tree(ROOT / 'application/inherited_calendar.py'))))
        sys.path.insert(0, str(ROOT.parent.parent))
        importlib.import_module('curriculum_api.catalogue.application.inherited_calendar')
        for forbidden in ('django', 'requests', 'curriculum_api.views', 'curriculum_api.country_calendars'):
            self.assertNotIn(forbidden, sys.modules)


if __name__ == '__main__':
    unittest.main()
