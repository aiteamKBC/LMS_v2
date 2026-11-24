"""DB-free checks of the actual source bodies and concrete session read contracts."""
import ast
import importlib.util
import inspect
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock

import importlib.util as _read_dependencies_util
_read_dependencies_spec = _read_dependencies_util.spec_from_file_location('read_dependencies_oracle', Path(__file__).with_name('read_dependencies_oracle.py'))
_read_dependencies = _read_dependencies_util.module_from_spec(_read_dependencies_spec)
_read_dependencies_spec.loader.exec_module(_read_dependencies)

ROOT = Path(__file__).resolve().parents[2]
SNAPSHOT = json.loads((ROOT / 'tests/fixtures/legacy_snapshots/session_enrichment_snapshot.json').read_text(encoding='utf-8'))


def load(relative):
    spec = importlib.util.spec_from_file_location(relative.replace('/', '_'), ROOT / (relative + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


identity = load('domain/session_identity')
reads = load('infrastructure/session_reads')
links = load('application/session_links')
calendar = load('infrastructure/calendar_rows')


class SessionSourceContracts(unittest.TestCase):
    def test_original_pure_bodies_preserved_except_explicit_identity_correction(self):
        for name in ('meaningful_session_names', 'resolved_live_session_date'):
            with self.subTest(name=name):
                old = ast.parse(SNAPSHOT[name]['source']).body[0]
                new = ast.parse(inspect.getsource(getattr(identity, name))).body[0]
                self.assertEqual([ast.dump(n) for n in old.body], [ast.dump(n) for n in new.body])

    def test_generated_session_functions_have_no_production_definitions_or_calls(self):
        retired = {'build_sessions_basic', 'prefer_authoring_module_sessions',
                   'matching_authoring_module_for_training_row', 'build_authoring_modules_by_programme',
                   'authoring_programme_lookup_key'}
        for path in [ROOT.parent / 'views.py', *ROOT.rglob('*.py')]:
            if path.name.startswith('test'):
                continue
            tree = _read_dependencies.source_tree(path)
            for node in ast.walk(tree):
                if isinstance(node, (ast.FunctionDef, ast.Name)):
                    self.assertNotIn(node.name if isinstance(node, ast.FunctionDef) else node.id, retired, str(path))
        self.assertFalse((ROOT / 'application/session_enrichment.py').exists())

    def test_owners_have_only_reviewed_standard_library_imports(self):
        for module in (identity, reads, links, calendar):
            tree = _read_dependencies.source_tree(Path(module.__file__))
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    self.assertTrue(all(a.name in ('re',) for a in node.names))
                if isinstance(node, ast.ImportFrom):
                    self.assertIn(node.module, ('collections', 'datetime'))
                    self.assertEqual(node.level, 0)
        self.assertNotIn('django', sys.modules)
        self.assertNotIn('psycopg', sys.modules)

    def test_narrow_sql_contracts_preserve_parameters_order_and_projection(self):
        read = Mock(return_value=[])
        ids = ['B', 'A']
        reads.module_rows(ids, authoring_fetch_all=read, modules_table='modules')
        read.assert_called_with('modules', 'module_catalogue_id in (%s,%s)', ids)
        reads.group_rows(ids, authoring_fetch_all=read, groups_table='groups')
        read.assert_called_with('groups', 'group_id in (%s,%s)', ids)
        reads.week_rows(ids, authoring_fetch_all=read, weeks_table='weeks')
        read.assert_called_with('weeks', 'module_catalogue_id in (%s,%s)', ids,
                                'module_catalogue_id, display_order, week_number, id')
        reads.component_rows(ids, authoring_fetch_all=read, components_table='components', live_session_type_sql='type_filter')
        read.assert_called_with('components', 'module_catalogue_id in (%s,%s) and type_filter', ids,
                                'module_catalogue_id, week_id, display_order, id', exclude_columns=('ksb_mappings',))

    def calendar_inputs(self, reader, **scope):
        return calendar.read_inputs(authoring_fetch_all=reader, modules_table='modules',
            groups_table='groups', cohorts_table='cohorts', group_order='group_id', cohort_order='cohort_id',
            module_fields=('module_catalogue_id',), excluded_module_columns=('heavy',), **scope)

    def test_scoped_normalized_sql_uses_ids_and_only_referenced_parents(self):
        read = Mock(side_effect=[[{'group_id': 'G', 'cohort_id': 'C'}, {'group_id': 'G', 'cohort_id': 'C'}], [], []])
        self.calendar_inputs(read, schedule=True, programme_id='P', module_ids=['M'])
        self.assertEqual(read.call_args_list[0].args, ('modules', 'module_catalogue_id in (%s) and programme_id = %s', ['M', 'P']))
        self.assertEqual(read.call_args_list[1].args, ('groups', 'group_id in (%s)', ['G']))
        self.assertEqual(read.call_args_list[2].args, ('cohorts', 'cohort_id in (%s)', ['C']))
        self.assertTrue(all(call.kwargs['ensure_tables'] is False for call in read.call_args_list))

    def test_empty_scope_never_becomes_an_unscoped_read(self):
        for scope in ({'module_ids': []}, {'programme_id': ''}):
            read = Mock(side_effect=AssertionError('No query permitted'))
            self.assertEqual(self.calendar_inputs(read, **scope), ([], [], []))
            read.assert_not_called()
        read = Mock(return_value=[])
        self.assertEqual(self.calendar_inputs(read, module_ids=['missing']), ([], [], []))
        read.assert_called_once()

    def test_required_plan_failure_raises_while_compatibility_contract_is_unchanged(self):
        kwargs = dict(modules_by_catalogue={'A': {'module_catalogue_id': 'A'}}, groups_by_id={},
                      holidays_by_cohort={}, read_module_rows=Mock(), read_group_rows=Mock(),
                      clean_str=lambda v: str(v or '').strip(), logger=Mock(),
                      module_week_delivery_slots=Mock(side_effect=ValueError('synthetic')), unique=list)
        with self.assertRaises(ValueError):
            links.delivery_slots_by_catalogue({'A': [{}]}, strict=True, **kwargs)
        self.assertEqual(links.delivery_slots_by_catalogue({'A': [{}]}, **kwargs), {})
        kwargs['read_module_rows'].assert_not_called()
        kwargs['read_group_rows'].assert_not_called()


if __name__ == '__main__':
    unittest.main(verbosity=2)
