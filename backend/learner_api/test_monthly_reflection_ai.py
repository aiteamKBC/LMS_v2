import inspect
import json
from unittest import TestCase
from unittest.mock import MagicMock, patch
from django.test import RequestFactory, override_settings
from . import monthly_reflection_ai as ai

class MonthlyReflectionTests(TestCase):
    @override_settings(OPENAI_API_KEY='test', OPENAI_REFLECTION_MODEL='test')
    def test_impact_and_action_use_answer_and_selected_month_activities(self):
        for mode, fields in [('impact', ('careerImpact', 'jobImpact', 'employerImpact', 'businessImpact')),
                             ('action', ('actionPlan', 'epaPreparedness'))]:
            with self.subTest(mode=mode):
                client = MagicMock()
                client.responses.create.return_value.output_text = json.dumps({key: 'supported ' * 20 for key in fields})
                activity = {'date': '2026-09-12', 'title': 'Audience research',
                            'reflection': 'I practised grouping interview responses.', 'ksbs': ['K1']}
                request = RequestFactory().post('/', json.dumps({'learnerId': '1', 'mode': mode, 'context': {
                    'month': '2026-09', 'answer': 'My assignment answer', 'activities': [activity,
                        {**activity, 'date': '2026-08-12', 'title': 'Previous month'}]}}), content_type='application/json')
                with patch.object(ai, '_openai_client', return_value=client), patch.object(ai, '_moderation_flagged', return_value=False):
                    response = inspect.unwrap(ai.generate_monthly_reflections)(request)
                self.assertEqual(response.status_code, 200)
                messages = client.responses.create.call_args.kwargs['input']
                sent = json.loads(messages[1]['content'])
                self.assertEqual(sent['answer'], 'My assignment answer')
                self.assertEqual(sent['activities'], [activity])
                self.assertIn('assignment answer AND the supplied full-month activities', messages[0]['content'])
                self.assertIn('do not force a connection', messages[0]['content'])
                self.assertEqual(set(json.loads(response.content)), set(fields))

    @override_settings(OPENAI_API_KEY='test', OPENAI_REFLECTION_MODEL='test')
    def test_month_scope_and_minimum_words(self):
        client = MagicMock()
        text = 'supported ' * 20
        client.responses.create.return_value.output_text = json.dumps({'lmsReflection': text, 'integratedReflection': 'Too short'})
        request = RequestFactory().post('/', json.dumps({'learnerId': '1', 'context': {
            'month': '2026-09', 'answer': 'My answer', 'activities': [
                {'date': '2026-09-12', 'title': 'Current'}, {'date': '2026-08-12', 'title': 'Previous'}]}}), content_type='application/json')
        with patch.object(ai, '_openai_client', return_value=client), patch.object(ai, '_moderation_flagged', return_value=False):
            response = inspect.unwrap(ai.generate_monthly_reflections)(request)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content), {'lmsReflection': text.strip(), 'integratedReflection': ''})
        sent = json.loads(client.responses.create.call_args.kwargs['input'][1]['content'])
        self.assertEqual([a['title'] for a in sent['activities']], ['Current'])

    @override_settings(OPENAI_API_KEY='test', OPENAI_REFLECTION_MODEL='test')
    def test_reflections_combine_answer_with_specific_monthly_activity_evidence(self):
        client = MagicMock()
        client.responses.create.return_value.output_text = json.dumps({key: 'supported ' * 20 for key in ai.FIELDS})
        answer = 'In my assignment I compared approaches to planning a marketing campaign.'
        activity = {'date': '2026-09-12', 'title': 'Audience research workshop',
                    'reflection': 'I practised grouping interview responses but found ambiguous responses difficult.',
                    'ksbs': ['K1']}
        request = RequestFactory().post('/', json.dumps({'learnerId': '1', 'context': {
            'month': '2026-09', 'answer': answer, 'activities': [activity,
                {'date': '2026-08-12', 'title': 'Previous month', 'reflection': 'Unrelated learning'}]}}),
            content_type='application/json')
        with patch.object(ai, '_openai_client', return_value=client), patch.object(ai, '_moderation_flagged', return_value=False):
            response = inspect.unwrap(ai.generate_monthly_reflections)(request)
        self.assertEqual(response.status_code, 200)
        messages = client.responses.create.call_args.kwargs['input']
        sent = json.loads(messages[1]['content'])
        self.assertEqual(sent['answer'], answer)
        self.assertEqual(sent['activities'], [activity])
        prompt = messages[0]['content']
        self.assertIn('use BOTH sources in EACH reflection', prompt)
        self.assertIn('specific supplied activities by title', prompt)
        self.assertIn('do not force an unsupported connection', prompt)
        self.assertIn('without inventing the missing answer or activities', prompt)

    def test_empty_context_does_not_call_ai(self):
        request = RequestFactory().post('/', json.dumps({'context': {'month': '2026-09', 'activities': []}}), content_type='application/json')
        with patch.object(ai, '_openai_client') as client:
            response = inspect.unwrap(ai.generate_monthly_reflections)(request)
        self.assertEqual(response.status_code, 400)
        client.assert_not_called()

    @override_settings(OPENAI_API_KEY='test', OPENAI_REFLECTION_MODEL='test')
    def test_impact_mode_returns_only_impact_fields(self):
        client = MagicMock()
        fields = ('careerImpact', 'jobImpact', 'employerImpact', 'businessImpact')
        expected = {k: 'supported ' * 20 for k in fields}
        client.responses.create.return_value.output_text = json.dumps(expected)
        request = RequestFactory().post('/', json.dumps({'learnerId': '1', 'mode': 'impact', 'context': {
            'month': '2026-09', 'answer': 'I learned to plan tasks.'}}), content_type='application/json')
        with patch.object(ai, '_openai_client', return_value=client), patch.object(ai, '_moderation_flagged', return_value=False):
            response = inspect.unwrap(ai.generate_monthly_reflections)(request)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content), {k: v.strip() for k, v in expected.items()})
        prompt = client.responses.create.call_args.kwargs['input'][0]['content']
        self.assertIn('never as achieved results', prompt)

    @override_settings(OPENAI_API_KEY='test', OPENAI_REFLECTION_MODEL='test')
    def test_action_mode_filters_short_drafts_and_uses_action_schema(self):
        client = MagicMock()
        text = 'supported ' * 20
        client.responses.create.return_value.output_text = json.dumps({'actionPlan': text, 'epaPreparedness': 'Too short'})
        request = RequestFactory().post('/', json.dumps({'learnerId': '1', 'mode': 'action', 'context': {
            'month': '2026-09', 'answer': 'I need to improve planning.'}}), content_type='application/json')
        with patch.object(ai, '_openai_client', return_value=client), patch.object(ai, '_moderation_flagged', return_value=False):
            response = inspect.unwrap(ai.generate_monthly_reflections)(request)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content), {'actionPlan': text.strip(), 'epaPreparedness': ''})
        schema = client.responses.create.call_args.kwargs['text']['format']['schema']
        self.assertEqual(schema['required'], ['actionPlan', 'epaPreparedness'])
