"""Pure source/coverage contracts: stdlib only, without Django or application startup."""
import ast
import copy
from collections import Counter
import importlib
import importlib.util
import json
from pathlib import Path
import random
import sys
import unittest

ROOT = Path(__file__).resolve().parents[3]
SNAPSHOT = json.loads((ROOT / 'reporting/tests/fixtures/legacy_snapshots/quality_assets_snapshot.json').read_text())


def load_leaf(relative):
    if relative == 'reporting/api/history.py':
        # Its two new local owners and package markers have no import-time I/O.
        sys.path.insert(0, str(ROOT.parent))
        return importlib.import_module('curriculum_api.reporting.api.history')
    spec = importlib.util.spec_from_file_location('isolated_' + relative.replace('/', '_'), ROOT / relative)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class SourceContracts(unittest.TestCase):
    def test_original_bodies_preserved_except_explicit_attribute_ports(self):
        for key, entry in SNAPSHOT['functions'].items():
            if key in {'quality.revision_trail', 'quality.curriculum_quality_versions', 'quality.curriculum_quality_record_history'}:
                # These three bodies now delegate query/projection blocks.
                # Exact SQL/constants are checked below; caller byte/error/SQL
                # parity is covered by the isolated QualityAssetParity suite.
                continue
            original = ast.parse(entry['source']).body[0]
            class Ports(ast.NodeTransformer):
                def visit_ImportFrom(self, node):
                    return None
                def visit_Attribute(self, node):
                    alias = entry['attributes'].get(ast.unparse(node))
                    return ast.Name(id=alias, ctx=ast.Load()) if alias else self.generic_visit(node)
            expected = Ports().visit(original)
            path = ROOT.parent / (entry['owner'].replace('.', '/') + '.py')
            current = next(n for n in ast.parse(path.read_text(encoding='utf-8-sig')).body
                           if isinstance(n, ast.FunctionDef) and n.name == key.split('.')[1])
            self.assertEqual([ast.dump(n) for n in expected.body], [ast.dump(n) for n in current.body], key)

    def test_original_signatures_decorators_and_owner_calls(self):
        for key, entry in SNAPSHOT['functions'].items():
            legacy, name = key.split('.')
            current = next(n for n in ast.parse((ROOT / (legacy + '.py')).read_text(encoding='utf-8-sig')).body
                           if isinstance(n, ast.FunctionDef) and n.name == name)
            original = ast.parse(entry['source']).body[0]
            self.assertEqual(ast.dump(current.args), ast.dump(original.args), key)
            self.assertEqual([ast.unparse(n) for n in current.decorator_list], entry['decorators'], key)
            self.assertEqual(current.body[0].module, entry['owner'].removeprefix('curriculum_api.'), key)
            calls = [n for n in ast.walk(current) if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id == 'implementation']
            self.assertEqual(len(calls), 1, key)
            self.assertEqual({kw.arg for kw in calls[0].keywords}, set(entry['dependencies']) | {n.arg for n in original.args.kwonlyargs}, key)

    def test_constant_values_and_owner_uniqueness(self):
        for key, entry in SNAPSHOT['constants'].items():
            namespace = {}
            exec(compile(entry['source'], '<original-constant>', 'exec'), namespace)
            module = load_leaf(entry['owner'].removeprefix('curriculum_api.').replace('.', '/') + '.py')
            self.assertEqual(getattr(module, key.split('.')[1]), namespace[key.split('.')[1]], key)

    def test_pure_coverage_moved_exactly(self):
        current = (ROOT / 'reporting/domain/ksb_coverage.py').read_text(encoding='utf-8-sig')
        self.assertEqual(current, SNAPSHOT['coverage_source'])
        facade = ast.parse((ROOT / 'ksb_coverage.py').read_text())
        self.assertFalse(any(isinstance(n, ast.FunctionDef) for n in facade.body))

    def test_owners_import_without_django_or_legacy_dependencies(self):
        owners = {entry['owner'] for entry in SNAPSHOT['functions'].values()}
        for owner in owners:
            relative = owner.removeprefix('curriculum_api.').replace('.', '/') + '.py'
            tree = ast.parse((ROOT / relative).read_text(encoding='utf-8-sig'))
            imports = [ast.unparse(n) for n in ast.walk(tree) if isinstance(n, (ast.Import, ast.ImportFrom))]
            expected = ['from ..application import history_results', 'from ..infrastructure import history_queries'] if relative == 'reporting/api/history.py' else []
            self.assertEqual(imports, expected, owner)
            load_leaf(relative)

    def test_split_history_retains_every_business_literal_and_query_fragment(self):
        names = {'revision_trail', 'curriculum_quality_versions', 'curriculum_quality_record_history'}
        def literals(functions):
            result = Counter()
            for function in functions:
                body = function.body[1:] if ast.get_docstring(function) else function.body
                for statement in body:
                    result.update(repr(n.value) for n in ast.walk(statement) if isinstance(n, ast.Constant))
            return result
        original = [ast.parse(SNAPSHOT['functions']['quality.' + name]['source']).body[0] for name in names]
        current = [n for path in ('reporting/api/history.py', 'reporting/application/history_results.py', 'reporting/infrastructure/history_queries.py')
                   for n in ast.parse((ROOT / path).read_text(encoding='utf-8')).body
                   if isinstance(n, ast.FunctionDef) and (path != 'reporting/api/history.py' or n.name in names)]
        # The only deliberate behavioral deviation is failure reporting:
        # three read errors now return 503 instead of fabricated zeros or a
        # claim that the store is not installed. Successful SQL is unchanged.
        expected = literals(original)
        expected.subtract({repr(0): 1})
        expected.update({repr('error'): 3, repr(503): 3, repr(True): 1,
                         repr('Version history could not be read. Please retry.'): 2,
                         repr('Record history could not be read. Please retry.'): 1,
                         repr('Could not read curriculum version totals.'): 1})
        self.assertEqual(literals(current), expected)

    def test_domain_has_no_io_capabilities(self):
        forbidden = {'connection', 'transaction', 'settings', 'logger', 'JsonResponse',
                     'curriculum_views_fetch_all', 'curriculum_views_build_curriculum_programme_tree_detail_payload'}
        for key, entry in SNAPSHOT['functions'].items():
            if '.domain.' in entry['owner']:
                self.assertFalse(set(entry['dependencies']) & forbidden, key)


class CoverageParity(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.old = {}
        exec(compile(SNAPSHOT['coverage_source'], '<original-coverage>', 'exec'), cls.old)
        cls.new = load_leaf('reporting/domain/ksb_coverage.py')

    def compare(self, name, *args, **kwargs):
        old_args, new_args = copy.deepcopy(args), copy.deepcopy(args)
        expected = self.old[name](*old_args, **copy.deepcopy(kwargs))
        actual = getattr(self.new, name)(*new_args, **copy.deepcopy(kwargs))
        self.assertEqual(actual, expected)
        self.assertEqual(type(actual), type(expected))
        self.assertEqual(old_args, new_args)
        return actual

    def test_normalization_and_decimal_contracts(self):
        for value in (None, '', '  k2.3 ', 'practice', 'unknown', 0, 2.225):
            for name in ('clean', 'normalise_code', 'normalise_classification', 'decimal_weight', 'float_weight'):
                self.compare(name, value)
        for value in ('hard', 'soft', 'possible', 'invalid', ''):
            for classification in ('main', 'secondary', 'possible'):
                self.compare('normalise_weight_class', value, classification)
        self.compare('unique_clean', ['First', ' first ', '', None, 'SECOND'])

    def test_source_identity_and_numeric_order(self):
        for source in ('A', 'B', ''):
            row = {'code': ' k10.2 ', 'source_type': ' Standard ', 'source_id': source}
            self.compare('coverage_identity', row)
            self.compare('coverage_sort_key', ('standard', source, 'K10.2'))
            self.compare('normalise_required_definition', row)
            self.compare('required_definition_from_mapping', row)
        for code in ('K1', 'K10.2', 'S2', 'B3', 'Q-X', ''):
            self.compare('ksb_sort_key', code)
            self.compare('ksb_type_from_value', '', code)

    def test_groups_serialization_and_classification(self):
        module = {'module_catalogue_id': 'M', 'title': 'Synthetic module', 'group_id': 'G'}
        week = {'id': 'W', 'week_number': 1, 'title': 'Week'}
        component = {'id': 'C', 'settings_json': {'selectedGroupNames': ['Group', 'group']}}
        mapping = {'ksb_code': 'K1', 'module_catalogue_id': 'M', 'week_id': 'W', 'component_id': 'C', 'weight': '33.335', 'classification': 'main'}
        self.compare('component_group_names', component, module)
        self.compare('component_group_names', {'settings_json': '{broken'}, {})
        self.compare('serialise_mapping', mapping, module, week, component)
        self.compare('classification_summary', [mapping, {**mapping, 'classification': 'possible'}])
        self.compare('default_summary_bucket')

    def test_empty_results_preserve_full_summary_and_totals_shapes(self):
        self.compare('build_coverage', [], [], [], [], [])
        self.compare('build_coverage', [], [], [], [], [], totals_only=True)
        self.compare('build_coverage_summary', [], [])

    def test_full_totals_summary_duplicate_and_cross_source_parity(self):
        rng = random.Random(2046)
        modules = [{'module_catalogue_id': 'M1', 'title': 'One'}, {'module_catalogue_id': 'M2', 'title': 'Two'}]
        required = [{'code': code, 'source_type': 'standard', 'source_id': source}
                    for source in ('A', 'B') for code in ('K1', 'K2', 'S1', 'B1')]
        for _ in range(32):
            mappings = [{'module_catalogue_id': rng.choice(('M1', 'M2', '')),
                         'ksb_code': rng.choice(('K1', 'S1', 'B1', 'K99')),
                         'source_type': 'standard', 'source_id': rng.choice(('A', 'B')),
                         'weight': rng.choice(('0', '12.345', '80', '125')),
                         'classification': rng.choice(('main', 'secondary', 'possible')),
                         '_stats_count': rng.randint(1, 3)} for __ in range(12)]
            for include in (False, True):
                self.compare('build_coverage', required, mappings, modules, [], [], include)
                self.compare('build_coverage', required, mappings, modules, [], [], include, totals_only=True)
                self.compare('build_coverage_summary', required, mappings, include)


if __name__ == '__main__':
    unittest.main()
