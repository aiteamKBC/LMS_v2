"""Feedback analytics filtering without database or external effects."""
import json
from types import SimpleNamespace
from unittest import mock

from django.test import RequestFactory, SimpleTestCase

from . import feedback
from .tests import _account, _patched


class FeedbackAnalyticsTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()

    def test_filters_counts_and_ratings_by_feedback_type(self):
        form = SimpleNamespace(id=20, form_type='post_lecture', template_key='family-1')
        forms = mock.MagicMock()
        forms.filter.return_value = forms
        forms.values_list.return_value = ['family-1']
        forms.__iter__.return_value = iter([form])

        family_forms = mock.MagicMock()
        family_forms.values_list.return_value = [19, 20]

        responses = mock.MagicMock()
        scoped_responses = mock.MagicMock()
        responses.filter.return_value = scoped_responses
        scoped_responses.filter.side_effect = lambda **kwargs: SimpleNamespace(
            count=lambda: {'in_progress': 1, 'completed': 4}[kwargs['status']],
        )

        question = SimpleNamespace(
            id=7,
            question_text='How useful was this session?',
            config={'min': 1, 'max': 10},
            answers=SimpleNamespace(filter=lambda **_kwargs: [
                SimpleNamespace(answer=8), SimpleNamespace(answer=10),
            ]),
        )
        rating_questions = mock.MagicMock()
        rating_questions.filter.return_value = [question]

        with (
            _patched(_account(role='staff', subject_type='staff')),
            mock.patch.object(feedback, 'sync_module_feedback'),
            mock.patch.object(feedback, '_forms_queryset', return_value=forms),
            mock.patch.object(feedback, '_assigned_count', return_value=10),
            mock.patch.object(feedback.FeedbackForm.objects, 'filter', return_value=family_forms),
            mock.patch.object(feedback.FeedbackResponse.objects, 'all', return_value=responses),
            mock.patch.object(feedback.FeedbackQuestion.objects, 'filter', return_value=rating_questions),
        ):
            response = feedback.analytics(self.factory.get('/?formType=post_lecture'))

        self.assertEqual(response.status_code, 200)
        forms.filter.assert_called_with(form_type='post_lecture')
        responses.filter.assert_called_once_with(form_id__in=[19, 20])
        payload = json.loads(response.content)['analytics']
        self.assertEqual(payload['totalAssigned'], 10)
        self.assertEqual(payload['notStarted'], 5)
        self.assertEqual(payload['completionRate'], 40.0)
        self.assertEqual(payload['ratingAverages'], [{
            'questionId': 7,
            'question': 'How useful was this session?',
            'average': 9.0,
            'responses': 2,
            'min': 1,
            'max': 10,
        }])

    def test_rejects_unknown_feedback_type_before_querying_forms(self):
        with (
            _patched(_account(role='staff', subject_type='staff')),
            mock.patch.object(feedback, 'sync_module_feedback'),
            mock.patch.object(feedback, '_forms_queryset') as forms,
        ):
            response = feedback.analytics(self.factory.get('/?formType=unknown'))

        self.assertEqual(response.status_code, 400)
        forms.assert_not_called()
