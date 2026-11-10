"""KSB coverage reads only the components its mappings sit on, without a database.

Coverage looks components up by a mapping's component id and nothing else;
delivery deduplication needs only how many active components each module has.
So coverage reads the mapped components' rows and counts the rest in SQL
(3,196 rows instead of 27,483 for the largest programme). Other callers of
authoring_scope_data keep every component.
"""
from collections import Counter
from unittest import mock

from django.test import RequestFactory, SimpleTestCase

from curriculum_api import views

MODULES = [{'module_catalogue_id': 'MOD-A', 'title': 'A'}, {'module_catalogue_id': 'MOD-B', 'title': 'B'}]
WEEKS = [{'id': 'W1', 'module_catalogue_id': 'MOD-A'}]
MAPPINGS = [
    {'id': 'M1', 'component_id': 'C1', 'module_catalogue_id': 'MOD-A', 'ksb_code': 'K1'},
    {'id': 'M2', 'component_id': ' C1 ', 'module_catalogue_id': 'MOD-A', 'ksb_code': 'K2'},
    {'id': 'M3', 'component_id': 'C9', 'module_catalogue_id': 'MOD-B', 'ksb_code': 'K1'},
    {'id': 'M4', 'component_id': '', 'module_catalogue_id': 'MOD-B', 'ksb_code': 'S1'},
]
MAPPED_COMPONENTS = [{'id': 'C1', 'module_catalogue_id': 'MOD-A', 'title': 'Intro'},
                     {'id': 'C9', 'module_catalogue_id': 'MOD-B', 'title': 'Quiz'}]


class MappedComponentsTests(SimpleTestCase):
    def setUp(self):
        self.child_tables = []

        def child_rows(table, module_ids, **kwargs):
            self.child_tables.append(table)
            return {views.AUTHORING_WEEKS_TABLE: WEEKS, views.AUTHORING_KSB_MAPPINGS_TABLE: MAPPINGS,
                    views.AUTHORING_COMPONENTS_TABLE: MAPPED_COMPONENTS}[table]

        patches = [
            mock.patch.object(views, 'ensure_module_authoring_tables'),
            mock.patch.object(views, 'authoring_scope_module_rows', return_value=MODULES),
            mock.patch.object(views, 'authoring_child_rows_for_modules', side_effect=child_rows),
            mock.patch.object(views, 'authoring_fetch_all', return_value=MAPPED_COMPONENTS),
            mock.patch('curriculum_api.ksb_stats_reads.grouped_component_counts', return_value=Counter({'MOD-A': 40, 'MOD-B': 3})),
            mock.patch.object(views, 'dedupe_authoring_module_rows', side_effect=lambda rows, *a, **k: rows),
            mock.patch.object(views, 'connection', mock.Mock(vendor='postgresql')),
        ]
        for patcher in patches:
            self.addCleanup(patcher.stop)
        self.mocks = [patcher.start() for patcher in patches]

    def test_reads_only_the_mapped_components_and_counts_the_rest(self):
        _modules, weeks, components, mappings = views.authoring_scope_data('programme', 'PROG-1', mapped_components_only=True)
        self.assertEqual(components, MAPPED_COMPONENTS)
        self.assertEqual((weeks, mappings), (WEEKS, MAPPINGS))
        self.assertNotIn(views.AUTHORING_COMPONENTS_TABLE, self.child_tables)
        fetch = views.authoring_fetch_all
        table, where, params = fetch.call_args.args
        self.assertEqual(table, views.AUTHORING_COMPONENTS_TABLE)
        self.assertIn('id = any(%s)', where)
        self.assertEqual(params, ['MOD-A', 'MOD-B', ['C1', 'C9']])
        self.assertEqual(fetch.call_args.kwargs['columns'], views.COMPONENT_KSB_SCOPE_COLUMNS)

    def test_deduplication_ranks_by_every_active_component(self):
        views.authoring_scope_data('programme', 'PROG-1', mapped_components_only=True)
        mapping_counts, component_counts, week_counts = views.dedupe_authoring_module_rows.call_args.kwargs['counts']
        self.assertEqual(component_counts, Counter({'MOD-A': 40, 'MOD-B': 3}))
        self.assertEqual(mapping_counts, Counter({'MOD-A': 2, 'MOD-B': 2}))
        self.assertEqual(week_counts, Counter({'MOD-A': 1}))

    def test_other_callers_still_read_every_component(self):
        views.authoring_scope_data('programme', 'PROG-1')
        self.assertIn(views.AUTHORING_COMPONENTS_TABLE, self.child_tables)


class CoverageAsksForMappedComponentsTests(SimpleTestCase):
    def test_full_coverage_asks_for_mapped_components_and_summary_does_not(self):
        calls = []

        def scope_data(scope, identifier, **kwargs):
            calls.append(kwargs)
            return [], [], [], []

        with mock.patch.object(views, 'authoring_scope_data', side_effect=scope_data):
            views._coverage_response_uncached(RequestFactory().get('/x'), 'programme', 'P')
            views._coverage_response_uncached(RequestFactory().get('/x', {'view': 'summary'}), 'programme', 'P')
        self.assertEqual(calls, [{'mapped_components_only': True}, {'stats_only': True}])
