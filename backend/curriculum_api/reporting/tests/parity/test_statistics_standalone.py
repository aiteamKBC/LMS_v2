"""Source fidelity and pure statistics contracts; no Django or database setup."""
import ast
import builtins
from copy import deepcopy
from decimal import Decimal
import importlib
import json
from pathlib import Path
import symtable
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT.parent.parent))
SNAPSHOT = json.loads((ROOT / 'tests/fixtures/legacy_snapshots/statistics_snapshot.json').read_text(encoding='utf-8'))
READS = json.loads((ROOT / 'tests/fixtures/legacy_snapshots/statistics_reads_snapshot.json').read_text(encoding='utf-8'))
MODULES = sorted({entry['module'] for entry in SNAPSHOT.values()} | {
    'domain.programme_statistics', 'infrastructure.statistics_reads',
})


def nodes(source):
    return {n.name: n for n in ast.parse(source).body if isinstance(n, ast.FunctionDef)}


def dump(body):
    return [ast.dump(n) for n in body]


class RemoveLegacyQualifiers(ast.NodeTransformer):
    def visit_Attribute(self, node):
        if isinstance(node.value, ast.Name):
            if node.value.id == 'views':
                return ast.copy_location(ast.Name(id=node.attr, ctx=node.ctx), node)
            if (node.value.id, node.attr) in {
                ('archive_state', 'uses_status'), ('ksb_mapping_placement', 'can_select'),
                ('ksb_mapping_placement', 'read_source'),
            }:
                return ast.copy_location(ast.Name(id=node.attr, ctx=node.ctx), node)
        return self.generic_visit(node)


class StatisticsSourceContracts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.owners = {}
        for module in MODULES:
            cls.owners.update(nodes(ROOT.joinpath(*module.split('.')).with_suffix('.py').read_text(encoding='utf-8')))

    def test_public_signatures_and_decorators_preserved(self):
        for filename, snapshot in (('views.py', SNAPSHOT), ('ksb_stats_reads.py', READS)):
            current = nodes((ROOT.parent / filename).read_text(encoding='utf-8-sig'))
            for name, entry in snapshot.items():
                with self.subTest(name=name):
                    before = nodes(entry['source'])[name]
                    self.assertEqual(ast.dump(before.args), ast.dump(current[name].args))
                    self.assertEqual(entry['decorators'], [ast.unparse(d) for d in current[name].decorator_list])

    def test_unsplit_source_bodies_are_exact(self):
        split = {'_programme_component_ksb_mapping_count', '_programme_ksb_expected_weights', 'programme_learner_ksb_progress'}
        for name, entry in SNAPSHOT.items():
            if name not in split:
                with self.subTest(name=name):
                    expected = nodes(entry['source'])[name]
                    # Deliberate identity corrections have executable frozen-source
                    # coverage in test_ksb_identity_boundary_no_db. Check that all
                    # other statements retain their exact original structure.
                    if name == 'get_ksb_profile_for_program':
                        loop = next(n for n in expected.body if isinstance(n, ast.For))
                        loop.body.insert(0, ast.parse('if not ksb_profile_source_id(profile):\n    continue').body[0])
                    elif name == 'programme_applied_ksb_profile':
                        expected.body.insert(3, ast.parse('ksb_profiles = [profile for profile in ksb_profiles or [] if ksb_profile_source_id(profile)]').body[0])
                    elif name == 'programme_row_ksb_source':
                        start = next(i for i, n in enumerate(expected.body) if isinstance(n, ast.For))
                        expected.body[start:start+1] = ast.parse('''
rows = get_program_config_rows()
for row in rows:
    if ident_key == normalise(programme_config_identity(row)):
        return programme_config_ksb_source(row)
if programme_identifier_looks_exact(ident):
    return '', ''
for row in rows:
    if ident_key == normalise(row.get('name')):
        return programme_config_ksb_source(row)
''').body
                    self.assertEqual(dump(expected.body), dump(self.owners[name].body))

    def test_three_domain_extractions_preserve_original_tails(self):
        for old, new, first in (
            ('_programme_component_ksb_mapping_count', 'mapped_ksb_count', 'module_ids'),
            ('_programme_ksb_expected_weights', 'expected_ksb_weights', 'expected'),
            ('programme_learner_ksb_progress', 'apply_programme_progress', 'achieved'),
        ):
            body = nodes(SNAPSHOT[old]['source'])[old].body
            start = next(i for i, n in enumerate(body) if isinstance(n, ast.Assign) and isinstance(n.targets[0], ast.Name) and n.targets[0].id == first)
            self.assertEqual(dump(body[start:]), dump(self.owners[new].body), old)
            self.assertEqual(dump(body[:start]), dump(self.owners[old].body[:-1]), old)

    def test_grouped_reads_only_replace_legacy_dependency_qualifiers(self):
        for name in ('grouped_scope_rows', 'grouped_component_counts', '_grouped_rows'):
            old = RemoveLegacyQualifiers().visit(nodes(READS[name]['source'])[name])
            self.assertEqual(dump(old.body), dump(self.owners[name].body), name)

    def test_sql_and_parameter_expressions_are_identical(self):
        def calls(tree):
            return [ast.dump(n) for n in ast.walk(tree) if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id == 'fetch_all']
        old = RemoveLegacyQualifiers().visit(nodes(READS['progress_totals']['source'])['progress_totals'])
        self.assertEqual(calls(old), calls(self.owners['progress_outcomes']) + calls(self.owners['latest_progress_weights']))
        for name in ('values', 'params', 'exclusion', 'sql'):
            before = next(n for n in old.body if isinstance(n, ast.Assign) and isinstance(n.targets[0], ast.Name) and n.targets[0].id == name)
            after = next(n for n in self.owners['latest_progress_weights'].body if isinstance(n, ast.Assign) and n.targets[0].id == name)
            self.assertEqual(ast.dump(before), ast.dump(after))

    def test_import_closure_has_no_infrastructure_or_views_back_edge(self):
        imports = {'re', 'hashlib', 'json', 'Counter', 'mapped_ksb_count', 'expected_ksb_weights', 'apply_programme_progress', 'sum_ordered_progress_weights'}
        def globals_used(table):
            return {s.get_name() for s in table.get_symbols() if s.is_global() and s.is_referenced()} | set().union(*(globals_used(c) for c in table.get_children()))
        for module in MODULES:
            text = ROOT.joinpath(*module.split('.')).with_suffix('.py').read_text(encoding='utf-8')
            tree = ast.parse(text)
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    self.assertTrue(all(a.name in {'re', 'hashlib', 'json'} for a in node.names))
                if isinstance(node, ast.ImportFrom):
                    self.assertIn((node.level, node.module), {(0, 'collections'), (2, 'domain.programme_statistics')})
            if module.startswith(('domain.', 'application.')):
                names = {n.id for n in ast.walk(tree) if isinstance(n, ast.Name)}
                self.assertFalse(names & {'request', 'connection', 'cursor', 'settings', 'fetch_all', 'JsonResponse'})
            for child in symtable.symtable(text, module, 'exec').get_children():
                self.assertFalse(globals_used(child) - set(dir(builtins)) - imports, module)
            importlib.import_module('curriculum_api.reporting.' + module)
        for name in ('django', 'psycopg', 'requests', 'curriculum_api.views', 'curriculum_api.ksb_stats_reads'):
            self.assertNotIn(name, sys.modules)


class PureStatisticsRules(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rules = importlib.import_module('curriculum_api.reporting.domain.programme_statistics')

    def test_mapped_count_filters_scope_owner_duplicates_and_parent_codes(self):
        rows = [
            {'module_catalogue_id': module, 'component_id': owner, 'ksb_code': code}
            for module, owner, code in [('M', 'C', 'k1.1'), ('M', 'C', 'K1.2'), ('M', '', 'K2'), ('X', 'C', 'K2'), ('M', 'C', 'K9')]
        ]
        clean = lambda value: str(value or '').strip()
        self.assertEqual(self.rules.mapped_ksb_count([{'module_catalogue_id': 'M'}], rows, {'K1', 'K2'}, clean_str=clean, coverage_normalise_code=lambda v: clean(v).upper()), 1)

    def test_expected_weights_keep_positive_duplicates_and_existing_aliases(self):
        coverage = {'items': [{'code': ' k1 ', 'raw_total_weight': 4}, {'code': 'K1', 'rawTotalWeight': 5}, {'code': 'S1', 'raw_total_weight': -3}, {'code': '', 'raw_total_weight': 40}]}
        self.assertEqual(self.rules.expected_ksb_weights(coverage, coverage_normalise_code=lambda v: v.strip().upper()), {'K1': 9.0})

    def test_progress_caps_per_learner_and_counts_declarations_separately(self):
        result = self.rules.apply_programme_progress({}, {'K1': 10, 'K2': 20}, [1, 2], {1: {'K1': 30, 'K2': 10}, 2: {'K1': -2, 'K2': 30}}, {2: {'K1', 'K9'}}, float_weight=float, merge_ksb_totals=lambda value: deepcopy(value))
        self.assertEqual(result['learnerKsbConsumedWeight'], 40)
        self.assertEqual(result['learnerKsbExpectedWeight'], 60)
        self.assertEqual(result['learnerKsbProgressPercentage'], 67)
        self.assertEqual(result['learnerKsbAchievedCount'], 4)
        self.assertEqual(result['learnerKsbAchievementPercentage'], 100)

    def test_ordered_decimal_rounding_is_not_replaced_with_sql_sum(self):
        rows = [{'learner_id': 1, 'ksb_code': ' k1 ', 'weights': [Decimal('.125'), Decimal('.135')]}, {'learner_id': 2, 'ksb_code': 'K1', 'weights': [Decimal('1e16'), 1, Decimal('-1e16')]}]
        result = self.rules.sum_ordered_progress_weights(rows, coverage_normalise_code=lambda v: v.strip().upper(), float_weight=lambda v: float(round(Decimal(str(v)), 2)))
        self.assertEqual(result, {1: {'K1': .26}, 2: {'K1': 0.0}})


if __name__ == '__main__':
    unittest.main()
