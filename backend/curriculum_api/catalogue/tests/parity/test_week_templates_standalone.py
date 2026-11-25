"""Exact-source and dependency checks for the week-template read extraction."""
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
SNAPSHOT = json.loads((ROOT / 'tests/fixtures/legacy_snapshots/week_templates_snapshot.json').read_text(encoding='utf-8'))


@lru_cache(None)
def tree(path):
    return _read_dependencies.source_tree(path)


def function(path, name):
    return deepcopy(next(n for n in tree(path).body if isinstance(n, ast.FunctionDef) and n.name == name))


class WeekTemplateContracts(unittest.TestCase):
    def test_original_query_projection_and_read_order_bodies_are_preserved(self):
        for name, entry in SNAPSHOT.items():
            old = ast.parse(entry['source']).body[0]
            new = function(ROOT.parent.parent.joinpath(*entry['module'].split('.')).with_suffix('.py'), entry.get('new_name', name))
            if name == 'curriculum_week_template_collection':
                old_body = old.body[1].body
                new = ast.parse(ast.unparse(new).replace('get_filter(', 'request.GET.get(')).body[0]
                self.assertEqual(ast.dump(new.body[-1].value), ast.dump(old_body[-1].value.args[0]))
                new.body[-1] = old_body[-1]
            else:
                old_body = old.body
            self.assertEqual([ast.dump(n) for n in old_body], [ast.dump(n) for n in new.body], name)

    def test_public_signatures_defaults_and_capability_bindings(self):
        for name, entry in SNAPSHOT.items():
            old = ast.parse(entry['source']).body[0]
            wrapper = function(ROOT.parent / 'views.py', name)
            self.assertEqual(ast.dump(wrapper.args), ast.dump(old.args))
            self.assertEqual([ast.unparse(d) for d in wrapper.decorator_list], entry['decorators'])
            if name == 'curriculum_week_template_collection':
                # The HTTP body now belongs to the API owner; the public
                # signature/decorators above still belong to the views seam.
                owner = function(ROOT / 'api/week_template_commands.py', name)
                call = owner.body[1].body[-1].value.args[0]
                self.assertEqual([ast.unparse(a) for a in call.args], ['request.GET.get'])
            else:
                call = wrapper.body[-1].value
                self.assertEqual([ast.unparse(a) for a in call.args], [a.arg for a in old.args.args])
            expected = {d: d for d in entry['deps']}
            expected.update({a.arg: a.arg for a in old.args.kwonlyargs})
            self.assertEqual({k.arg: ast.unparse(k.value) for k in call.keywords}, expected)

    def test_collection_provisioning_and_all_post_statements_are_unchanged(self):
        old = ast.parse(SNAPSHOT['curriculum_week_template_collection']['source']).body[0]
        new = function(ROOT / 'api/week_template_commands.py', old.name)
        self.assertEqual(ast.dump(old.body[0]), ast.dump(new.body[0]))
        self.assertEqual(ast.dump(old.body[1].test), ast.dump(new.body[1].test))
        self.assertEqual([ast.dump(n) for n in old.body[2:]], [ast.dump(n) for n in new.body[2:]])

    def test_new_modules_have_no_framework_or_legacy_import_edges(self):
        sys.path.insert(0, str(ROOT.parent.parent))
        for module in {e['module'] for e in SNAPSHOT.values()}:
            path = ROOT.parent.parent.joinpath(*module.split('.')).with_suffix('.py')
            self.assertFalse(any(isinstance(n, (ast.Import, ast.ImportFrom)) for n in ast.walk(tree(path))))
            importlib.import_module(module)
        self.assertNotIn('django', sys.modules)


if __name__ == '__main__':
    unittest.main()
