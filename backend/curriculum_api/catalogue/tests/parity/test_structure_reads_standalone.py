"""Source and dependency contracts for the structure read boundary; no Django."""
import ast
from copy import deepcopy
from functools import lru_cache
import json
from pathlib import Path
import unittest

import importlib.util as _read_dependencies_util
_read_dependencies_spec = _read_dependencies_util.spec_from_file_location('read_dependencies_oracle', Path(__file__).with_name('read_dependencies_oracle.py'))
_read_dependencies = _read_dependencies_util.module_from_spec(_read_dependencies_spec)
_read_dependencies_spec.loader.exec_module(_read_dependencies)

ROOT = Path(__file__).resolve().parents[2]
SNAPSHOT = json.loads((ROOT / 'tests/fixtures/legacy_snapshots/structure_reads_snapshot.json').read_text(encoding='utf-8'))


@lru_cache(None)
def tree(path):
    return _read_dependencies.source_tree(path)


def function(path, name):
    return next(n for n in tree(path).body if isinstance(n, ast.FunctionDef) and n.name == name)


class StructureReadContracts(unittest.TestCase):
    def test_five_bodies_preserve_original_sql_and_payloads(self):
        self.assertEqual(len(SNAPSHOT), 5)
        for key, entry in SNAPSHOT.items():
            with self.subTest(function=key):
                name = key
                old = ast.parse(entry['source']).body[0]
                new = deepcopy(function(ROOT.parent.parent.joinpath(*entry['module'].split('.')).with_suffix('.py'), name))
                aliases = dict(entry['attrs'])
                class Restore(ast.NodeTransformer):
                    def visit_Name(self, n):
                        return ast.parse(aliases[n.id], mode='eval').body if n.id in aliases else n
                    def visit_Call(self, n):
                        if isinstance(n.func, ast.Name) and n.func.id == 'database_vendor':
                            return ast.parse('connection.vendor', mode='eval').body
                        if isinstance(n.func, ast.Name) and n.func.id == 'calendar_unavailable_type':
                            return ast.Name(id='CalendarUnavailable', ctx=ast.Load())
                        return self.generic_visit(n)
                class RemoveLocalImport(ast.NodeTransformer):
                    def visit_ImportFrom(self, n):
                        return None
                new = Restore().visit(new)
                old = RemoveLocalImport().visit(old)
                self.assertEqual([ast.dump(n) for n in old.body], [ast.dump(n) for n in new.body])

    def test_legacy_signatures_forward_exact_arguments_and_read_capabilities(self):
        for key, entry in SNAPSHOT.items():
            name = key
            wrapper = function(ROOT.parent / 'views.py', name)
            old = ast.parse(entry['source']).body[0]
            self.assertEqual(ast.dump(wrapper.args), ast.dump(old.args))
            self.assertEqual([ast.unparse(n) for n in wrapper.decorator_list], entry['decorators'])
            imports = [n for n in wrapper.body if isinstance(n, ast.ImportFrom)]
            self.assertEqual('curriculum_api.' + imports[-1].module, entry['module'])
            call = wrapper.body[-1].value
            self.assertEqual([ast.unparse(a) for a in call.args], [a.arg for a in old.args.args])
            keywords = {k.arg: ast.unparse(k.value) for k in call.keywords}
            for dep in entry['deps'] + [a.arg for a in old.args.kwonlyargs]:
                expected = ast.unparse(ast.parse(entry['bindings'].get(dep, dep), mode='eval').body)
                self.assertEqual(keywords[dep], expected)

    def test_leaf_modules_do_not_import_legacy_or_infrastructure(self):
        for module in {e['module'] for e in SNAPSHOT.values()}:
            path = ROOT.parent.parent.joinpath(*module.split('.')).with_suffix('.py')
            for n in ast.walk(tree(path)):
                self.assertNotIsInstance(n, ast.Import)
                if isinstance(n, ast.ImportFrom):
                    self.assertEqual((n.level, n.module), (0, 'collections'))
                    self.assertEqual([a.name for a in n.names], ['defaultdict'])

    def test_wiring_keeps_legacy_scope_and_narrow_read_capabilities(self):
        for name in ('get_authoring_structure_payload', 'get_authoring_structure_payloads'):
            node = function(ROOT / 'application/structure_payloads.py', name)
            args = {a.arg for a in node.args.kwonlyargs}
            self.assertTrue({'lookup_free_course_prices', 'free_course_price_payload'} <= args)
            self.assertTrue({'views', 'connection', 'free_course_pricing', 'archive_state'}.isdisjoint(args))
        wrapper = function(ROOT.parent / 'views.py', 'get_authoring_structure_payloads')
        self.assertEqual([n.name for n in wrapper.body if isinstance(n, ast.FunctionDef)],
                         ['calendar_unavailable_type', 'display_cohort_holidays'])
        reader = function(ROOT / 'infrastructure/component_reads.py', 'live_component_rows_without_content')
        args = {a.arg for a in reader.args.kwonlyargs}
        self.assertTrue({'open_cursor', 'database_vendor', 'archive_live_sql'} <= args)
        self.assertNotIn('connection', args)


if __name__ == '__main__':
    unittest.main()
