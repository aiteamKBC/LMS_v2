"""History endpoint reads classification directly, without saved import rows."""
import json
from inspect import unwrap
from unittest.mock import patch
from django.test import RequestFactory, SimpleTestCase
from .reflection_submissions import get_reflection_submission, _submit_reflection
from .tests_legacy_assignments import source_row


class AssignmentHistoryTests(SimpleTestCase):
    def test_list_reads_classification_without_import(self):
        request = RequestFactory().get('/', {'learnerKind': 'commercial', 'learnerId': '125', 'view': 'assignments'})
        with patch('learner_api.legacy_assignments.classified_rows', return_value=[source_row()]) as read, \
             patch('learner_api.reflection_submissions.connections') as stored:
            response = unwrap(get_reflection_submission)(request)
        self.assertEqual(json.loads(response.content)['assignments'][0]['submissionOrigin'], 'classified_legacy')
        read.assert_called_once_with('commercial', '125', '')
        stored.__getitem__.assert_not_called()

    def test_detail_reads_classification_without_import(self):
        request = RequestFactory().get('/', {'learnerKind': 'commercial', 'learnerId': '125',
            'activityType': 'assignment', 'activityId': 'aptem:92:evidence:20128'})
        with patch('learner_api.legacy_assignments.classified_rows', return_value=[source_row()]), \
             patch('learner_api.assignment_content.load_assignment_content', return_value={'cards': [], 'notices': []}):
            response = unwrap(get_reflection_submission)(request)
        self.assertTrue(json.loads(response.content)['submission']['locked'])

    def test_post_cannot_create_or_overwrite_a_classified_assignment(self):
        request = RequestFactory().post('/', data=json.dumps({'learnerKind': 'commercial', 'learnerId': '125',
            'activityType': 'assignment', 'activityId': 'aptem:92:evidence:20128', 'submissionMode': 'draft'}), content_type='application/json')
        with patch('learner_api.reflection_submissions.connections') as stored:
            response = unwrap(_submit_reflection)(request)
        self.assertEqual(response.status_code, 409)
        stored.__getitem__.assert_not_called()
