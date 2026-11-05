import copy
from unittest.mock import patch

from django.test import SimpleTestCase

from . import views
from .authoring_read_transport import compact_authoring_rows


class StructureTransportTests(SimpleTestCase):
    def test_postgres_revision_reuses_only_verified_rows_without_changing_guard(self):
        rows = {table: [] for _, table, _, _ in views.STRUCTURE_REVISION_SOURCES}
        rows[views.AUTHORING_COMPONENTS_TABLE] = [
            {'id': 'C1', 'module_catalogue_id': 'M1', 'type': 'reading',
             'settings_json': '{ "readingContent": "original" }', 'updated_at': 'ignored'},
        ]
        def read(table, *args, **kwargs):
            return [{k: copy.deepcopy(v) for k, v in row.items() if k not in kwargs.get('exclude_columns', ())}
                    for row in rows[table]]
        with patch.object(views, 'ensure_module_authoring_tables'), \
                patch.object(views, 'authoring_fetch_all', side_effect=read), \
                patch('curriculum_api.authoring_read_transport.compact_authoring_rows', side_effect=read) as verified, \
                patch.object(views, 'connection', vendor='sqlite'):
            expected = views.module_structure_revision('M1')
            views.connection.vendor = 'postgresql'
            self.assertEqual(views.module_structure_revision('M1'), expected)
            self.assertTrue(all(call.kwargs['reuse_unchanged'] for call in verified.call_args_list))
            rows[views.AUTHORING_COMPONENTS_TABLE][0]['updated_at'] = 'later timestamp'
            self.assertEqual(views.module_structure_revision('M1'), expected)
            rows[views.AUTHORING_COMPONENTS_TABLE][0]['settings_json'] = '{ "readingContent": "external edit" }'
            self.assertNotEqual(views.module_structure_revision('M1'), expected)

    def test_shared_source_rows_preserve_entire_structure_and_revision(self):
        rows = {
            views.AUTHORING_MODULES_TABLE: [{'module_catalogue_id': 'M1', 'title': 'Synthetic', 'updated_at': 'ignored'}],
            views.AUTHORING_WEEKS_TABLE: [{'id': 'W1', 'module_catalogue_id': 'M1', 'week_number': 1}],
            views.AUTHORING_COMPONENTS_TABLE: [
                {'id': 'C1', 'module_catalogue_id': 'M1', 'week_id': 'W1', 'type': 'reading', 'title': 'Text', 'settings_json': {'body': 'محتوى 🙂'}, 'expected_otjh': .125},
                {'id': 'C2', 'module_catalogue_id': 'M1', 'week_id': 'W1', 'type': 'quiz', 'deleted_at': '2026-01-01'},
            ],
            views.AUTHORING_KSB_MAPPINGS_TABLE: [{'id': 'K1', 'module_catalogue_id': 'M1', 'component_id': 'C1', 'ksb_code': 'K1', 'source_type': 'standard', 'source_id': 'S1', 'weight': 0}],
        }
        calls = []
        def read(table, *args, **kwargs):
            calls.append(table)
            return [{k: copy.deepcopy(v) for k, v in row.items() if k not in kwargs.get('exclude_columns', ())}
                    for row in rows.get(table, [])]
        with patch.object(views, 'ensure_module_authoring_tables'), \
                patch.object(views, 'connection', vendor='sqlite'), \
                patch.object(views, 'authoring_fetch_all', side_effect=read), \
                patch.object(views, 'apply_module_session_plan_to_weeks'), \
                patch.object(views, 'teams_delivery_metadata_from_live_session', return_value={}):
            # The editor's read also carries the per-item fingerprints its
            # partial saves are merged by, computed from that same payload.
            expected = views.with_item_fingerprints(
                views.structure_payload_with_revision(lambda: views.get_authoring_structure_payload('M1'), 'M1'),
            )
            calls.clear()
            actual = views.read_module_structure_with_revision('M1')
            self.assertEqual(actual, expected)
            self.assertEqual(sorted(actual['itemFingerprints']['components']), ['C1'])
            for _, table, _, _ in views.STRUCTURE_REVISION_SOURCES:
                self.assertEqual(calls.count(table), 1, table)
            rows[views.AUTHORING_COMPONENTS_TABLE][0]['title'] = 'Changed by another editor'
            self.assertNotEqual(actual['structureRevision'], views.module_structure_revision('M1'))

    def test_dictionary_restores_native_values_without_sharing_mutable_json(self):
        wire_rows = [
            {'id': '1', 'description': '', 'settings_json': {'x': ['🙂']}, '__text_rank_0': 1, '__text_rank_1': 2},
            {'id': '2', 'description': None, 'settings_json': None, '__text_rank_0': 1, '__text_rank_1': 2},
            {'id': '3', 'description': None, 'settings_json': None, '__text_rank_0': 3, '__text_rank_1': 3},
            {'id': '4', 'description': '  ', 'settings_json': 'raw JSON text', '__text_rank_0': 4, '__text_rank_1': 4},
        ]
        with patch.object(views, 'connection', vendor='postgresql'), \
                patch.object(views, 'ensure_module_authoring_tables'), \
                patch.object(views, 'column_names', return_value={'id', 'description', 'settings_json'}), \
                patch.object(views, 'authoring_table_name', return_value='synthetic'), \
                patch.object(views, 'rows_as_dicts', return_value=copy.deepcopy(wire_rows)):
            result = compact_authoring_rows('components', 'id = %s', ['1'], 'id')
        self.assertEqual(result[1]['description'], '')
        self.assertIsNone(result[2]['description'])
        self.assertEqual(result[3]['description'], '  ')
        self.assertEqual(result[3]['settings_json'], 'raw JSON text')
        result[0]['settings_json']['x'].append('edit')
        self.assertEqual(result[1]['settings_json'], {'x': ['🙂']})
