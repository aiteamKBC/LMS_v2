"""Batch summary equivalence and bounded query contracts; no live databases."""
from types import SimpleNamespace as Row
from unittest.mock import MagicMock, patch
import json

from django.test import RequestFactory, SimpleTestCase

from . import feedback, form_reporting as reporting


def aggregate(rows):
    manager = MagicMock()
    manager.filter.return_value.order_by.return_value.values.return_value.annotate.return_value.values_list.return_value = rows
    return manager


class FormReportingTests(SimpleTestCase):
    def test_families_manual_deduplication_employer_counts_event_distinctness_and_version_history(self):
        forms = [Row(id=2, template_key='a', form_type='post_lecture'),
                 Row(id=4, template_key='b', form_type='post_progress_review_employer'),
                 Row(id=5, template_key='c', form_type='general'), Row(id=6, template_key='d', form_type='post_event')]
        family = MagicMock()
        family.filter.return_value.values_list.return_value = [(1, 'a'), (2, 'a'), (3, 'b'), (4, 'b')]
        assignments = MagicMock()
        assignments.filter.return_value.values_list.return_value = [
            (1, 'learner', 7), (2, 'learner', 7), (2, 'learner', 8),
            (5, 'all_learners', None), (5, 'learner', 7), (6, 'all_learners', None),
            (2, 'unsupported', 999),
        ]
        recipients = aggregate([(1, 3), (2, 4), (4, 2), (5, 1)])
        reviews = aggregate([(1, 3), (5, 2)])
        employers = aggregate([(3, 1), (4, 2)])
        events = aggregate([(6, 7)])
        deliveries = MagicMock()
        deliveries.filter.return_value.order_by.return_value.values_list.return_value.distinct.return_value = [1]
        responses = MagicMock()
        responses.filter.return_value.order_by.return_value.values.return_value.annotate.return_value = [
            {'form_id': 1, 'started': 4, 'completed': 3}, {'form_id': 4, 'started': 2, 'completed': 1},
        ]
        learners = MagicMock()
        learners.count.return_value = 100
        with patch.object(reporting.FeedbackForm, 'objects', family), patch.object(reporting.FeedbackAssignment, 'objects', assignments), \
             patch.object(reporting.FeedbackDeliveryRecipient, 'objects', recipients), patch.object(reporting.FeedbackReviewDelivery, 'objects', reviews), \
             patch.object(reporting.FeedbackEmployerReviewDelivery, 'objects', employers), patch.object(reporting.FeedbackDelivery, 'objects', deliveries), \
             patch.object(reporting.FeedbackResponse, 'objects', responses), patch.object(reporting.FeedbackEventRecipient, 'objects', events), \
             patch.object(reporting.EnrolmentUser, 'all_learners', learners):
            result = reporting.form_report_counts(forms, versioned_types=feedback.VERSIONED_FORM_TYPES, employer_type=feedback.EMPLOYER_REVIEW_FORM_TYPE)
        self.assertEqual(result[2], {'assigned': 12, 'started': 4, 'completed': 3, 'history': False})
        self.assertEqual(result[4], {'assigned': 5, 'started': 2, 'completed': 1, 'history': True})
        self.assertEqual(result[5]['assigned'], 103)
        self.assertEqual(result[6]['assigned'], 7)
        learners.count.assert_called_once()
        self.assertTrue(recipients.filter.call_args.kwargs['revoked_at__isnull'])
        self.assertEqual(events.filter.call_args.kwargs['event__feedback_campaigns__status'], 'open')
        for manager in (family, assignments, recipients, reviews, employers, deliveries, responses, events):
            manager.filter.assert_called_once()  # Queries do not grow per form.

    def test_empty_form_selection_does_not_query_storage(self):
        with patch.object(reporting.FeedbackForm, 'objects') as manager:
            self.assertEqual(reporting.form_report_counts([], versioned_types=set(), employer_type='employer'), {})
            manager.filter.assert_not_called()

    def test_legacy_rating_averages_use_one_answer_read_and_preserve_numeric_semantics(self):
        questions = [Row(id=1, question_text='First', config={}), Row(id=2, question_text='Second', config={'min': 0, 'max': 10}), Row(id=3, question_text='Empty', config={})]
        query = MagicMock()
        query.filter.return_value = query
        query.count.return_value = 0
        answers = MagicMock()
        answers.values_list.return_value = [(1, 1), (1, 5), (1, '4'), (1, None), (2, True), (2, 3)]
        with patch.object(feedback, 'sync_module_feedback'), patch.object(feedback, '_forms_queryset', return_value=[]), \
             patch.object(feedback.FeedbackResponse.objects, 'all', return_value=query), \
             patch.object(feedback.FeedbackQuestion.objects, 'filter', return_value=questions), \
             patch.object(feedback.FeedbackAnswer.objects, 'filter', return_value=answers) as read, \
             patch.object(feedback, 'question_analytics', return_value={}), patch.object(feedback, 'lecture_analytics_options', return_value=[]):
            result = json.loads(feedback.analytics.__wrapped__(RequestFactory().get('/')).content)['analytics']
        self.assertEqual(result['ratingAverages'], [
            {'questionId': 1, 'question': 'First', 'average': 3.0, 'responses': 2, 'min': 1, 'max': 5},
            {'questionId': 2, 'question': 'Second', 'average': 2.0, 'responses': 2, 'min': 0, 'max': 10},
        ])
        read.assert_called_once_with(question_id__in=[1, 2, 3], response__status='completed')
