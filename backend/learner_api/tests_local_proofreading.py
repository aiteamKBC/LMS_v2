"""No database, downloaded model or external API needed."""
import json
from unittest.mock import patch
from django.test import SimpleTestCase, RequestFactory, override_settings
from .reflection_ai import proofread_reflection


@override_settings(PROOFREAD_PROVIDER='ollama', OLLAMA_PROOFREAD_MODEL='qwen2.5:1.5b', OPENAI_API_KEY='')
class LocalProofreadingTests(SimpleTestCase):
    def request(self, payload=None):
        return proofread_reflection(RequestFactory().post('/proofread/', data=json.dumps(payload or {
            'text': 'I learned to plan my work.', 'minimumWords': 20, 'onePointPerLine': True,
        }), content_type='application/json'))

    @patch('learner_api.reflection_ai._openai_client')
    @patch('learner_api.local_proofreading.proofread')
    def test_local_result_without_cloud_key_or_client(self, local, cloud):
        local.return_value = {'accepted': True, 'improved_text': 'I learned to plan my work.', 'reason': ''}
        result = self.request()
        self.assertEqual(result.status_code, 200)
        self.assertEqual(json.loads(result.content)['provider'], 'ollama')
        self.assertIn('20 whitespace-separated words', local.call_args.args[0][0]['content'])
        self.assertIn('own line', local.call_args.args[0][0]['content'])
        cloud.assert_not_called()

    @patch('learner_api.reflection_ai._openai_client')
    @patch('learner_api.local_proofreading.proofread', side_effect=TimeoutError)
    def test_local_failure_never_falls_back_to_paid_api(self, local, cloud):
        with self.assertLogs('learner_api.reflection_ai', level='ERROR'):
            self.assertEqual(self.request().status_code, 502)
        cloud.assert_not_called()

    @patch('learner_api.local_proofreading.proofread')
    def test_rejected_placeholder_returns_reason(self, local):
        local.return_value = {'accepted': False, 'improved_text': '', 'reason': 'Please describe your learning.'}
        result = self.request()
        self.assertEqual(result.status_code, 422)
        self.assertEqual(json.loads(result.content)['error'], 'Please describe your learning.')

    @patch('learner_api.local_proofreading.proofread')
    def test_invalid_requirements_do_not_run_model(self, local):
        self.assertEqual(self.request({'text': 'Hello', 'minimumWords': -1}).status_code, 400)
        local.assert_not_called()
