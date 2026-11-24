from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid5, NAMESPACE_URL

from django.test import SimpleTestCase

from . import feedback


class FeedbackQualityTicketScoringTests(SimpleTestCase):
    def _response(self, *, delivery_id=None, delivery=None):
        return SimpleNamespace(
            status='completed', learner_id='7', delivery_id=delivery_id,
            delivery=delivery, started_at=None,
        )

    def _answer_manager(self, answers):
        manager = MagicMock()
        manager.filter.return_value.select_related.return_value = answers
        return manager

    def test_weighted_score_matches_feedback_classification_weights(self):
        high = SimpleNamespace(
            id=1, question_type='rating',
            config={'min': 1, 'max': 5, 'analytics': {
                'scoring': 'higher', 'importance': 'high', 'includeInOverall': True,
            }},
        )
        medium = SimpleNamespace(
            id=2, question_type='rating',
            config={'min': 1, 'max': 5, 'analytics': {
                'scoring': 'higher', 'importance': 'medium', 'includeInOverall': True,
            }},
        )
        answers = [
            SimpleNamespace(question=high, answer=3),
            SimpleNamespace(question=medium, answer=5),
        ]
        with patch.object(feedback.FeedbackAnswer, 'objects', self._answer_manager(answers)), \
             patch.object(feedback, '_selected_delivery_question_ids', return_value=None):
            self.assertEqual(feedback._feedback_response_score(self._response()), 70)

    def test_score_ignores_answers_outside_a_pinned_delivery_selection(self):
        selected = SimpleNamespace(
            id=1, question_type='rating',
            config={'min': 1, 'max': 5, 'analytics': {
                'scoring': 'higher', 'importance': 'medium', 'includeInOverall': True,
            }},
        )
        removed = SimpleNamespace(
            id=2, question_type='rating',
            config={'min': 1, 'max': 5, 'analytics': {
                'scoring': 'higher', 'importance': 'medium', 'includeInOverall': True,
            }},
        )
        answers = [
            SimpleNamespace(question=selected, answer=3),
            SimpleNamespace(question=removed, answer=5),
        ]
        response = self._response(delivery_id=11, delivery=SimpleNamespace())
        with patch.object(feedback.FeedbackAnswer, 'objects', self._answer_manager(answers)), \
             patch.object(feedback.FeedbackDeliveryRecipient.objects, 'filter') as recipients, \
             patch.object(feedback, '_selected_delivery_question_ids', return_value={1}):
            recipients.return_value.first.return_value = None
            self.assertEqual(feedback._feedback_response_score(response), 50)

    def test_positive_response_does_not_require_ticketing_connection(self):
        response_type = type('Response', (), {})
        response = response_type()
        response.status = 'completed'
        with patch.object(feedback, 'FeedbackResponse', response_type), \
             patch.object(feedback, '_feedback_response_score', return_value=90), \
             patch.object(feedback, 'connections', SimpleNamespace(databases={})):
            self.assertIsNone(feedback.ensure_quality_ticket_for_response(response))

    def test_negative_response_builds_a_quality_ticket_for_the_learner(self):
        response_type = type('Response', (), {})
        response = response_type()
        response.id = 42
        response.status = 'completed'
        response.learner_id = '7'
        response.enrolment_id = '7'
        response.learner_name = 'Example Learner'
        response.delivery = SimpleNamespace(session_title='Session 3', module_name='Module')
        response.form = SimpleNamespace(title='Lecture feedback')
        response.submitted_at = None
        learner_account = SimpleNamespace(subject_type='learner')
        with patch.object(feedback, 'FeedbackResponse', response_type), \
             patch.object(feedback, '_feedback_response_score', return_value=10), \
             patch.object(feedback, 'connections', SimpleNamespace(databases={'assistant_conversations': object()})), \
             patch.object(feedback, 'account_for_subject', return_value=learner_account), \
             patch.object(feedback.support_tickets, 'create_staff_ticket', return_value={'id': 'saved'}) as create:
            saved = feedback.ensure_quality_ticket_for_response(response)

        self.assertEqual(saved, {'id': 'saved'})
        kwargs = create.call_args.kwargs
        self.assertIs(kwargs['learner_account'], learner_account)
        self.assertEqual(kwargs['ticket']['id'], str(uuid5(NAMESPACE_URL, 'lms-feedback-quality:42')))
        self.assertEqual(kwargs['ticket']['category'], 'Learning Support')
        self.assertEqual(kwargs['ticket']['priority'], 'high')
        self.assertEqual(kwargs['actor_name'], 'Feedback automation')
