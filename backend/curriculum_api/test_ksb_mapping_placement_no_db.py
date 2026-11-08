"""KSB mappings scoped by their component's module / week, and single-mapping writes.

Nothing here opens a connection: the schema shape and the writers are patched.
"""
from unittest import mock

from django.test import SimpleTestCase

from curriculum_api import ksb_mapping_placement as placement
from curriculum_api import views


class WhereTests(SimpleTestCase):
    def where(self, stores, *args, **kwargs):
        with mock.patch.object(placement, 'stores_placement', return_value=stores), \
                mock.patch.object(views, 'authoring_table_name', return_value='"curriculum"."components"'):
            return placement.where(*args, **kwargs)

    def test_normalised_schema_scopes_through_the_component(self):
        sql, params = self.where(False, 'MOD-1', week_id='WEEK-1')
        self.assertEqual(
            sql,
            'component_id in (select c.id from "curriculum"."components" c '
            'where c.module_catalogue_id in (%s) and c.week_id = %s)',
        )
        self.assertEqual(params, ['MOD-1', 'WEEK-1'])
        self.assertNotIn('ksb_mappings.module_catalogue_id', sql)

    def test_components_narrow_the_module_scope(self):
        sql, params = self.where(False, ['MOD-1', 'MOD-2'], component_ids=['COMP-1'])
        self.assertTrue(sql.endswith(' and component_id in (%s)'))
        self.assertEqual(params, ['MOD-1', 'MOD-2', 'COMP-1'])

    def test_a_schema_that_stores_the_placement_uses_its_columns(self):
        sql, params = self.where(True, 'MOD-1', week_id='WEEK-1')
        self.assertEqual(sql, 'module_catalogue_id in (%s) and week_id = %s')
        self.assertEqual(params, ['MOD-1', 'WEEK-1'])

    def test_no_scope_selects_nothing(self):
        self.assertEqual(self.where(False), ('1 = 0', []))
        self.assertEqual(self.where(False, ['', None]), ('1 = 0', []))


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
