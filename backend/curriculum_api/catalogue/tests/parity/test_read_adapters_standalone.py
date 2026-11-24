"""Read adapter source contracts and pure policies; no Django or database imports."""
import ast
from copy import deepcopy
from functools import lru_cache
import importlib.util
import json
import math
from pathlib import Path
import unittest

import importlib.util as _read_dependencies_util
_read_dependencies_spec = _read_dependencies_util.spec_from_file_location('read_dependencies_oracle', Path(__file__).with_name('read_dependencies_oracle.py'))
_read_dependencies = _read_dependencies_util.module_from_spec(_read_dependencies_spec)
_read_dependencies_spec.loader.exec_module(_read_dependencies)

ROOT = Path(__file__).resolve().parents[2]
SNAPSHOT = json.loads((ROOT / 'tests/fixtures/legacy_snapshots/read_adapters_snapshot.json').read_text(encoding='utf-8'))


@lru_cache(None)
def tree(path):
    return _read_dependencies.source_tree(path)


def function(path, name):
    return next(n for n in tree(path).body if isinstance(n, ast.FunctionDef) and n.name == name)


class ReadAdapterContracts(unittest.TestCase):
    def test_actual_bodies_preserve_queries_completion_and_fallbacks(self):
        self.assertEqual(len(SNAPSHOT), 11)
        for name, entry in SNAPSHOT.items():
            source = entry['source']
            if name == 'authoring_select_sql':
                source = source.replace('    if ensure_tables:\n        ensure_module_authoring_tables()\n', '')
            if name == 'component_is_published':
                source = source.replace('component_builder_settings(row)', 'settings')
            old = ast.parse(source).body[0]
            new = deepcopy(function(ROOT.parent.parent.joinpath(*entry['module'].split('.')).with_suffix('.py'), name))

            class Restore(ast.NodeTransformer):
                def visit(self, node):
                    if isinstance(node, (ast.Name, ast.Call)) and ast.unparse(node) in entry['attrs']:
                        return ast.parse(entry['attrs'][ast.unparse(node)], mode='eval').body
                    return super().visit(node)

            new = Restore().visit(new)
            with self.subTest(function=name):
                self.assertEqual([ast.dump(n) for n in old.body], [ast.dump(n) for n in new.body])

    def test_public_signatures_decorators_and_bindings_are_preserved(self):
        for name, entry in SNAPSHOT.items():
            old = ast.parse(entry['source']).body[0]
            wrapper = function(ROOT.parent / 'views.py', name)
            self.assertEqual(ast.dump(wrapper.args), ast.dump(old.args))
            self.assertEqual([ast.unparse(d) for d in wrapper.decorator_list], entry['decorators'])
            call = wrapper.body[-1].value
            args = ['component_builder_settings(row)'] if name == 'component_is_published' else [a.arg for a in old.args.args]
            self.assertEqual([ast.unparse(a) for a in call.args], args)
            keywords = {k.arg: ast.unparse(k.value) for k in call.keywords}
            for dep in entry['deps']:
                self.assertEqual(keywords[dep], ast.unparse(ast.parse(entry['bindings'].get(dep, dep).replace('_CURRICULUM_READ_SCOPE', 'cache_state._CURRICULUM_READ_SCOPE'), mode='eval').body))
            for argument in old.args.kwonlyargs:
                if name == 'authoring_select_sql' and argument.arg == 'ensure_tables':
                    continue
                self.assertEqual(keywords[argument.arg], argument.arg)

    def test_schema_guard_stays_in_compatibility_adapter(self):
        wrapper = function(ROOT.parent / 'views.py', 'authoring_select_sql')
        self.assertEqual(ast.unparse(wrapper.body[0]), 'if ensure_tables:\n    ensure_module_authoring_tables()')
        core = function(ROOT / 'infrastructure/authoring_sql.py', 'authoring_select_sql')
        self.assertNotIn('ensure_tables', [a.arg for a in core.args.kwonlyargs])
        self.assertNotIn('ensure_module_authoring_tables', ast.unparse(core))

    def test_no_framework_legacy_imports_or_new_import_cycles(self):
        for module in {e['module'] for e in SNAPSHOT.values()}:
            path = ROOT.parent.parent.joinpath(*module.split('.')).with_suffix('.py')
            for node in ast.walk(tree(path)):
                if isinstance(node, ast.Import):
                    self.assertTrue(all(alias.name in {'inspect', 're', 'math'} for alias in node.names))
                if isinstance(node, ast.ImportFrom):
                    self.assertEqual((node.level, node.module), (0, 'collections'))


class SummaryPolicyParity(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location('summary_policy', ROOT / 'domain/component_summary.py')
        cls.policy = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.policy)
        cls.original = {'math': math, 'component_builder_settings': lambda row: row['settings']}
        for name in ('js_round', 'component_is_published'):
            exec(compile(SNAPSHOT[name]['source'], '<actual-original-policy>', 'exec'), cls.original)

    def test_rounding_half_boundaries_matches_actual_old_function(self):
        for value in (-2.51, -2.5, -1.5, -.5, -.01, 0, .49, .5, 1.5, 2.5, 7.499999999, 7.5):
            self.assertEqual(self.policy.js_round(value), self.original['js_round'](value))
        self.assertEqual([self.policy.js_round(v) for v in (-1.5, .5, 2.5)], [-1, 1, 3])

    def test_publication_default_case_and_null_semantics(self):
        for settings in ({}, {'componentBuilderStatus': None}, {'componentBuilderStatus': ''},
                         {'componentBuilderStatus': 'published'}, {'componentBuilderStatus': 'Published'},
                         {'componentBuilderStatus': ' published '}, {'componentBuilderStatus': 'draft'}):
            self.assertEqual(self.policy.component_is_published(settings),
                             self.original['component_is_published']({'settings': settings}))
        self.assertEqual(self.policy.component_is_published({'componentBuilderStatus': 'published'}), 1)


if __name__ == '__main__':
    unittest.main()
