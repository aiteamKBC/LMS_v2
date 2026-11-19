import json
from types import SimpleNamespace
from unittest import mock

from django.test import RequestFactory, TestCase

from .feedback_findings import feedback_finding_detail, feedback_findings, _source_rows
from .models import FeedbackFindingState


NEGATIVE = {
    'responseId': 11, 'formId': 4, 'formTitle': 'Session feedback', 'formType': 'post_lecture',
    'contextTitle': 'Synthetic session', 'classification': 'negative', 'respondent': 'Synthetic learner',
    'groupName': 'Synthetic group', 'submittedAt': '2026-10-20T10:00:00Z', 'score': 25,
}
NEUTRAL = {**NEGATIVE, 'responseId': 12, 'classification': 'neutral', 'score': 60}


class FeedbackFindingTests(TestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.account = SimpleNamespace(role='staff', display_name='Synthetic QA')
        self.auth = mock.patch('login.permissions.authenticate_request', return_value=self.account)
        self.auth.start()
        self.addCleanup(self.auth.stop)
        self.source = mock.patch('qms_api.feedback_findings._source_rows', return_value={11: NEGATIVE, 12: NEUTRAL})
        self.source.start()
        self.addCleanup(self.source.stop)

    def test_live_source_selects_neutral_and_negative_without_test_forms(self):
        report = {'insights': {'classification': {'responses': [NEGATIVE, NEUTRAL, {**NEGATIVE, 'responseId': 13, 'classification': 'positive'}]}}}
        with mock.patch('qms_api.feedback_findings.question_analytics', return_value=report) as analytics:
            self.assertEqual(set(_source_rows()), {11, 12})
        self.assertTrue(analytics.call_args.kwargs['excluded_form_title_pattern'])
        self.assertTrue(analytics.call_args.kwargs['dashboard'])

    def test_list_is_read_only_and_shows_one_finding_per_response(self):
        response = feedback_findings(self.factory.get('/qms_api/feedback-findings/'))
        self.assertEqual(response.status_code, 200)
        findings = json.loads(response.content)['findings']
        self.assertEqual([(row['id'], row['severity'], row['status']) for row in findings],
                         [(11, 'Critical', 'Open'), (12, 'Major', 'Open')])
        self.assertFalse(FeedbackFindingState.objects.exists())

    def test_details_and_status_persist_with_version_and_valid_transitions(self):
        def patch(body):
            request = self.factory.patch('/qms_api/feedback-findings/11/', json.dumps(body), content_type='application/json')
            request.login_account = self.account
            return feedback_finding_detail(request, 11)

        self.assertEqual(patch({'expectedVersion': 0, 'status': 'Resolved'}).status_code, 409)
        self.assertFalse(FeedbackFindingState.objects.exists())
        self.assertEqual(patch({'expectedVersion': 0, 'status': 'In Progress', 'actionPlan': 'Review answers'}).status_code, 200)
        self.assertEqual(patch({'expectedVersion': 0, 'status': 'Resolved'}).status_code, 409)
        self.assertEqual(patch({'expectedVersion': 1, 'owner': 'QA staff', 'dueDate': '2026-12-01'}).status_code, 200)
        self.assertEqual(patch({'expectedVersion': 2, 'status': 'Resolved'}).status_code, 200)
        state = FeedbackFindingState.objects.get(response_id=11)
        self.assertEqual((state.status, state.action_plan, state.owner, state.version),
                         ('Resolved', 'Review answers', 'QA staff', 3))
        self.assertEqual(state.due_date.isoformat(), '2026-12-01')
        self.assertEqual(json.loads(feedback_findings(self.factory.get('/qms_api/feedback-findings/')).content)['findings'][0]['status'], 'Resolved')

    def test_invalid_payload_and_missing_source_do_not_change_state(self):
        request = self.factory.patch('/qms_api/feedback-findings/11/', json.dumps({'expectedVersion': 0, 'status': 'Closed'}), content_type='application/json')
        self.assertEqual(feedback_finding_detail(request, 11).status_code, 400)
        request = self.factory.patch('/qms_api/feedback-findings/11/', json.dumps({'expectedVersion': 0, 'dueDate': '2026-02-30'}), content_type='application/json')
        self.assertEqual(feedback_finding_detail(request, 11).status_code, 400)
        self.assertEqual(feedback_finding_detail(request, 99).status_code, 404)
        self.assertFalse(FeedbackFindingState.objects.exists())

    def test_learner_cannot_read_or_update(self):
        with mock.patch('login.permissions.authenticate_request', return_value=SimpleNamespace(role='learner')):
            self.assertEqual(feedback_findings(self.factory.get('/qms_api/feedback-findings/')).status_code, 403)
            request = self.factory.patch('/qms_api/feedback-findings/11/', '{}', content_type='application/json')
            self.assertEqual(feedback_finding_detail(request, 11).status_code, 403)
