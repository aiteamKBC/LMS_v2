"""Rewards read isolation; SimpleTestCase forbids all database access."""
import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.db import DatabaseError
from django.test import SimpleTestCase, RequestFactory
from .rewards_summary import learner_rewards_summary


class RewardsSummaryTests(SimpleTestCase):
    def test_reads_the_url_learner_authoritative_balance_and_only_available_rewards(self):
        model = MagicMock()
        reward = SimpleNamespace(pk=1, name='Book voucher', description='Read something new', points=300, category='Learning', stock=5, total_claimed=2)
        with patch.dict('learner_api.rewards_summary.SOURCE_MODELS', {'commercial': model}), \
             patch('learner_api.rewards_summary.points_summary', return_value={'learnerId': '125', 'earned': 400, 'committed': 150, 'balance': 250}) as summary, \
             patch('learner_api.rewards_summary.Reward') as rewards:
            rewards.objects.filter.return_value.order_by.return_value.__getitem__.return_value = [reward]
            response = learner_rewards_summary.__wrapped__.__wrapped__(RequestFactory().get('/?learnerId=999'), 'commercial', 125)
        model.all_learners.filter.assert_called_once_with(pk=125)
        summary.assert_called_once_with('125')
        self.assertTrue(rewards.objects.filter.call_args.kwargs['active'])
        self.assertIn('stock__gt', rewards.objects.filter.call_args.kwargs)
        self.assertEqual(json.loads(response.content)['rewards'][0]['remaining'], 3)
        self.assertEqual(response['Cache-Control'], 'private, no-store')

    def test_unknown_learner_never_reads_points(self):
        model = MagicMock()
        model.all_learners.filter.return_value.exists.return_value = False
        with patch.dict('learner_api.rewards_summary.SOURCE_MODELS', {'commercial': model}), patch('learner_api.rewards_summary.points_summary') as summary:
            response = learner_rewards_summary.__wrapped__.__wrapped__(RequestFactory().get('/'), 'commercial', 125)
        self.assertEqual(response.status_code, 404)
        summary.assert_not_called()

    def test_other_learner_cannot_read_a_balance(self):
        account = SimpleNamespace(role='learner', subject_type='learner', subject_id=999)
        with patch.dict('os.environ', {'LEARNER_API_REQUIRE_AUTH': '1'}), \
             patch('login.permissions.authenticate_request', return_value=account), \
             patch('learner_api.rewards_summary.points_summary') as summary:
            response = learner_rewards_summary(RequestFactory().get('/'), kind='commercial', pk=125)
        self.assertEqual(response.status_code, 404)
        summary.assert_not_called()

    def test_rejects_writes_before_reading_any_data(self):
        with patch('learner_api.rewards_summary.points_summary') as summary:
            response = learner_rewards_summary(RequestFactory().post('/'), 'commercial', 125)
        self.assertEqual(response.status_code, 405)
        summary.assert_not_called()

    def test_database_errors_are_retryable_without_exposing_sql(self):
        model = MagicMock()
        with patch.dict('learner_api.rewards_summary.SOURCE_MODELS', {'commercial': model}), \
             patch('learner_api.rewards_summary.points_summary', side_effect=DatabaseError('private SQL')):
            response = learner_rewards_summary.__wrapped__.__wrapped__(RequestFactory().get('/'), 'commercial', 125)
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('private SQL', response.content.decode())
