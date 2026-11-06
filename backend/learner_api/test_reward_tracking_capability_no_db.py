"""Saved study sessions must follow current reward availability, without new awards."""
from datetime import timedelta
import json
from types import SimpleNamespace
from unittest.mock import patch

from django.test import RequestFactory, SimpleTestCase, override_settings
from django.utils import timezone

from . import reward_tracking, time_tracking


class RewardTrackingCapabilityTests(SimpleTestCase):
    @override_settings(KBC_SHARED_REWARDS_READY=True)
    def test_future_reward_policy_does_not_advertise_observation_support(self):
        now = timezone.now()
        with patch('login.sessions.authenticate_request', return_value=SimpleNamespace(role='learner')), \
             patch.object(reward_tracking.mobile, '_context', return_value=()), \
             patch.object(reward_tracking, 'resolve', return_value={'moduleId': 'synthetic-module'}), \
             patch.object(reward_tracking, 'connections') as connections, \
             patch.object(reward_tracking, 'policy', return_value={
                 'enabled': True, 'starts_at': now + timedelta(days=1),
             }), patch.object(reward_tracking.timezone, 'now', return_value=now):
            self.assertFalse(reward_tracking.capability(SimpleNamespace(), 'video', 'synthetic-video'))
        connections.__getitem__.assert_called_once_with('default')

    def checkpoint(self, *, learner_kind='apprenticeship', subject_id=12, enabled=False, error=None):
        request = RequestFactory().post(
            f'/?kind={learner_kind}&learnerId=12',
            json.dumps({'trackingToken': 'same-signed-token', 'activityKind': 'video',
                        'activityId': 'synthetic-video', 'elapsedSeconds': 300}),
            content_type='application/json',
        )
        saved = {'trackingToken': 'same-signed-token', 'sessionId': 'same-session',
                 'startedAt': '2026-11-06T10:00:00Z', 'countingMode': 'active_playback',
                 'persistent': True, 'savedSeconds': 300, 'elapsedMilliseconds': 300000}
        with patch('login.permissions._auth_gate_enabled', return_value=True), \
             patch('login.permissions.authenticate_request', return_value=SimpleNamespace(role='learner', subject_id=subject_id)), \
             patch('learner_api.timing_drafts.checkpoint', return_value=dict(saved), side_effect=error) as store, \
             patch.object(reward_tracking, 'capability', return_value=enabled) as capability:
            response = time_tracking.checkpoint_time_tracking(request)
        return response, store, capability, saved

    def test_checkpoint_rechecks_disabled_rewards_for_both_learner_types(self):
        for kind in ('commercial', 'apprenticeship'):
            with self.subTest(kind=kind):
                response, store, capability, saved = self.checkpoint(learner_kind=kind)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(json.loads(response.content), {**saved, 'rewardTracking': False})
                capability.assert_called_once()
                store.assert_called_once_with('same-signed-token', activity_kind='video',
                    activity_id='synthetic-video', learner_kind=kind, learner_id='12', seconds=300)

    def test_checkpoint_preserves_enabled_reward_tracking(self):
        response, _, capability, saved = self.checkpoint(enabled=True)
        self.assertEqual(json.loads(response.content), {**saved, 'rewardTracking': True})
        capability.assert_called_once()

    def test_other_learner_cannot_checkpoint_or_read_reward_availability(self):
        response, store, capability, _ = self.checkpoint(subject_id=13)
        self.assertEqual(response.status_code, 404)
        store.assert_not_called()
        capability.assert_not_called()

    def test_invalid_signed_time_is_still_rejected_before_reward_refresh(self):
        response, store, capability, _ = self.checkpoint(error=time_tracking.TrackingSessionError('Invalid signed time.'))
        self.assertEqual(response.status_code, 400)
        self.assertEqual(json.loads(response.content)['error'], 'Invalid signed time.')
        store.assert_called_once()
        capability.assert_not_called()

    @override_settings(KBC_SHARED_REWARDS_READY=False)
    def test_disabled_global_flag_never_queries_reward_tables(self):
        with patch.object(reward_tracking, 'connections') as connections:
            self.assertFalse(reward_tracking.capability(SimpleNamespace(), 'video', 'synthetic-video'))
        connections.__getitem__.assert_not_called()
