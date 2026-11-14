"""KSB mappings scoped by their component's module / week, and single-mapping writes.

Nothing here opens a connection: the schema shape and the writers are patched.
"""
from unittest import mock

from django.test import SimpleTestCase

from curriculum_api import ksb_mapping_placement as placement
from curriculum_api import views


class WhereTests(SimpleTestCase):
    def where(self, *args, **kwargs):
        with mock.patch.object(views, 'authoring_table_name', return_value='"curriculum"."components"'):
            return placement.where(*args, **kwargs)

    def test_mappings_are_scoped_through_their_component(self):
        sql, params = self.where('MOD-1', week_id='WEEK-1')
        self.assertEqual(
            sql,
            'component_id in (select c.id from "curriculum"."components" c '
            'where c.module_catalogue_id in (%s) and c.week_id = %s)',
        )
        self.assertEqual(params, ['MOD-1', 'WEEK-1'])
        self.assertNotIn('ksb_mappings.module_catalogue_id', sql)

    def test_components_narrow_the_module_scope(self):
        sql, params = self.where(['MOD-1', 'MOD-2'], component_ids=['COMP-1'])
        self.assertTrue(sql.endswith(' and component_id in (%s)'))
        self.assertEqual(params, ['MOD-1', 'MOD-2', 'COMP-1'])

    def test_no_scope_selects_nothing(self):
        self.assertEqual(self.where(), ('1 = 0', []))
        self.assertEqual(self.where(['', None]), ('1 = 0', []))


class StoreComponentMappingsTests(SimpleTestCase):
    def test_the_new_list_reaches_the_projection_without_a_re_read(self):
        # The normalised schema keeps no JSON copy on the component: re-reading
        # it would answer the mappings stored before this write.
        component = {'id': 'COMP-1', 'module_catalogue_id': 'MOD-1', 'week_id': 'WEEK-1', 'ksb_mappings': [{'code': 'K1'}]}
        items = [{'code': 'K1'}, {'code': 'S2'}]
        with mock.patch.object(views, 'sync_component_ksb_projection', return_value=items) as sync:
            views.store_component_ksb_mappings(component, items, deleted_by='component-ksb-post')
        sync.assert_called_once()
        args, kwargs = sync.call_args
        self.assertEqual(args, ('COMP-1',))
        self.assertEqual(kwargs['component_row']['ksb_mappings'], items)
        self.assertEqual(kwargs['deleted_by'], 'component-ksb-post')
        self.assertEqual(component['ksb_mappings'], [{'code': 'K1'}])  # caller's row untouched

    def test_removing_the_last_mapping_passes_an_empty_list(self):
        with mock.patch.object(views, 'sync_component_ksb_projection') as sync:
            views.store_component_ksb_mappings({'id': 'COMP-1'}, [], deleted_by='ksb-mapping-delete')
        self.assertEqual(sync.call_args.kwargs['component_row']['ksb_mappings'], [])


class StatsReadTests(SimpleTestCase):
    def test_programme_stats_read_mappings_with_placement_and_status(self):
        # Before: only the mapping's own columns were selected, so a mapping had
        # no module (counted under '') and archived rows were counted.
        from curriculum_api import ksb_stats_reads
        real = {
            views.AUTHORING_WEEKS_TABLE: {'module_catalogue_id', 'status'},
            views.AUTHORING_COMPONENTS_TABLE: {'module_catalogue_id', 'type', 'status'},
            views.AUTHORING_KSB_MAPPINGS_TABLE: {'component_id', 'source_type', 'source_id', 'weight', 'status'},
        }
        statements = []
        with mock.patch.object(views, 'has_column', side_effect=lambda table, column: column in real[table]), \
                mock.patch.object(placement, 'relation', return_value='(mapping relation) as "ksb_mappings"'), \
                mock.patch.object(views, 'authoring_table_name', side_effect=lambda table: table), \
                mock.patch.object(views, 'fetch_all', side_effect=lambda sql, params: statements.append(sql) or []):
            ksb_stats_reads.grouped_scope_rows(['MOD-1'])
        weeks, components, mappings = statements
        self.assertIn('from (mapping relation) as "ksb_mappings"', mappings)
        for column in ('"module_catalogue_id"', '"ksb_code"', '"status"'):
            self.assertIn(column, mappings.split(' from ')[0])
        self.assertIn('"status"', components.split(' from ')[0])
        self.assertIn('from weeks', weeks)
