import json
from unittest.mock import Mock, patch
from django.test import RequestFactory, SimpleTestCase
from .evidence import _training_plan_details
from .reflection_submissions import _learner_profile_ids_for_source


class EvidenceMetadataTests(SimpleTestCase):
    def test_database_json_text_keeps_the_entered_placement_and_ksbs(self):
        details = {'componentTitle': 'Campaign evaluation', 'weekTitle': 'Week 2', 'ksbCodes': ['K1'], 'otjhHours': 1.5}
        self.assertEqual(_training_plan_details(json.dumps(details)), details)
        self.assertEqual(_training_plan_details(details), details)

    def test_missing_or_invalid_metadata_is_not_exposed_as_a_string(self):
        for value in (None, '', 'invalid', '[]', 'null'):
            self.assertIsNone(_training_plan_details(value))


class ProgressIdentityTests(SimpleTestCase):
    def test_explicit_profile_link_never_uses_an_unrelated_source_primary_key(self):
        cursor = Mock()
        cursor.fetchall.return_value = [('647',)]
        self.assertEqual(_learner_profile_ids_for_source(cursor, 501), ['647'])
        cursor.execute.assert_called_once()

    def test_unmatched_or_ambiguous_legacy_profiles_do_not_invent_a_profile_id(self):
        for candidates in ([], [('2',), ('3',)]):
            cursor = Mock()
            cursor.fetchall.side_effect = [[], candidates]
            cursor.fetchone.return_value = ('shared@example.test',)
            self.assertEqual(_learner_profile_ids_for_source(cursor, 500), [])
            self.assertIn('enrolment_id is null', cursor.execute.call_args.args[0])
            self.assertIn('not exists', cursor.execute.call_args.args[0])


class ComponentEditReadScopeTests(SimpleTestCase):
    def test_editing_one_component_does_not_read_the_entire_curriculum(self):
        from curriculum_api.views import curriculum_component_detail
        request = RequestFactory().patch('/component/COMP-1/', data=json.dumps({'reflectionRequired': False}), content_type='application/json')
        with patch('curriculum_api.views.authoring_fetch_all', return_value=[{'id': 'COMP-1', 'module_catalogue_id': 'MOD-1'}]), \
                patch('curriculum_api.views.component_builder_rows', return_value=[{'id': 'COMP-1'}]) as read, \
                patch('curriculum_api.views.save_component_builder_payload', return_value={'id': 'COMP-1'}):
            response = curriculum_component_detail(request, 'COMP-1')
        self.assertEqual(response.status_code, 200)
        read.assert_called_once_with(['MOD-1'])
