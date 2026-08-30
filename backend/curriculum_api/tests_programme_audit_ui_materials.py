from unittest.mock import patch
from types import SimpleNamespace

from django.test import RequestFactory, SimpleTestCase

from curriculum_api.programme_audit import (
    programme_audit_material,
    programme_audit_materials,
    scope_assets_to_ui_material,
)
from curriculum_api.management.commands.split_programme_audit_by_ui_materials import UI_MATERIALS


class ProgrammeAuditUiMaterialSplitTests(SimpleTestCase):
    def setUp(self):
        self.requests = RequestFactory()

    @patch('curriculum_api.programme_audit.fetch_ui_material')
    def test_material_summary_endpoint_filters_by_programme(self, fetch_material):
        fetch_material.side_effect = lambda key, include_results=False: {
            'key': key, 'ready': True, 'count': 3, 'results': [],
        }

        response = programme_audit_materials(self.requests.get('/?programme=MM'))

        self.assertEqual(response.status_code, 200)
        self.assertIn('no-cache', response.headers['Cache-Control'])
        self.assertContains(response, 'ai-in-marketing')
        self.assertNotContains(response, 'impact-planning')
        self.assertTrue(all(call.kwargs['include_results'] is False for call in fetch_material.call_args_list))

    def test_unknown_material_key_is_rejected(self):
        response = programme_audit_material(self.requests.get('/'), 'not-a-real-table')

        self.assertEqual(response.status_code, 404)

    @patch('curriculum_api.programme_audit.fetch_ui_material')
    def test_learner_summary_is_forced_to_their_own_programme(self, fetch_material):
        fetch_material.side_effect = lambda key, include_results=False: {
            'key': key, 'ready': True, 'count': 3, 'results': [],
        }
        request = self.requests.get('/?programme=ME')
        request.login_account = SimpleNamespace(role='learner', email='learner-pcp@learner.local')

        response = programme_audit_materials(request)

        self.assertContains(response, 'project-management-professional')
        self.assertNotContains(response, 'impact-planning')

    def test_learner_cannot_read_another_programmes_material(self):
        request = self.requests.get('/')
        request.login_account = SimpleNamespace(role='learner', email='learner-pcp@learner.local')

        response = programme_audit_material(request, 'ai-in-marketing')

        self.assertEqual(response.status_code, 403)

    def test_marketing_manager_includes_empty_ai_material(self):
        ai_material = next(item for item in UI_MATERIALS if item['key'] == 'ai-in-marketing')

        self.assertEqual(ai_material['name'], 'AI in Marketing')
        self.assertEqual(ai_material['programme_id'], 'MM')
        self.assertEqual(ai_material['module_ids'], ())
        self.assertEqual(ai_material['lms_programme_ids'], ('125593',))

    def test_applies_learner_facing_name_and_keeps_authored_module_id(self):
        material = {
            'name': 'Impact Planning',
            'programme_id': 'ME',
            'programme_name': 'Marketing Executive',
        }
        source = {
            'id': 'asset-1',
            'programme_id': 'PROG-MBA',
            'programme_source_id': 'PROG-MBA',
            'programme_name': 'MBA',
            'module_catalogue_id': 'MOD-1',
            'module_title': 'Long authored module title',
            'settings': {},
        }

        matched = scope_assets_to_ui_material(material, [source])[0]

        self.assertEqual(matched['programme_id'], 'ME')
        self.assertEqual(matched['programme_name'], 'Marketing Executive')
        self.assertEqual(matched['module_catalogue_id'], 'MOD-1')
        self.assertEqual(matched['module_title'], 'Impact Planning')
        self.assertEqual(matched['settings']['sourceModuleTitle'], 'Long authored module title')
        self.assertEqual(matched['raw_payload']['uiMaterialName'], 'Impact Planning')
        self.assertEqual(matched['raw_payload']['sourceModuleId'], 'MOD-1')
        self.assertEqual(source['module_title'], 'Long authored module title')
