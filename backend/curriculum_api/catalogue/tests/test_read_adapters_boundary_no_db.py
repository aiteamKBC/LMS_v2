"""Old/new read adapter parity using the actual saved functions; synthetic only."""
from curriculum_api.catalogue.tests.parity.composition_test_support import composition_fixture
from curriculum_api.catalogue.tests.parity.read_dependency_test_support import placement_read_fixture
from curriculum_api.catalogue.tests.parity.read_dependency_test_support import authoring_read_fixture
from curriculum_api.catalogue.tests.parity.read_dependency_test_support import observe_export, database_read_fixture, ksb_read_fixture, authoring_logger_fixture
from contextlib import ExitStack, contextmanager
from copy import deepcopy
import importlib
import json
from pathlib import Path
from types import FunctionType, SimpleNamespace
from unittest.mock import MagicMock, Mock, patch

from django.test import SimpleTestCase
from curriculum_api import views
from curriculum_api.catalogue.tests.parity.cache_ownership_oracle import relocated_source

SNAPSHOT = json.loads((Path(__file__).parents[2] / 'catalogue/tests/fixtures/legacy_snapshots/read_adapters_snapshot.json').read_text(encoding='utf-8'))


@contextmanager
def original_read_adapters():
    with ExitStack() as stack:
        for name, entry in SNAPSHOT.items():
            if isinstance(getattr(views, name), Mock):
                continue
            namespace = dict(vars(views))
            exec(compile(relocated_source(entry['source']), '<original-read-adapter>', 'exec'), namespace)
            fn = namespace[name]
            restored = FunctionType(fn.__code__, vars(views), name, fn.__defaults__)
            restored.__kwdefaults__ = fn.__kwdefaults__
            for decorator in reversed(entry['decorators']):
                restored = getattr(views, decorator)(restored)
            stack.enter_context(composition_fixture(views, name, restored))
        yield


class ReadAdapterParity(SimpleTestCase):
    def compare(self, name, *args, **kwargs):
        with original_read_adapters():
            expected = getattr(views, name)(*deepcopy(args), **deepcopy(kwargs))
        owner = importlib.import_module(SNAPSHOT[name]['module'])
        with observe_export(views, owner, name, wraps=getattr(owner, name)) as called:
            actual = getattr(views, name)(*deepcopy(args), **deepcopy(kwargs))
        called.assert_called_once()
        self.assertEqual(actual, expected)
        return actual

    def test_select_sql_full_narrow_excluded_and_normalized_mapping_parity(self):
        physical = {'module_catalogue_id', 'programme_id', 'cohort_id', 'group_id', 'programme_name', 'status'}
        with database_read_fixture('column_names', return_value=physical), \
             database_read_fixture('has_column', side_effect=lambda table, key: key in physical), \
             database_read_fixture('authoring_table_name', side_effect=lambda table: 'curriculum.' + table), \
             authoring_read_fixture('learning_read_table', side_effect=lambda table: 'curriculum.' + table), \
             authoring_read_fixture('ensure_module_authoring_tables') as guard:
            for options in ({}, {'columns': ['module_catalogue_id', 'programme_name']},
                            {'exclude_columns': ['programme_name']}, {'columns': ['status']}):
                self.compare('authoring_select_sql', 'modules', 'cohort_name = %s', 'group_name, module_catalogue_id', **options)
            self.assertEqual(guard.call_count, 8)
            guard.reset_mock()
            self.compare('authoring_select_sql', 'weeks', ensure_tables=False)
            guard.assert_not_called()
            physical.clear()
            physical.update({'id', 'component_id', 'standard_ksb_id', 'status'})
            with ksb_read_fixture('relation', return_value='(normalized_mapping) as ksb_mappings'):
                sql = self.compare('authoring_select_sql', 'ksb_mappings', columns=['id', 'ksb_description', 'module_catalogue_id'], ensure_tables=False)
            self.assertIn('"standard_ksb_id"', sql)
            self.assertIn('normalized_mapping', sql)

    def test_completion_respects_requested_excluded_and_empty_rows(self):
        events = []
        with ksb_read_fixture('attach_descriptions', side_effect=lambda rows: events.append('description')), \
             ksb_read_fixture('attach_component_items', side_effect=lambda rows: events.append('items')), \
             placement_read_fixture('attach', side_effect=lambda table, rows, **kw: events.append(('names', kw)) or rows):
            for table, rows, columns, excluded in (
                ('ksb_mappings', [{'id': 'M'}], None, None),
                ('ksb_mappings', [{'id': 'M'}], ['id'], None),
                ('components', [{'id': 'C'}], None, ['ksb_mappings']),
                ('components', [{'id': 'C'}], None, None),
                ('components', [], None, None),
            ):
                events.clear()
                self.compare('complete_authoring_rows', table, rows, columns, excluded)
                half = len(events) // 2
                self.assertEqual(events[:half], events[half:])

    def test_fetch_parameters_completion_and_cursor_close(self):
        connection = MagicMock(vendor='postgresql')
        cursor = connection.cursor.return_value.__enter__.return_value
        with database_read_fixture('connection', connection), \
             authoring_read_fixture('authoring_select_sql', return_value='reviewed select') as sql, \
             database_read_fixture('rows_as_dicts', return_value=[{'id': 'C'}]), \
             authoring_read_fixture('complete_authoring_rows', side_effect=lambda table, rows, *args: rows) as complete:
            self.compare('authoring_fetch_all', 'components', 'id = %s', ['C'], 'id', ensure_tables=False, columns=['id'])
            self.assertEqual(sql.call_args_list[0], sql.call_args_list[1])
            self.assertEqual(complete.call_args_list[0], complete.call_args_list[1])
            cursor.execute.assert_called_with('reviewed select', ['C'])
            self.assertEqual(connection.cursor.return_value.__exit__.call_count, 2)

    def test_database_errors_propagate_instead_of_reporting_empty_data(self):
        connection = MagicMock(vendor='postgresql')
        connection.cursor.return_value.__enter__.return_value.execute.side_effect = RuntimeError('synthetic missing relation')
        with database_read_fixture('connection', connection), authoring_read_fixture('authoring_select_sql', return_value='reviewed select'):
            with original_read_adapters(), self.assertRaisesRegex(RuntimeError, 'synthetic missing relation'):
                views.authoring_fetch_all('weeks', ensure_tables=False)
            with self.assertRaisesRegex(RuntimeError, 'synthetic missing relation'):
                views.authoring_fetch_all('weeks', ensure_tables=False)

    def test_id_reads_preserve_scope_normalization_duplicates_and_empty_ids(self):
        rows = [{'id': 'A'}, {'id': 'B'}, {'id': 'A'}]
        with authoring_read_fixture('authoring_fetch_all', return_value=rows) as read:
            self.compare('authoring_rows_by_id', 'weeks', 'id', [' B ', 'B', 'A', ''], 'id', ensure_tables=False)
            self.assertEqual(read.call_args_list[0], read.call_args_list[1])
            self.assertEqual(read.call_args.args[2], ['A', 'B'])
            read.reset_mock()
            self.assertEqual(self.compare('authoring_rows_by_id', 'weeks', 'id', [], 'id'), [])
            read.assert_not_called()
            with views.curriculum_read_scope():
                actual = self.compare('authoring_rows_by_id', 'weeks', 'id', [' A ', 'A'], 'id', ensure_tables=False)
            self.assertEqual(actual, [{'id': 'A'}, {'id': 'A'}])
            self.assertEqual(read.call_args.kwargs, {'order_sql': 'id'})

    def test_incomplete_prefetch_leaves_cache_empty_and_logs_fallback(self):
        connection = MagicMock(vendor='postgresql', in_atomic_block=False)
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.nextset.return_value = False
        with database_read_fixture('connection', connection), \
             authoring_read_fixture('CURRICULUM_BATCHED_READS', True), \
             authoring_read_fixture('authoring_select_sql', return_value='reviewed select'), \
             database_read_fixture('rows_as_dicts', return_value=[]), authoring_logger_fixture() as logger, \
             views.curriculum_read_scope():
            self.compare('prefetch_authoring_reads', [(('modules',), {'ensure_tables': False}), (('weeks',), {'ensure_tables': False})])
            self.assertEqual(views.cache_state._CURRICULUM_READ_SCOPE.memo, {})
            self.assertEqual(logger.warning.call_count, 2)

    def test_summary_postgresql_sql_and_json_string_results_match(self):
        grouped = [{'module_catalogue_id': 'M', 'week_id': 'W', 'type': 'reading', 'status': 'active',
                    'expected_otjh': .125, '_count': 2, '_published_flag': True}]
        loose = [{'module_catalogue_id': 'M', 'week_id': 'W', 'type': 'reading', 'status': 'active',
                  'settings_json': '{"componentBuilderStatus":"published"}'}]
        def fetch(sql, params):
            return deepcopy(grouped if 'count(*)' in sql else loose)
        with database_read_fixture('connection', SimpleNamespace(vendor='postgresql')), \
             database_read_fixture('column_names', return_value=set(views.COMPONENT_SUMMARY_COLUMNS) | {'settings_json'}), \
             authoring_read_fixture('learning_read_table', return_value='curriculum.components'), \
             composition_fixture(views, 'fetch_all', side_effect=fetch) as query:
            actual = self.compare('component_summary_source_rows', ['M'])
            self.assertEqual(query.call_args_list[:2], query.call_args_list[2:])
            self.assertEqual([row['_published'] for row in actual], [2, 1])

    def test_ksb_summary_query_codes_and_unavailable_state_match(self):
        rows = [{'module_catalogue_id': 'M', 'week_id': 'W', 'type': 'reading', '_codes': [' k1 ', 'K1', ''] }]
        with database_read_fixture('connection', SimpleNamespace(vendor='postgresql')), \
             composition_fixture(views, 'table_exists', return_value=True), \
             database_read_fixture('authoring_table_name', side_effect=lambda table: 'curriculum.' + table), \
             composition_fixture(views, 'fetch_all', return_value=rows) as query:
            actual = self.compare('component_summary_ksb_codes', ['M'])
            self.assertEqual(query.call_args_list[0], query.call_args_list[1])
            self.assertEqual(actual, {('M', 'W'): {'K1'}})
            query.reset_mock()
            self.assertIsNone(self.compare('component_summary_ksb_codes', []))
            query.assert_not_called()
