"""Source-isolated regression tests; run this file directly with Python.

Only selected function definitions are compiled, never application modules.
No Django, settings, SQL engine, database driver or provider is imported.
SQL assertions check construction, not PostgreSQL execution/plan validity.
Resolver fixtures stand in for catalogue reads; consumers have wiring checks.
"""
import ast
from curriculum_api.catalogue.tests.parity.current_entry_source import current_entry_tree
import builtins
import importlib
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path
import re
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch


ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent))


def load_functions(filename, names, namespace):
    tree = current_entry_tree() if filename == 'views.py' else ast.parse((ROOT / filename).read_text(encoding='utf-8'))
    selected = []
    imported = set()
    for node in tree.body:
        if filename == 'ksb_mapping_placement.py' and isinstance(node, ast.ImportFrom) and node.module == 'catalogue.infrastructure.ksb_read_store':
            requested = {a.name for a in node.names} & set(names)
            load_functions('catalogue/infrastructure/ksb_read_store.py', requested, namespace)
            imported.update(requested)
        if filename == 'views.py' and isinstance(node, ast.ImportFrom) and node.level == 1 and (node.module or '').startswith('catalogue.'):
            for alias in node.names:
                public_name = alias.asname or alias.name
                if public_name in names:
                    if node.module == 'catalogue.infrastructure.database_reads':
                        # The formatter is pure; compile its actual owner source
                        # without importing the owner's Django connection.
                        assert alias.name == public_name == 'quote_ident'
                        load_functions('catalogue/infrastructure/database_reads.py', {alias.name}, namespace)
                    else:
                        owner = importlib.import_module('curriculum_api.' + node.module)
                        namespace[public_name] = getattr(owner, alias.name)
                    imported.add(public_name)
        if not isinstance(node, ast.FunctionDef) or node.name not in names:
            continue
        if node.decorator_list:
            raise AssertionError('Do not execute application decorators')
        # Supply the concrete reader's constants/formatter as synthetic values;
        # retain the actual relation body and extracted SQL implementation.
        if filename == 'catalogue/infrastructure/ksb_read_store.py' and node.name == 'relation':
            node.body = [item for item in node.body if not (
                isinstance(item, ast.ImportFrom) and item.level == 1
                and item.module is None
                and [(a.name, a.asname) for a in item.names] == [('database_reads', None)]
            )]
        if filename == 'catalogue/infrastructure/content_counts.py':
            # Compile the actual query body with explicit synthetic IO globals.
            # Only these two reviewed imports are replaced; no SQL is copied.
            imports = [item for item in node.body if isinstance(item, ast.ImportFrom)]
            assert [ast.unparse(item) for item in imports] == [
                'from . import database_reads, ksb_read_store as ksb_mapping_placement',
                'from .authoring_sql import live_authoring_rows_sql',
            ]
            node.body = [item for item in node.body if item not in imports]
        if any(isinstance(item, (ast.Import, ast.ImportFrom)) and not (isinstance(item, ast.ImportFrom) and item.level == 1 and ((item.module or '').startswith('catalogue.') or item.module == 'ksb_placement_reads')) for item in ast.walk(node)):
            raise AssertionError('Unexpected import in isolated function')
        selected.append(node)
    if {node.name for node in selected} | imported != set(names):
        raise AssertionError('Missing source function')
    safe_builtins = dict(vars(builtins))
    for name in ('__import__', 'open', 'eval', 'exec', 'compile'):
        safe_builtins.pop(name, None)
    def catalogue_import(name, globals=None, locals=None, fromlist=(), level=0):
        if level == 1 and name == 'catalogue.infrastructure.content_counts':
            return namespace['_content_counts_owner']
        if level == 1 and name == 'ksb_placement_reads':
            return importlib.import_module('curriculum_api.catalogue.infrastructure.ksb_placement_reads')
        assert level == 1 and name in {'catalogue.application.resolution', 'catalogue.infrastructure.content_counts', 'catalogue.domain.ranking', 'catalogue.infrastructure.ksb_placement_reads'}
        return importlib.import_module('curriculum_api.' + name)
    safe_builtins['__import__'] = catalogue_import
    namespace['__builtins__'] = safe_builtins
    exec(compile(ast.Module(body=selected, type_ignores=[]), filename, 'exec'), namespace)
    return namespace


class KsbCountCompatibilityTests(unittest.TestCase):
    def setUp(self):
        self.ns = dict(Counter=Counter, defaultdict=defaultdict, re=re)
        load_functions('views.py', {
            'clean_str', 'parse_int', 'quote_ident', 'normalise',
            'authoring_module_content_counts', 'authoring_summary_score',
            'best_authoring_summary', 'resolve_stored_module_catalogue_id',
            'resolve_authoring_catalogue_id', 'training_module_identifier',
            'authoring_summary_delivery_signature',
        }, self.ns)
        archive = load_functions('catalogue/infrastructure/archive_sql.py', {'live_sql'}, {})
        relation_ns = {
            'connection': SimpleNamespace(vendor='postgresql'),
            'database_reads': SimpleNamespace(
                AUTHORING_KSB_MAPPINGS_TABLE='ksb_mappings',
                AUTHORING_COMPONENTS_TABLE='components',
                authoring_table_name=lambda name: '"curriculum"."' + name + '"',
            ),
        }
        load_functions('ksb_mapping_placement.py', {'relation', '_only'}, relation_ns)
        self.relation = relation_ns['relation']
        self.fetch = Mock(side_effect=[[], []])
        self.ns.update(
            AUTHORING_COMPONENTS_TABLE='components',
            AUTHORING_KSB_MAPPINGS_TABLE='ksb_mappings',
            has_column=lambda table, column: column in {'module_catalogue_id', 'type'},
            learning_read_table=lambda table: '"curriculum"."' + table + '"',
            live_authoring_rows_sql=lambda table: (archive['live_sql'](), []),
            is_retired_component_type=lambda value: value == 'retired-fixture',
            ksb_mapping_placement=SimpleNamespace(relation=self.relation),
            fetch_all=self.fetch,
        )
        count_namespace = dict(
            Counter=Counter, defaultdict=defaultdict,
            _default_clean_str=self.ns['clean_str'], _default_parse_int=self.ns['parse_int'],
            _default_is_retired_component_type=self.ns['is_retired_component_type'],
            database_reads=SimpleNamespace(**{name: self.ns[name] for name in
                ('AUTHORING_COMPONENTS_TABLE', 'AUTHORING_KSB_MAPPINGS_TABLE',
                 'fetch_all', 'has_column', 'quote_ident')}),
            ksb_mapping_placement=self.ns['ksb_mapping_placement'],
            live_authoring_rows_sql=self.ns['live_authoring_rows_sql'],
        )
        load_functions('catalogue/infrastructure/content_counts.py', {'authoring_module_content_counts'}, count_namespace)
        self.ns['_content_counts_owner'] = SimpleNamespace(
            authoring_module_content_counts=count_namespace['authoring_module_content_counts'])

        # Dependency wiring now happens at the wrapper boundary. Unused legacy
        # callbacks exist but must never execute in these bounded fixtures.
        manifest = json.loads((ROOT / 'catalogue/tests/fixtures/legacy_snapshots/prebatch03_snapshot.json').read_text())
        for item in manifest.values():
            for name in item['deps']:
                self.ns.setdefault(name, Mock(side_effect=AssertionError('Unexpected dependency: ' + name)))

    def test_normalized_projection_joins_and_null_contract(self):
        projection = self.relation(include_description=False)
        for fragment in (
            'select m.*, c.module_catalogue_id, c.week_id',
            "coalesce(s.ksb_code, '') as ksb_code",
            'from only "curriculum"."ksb_mappings" m',
            'left join only "curriculum"."components" c on c.id = m.component_id',
            'left join only "curriculum"."standard_ksbs" s on s.id = m.standard_ksb_id',
            'as "ksb_mappings"',
        ):
            self.assertIn(fragment, projection)
        self.assertNotIn('ksb_description', projection)
        self.assertNotIn('m.module_catalogue_id', projection)
        self.assertNotIn('m.ksb_code', projection)
        # m.* retains the mapping's status; the normalized mapping table
        # needs neither of the formerly assumed physical projected columns.

    def test_count_query_preserves_status_filter_and_grouping(self):
        self.ns['authoring_module_content_counts']()
        sql, params = self.fetch.call_args_list[1].args
        self.assertIn('from ' + self.relation(include_description=False), sql)
        self.assertIn('where "status" not in (\'inactive\', \'archived\')', sql)
        self.assertTrue(sql.endswith('group by "module_catalogue_id", "ksb_code"'))
        self.assertEqual(params, [])
        component_sql = self.fetch.call_args_list[0].args[0]
        self.assertIn('from "curriculum"."components"', component_sql)

    def test_duplicate_blank_and_whitespace_codes_keep_python_semantics(self):
        self.fetch.side_effect = [
            [{'module_catalogue_id': 'M1', 'type': 'lesson', 'row_count': 3}],
            [{'module_catalogue_id': module, 'ksb_code': code} for module, code in
             [('M1', ' K1 '), ('M1', 'K1'), ('M1', 'K1'), ('M1', ''),
              ('M1', None), ('M1', '   '), ('M1', 'k1'), ('M2', 'K1')]],
        ]
        self.assertEqual(self.ns['authoring_module_content_counts'](),
                         ({'M1': 3}, {'M1': 2, 'M2': 1}))

    def test_candidate_ranking_is_lexicographic_in_existing_order(self):
        keys = ('ksbCount', 'qualityScore', 'lessonCount', 'weeks')
        for priority in range(4):
            with self.subTest(priority=keys[priority]):
                winner = dict.fromkeys(keys, 0)
                loser = dict.fromkeys(keys, 0)
                winner[keys[priority]] = 1
                for lower in keys[priority + 1:]:
                    loser[lower] = 999
                self.assertIs(self.ns['best_authoring_summary']([loser, winner]), winner)

    def test_equal_scores_keep_first_candidate_and_empty_returns_none(self):
        first, second = {'catalogueId': 'M1'}, {'catalogueId': 'M2'}
        self.assertIs(self.ns['best_authoring_summary']([first, second]), first)
        self.assertIs(self.ns['best_authoring_summary']([second, first]), second)
        self.assertIsNone(self.ns['best_authoring_summary']([]))

    def test_canonical_and_catalogue_alias_skip_broad_resolver(self):
        fallback = Mock(side_effect=AssertionError('Broad resolver must not run'))
        self.ns.update(authoring_module_exists=lambda ident: ident == 'MOD-1',
                       resolve_authoring_catalogue_id=fallback)
        for value in ('MOD-1', '  MOD-1  ', 'catalogue-module-MOD-1'):
            self.assertEqual(self.ns['resolve_stored_module_catalogue_id'](value), 'MOD-1')
        fallback.assert_not_called()

    def test_legacy_source_and_training_alias_use_ranked_summaries(self):
        summaries = Mock(return_value={
            'M1': {'catalogueId': 'M1', 'sourceId': 'old', 'ksbCount': 1},
            'M2': {'catalogueId': 'M2', 'sourceId': 'old', 'ksbCount': 2},
        })
        self.ns.update(authoring_module_exists=lambda ident: False,
                       authoring_catalogue_summaries=summaries,
                       training_row_by_id=lambda ident: None)
        for value in ('old', 'training-module-old'):
            self.assertEqual(self.ns['resolve_stored_module_catalogue_id'](value), 'M2')
        summaries.assert_called_with(include_programme_deleted=True, include_content=False)

    def test_delivery_signature_alias_still_matches(self):
        summary = dict(catalogueId='M1', sourceId='other', programmeName='Data',
                       title='Intro', cohortId='C1', groupId='G1')
        self.ns.update(
            authoring_catalogue_summaries=lambda **kwargs: {'M1': summary},
            training_row_by_id=lambda ident: {'_meta': {'present': True}, 'module_name': 'Intro'},
            training_row_module_catalogue_id=lambda row: '',
            get_program_config_rows=lambda: [], program_config_by_id=lambda rows: {},
            canonical_programme_name=lambda row, configs: 'Data',
            actual_cohort_identity=lambda row, programme: {'id': 'C1'},
            actual_group_identity=lambda row, cohort: {'id': 'G1'},
        )
        from curriculum_api.catalogue.application import resolution
        dependencies = {name: self.ns[name] for name in (
            'canonical_programme_name', 'actual_cohort_identity', 'actual_group_identity')}
        with patch.dict(resolution.resolve_authoring_catalogue_id.__kwdefaults__, dependencies):
            self.assertEqual(self.ns['resolve_authoring_catalogue_id']('training-module-old'), 'M1')

    def test_unresolved_legacy_alias_stays_empty(self):
        self.ns.update(authoring_module_exists=lambda ident: False,
                       authoring_catalogue_summaries=lambda **kwargs: {})
        self.assertEqual(self.ns['resolve_stored_module_catalogue_id']('unknown'), '')

    def test_home_and_programme_fallbacks_retain_content_free_wiring(self):
        # Static wiring only: not a Django consumer/HTTP execution test.
        for filename, function in [('home_summary.py', 'build_home_summary'),
                                   ('programme_list.py', 'build_programme_list')]:
            with self.subTest(consumer=function):
                tree = ast.parse((ROOT / 'catalogue/application/projections.py').read_text(encoding='utf-8'))
                node = next(n for n in tree.body if isinstance(n, ast.FunctionDef)
                            and n.name == function)
                calls = [n for n in ast.walk(node) if isinstance(n, ast.Call)
                         and isinstance(n.func, ast.Name)
                         and n.func.id == 'enrich_modules_with_authoring']
                self.assertEqual(len(calls), 1)
                options = {k.arg: k.value for k in calls[0].keywords}
                self.assertIs(options['include_content'].value, False)
                self.assertIn('include_programme_deleted', options)


if __name__ == '__main__':
    unittest.main()
