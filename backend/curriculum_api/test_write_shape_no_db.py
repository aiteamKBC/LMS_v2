"""The shape a curriculum write stores (write_shape), without a database."""
from unittest import mock

from django.test import SimpleTestCase

from curriculum_api import ksb_mapping_placement, write_shape

MODULES = {'module_catalogue_id', 'programme_id', 'cohort_id', 'group_id', 'title', 'status', 'tutor_id',
           'updated_at', 'created_at'}
COLUMNS = {
    'modules': MODULES,
    'groups': {'group_id', 'group_name', 'cohort_id', 'programme_id', 'status', 'updated_at'},
    'weeks': {'id', 'module_catalogue_id', 'status', 'updated_at'},
    'components': {'id', 'week_id', 'module_catalogue_id', 'status', 'updated_at'},
    'cohorts': {'cohort_id', 'cohort_name', 'programme_id', 'status', 'updated_at'},
    'ksb_mappings': {'id', 'component_id', 'ksb_id', 'standard_ksb_id', 'source_type', 'source_id', 'weight',
                     'status', 'updated_at'},
}


def shape(table, payload):
    return write_shape.normalise(table, payload, COLUMNS[table])


class StatusTests(SimpleTestCase):
    def test_archived_is_stored_as_inactive(self):
        for table in ('modules', 'cohorts', 'groups'):
            shaped, _ = shape(table, {'status': 'archived'})
            self.assertEqual(shaped['status'], 'inactive', table)

    def test_display_status_is_not_written_to_an_archive_flag_column(self):
        # groups/modules/weeks CHECK status in ('active', 'inactive'): a cohort's
        # 'planned' or a builder 'draft' was refused by the database (500).
        for table, value in (('groups', 'planned'), ('modules', 'draft'), ('modules', 'published'), ('weeks', 'draft')):
            shaped, _ = shape(table, {'status': value, 'title': 'T'})
            self.assertNotIn('status', shaped, (table, value))
            self.assertEqual(shaped['title'], 'T')
        self.assertEqual(shape('groups', {'status': 'Active'})[0]['status'], 'active')

    def test_cohorts_keep_their_own_status_values(self):
        self.assertEqual(shape('cohorts', {'status': 'planned'})[0]['status'], 'planned')

    def test_an_ordinary_save_does_not_invent_a_status(self):
        self.assertNotIn('status', shape('modules', {'title': 'Module A'})[0])

    def test_legacy_archive_flags_are_not_translated(self):
        # The archive state is written as status; an old flag is not a column
        # here, so filtered_payload drops it like any unknown key.
        shaped, _ = shape('modules', {'deleted_at': '2026-01-01', 'is_programme_deleted': True})
        self.assertNotIn('status', shaped)

    def test_the_callers_payload_is_not_changed(self):
        payload = {'status': 'archived', 'group_id': ''}
        shape('modules', payload)
        self.assertEqual(payload, {'status': 'archived', 'group_id': ''})


class ForeignKeyTests(SimpleTestCase):
    def test_blank_foreign_keys_are_stored_as_null(self):
        shaped, nullable = shape('modules', {'group_id': '', 'cohort_id': '  ', 'programme_id': 'PROG-1'})
        self.assertIsNone(shaped['group_id'])
        self.assertIsNone(shaped['cohort_id'])
        self.assertEqual(shaped['programme_id'], 'PROG-1')
        self.assertTrue({'group_id', 'cohort_id'} <= nullable)

    def test_blank_required_foreign_key_leaves_the_stored_link_alone(self):
        shaped, nullable = shape('components', {'week_id': '', 'title': 'T'})
        self.assertNotIn('week_id', shaped)
        self.assertNotIn('week_id', nullable)

    def test_staff_names_are_left_for_curriculum_names(self):
        shaped, nullable = shape('modules', {'tutor_name': 'Tutor'})
        self.assertEqual(shaped, {'tutor_name': 'Tutor'})
        self.assertEqual(nullable, set())


class KsbMappingTests(SimpleTestCase):
    def test_a_mapping_resolves_its_standard_ksb_from_its_own_source(self):
        with mock.patch.object(ksb_mapping_placement, 'standard_ksb_id_for', return_value=7) as lookup:
            shaped, _ = shape('ksb_mappings', {
                'id': 'KSBMAP-1', 'component_id': 'C1', 'ksb_id': 'K1', 'ksb_code': 'K1', 'weight': 40,
                'module_catalogue_id': 'MOD-1', 'source_type': 'standard', 'source_id': 'st0596-v1-0',
            })
        self.assertEqual(shaped['standard_ksb_id'], 7)
        lookup.assert_called_once_with('K1', 'K1', module_catalogue_id='MOD-1', source_type='standard',
                                       source_id='st0596-v1-0')

    def test_a_given_standard_ksb_is_kept(self):
        with mock.patch.object(ksb_mapping_placement, 'standard_ksb_id_for') as lookup:
            shaped, _ = shape('ksb_mappings', {'component_id': 'C1', 'standard_ksb_id': 3, 'ksb_code': 'K1'})
        self.assertEqual(shaped['standard_ksb_id'], 3)
        lookup.assert_not_called()
