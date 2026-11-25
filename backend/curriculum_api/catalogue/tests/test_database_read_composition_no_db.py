"""Actual read adapter wiring with Django configured and database access forbidden."""
from curriculum_api.catalogue.tests.parity.composition_test_support import composition_fixture
from curriculum_api.catalogue.tests.parity.read_dependency_test_support import placement_read_fixture
from curriculum_api.catalogue.tests.parity.read_dependency_test_support import authoring_read_fixture
from unittest.mock import patch
from types import SimpleNamespace
from django.test import SimpleTestCase

from curriculum_api import views, learning_storage, schema_compat, ksb_mapping_placement
from curriculum_api.catalogue.infrastructure import database_reads, storage_context
from curriculum_api.catalogue.infrastructure import authoring_reads, authoring_sql, ksb_read_store
from curriculum_api.catalogue.tests.parity.authoring_composition_oracle import SNAPSHOT
from contextlib import ExitStack, contextmanager
from unittest.mock import Mock
import copy


class DatabaseReadCompositionTests(SimpleTestCase):
    def test_legacy_exports_are_owner_functions_and_shared_caches(self):
        for name in ('column_names', 'table_exists', 'has_column', 'fetch_all', 'rows_as_dicts',
                     'authoring_table_name', 'learner_schema_columns', 'reset_learner_schema_cache',
                     '_TABLE_COLUMNS_CACHE', '_TABLE_EXISTS_CACHE', '_LEARNER_SCHEMA_COLUMNS'):
            self.assertIs(getattr(views, name), getattr(database_reads, name), name)
        self.assertIs(learning_storage.native_only, storage_context.native_only)
        self.assertIs(learning_storage._native_only, storage_context._native_only)
        with learning_storage.native_authoring_scope():
            self.assertTrue(database_reads.native_only())
        self.assertFalse(database_reads.native_only())

    def test_schema_adapter_uses_concrete_owner_without_views_lookup(self):
        with patch.object(database_reads, 'column_names', return_value={'id'}) as query, \
             patch.object(schema_compat, 'connection', SimpleNamespace(vendor='postgresql')), \
             composition_fixture(views, 'column_names', side_effect=AssertionError('legacy facade used')):
            self.assertEqual(schema_compat.columns_of('curriculum', 'synthetic_uncached'), {'id'})
        query.assert_called_once_with('synthetic_uncached')

    def test_ksb_projection_uses_owner_and_keeps_join_shape(self):
        with patch.object(database_reads, 'authoring_table_name', side_effect=lambda table: '"curriculum"."' + table + '"'), \
             composition_fixture(views, 'authoring_table_name', side_effect=AssertionError('legacy facade used')):
            sql = ksb_mapping_placement.relation(include_description=False)
        self.assertIn('module_catalogue_id', sql)
        self.assertIn('ksb_code', sql)
        self.assertIn('select m.*', sql)  # Includes the physical status column.
        self.assertIn('left join', sql.lower())
        self.assertNotIn('ksb_description', sql)


class ReadCursor:
    """Synthetic result sets only; never wraps a database connection."""
    vendor = 'postgresql'
    in_atomic_block = False

    def __init__(self, results=(((1,),), ((2,),)), error=None):
        self.results = results
        self.error = error
        self.calls = []
        self.index = 0
        self.description = [('id',)]

    def cursor(self):
        return self

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass

    def execute(self, query, params):
        self.index = 0
        self.calls.append((query, copy.deepcopy(params)))
        if self.error:
            raise self.error

    def fetchall(self):
        return self.results[self.index]

    def nextset(self):
        self.index += 1
        return self.index < len(self.results)


@contextmanager
def authoring_fixture(cursor):
    with ExitStack() as stack:
        stack.enter_context(patch.object(database_reads, 'connection', cursor))
        stack.enter_context(patch.object(database_reads, 'column_names', return_value={'id'}))
        stack.enter_context(patch.object(database_reads, 'has_column', return_value=False))
        stack.enter_context(authoring_read_fixture('learning_read_table', side_effect=lambda table: '"' + table + '"'))
        guard = stack.enter_context(authoring_read_fixture('ensure_module_authoring_tables'))
        stack.enter_context(placement_read_fixture('attach', side_effect=lambda table, rows, **kw: rows))
        yield guard


class AuthoringReadCompositionTests(SimpleTestCase):
    def test_default_select_sql_matches_actual_old_source_with_explicit_capabilities(self):
        old = {}
        exec(compile(SNAPSHOT['old_sources']['catalogue/infrastructure/authoring_sql.py'],
                     '<pre-composition-authoring-sql>', 'exec'), old)
        ref = lambda table: '"curriculum"."' + table + '"'
        for table in ('modules', 'groups', 'cohorts', 'ksb_mappings', 'components'):
            for columns in (None, ['id'], ['module_catalogue_id', 'ksb_code', 'ksb_description']):
                for excluded in (None, ['ksb_description', 'settings_json']):
                    with self.subTest(table=table, columns=columns, excluded=excluded), \
                         patch.object(database_reads, 'authoring_table_name', side_effect=ref), \
                         patch.object(database_reads, 'column_names', return_value={
                             'id', 'programme_id', 'cohort_id', 'group_id', 'programme_name',
                             'status', 'standard_ksb_id', 'settings_json'}), \
                         patch.object(database_reads, 'has_column', return_value=True):
                        programme = lambda t: old['derived_programme_name_sql'](
                            t, PROGRAMME_NAME_DERIVED_TABLES=views.PROGRAMME_NAME_DERIVED_TABLES,
                            authoring_table_name=ref, has_column=database_reads.has_column)
                        placement = lambda t: old['derived_placement_names_sql'](
                            t, PLACEMENT_NAME_DERIVED_COLUMNS=views.PLACEMENT_NAME_DERIVED_COLUMNS,
                            authoring_table_name=ref, has_column=database_reads.has_column,
                            derived_programme_name_sql=programme)
                        expected = old['authoring_select_sql'](
                            table, 'id = %s', 'id', columns=columns, exclude_columns=excluded,
                            AUTHORING_KSB_MAPPINGS_TABLE='ksb_mappings', authoring_table_name=ref,
                            column_names=database_reads.column_names, derived_placement_names_sql=placement,
                            ksb_placement_fields=ksb_read_store.PLACEMENT_FIELDS,
                            ksb_relation=ksb_read_store.relation, learning_read_table=ref,
                            quote_ident=database_reads.quote_ident)
                        actual = authoring_sql.authoring_select_sql(
                            table, 'id = %s', 'id', columns=columns, exclude_columns=excluded,
                            learning_read_table=ref)
                        self.assertEqual(actual, expected)

    def test_ksb_exports_share_state_and_completion_preserves_selected_fields(self):
        self.assertIs(views.derived_programme_name_sql, authoring_sql.derived_programme_name_sql)
        self.assertIs(views.derived_placement_names_sql, authoring_sql.derived_placement_names_sql)
        for name in SNAPSHOT['ksb_read_symbols'] + ['_STANDARD_TEXTS', '_STANDARD_TEXTS_LOCK']:
            self.assertIs(getattr(ksb_mapping_placement, name), getattr(ksb_read_store, name))
        old = {}
        exec(compile(SNAPSHOT['old_sources']['catalogue/infrastructure/authoring_reads.py'],
                     '<pre-composition-authoring-reads>', 'exec'), old)
        for table, row in [('components', {'id': 'C'}),
                           ('components', {'id': 'C', 'ksb_mappings': []}),
                           ('ksb_mappings', {'id': 'K', 'standard_ksb_id': 8}),
                           ('ksb_mappings', {'id': 'K', 'standard_ksb_id': None, 'ksb_description': ''})]:
            for columns, excluded in ((None, None), (['id'], None), (None, ['ksb_mappings', 'ksb_description'])):
                with self.subTest(table=table, row=row, columns=columns, excluded=excluded), \
                     patch.object(ksb_read_store, 'component_items', return_value={'C': [{'id': 'K'}]}), \
                     patch.object(ksb_read_store, 'standard_ksb_texts', return_value={8: ('K1', 'Synthetic')}):
                    names = Mock(side_effect=lambda table, rows, **kw: rows)
                    expected = old['complete_authoring_rows'](
                        table, [copy.deepcopy(row)], columns, excluded,
                        AUTHORING_COMPONENTS_TABLE='components', AUTHORING_KSB_MAPPINGS_TABLE='ksb_mappings',
                        attach_component_ksbs=ksb_read_store.attach_component_items,
                        attach_ksb_descriptions=ksb_read_store.attach_descriptions, attach_curriculum_names=names)
                    old_call = names.call_args
                    actual = authoring_reads.complete_authoring_rows(
                        table, [copy.deepcopy(row)], columns, excluded, attach_curriculum_names=names,
                        AUTHORING_COMPONENTS_TABLE='components', AUTHORING_KSB_MAPPINGS_TABLE='ksb_mappings')
                    self.assertEqual(actual, expected)
                    self.assertEqual(names.call_args, old_call)

    def test_actual_facade_direct_and_prefetched_reads_share_results_and_memo(self):
        cursor = ReadCursor()
        calls = [(('synthetic_a', 'id = %s', [1]), {}), (('synthetic_b',), {'columns': ['id']})]
        with authoring_fixture(cursor), views.curriculum_read_scope():
            views.prefetch_authoring_reads(calls)
            self.assertEqual(len(cursor.calls), 1)
            self.assertIn('; ', cursor.calls[0][0])
            self.assertEqual(cursor.calls[0][1], [1])
            self.assertEqual(views.authoring_fetch_all(*calls[0][0], **calls[0][1]), [{'id': 1}])
            self.assertEqual(views.authoring_fetch_all(*calls[1][0], **calls[1][1]), [{'id': 2}])
            self.assertEqual(len(cursor.calls), 1)
        cursor.results = (((1,),),)
        with authoring_fixture(cursor):
            self.assertEqual(views.authoring_fetch_all('synthetic_a', 'id = %s', [1]), [{'id': 1}])
            self.assertEqual(len(cursor.calls), 2)

    def test_failed_batch_does_not_substitute_empty_success_and_direct_failure_propagates(self):
        cursor = ReadCursor(error=RuntimeError('synthetic query failure'))
        calls = [(('synthetic_a',), {}), (('synthetic_b',), {})]
        with authoring_fixture(cursor), views.curriculum_read_scope():
            views.prefetch_authoring_reads(calls)
            with self.assertRaisesRegex(RuntimeError, 'synthetic query failure'):
                views.authoring_fetch_all('synthetic_a')
            self.assertEqual(len(cursor.calls), 2)

    def test_short_batch_result_does_not_poison_individual_read(self):
        cursor = ReadCursor(results=(((7,),),))
        with authoring_fixture(cursor), views.curriculum_read_scope():
            views.prefetch_authoring_reads([(('synthetic_a',), {}), (('synthetic_b',), {})])
            self.assertEqual(views.authoring_fetch_all('synthetic_a'), [{'id': 7}])
            self.assertEqual(len(cursor.calls), 2)

    def test_prefetch_remains_disabled_outside_scope_in_transactions_and_off_postgres(self):
        calls = [(('synthetic_a',), {}), (('synthetic_b',), {})]
        cursor = ReadCursor()
        with authoring_fixture(cursor):
            views.prefetch_authoring_reads(calls)
        for vendor, atomic in [('postgresql', True), ('sqlite', False)]:
            cursor.vendor, cursor.in_atomic_block = vendor, atomic
            with authoring_fixture(cursor), views.curriculum_read_scope():
                views.prefetch_authoring_reads(calls)
        self.assertEqual(cursor.calls, [])

    def test_schema_guard_is_explicit_and_failure_precedes_sql_execution(self):
        cursor = ReadCursor(results=((),))
        with authoring_fixture(cursor) as guard:
            views.authoring_fetch_all('synthetic', ensure_tables=False)
            guard.assert_not_called()
            guard.side_effect = RuntimeError('synthetic schema not ready')
            with self.assertRaisesRegex(RuntimeError, 'synthetic schema not ready'):
                views.authoring_fetch_all('synthetic')
            self.assertEqual(len(cursor.calls), 1)

    def test_rows_by_id_preserve_normalization_and_scope_ordering(self):
        read = Mock(return_value=[{'id': 'B'}, {'id': 'A'}, {'id': 'Z'}])
        with views.curriculum_read_scope():
            self.assertEqual(authoring_reads.authoring_rows_by_id(
                'synthetic', 'id', [' A ', 'B', 'A', '', None], 'id', authoring_fetch_all=read),
                [{'id': 'B'}, {'id': 'A'}])
            read.assert_called_once_with('synthetic', order_sql='id')
        read.reset_mock()
        authoring_reads.authoring_rows_by_id('synthetic', 'id', [' B ', 'A', 'A'], 'id',
                                            ensure_tables=False, authoring_fetch_all=read)
        read.assert_called_once_with('synthetic', '"id" in (%s, %s)', ['A', 'B'], ensure_tables=False)
