"""Workspace projections use synthetic rows; no database or external calls."""
import copy
import gzip
import json
from unittest.mock import patch

from django.test import RequestFactory, SimpleTestCase

from . import views


def document():
    module = {
        'id': 'DELIVERY-1', 'moduleCatalogueId': 'MOD-1', 'sourceType': 'authoring',
        'relatedCatalogueIds': ['MOD-2'], 'name': 'Synthetic module',
        'programmeId': 'PROG-1', 'programme': 'Synthetic programme',
        'cohortId': 'C-1', 'groupId': 'G-1', 'status': 'published',
        'authoringStatus': 'draft', 'deliveryStatus': 'active', 'isProgrammeDeleted': False,
        'weeks': 2, 'sessionsNumber': 3, 'ksbCodes': ['K1'],
        'notes': 'Keep this description on edit', 'color': '#123456',
        'coverImage': 'https://example.invalid/cover.png', 'tutor': 'Synthetic tutor',
        'startDate': '2026-10-01', 'endDate': '2026-11-01', 'endTime': None,
        'weeklySchedule': [{'day': 'Monday', 'startTime': '09:00', 'endTime': '10:00'}],
        'sessionHolidays': ['H-1'], 'deliveryWeeks': 2, 'weekDays': 'Monday',
        'startTime': '09:00', 'weekStructureOutline': True,
        'sessionNames': ['Duplicate session title'] * 500,
        'moduleKsbMappings': [{'code': f'K{i}', 'description': 'Unused mapping text' * 50} for i in range(100)],
        'deliveryMetadata': {'unusedMetadata': 'large unused metadata' * 1000},
        'weekStructure': [{
            'id': 'W-1', 'weekNumber': 1, 'number': 1, 'title': 'Orientation', 'displayOrder': 3,
            'description': 'Unused week description' * 1000,
            'ksbMappings': [{'code': 'K1'}], 'componentsOmitted': True,
        }],
    }
    return {'schema': 'curriculum', 'flat': {'modules': [module], 'sessions': [{
        'id': 'S-1', 'moduleId': 'MOD-1', 'date': '2026-10-05',
        'skippedHolidays': ['H-1'], 'scheduleWarnings': ['Synthetic warning'],
    }]}}


class ProgrammeModulesWorkspaceTests(SimpleTestCase):
    def test_preserves_display_edit_identity_and_schedule_values_without_mutating_source(self):
        full = document()
        before = copy.deepcopy(full)
        projected = views.programme_modules_workspace_payload(full)
        module = projected['flat']['modules'][0]
        for key, value in full['flat']['modules'][0].items():
            if key not in {'sessionNames', 'moduleKsbMappings', 'deliveryMetadata', 'weekStructure'}:
                self.assertEqual(module[key], value, key)
        self.assertEqual(module['weekStructure'], [{
            'id': 'W-1', 'weekNumber': 1, 'number': 1, 'title': 'Orientation',
            'displayOrder': 3, 'componentsOmitted': True,
        }])
        self.assertTrue(module['weekStructureOutline'])
        self.assertEqual(projected['flat']['sessions'], full['flat']['sessions'])
        self.assertEqual(full, before)

    def test_large_unused_authoring_fields_do_not_grow_workspace_response(self):
        full = document()
        small = views.programme_modules_workspace_payload(full)
        self.assertLess(len(json.dumps(small).encode()), len(json.dumps(full).encode()) // 20)
        self.assertTrue({'sessionNames', 'moduleKsbMappings', 'deliveryMetadata'}.isdisjoint(small['flat']['modules'][0]))

    def get(self, query='', **headers):
        with patch.object(views, 'repair_curriculum_parent_links') as repair, \
                patch.object(views, 'build_curriculum_programme_tree_detail_payload', return_value=document()), \
                patch.object(views, 'cached_curriculum_value', side_effect=lambda key, build, **kw: build()) as cached:
            request = RequestFactory().get('/curriculum/programmes/PROG-1/detail/modules/' + query, **headers)
            response = views.curriculum_programme_detail_section(request, 'PROG-1', 'modules')
        repair.assert_called_once_with('PROG-1', allow_writes=False)
        return response, cached.call_args

    def test_opt_in_keeps_full_response_and_cache_separate(self):
        original, original_cache = self.get('?visibility=all')
        compact, compact_cache = self.get('?visibility=all&view=workspace')
        self.assertEqual(json.loads(original.content), document())
        self.assertEqual(json.loads(compact.content), views.programme_modules_workspace_payload(document()))
        self.assertNotEqual(original_cache.args[0], compact_cache.args[0])
        self.assertIn(':all:', compact_cache.args[0])

    def test_gzip_roundtrip_preserves_data_and_conditional_response(self):
        response, _ = self.get('?visibility=all&view=workspace', HTTP_ACCEPT_ENCODING='gzip')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Content-Encoding'], 'gzip')
        self.assertEqual(json.loads(gzip.decompress(response.content)), views.programme_modules_workspace_payload(document()))
        unchanged, _ = self.get('?visibility=all&view=workspace', HTTP_IF_NONE_MATCH=response['ETag'])
        self.assertEqual(unchanged.status_code, 304)

    def test_preserves_absent_and_null_fields(self):
        payload = {'schema': 'test', 'flat': {'modules': [{'id': 'M', 'notes': None}], 'sessions': []}}
        self.assertEqual(views.programme_modules_workspace_payload(payload), payload)
