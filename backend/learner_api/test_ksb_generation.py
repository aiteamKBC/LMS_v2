import inspect
import json
from unittest import TestCase
from unittest.mock import MagicMock, patch

from django.test import RequestFactory, override_settings
from . import ksb_generation


class KsbGenerationTests(TestCase):
    def test_evidence_is_scoped_to_owner_and_approved_files(self):
        cursor = MagicMock()
        cursor.fetchall.return_value = [('file1', 'report.txt', 'approved', 'blob')]
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor
        with patch.object(ksb_generation, 'connections', {'enrolment': connection}), patch(
            'learner_api.evidence_storage.download_blob_bytes', return_value=b'My project report'
        ):
            documents, notices = ksb_generation.evidence_context('commercial', '123', [
                {'id': 'file1'}, {'id': 'someone-elses-file'}, {'id': 'link:1'}])
        sql, params = cursor.execute.call_args.args
        self.assertIn('learner_kind = %s AND learner_id = %s AND status = %s', sql)
        self.assertEqual(params[:3], ['commercial', '123', 'approved'])
        self.assertEqual([d['id'] for d in documents], ['file1'])
        self.assertEqual(documents[0]['text'], 'My project report')
        self.assertTrue(any('unavailable' in n for n in notices))
        self.assertTrue(any('External links' in n for n in notices))

    @override_settings(OPENAI_API_KEY='test', OPENAI_REFLECTION_MODEL='test')
    def test_only_assigned_codes_and_read_evidence_are_returned(self):
        client = MagicMock()
        explanation = ' '.join(['supported'] * 20)
        client.responses.create.return_value.output_text = json.dumps({'claims': [
            {'code': 'K1', 'explanation': explanation, 'evidenceIds': ['file1', 'invented']},
            {'code': 'K2', 'explanation': 'Too short', 'evidenceIds': ['file1']},
            {'code': 'S9', 'explanation': explanation, 'evidenceIds': ['file1']},
        ]})
        request = RequestFactory().post('/', data=json.dumps({
            'learnerId': '123', 'learnerKind': 'commercial', 'activityId': 'a',
            'question': 'What did you learn?', 'answer': 'I planned the project.',
            'mappings': [{'code': 'K1'}, {'code': 'K2'}, {'code': 'S9'}], 'evidence': [{'id': 'file1'}],
        }), content_type='application/json')
        with patch('learner_api.components.component_ksb_codes', return_value=['K1', 'K2']), patch(
            'learner_api.reflection_ai._openai_client', return_value=client
        ), patch('learner_api.reflection_ai._moderation_flagged', return_value=False), patch.object(
            ksb_generation, 'evidence_context', return_value=([{'id': 'file1', 'text': 'Report'}], [])
        ):
            response = inspect.unwrap(ksb_generation.generate_ksb_explanations)(request)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content)['claims'], [
            {'code': 'K1', 'explanation': explanation, 'evidenceIds': ['file1']},
            {'code': 'K2', 'explanation': '', 'evidenceIds': []},
        ])
