"""API-boundary regressions for the native Extra Activity cutover."""
import json
from inspect import unwrap
from unittest.mock import patch

from django.http import JsonResponse
from django.test import RequestFactory, SimpleTestCase

from .reflection_submissions import _submit_reflection, get_reflection_submission


class ExtraActivityCutoverTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.payload = {
            'learnerKind': 'apprenticeship', 'learnerId': '678',
            'activityType': 'extra_activity',
            'activityId': 'extra:622d4aa2-5884-4be9-a5a7-5f6e81ad4b23',
            'submissionMode': 'draft', 'activityTitle': 'External learning',
        }

    def test_save_routes_to_native_store_before_legacy_submission_sql(self):
        request = self.factory.post('/', json.dumps(self.payload), content_type='application/json')
        expected = JsonResponse({'id': 'native'}, status=201)
        with patch('learner_api.extra_activities.prepare_extra_activity', return_value=self.payload), \
             patch('learner_api.extra_activity_store.save_response', return_value=expected) as save, \
             patch('learner_api.reflection_submissions.connections') as legacy:
            response = unwrap(_submit_reflection)(request)
        self.assertIs(response, expected)
        save.assert_called_once_with(self.payload)
        legacy.__getitem__.assert_not_called()

    def test_read_routes_to_native_store_before_legacy_submission_sql(self):
        request = self.factory.get('/', {
            'learnerKind': 'apprenticeship', 'learnerId': '678',
            'activityType': 'extra_activity', 'activityId': self.payload['activityId'],
        })
        expected = JsonResponse({'submission': {'activityType': 'extra_activity'}})
        with patch('learner_api.extra_activity_store.get_response', return_value=expected) as read, \
             patch('learner_api.reflection_submissions.connections') as legacy:
            response = unwrap(get_reflection_submission)(request)
        self.assertIs(response, expected)
        read.assert_called_once_with('678', 'apprenticeship', self.payload['activityId'])
        legacy.__getitem__.assert_not_called()

    def test_assignment_path_still_uses_shared_submission_workflow(self):
        request = self.factory.post('/', json.dumps({
            **self.payload, 'activityType': 'assignment', 'activityId': 'COMP-1',
        }), content_type='application/json')
        marker = RuntimeError('assignment workflow reached')
        with patch('learner_api.extra_activity_store.save_response') as native, \
             patch('learner_api.live_session_access.access_refusal', side_effect=marker):
            with self.assertRaisesRegex(RuntimeError, 'assignment workflow reached'):
                unwrap(_submit_reflection)(request)
        native.assert_not_called()

