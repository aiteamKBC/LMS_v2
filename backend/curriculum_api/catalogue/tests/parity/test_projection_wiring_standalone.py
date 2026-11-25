"""Dependency direction and real frozen-source fact parity, without Django."""
import ast
from copy import deepcopy
import hashlib
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

import importlib.util as _read_dependencies_util
_read_dependencies_spec = _read_dependencies_util.spec_from_file_location('read_dependencies_oracle', Path(__file__).with_name('read_dependencies_oracle.py'))
_read_dependencies = _read_dependencies_util.module_from_spec(_read_dependencies_spec)
_read_dependencies_spec.loader.exec_module(_read_dependencies)

ROOT = Path(__file__).resolve().parents[3]
DATA = (ROOT / 'catalogue/tests/fixtures/legacy_snapshots/module_authoring_facts_snapshot.json').read_bytes()
assert hashlib.sha256(DATA).hexdigest() == '654361b56feee9afabad61b98f2e6fcc0e21c672497deb542713122f66783019'
SOURCE = json.loads(DATA)['source']
spec = importlib.util.spec_from_file_location('explicit_authoring_facts', ROOT / 'module_authoring_facts.py')
facts = importlib.util.module_from_spec(spec)
spec.loader.exec_module(facts)


def original(**dependencies):
    """Actual frozen bodies; only reviewed local views imports are injected."""
    functions = [n for n in ast.parse(SOURCE).body if isinstance(n, ast.FunctionDef)]
    for function in functions:
        for node in function.body:
            if isinstance(node, ast.ImportFrom):
                assert node.level == 1 and node.module is None
                assert [(a.name, a.asname) for a in node.names] == [('views', None)]
        function.body = [n for n in function.body if not isinstance(n, ast.ImportFrom)]
    namespace = {'json': json, **dependencies}
    exec(compile(ast.Module(body=functions, type_ignores=[]), '<actual-frozen-authoring-facts>', 'exec'), namespace)
    return SimpleNamespace(**namespace)


class ProjectionWiringContracts(unittest.TestCase):
    def test_fact_bodies_preserved_except_explicit_dependencies(self):
        before = {n.name: n for n in ast.parse(SOURCE).body if isinstance(n, ast.FunctionDef)}
        after = {n.name: n for n in _read_dependencies.source_tree(ROOT / 'module_authoring_facts.py').body
                 if isinstance(n, ast.FunctionDef)}
        self.assertEqual(before.keys(), after.keys())

        class ExplicitReferences(ast.NodeTransformer):
            def visit_Attribute(self, node):
                if isinstance(node.value, ast.Name) and node.value.id in {'views', 'ksb_mapping_placement'}:
                    return ast.copy_location(ast.Name(id=node.attr, ctx=node.ctx), node)
                return self.generic_visit(node)

        for name, node in before.items():
            node.body = [n for n in node.body if not isinstance(n, ast.ImportFrom)]
            node = ExplicitReferences().visit(node)
            self.assertEqual([ast.dump(n) for n in node.body], [ast.dump(n) for n in after[name].body], name)

    def test_consumers_cannot_reach_legacy_views_through_imports(self):
        for root in ('home_summary', 'programme_list', 'module_authoring_facts'):
            pending = [ROOT / (root + '.py')]
            seen = set()
            while pending:
                path = pending.pop().resolve()
                if path in seen:
                    continue
                seen.add(path)
                self.assertNotIn(path.name, {'views.py', 'read_model.py', 'catalogue_read_composition.py'})
                for node in ast.walk(_read_dependencies.source_tree(path)):
                    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
                        self.assertNotIn(node.func.id, {'__import__', 'eval', 'exec'})
                    if not isinstance(node, ast.ImportFrom):
                        continue
                    if node.level:
                        base = path.parent
                        for _ in range(node.level - 1):
                            base = base.parent
                        target = base.joinpath(*(node.module or '').split('.'))
                    elif (node.module or '').startswith('curriculum_api'):
                        target = ROOT.parent.joinpath(*node.module.split('.'))
                    else:
                        continue
                    candidates = [target.with_suffix('.py'), target / '__init__.py']
                    candidates += [target / (alias.name + '.py') for alias in node.names]
                    pending.extend(candidate for candidate in candidates if candidate.is_file())
            self.assertGreater(len(seen), 0)
        self.assertFalse((ROOT / 'catalogue_read_composition.py').exists())

    def test_fact_imports_are_stdlib_only(self):
        imports = [ast.unparse(n) for n in ast.walk(_read_dependencies.source_tree(ROOT / 'module_authoring_facts.py'))
                   if isinstance(n, (ast.Import, ast.ImportFrom))]
        self.assertEqual(imports, ['import json'])

    def test_ksb_sql_and_parameters_match_original_with_and_without_filter(self):
        for where, params in (('', []), ('status not in (%s, %s)', ['inactive', 'archived'])):
            live = Mock(return_value=(where, params))
            relation = Mock(return_value='(select synthetic_projection)')
            old = original(views=SimpleNamespace(live_authoring_rows_sql=live, AUTHORING_KSB_MAPPINGS_TABLE='ksb'),
                           ksb_mapping_placement=SimpleNamespace(relation=relation))
            expected = old.ksb_counts_selection()
            calls = (list(live.call_args_list), list(relation.call_args_list))
            live.reset_mock(); relation.reset_mock()
            actual = facts.ksb_counts_selection(live_authoring_rows_sql=live, AUTHORING_KSB_MAPPINGS_TABLE='ksb', relation=relation)
            self.assertEqual(actual, expected)
            self.assertEqual((live.call_args_list, relation.call_args_list), calls)
            self.assertIn('count(distinct nullif(trim(ksb_code)', actual[0])

    def test_payload_facts_preserve_normalization_missing_counts_and_mutation(self):
        modules = [{'moduleCatalogueId': ' M1 ', 'ksbCount': 7}, {'catalogueId': 'M2'},
                   {'sourceId': 'M3'}, {'moduleCatalogueId': 0}, {}]
        rows = [{'module_catalogue_id': ' M1 ', 'updated_at': 'stamp'},
                {'module_catalogue_id': 'M1', 'updated_at': 'new'},
                {'module_catalogue_id': 'M2', 'updated_at': None}]
        formatter = lambda value: 'formatted:' + value if value else ''
        old = original(views=SimpleNamespace(format_created_at=formatter))
        for counts in (None, {}, {'M1': 3, 'M2': 0}):
            expected, actual = deepcopy(modules), deepcopy(modules)
            self.assertIs(old.apply_authoring_facts(expected, rows, counts), expected)
            self.assertIs(facts.apply_authoring_facts(actual, rows, counts, format_created_at=formatter), actual)
            self.assertEqual(actual, expected)

    def test_count_decoding_preserves_empty_values_and_errors(self):
        old = original()
        for value in (None, {}, '', '{}', '{"M1":3,"M2":null}', {'M1': '4'}):
            self.assertEqual(facts.decode_counts(value), old.decode_counts(value))
        for value in ('not-json', {'M1': 'invalid'}):
            with self.assertRaises(ValueError): old.decode_counts(value)
            with self.assertRaises(ValueError): facts.decode_counts(value)

    def test_optional_scalar_reader_preserves_vendor_and_errors(self):
        for vendor in ('sqlite', 'postgresql'):
            connection = SimpleNamespace(vendor=vendor)
            fetch = Mock(return_value=[{'ksb_counts': '{"M1":2}'}])
            selection = Mock(return_value=('synthetic_sql', ['active']))
            old = original(connection=connection, views=SimpleNamespace(fetch_all=fetch))
            old.module_ksb_counts.__globals__['ksb_counts_selection'] = selection
            expected = old.module_ksb_counts()
            calls = list(fetch.call_args_list)
            fetch.reset_mock()
            self.assertEqual(facts.module_ksb_counts(connection=connection, ksb_counts_selection=selection, fetch_all=fetch), expected)
            self.assertEqual(fetch.call_args_list, calls)
        fetch.side_effect = RuntimeError('synthetic source unavailable')
        with self.assertRaisesRegex(RuntimeError, 'synthetic source unavailable'):
            facts.module_ksb_counts(connection=connection, ksb_counts_selection=selection, fetch_all=fetch)


if __name__ == '__main__':
    unittest.main()
