"""Execute concrete catalogue readers against synthetic IO, never a database."""
from curriculum_api.catalogue.tests.parity.composition_test_support import composition_fixture
from collections import Counter, defaultdict
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.test import SimpleTestCase

from . import views, catalogue_summary_reads, ksb_stats_reads, curriculum_names, archive_state
from .catalogue.domain import archive_policy, content_values, values, component_types
from .catalogue.infrastructure import content_counts, grouped_content, database_reads, ksb_read_store
from .catalogue.tests.parity import content_composition_oracle as oracle


def original(relative, name):
    env = dict(Counter=Counter, defaultdict=defaultdict,
               _default_clean_str=values.clean_str, _default_parse_int=values.parse_int,
               _default_is_retired_component_type=component_types.is_retired_component_type)
    exec(compile(oracle.SNAPSHOT['original_functions'][relative + ':' + name], '<task-start>', 'exec'), env)
    return env[name]


class CatalogueContentCompositionTests(SimpleTestCase):
    def test_exports_are_same_concrete_functions_and_consumers_skip_views(self):
        for name in ('row_has_deleted_at', 'programme_deleted_row', 'active_week_rows', 'active_mapping_rows'):
            self.assertIs(getattr(views, name), getattr(archive_policy, name))
        self.assertIs(curriculum_names.is_inactive, archive_policy.is_inactive)
        self.assertIs(archive_state.row_inactive, archive_policy.row_inactive)
        self.assertIs(views.active_component_rows, content_values.active_component_rows)
        self.assertIs(catalogue_summary_reads.grouped_catalogue_content_rows,
                      grouped_content.grouped_catalogue_content_rows)
        self.assertNotIn('views', vars(ksb_stats_reads))
        self.assertIs(ksb_stats_reads.active_component_rows, content_values.active_component_rows)

    def count_parity(self, lessons, mappings, *, missing_type=False):
        old_read = original('catalogue/infrastructure/content_counts.py', 'authoring_module_content_counts')
        columns = lambda table, column: not (missing_type and column == 'type')
        old_fetch = Mock(side_effect=deepcopy([lessons, mappings]))
        new_fetch = Mock(side_effect=deepcopy([lessons, mappings]))
        route = Mock(return_value='"curriculum"."components_read"')
        projection = Mock(return_value='(select * from normalized_ksb_projection)')
        expected = old_read(
            AUTHORING_COMPONENTS_TABLE='components', AUTHORING_KSB_MAPPINGS_TABLE='ksb_mappings',
            fetch_all=old_fetch, has_column=columns, quote_ident=database_reads.quote_ident,
            learning_read_table=route, ksb_mapping_placement=SimpleNamespace(relation=projection),
            live_authoring_rows_sql=views.live_authoring_rows_sql)
        route.reset_mock(); projection.reset_mock()
        with patch.object(database_reads, 'fetch_all', new_fetch), \
             patch.object(database_reads, 'has_column', side_effect=columns), \
             composition_fixture(views, 'learning_read_table', route), \
             patch.object(ksb_read_store, 'relation', projection), \
             composition_fixture(views, 'fetch_all', side_effect=AssertionError('facade must not supply IO')):
            actual = views.authoring_module_content_counts()
        self.assertEqual(actual, expected)
        self.assertEqual(new_fetch.call_args_list, old_fetch.call_args_list)
        route.assert_called_once_with('components')
        projection.assert_called_once_with(include_description=False)
        self.assertEqual(len(new_fetch.call_args_list), 2)
        return actual

    def test_empty_counts_stay_empty(self):
        self.assertEqual(self.count_parity([], []), ({}, {}))

    def test_grouped_counts_keep_retired_types_and_duplicate_code_rules(self):
        lessons = [{'module_catalogue_id': 'MOD-A', 'type': 'reading', 'row_count': 3},
                   {'module_catalogue_id': 'MOD-A', 'type': 'quiz', 'row_count': '2'},
                   {'module_catalogue_id': 'MOD-A', 'type': 'workplace_evidence', 'row_count': 17}]
        mappings = [{'module_catalogue_id': 'MOD-A', 'ksb_code': code}
                    for code in (' K1 ', 'K1', '\tK2\n', '', None, 'k1')]
        self.assertEqual(self.count_parity(lessons, mappings)[1], {'MOD-A': 3})

    def test_missing_column_selection_unchanged(self):
        self.count_parity([{'module_catalogue_id': 'MOD-A', 'row_count': 4}], [], missing_type=True)

    def test_null_module_and_invalid_counts_keep_original_behavior(self):
        self.count_parity([{'module_catalogue_id': None, 'type': 'reading', 'row_count': 'invalid'}],
                          [{'module_catalogue_id': None, 'ksb_code': 'K1'}])

    def test_reader_error_propagates_without_empty_fallback(self):
        with patch.object(database_reads, 'has_column', return_value=True), \
             composition_fixture(views, 'learning_read_table', return_value='components'), \
             patch.object(database_reads, 'fetch_all', side_effect=RuntimeError('synthetic unavailable')) as read:
            with self.assertRaisesRegex(RuntimeError, 'synthetic unavailable'):
                views.authoring_module_content_counts()
        read.assert_called_once()

    def test_grouped_reader_keeps_exact_sql_order_types_filter_and_counts(self):
        rows = [
            [{'module_catalogue_id': 'MOD-A', 'type': 'reading', 'status': 'active', 'row_count': 2},
             {'module_catalogue_id': 'MOD-A', 'type': 'quiz', 'status': 'inactive', 'row_count': 5},
             {'module_catalogue_id': 'MOD-A', 'type': 'live-session', 'status': 'active',
              'title': 'Same title', 'expected_otjh': .125, 'row_count': 3}],
            [{'module_catalogue_id': 'MOD-A', 'ksb_code': ' K1 ', 'status': 'active'},
             {'module_catalogue_id': 'MOD-A', 'ksb_code': 'K2', 'status': 'archived'}],
        ]
        old_fetch = Mock(side_effect=deepcopy(rows)); new_fetch = Mock(side_effect=deepcopy(rows))
        previous = original('catalogue/infrastructure/grouped_content.py', 'grouped_catalogue_content_rows')
        expected = previous(
            AUTHORING_COMPONENTS_TABLE='components', AUTHORING_KSB_MAPPINGS_TABLE='ksb_mappings',
            active_component_rows=content_values.active_component_rows,
            active_mapping_rows=archive_policy.active_mapping_rows,
            authoring_table_name=lambda table: '"' + table + '"', fetch_all=old_fetch,
            has_column=lambda *args: True, live_authoring_rows_sql=views.live_authoring_rows_sql,
            mapping_can_select=lambda *args: True, mapping_read_source=lambda table: 'normalized_projection',
            quote_ident=database_reads.quote_ident)
        with patch.object(database_reads, 'fetch_all', new_fetch), \
             patch.object(database_reads, 'has_column', return_value=True), \
             patch.object(database_reads, 'authoring_table_name', side_effect=lambda table: '"' + table + '"'), \
             patch.object(grouped_content, 'mapping_can_select', return_value=True), \
             patch.object(grouped_content, 'mapping_read_source', return_value='normalized_projection'):
            actual = catalogue_summary_reads.grouped_catalogue_content_rows()
        self.assertEqual(actual, expected)
        self.assertEqual(new_fetch.call_args_list, old_fetch.call_args_list)
        self.assertEqual(len(actual[0]), 2)
        self.assertEqual(len(actual[1]), 1)
        self.assertEqual(actual[0][1]['expected_otjh'], .125)

    def test_grouped_reader_failure_is_not_swallowed(self):
        with patch.object(database_reads, 'has_column', return_value=True), \
             patch.object(database_reads, 'authoring_table_name', return_value='components'), \
             patch.object(database_reads, 'fetch_all', side_effect=RuntimeError('synthetic unavailable')):
            with self.assertRaisesRegex(RuntimeError, 'synthetic unavailable'):
                catalogue_summary_reads.grouped_catalogue_content_rows()
