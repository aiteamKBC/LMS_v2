"""Real checkpoint persistence against the explicitly isolated timing runner."""
import json
import unittest
import importlib
from datetime import datetime, timedelta, timezone as dt_timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch, MagicMock

from django.test import RequestFactory
from django.http import JsonResponse
from django.db import connections
from django.db.migrations.state import ProjectState
from . import time_tracking as timing
from .timing_drafts import ActivityTimingDraft, checkpoint, read_evidence, LEASE_MS
from engagement_api import shared_rewards
from engagement_api.segment_rules import RewardError


class TimingMigrationTargetTests(unittest.TestCase):
    def setUp(self):
        self.migration = importlib.import_module('learner_api.migrations.0024_activity_timing_drafts')
        self.config = {'ENGINE': 'django.db.backends.postgresql', 'NAME': 'synthetic_timing',
                       'HOST': 'localhost', 'USER': 'synthetic_owner', 'PORT': ''}

    def install(self, primary_config, learner_config):
        primary = SimpleNamespace(alias='default', vendor='postgresql', settings_dict=primary_config)
        learner = SimpleNamespace(vendor='postgresql', settings_dict=learner_config)
        editor = SimpleNamespace(connection=primary, create_model=MagicMock())
        apps = MagicMock()
        with patch.object(self.migration, 'connections', {'enrolment': learner}):
            self.migration.install(apps, editor)
        editor.create_model.assert_called_once_with(apps.get_model.return_value)

    def test_migration_accepts_omitted_and_explicit_default_postgres_port(self):
        for primary_port, learner_port in (('5432', ''), ('', '5432'), (5432, None)):
            with self.subTest(primary_port=primary_port, learner_port=learner_port):
                self.install({**self.config, 'PORT': primary_port}, {**self.config, 'PORT': learner_port})

    def test_migration_rejects_a_different_database_host_user_engine_or_port(self):
        for change in ({'PORT': '5433'}, {'NAME': 'other_database'}, {'HOST': 'other-host'},
                       {'USER': 'other_owner'}, {'ENGINE': 'django.db.backends.mysql'}):
            with self.subTest(change=change):
                primary = SimpleNamespace(alias='default', vendor='postgresql', settings_dict=self.config)
                learner = SimpleNamespace(vendor='postgresql', settings_dict={**self.config, **change})
                editor = SimpleNamespace(connection=primary, create_model=MagicMock())
                with patch.object(self.migration, 'connections', {'enrolment': learner}):
                    with self.assertRaisesRegex(RuntimeError, 'same database'):
                        self.migration.install(MagicMock(), editor)
                editor.create_model.assert_not_called()


class TimingDraftTests(unittest.TestCase):
    def setUp(self):
        ActivityTimingDraft.objects.using('enrolment').all().delete()
        self.now = datetime(2026, 10, 1, 10, tzinfo=dt_timezone.utc)
        self.clock = patch('django.utils.timezone.now', side_effect=lambda: self.now)
        self.clock.start()
        self.addCleanup(self.clock.stop)
        self.signing_clock = patch('django.core.signing.time.time', side_effect=lambda: self.now.timestamp())
        self.signing_clock.start()
        self.addCleanup(self.signing_clock.stop)
        self.used = patch.object(timing, 'tracking_session_already_used', return_value=False)
        self.used_mock = self.used.start()
        self.addCleanup(self.used.stop)
        self.identity = dict(activity_kind='component', activity_id='READ-1', learner_kind='commercial', learner_id='7')

    def start(self, persistent=True):
        return timing.issue_tracking_session(**self.identity, counting_mode='visible_page', persistent=persistent)

    def save(self, session, seconds=300, **identity):
        return checkpoint(session['trackingToken'], **{**self.identity, **identity}, seconds=seconds)

    def verify(self, session, seconds=300):
        return timing.verify_tracking_session(session['trackingToken'], **self.identity, claimed_seconds=seconds)

    def test_resume_two_days_later_preserves_identity_and_excludes_unleased_gap(self):
        session = self.start()
        self.now += timedelta(minutes=5)
        self.save(session)
        self.now += timedelta(days=2)
        with self.assertRaises(timing.TrackingSessionError):
            self.verify(session)
        resumed = self.save(session, 250)
        self.assertEqual(resumed['trackingToken'], session['trackingToken'])
        self.assertEqual(resumed['sessionId'], session['sessionId'])
        self.assertEqual(resumed['savedSeconds'], 300)
        evidence = self.verify(resumed, 999999)
        self.assertEqual(evidence['serverSessionSeconds'], 86400 + 300)
        self.assertEqual(len(evidence['trackingWindows']), 2)
        self.now += timedelta(seconds=20)
        self.assertEqual(self.verify(resumed, 320)['verifiedSeconds'], 320)

    def test_expired_legacy_draft_requires_explicit_authenticated_checkpoint(self):
        session = self.start(False)
        self.now += timedelta(days=3)
        with self.assertRaises(timing.TrackingSessionError) as caught:
            self.verify(session)
        self.assertEqual(caught.exception.code, 'expired_tracking_session')
        resumed = self.save(session, 600)
        self.assertEqual(resumed['savedSeconds'], 600)
        self.assertEqual(self.verify(resumed, 600)['verifiedSeconds'], 600)
        self.assertEqual(self.verify(resumed, 999999)['serverSessionSeconds'], 86400)

    def test_retries_and_older_tabs_do_not_double_count_or_reduce_checkpoint(self):
        session = self.start()
        self.now += timedelta(minutes=10)
        for amount in (300, 300, 600, 200):
            self.save(session, amount)
        self.assertEqual(ActivityTimingDraft.objects.using('enrolment').count(), 1)
        self.assertEqual(self.save(session, 0)['savedSeconds'], 600)

    def test_other_learner_activity_kind_or_tampered_token_cannot_recover(self):
        session = self.start()
        self.now += timedelta(days=2)
        for identity in ({'learner_id': '8'}, {'learner_kind': 'apprenticeship'},
                         {'activity_id': 'READ-2'}, {'activity_kind': 'video'}):
            with self.subTest(identity=identity), self.assertRaises(timing.TrackingSessionError):
                self.save(session, **identity)
        with self.assertRaises(timing.TrackingSessionError):
            self.save({**session, 'trackingToken': session['trackingToken'] + 'x'})
        self.assertEqual(ActivityTimingDraft.objects.using('enrolment').get().elapsed_seconds, 0)

    def test_completed_session_cannot_be_renewed(self):
        session = self.start()
        self.used_mock.return_value = True
        with self.assertRaises(timing.TrackingSessionError) as caught:
            self.save(session)
        self.assertEqual(caught.exception.code, 'tracking_session_used')
        self.assertEqual(ActivityTimingDraft.objects.using('enrolment').get().elapsed_seconds, 0)

    def test_commercial_and_apprenticeship_drafts_remain_separate(self):
        commercial = self.start()
        self.identity['learner_kind'] = 'apprenticeship'
        apprentice = self.start()
        self.save(apprentice, 200)
        self.identity['learner_kind'] = 'commercial'
        self.assertEqual(self.save(commercial, 100)['savedSeconds'], 100)
        self.assertEqual(ActivityTimingDraft.objects.using('enrolment').count(), 2)

    def test_reward_intervals_in_expired_gap_are_rejected_before_any_award_write(self):
        session = self.start()
        self.now += timedelta(days=3)
        self.save(session)
        tracking = self.verify(session)
        with patch.object(shared_rewards, '_active'), self.assertRaises(RewardError) as caught:
            shared_rewards.record_observations(learner_id='7', profile_id=7,
                component={'moduleId': 'M1'}, tracking=tracking, token=session['trackingToken'],
                event_id='event-1', sequence=1,
                observed_intervals=[{'startOffsetMs': LEASE_MS + 1000, 'endOffsetMs': LEASE_MS + 2000}])
        self.assertEqual(caught.exception.code, 'observation_outside_timing_lease')

    def test_wrong_learner_request_is_denied_by_endpoint_before_storage(self):
        session = self.start()
        request = RequestFactory().post('/checkpoint/?kind=commercial&learnerId=8', data=json.dumps({
            'activityKind': 'component', 'activityId': 'READ-1', 'trackingToken': session['trackingToken'], 'elapsedSeconds': 300,
        }), content_type='application/json')
        account = SimpleNamespace(role='learner', subject_type='learner', subject_id=7, learner_record_id=None)
        with patch('login.permissions.authenticate_request', return_value=account):
            response = timing.checkpoint_time_tracking(request)
        self.assertEqual(response.status_code, 404)
        self.assertEqual(ActivityTimingDraft.objects.using('enrolment').get().elapsed_seconds, 0)

    def test_invalid_and_negative_checkpoint_values_are_rejected(self):
        session = self.start()
        for amount in (-1, float('inf'), 'bad', 2**31):
            with self.subTest(amount=amount), self.assertRaises(timing.TrackingSessionError):
                self.save(session, amount)

    def test_authenticated_owner_can_restore_but_anonymous_and_unrelated_staff_cannot(self):
        session = self.start()
        self.now += timedelta(days=2)
        request = RequestFactory().post('/checkpoint/?kind=commercial&learnerId=7', data=json.dumps({
            'activityKind': 'component', 'activityId': 'READ-1', 'trackingToken': session['trackingToken'], 'elapsedSeconds': 300,
        }), content_type='application/json')
        owner = SimpleNamespace(role='learner', subject_id=7)
        with patch('login.permissions.authenticate_request', return_value=owner):
            response = timing.checkpoint_time_tracking(request)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content)['savedSeconds'], 300)
        with patch('login.permissions.authenticate_request', return_value=None), \
                patch('login.permissions.session_unreadable', return_value=False):
            self.assertEqual(timing.checkpoint_time_tracking(request).status_code, 401)
        with patch('login.permissions.authenticate_request', return_value=SimpleNamespace(role='staff')), \
                patch('login.permissions.coach_owns_learner', return_value=False), \
                patch('login.permissions.staff_owns_learner', return_value=False):
            self.assertEqual(timing.checkpoint_time_tracking(request).status_code, 403)

    def test_renewed_reward_upload_accepts_original_offsets_and_keeps_duplicate_receipt(self):
        session = self.start()
        original_start = self.now
        self.now += timedelta(days=2)
        self.save(session)
        self.now += timedelta(seconds=2)
        tracking = {**self.verify(session), 'learnerKind': 'commercial', 'activityKind': 'component', 'activityId': 'READ-1'}
        offsets = [[172800000, 172802000]]
        stored = dict(learner_id='7', profile_id=7, component_id='READ-1', module_id='M1',
                      activity_kind='component', activity_id='READ-1', counting_mode='visible_page',
                      started_at=original_start, token_sha256=shared_rewards.hashlib.sha256(session['trackingToken'].encode()).hexdigest(),
                      expires_at=original_start+timedelta(days=1))
        receipt = {'event_id': 'event-1', 'session_id': session['sessionId'], 'sequence': 1,
                   'payload_sha256': shared_rewards.digest([session['sessionId'], 1, offsets]), 'observed_ms': 2000}
        conn = MagicMock()
        cursor = conn.cursor.return_value.__enter__.return_value
        # PostgreSQL SUM(bigint) returns numeric, adapted as Decimal.
        cursor.fetchone.return_value = [Decimal('2000')]
        with patch.object(shared_rewards, '_active'), patch.object(shared_rewards, '_wallet_lock'), \
                patch('engagement_api.learning_policy.ensure_module'), patch.object(shared_rewards, 'policy', return_value={'starts_at': original_start}), \
                patch.object(shared_rewards, 'connections', {'default': conn}), patch.object(shared_rewards, '_one', return_value=stored), \
                patch.object(shared_rewards, '_all', return_value=[receipt]):
            result = shared_rewards.record_observations(learner_id='7', profile_id=7, component={
                'moduleId': 'M1', 'componentId': 'READ-1', 'weekId': 'W1'}, tracking=tracking, token=session['trackingToken'],
                event_id='event-1', sequence=1, observed_intervals=[{'startOffsetMs': offsets[0][0], 'endOffsetMs': offsets[0][1]}])
        self.assertTrue(result['duplicate'])
        self.assertEqual(result['observedMilliseconds'], 2000)
        self.assertEqual(result['cumulativeObservedMilliseconds'], 2000)
        payload = json.loads(JsonResponse(result).content)
        self.assertIs(type(payload['cumulativeObservedMilliseconds']), int)
        self.assertEqual(payload, {
            'source': 'lms', 'eventId': 'event-1', 'sessionId': session['sessionId'],
            'sequence': 1, 'status': 'pending', 'observedMilliseconds': 2000,
            'cumulativeObservedMilliseconds': 2000, 'duplicate': True,
        })
        self.assertFalse(any('INSERT INTO "Engagement".shared_reward_observations' in call.args[0] for call in cursor.execute.call_args_list))
        cursor.execute.assert_any_call('UPDATE "Engagement".shared_reward_sessions SET expires_at=%s WHERE session_id=%s',
                                       [tracking['trackingExpiresAt'], session['sessionId']])

    def test_migration_creates_checkpoint_table_and_router_allows_only_canonical_install(self):
        migration = importlib.import_module('learner_api.migrations.0024_activity_timing_drafts')
        from .routers import EnrolmentRouter
        router = EnrolmentRouter()
        self.assertTrue(router.allow_migrate('default', 'learner_api', learner_schema_migration=True))
        self.assertFalse(router.allow_migrate('enrolment', 'learner_api', learner_schema_migration=True))
        state = ProjectState()
        migration.Migration.operations[0].state_forwards('learner_api', state)
        with connections['default'].schema_editor() as editor:
            migration.install(state.apps, editor)
        try:
            self.assertEqual(ActivityTimingDraft.objects.using('default').count(), 0)
        finally:
            with connections['default'].schema_editor() as editor:
                editor.delete_model(ActivityTimingDraft)
