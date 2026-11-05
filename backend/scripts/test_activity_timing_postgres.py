"""Timing/reward integration on a verified, empty, disposable PostgreSQL database.

Run with --connection-file <private JSON> --data-directory <local cluster path>.
JSON keys: host, port, dbname, user, password. No .env/application settings load.
The database name must start with kbc_timing_test_. Existing tables are refused.
Creates synthetic fixtures and applies the actual timing migration; does not
run historical LMS migrations, application startup repair hooks or live services.
"""
import argparse
import importlib
import json
from pathlib import Path
import socket
import sys
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--connection-file', type=Path, required=True)
parser.add_argument('--data-directory', type=Path, required=True)
args = parser.parse_args()
cfg = json.loads(args.connection_file.read_text(encoding='utf-8-sig'))
if cfg.get('host') != '127.0.0.1' or not str(cfg.get('dbname', '')).startswith('kbc_timing_test_'):
    raise RuntimeError('Only a disposable timing database on 127.0.0.1 is permitted.')

from django.apps import AppConfig
from django.conf import settings


class LearnerTestsConfig(AppConfig):
    name = 'learner_api'


class LoginTestsConfig(AppConfig):
    name = 'login'


class EngagementTestsConfig(AppConfig):
    name = 'engagement_api'


class EnrolmentTestsConfig(AppConfig):
    name = 'enrolment_api'


class QuizTestsConfig(AppConfig):
    name = 'quiz_api'


database = {
    'ENGINE': 'django.db.backends.postgresql', 'NAME': cfg['dbname'],
    'USER': cfg['user'], 'PASSWORD': cfg['password'], 'HOST': cfg['host'],
    'PORT': cfg['port'], 'CONN_MAX_AGE': 0,
    'OPTIONS': {'connect_timeout': 5, 'options': '-c statement_timeout=15000 -c lock_timeout=10000'},
}
settings.configure(
    SECRET_KEY='synthetic-local-timing-tests-only', USE_TZ=True, TIME_ZONE='Europe/London',
    DEFAULT_AUTO_FIELD='django.db.models.BigAutoField',
    INSTALLED_APPS=['django.contrib.auth', 'django.contrib.contenttypes',
                    '__main__.LearnerTestsConfig', '__main__.LoginTestsConfig',
                    '__main__.EnrolmentTestsConfig', '__main__.QuizTestsConfig',
                    '__main__.EngagementTestsConfig', 'system_audit'],
    DATABASES={alias: dict(database) for alias in ('default', 'enrolment')},
    DATABASE_ROUTERS=['learner_api.routers.EnrolmentRouter'], KBC_SHARED_REWARDS_READY=True,
)
cfg.clear()
import django
django.setup()
from django.db import connections
from django.db.migrations.state import ProjectState
from engagement_api import shared_rewards as rewards
from engagement_api.models import PointsGrant, PointsRule
from engagement_api.segment_rules import RewardError
from engagement_api.services import points_summary
from learner_api import time_tracking as timing
from learner_api.timing_drafts import ActivityTimingDraft, checkpoint, LEASE_MS


def sql(statement, params=()):
    with connections['default'].cursor() as cursor:
        cursor.execute(statement, params)
        return cursor.fetchall() if cursor.description else None


def prepare_empty_database():
    # Verify the actual server, both aliases and emptiness before the first DDL.
    for connection in connections.all():
        with connection.cursor() as cursor:
            cursor.execute("SELECT current_database(), host(inet_server_addr()), inet_server_port(), "
                           "current_setting('data_directory')")
            name, host, port, directory = cursor.fetchone()
            if (name != database['NAME'] or host != '127.0.0.1' or int(port) != int(database['PORT'])
                    or Path(directory).resolve() != args.data_directory.resolve()):
                raise RuntimeError('Actual database/cluster identity does not match the isolated target.')
    count = sql("SELECT count(*) FROM information_schema.tables "
                "WHERE table_schema NOT IN ('pg_catalog', 'information_schema')")[0][0]
    if count:
        raise RuntimeError('Database is not empty; refusing to overwrite existing tables.')
    fixture_root = ROOT / 'mobile_integration_tests'
    for name in ('test-fixtures.sql', 'schema.sql'):
        sql((fixture_root / name).read_text(encoding='utf-8'))
    sql(importlib.import_module('engagement_api.migrations.0004_all_course_learning_policy').SQL)
    module = importlib.import_module('learner_api.migrations.0024_activity_timing_drafts')
    migration = module.Migration('0024_activity_timing_drafts', 'learner_api')
    with connections['default'].schema_editor() as editor:
        migration.apply(ProjectState(), editor)
    for key in (rewards.HOUR_RULE, rewards.QUIZ_RULE, rewards.BONUS_RULE):
        PointsRule.objects.create(key=key, name=key, description='Synthetic', points=0,
                                  category='Learning', frequency='Per event', trigger=key, active=True)
    print('Verified local empty PostgreSQL target; timing migration applied through default.', flush=True)


class PostgreSQLTimingTests(unittest.TestCase):
    counter = 1000

    def setUp(self):
        # Distinct synthetic learners per test: no truncation or deletion.
        type(self).counter += 1
        self.profile = type(self).counter
        self.learner = str(self.profile + 10000)
        self.other = str(self.profile + 20000)
        self.now = datetime(2026, 10, 1, 10, tzinfo=timezone.utc)
        for target, value in (('django.utils.timezone.now', lambda: self.now),
                              ('django.core.signing.time.time', lambda: self.now.timestamp())):
            patcher = patch(target, side_effect=value)
            patcher.start()
            self.addCleanup(patcher.stop)
        sql('INSERT INTO "Learner".learners VALUES (%s,%s,\'active\',\'Synthetic timing learner\')',
            [self.profile, int(self.learner)])
        self.component = {'componentId': 'READ-LOCAL', 'moduleId': f'MOD-LOCAL-{self.profile}',
                          'weekId': 'W01', 'tutorValidationRequired': False}
        sql('INSERT INTO "Engagement".shared_reward_config(module_id,enabled,starts_at) VALUES(%s,true,%s)',
            [self.component['moduleId'], self.now - timedelta(days=1)])
        self.identity = dict(activity_kind='component', activity_id=self.component['componentId'],
                             learner_kind='commercial', learner_id=self.learner)

    def start(self, persistent=True):
        return timing.issue_tracking_session(**self.identity, counting_mode='visible_page', persistent=persistent)

    def save(self, session, seconds=300, **identity):
        return checkpoint(session['trackingToken'], **{**self.identity, **identity}, seconds=seconds)

    def verify(self, session, seconds=300):
        return timing.verify_tracking_session(session['trackingToken'], **self.identity, claimed_seconds=seconds)

    def observe(self, session, segments, sequence=1):
        evidence = self.verify(session, 999999)
        tracking = {**evidence, 'learnerKind': self.identity['learner_kind'],
                    'activityKind': self.identity['activity_kind'], 'activityId': self.identity['activity_id']}
        return rewards.record_observations(
            learner_id=self.learner, profile_id=self.profile, component=self.component, tracking=tracking,
            token=session['trackingToken'], event_id=f"{session['sessionId']}:{sequence}", sequence=sequence,
            observed_intervals=segments,
        )

    def progress(self, session, seconds):
        evidence = self.verify(session, seconds)
        return sql('''INSERT INTO "Learner".learner_progress_entries
            (learner_id,entry_order,kind,component_ref,verified_seconds,time_tracking_source,
             time_tracking_session_ref,started_at,submitted_at)
            VALUES(%s,1,'component',%s,%s,%s,%s,%s,%s) RETURNING id''',
            [self.profile, self.component['componentId'], evidence['verifiedSeconds'], evidence['source'],
             session['sessionId'], evidence['startedAt'], self.now])[0][0]

    def concurrent(self, values, action):
        barrier = threading.Barrier(len(values))

        def worker(value):
            try:
                barrier.wait(timeout=10)
                return action(value)
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=len(values)) as pool:
            return list(pool.map(worker, values))

    def test_migration_creates_real_shared_table_and_primary_key(self):
        session = self.start()
        self.now += timedelta(minutes=5)
        self.save(session, 300)
        for alias in ('default', 'enrolment'):
            self.assertEqual(ActivityTimingDraft.objects.using(alias).get(pk=session['sessionId']).elapsed_seconds, 300)
        self.assertEqual(sql("SELECT count(*) FROM pg_constraint WHERE contype='p' "
                             "AND conrelid='learner_activity_timing_drafts'::regclass")[0][0], 1)

    def test_concurrent_expired_legacy_adoption_retains_one_identity_and_maximum(self):
        session = self.start(False)
        self.now += timedelta(days=2)
        with self.assertRaises(timing.TrackingSessionError):
            self.verify(session)
        replies = self.concurrent([300, 900, 600, 100, 900, 450], lambda value: self.save(session, value))
        self.assertTrue(all(reply['trackingToken'] == session['trackingToken'] for reply in replies))
        self.assertTrue(all(reply['sessionId'] == session['sessionId'] for reply in replies))
        self.assertEqual(ActivityTimingDraft.objects.using('enrolment').filter(pk=session['sessionId']).count(), 1)
        row = ActivityTimingDraft.objects.using('enrolment').get(pk=session['sessionId'])
        self.assertEqual(row.elapsed_seconds, 900)
        self.assertEqual(row.windows, [[0, LEASE_MS], [2 * LEASE_MS, 3 * LEASE_MS]])
        self.assertEqual(self.verify(session, 900)['verifiedSeconds'], 900)

    def test_concurrent_persistent_renewal_cannot_add_duplicate_windows_or_seconds(self):
        session = self.start()
        self.now += timedelta(minutes=10)
        self.save(session, 600)
        self.now += timedelta(days=2)
        self.concurrent([600, 300, 800, 700], lambda value: self.save(session, value))
        row = ActivityTimingDraft.objects.using('enrolment').get(pk=session['sessionId'])
        self.assertEqual(row.elapsed_seconds, 800)
        self.assertEqual(len(row.windows), 2)
        self.assertEqual(self.verify(session, 999999)['serverSessionSeconds'], 86400 + 600)

    def test_renewal_preserves_old_receipts_and_awards_once_after_concurrent_reconciliation(self):
        session = self.start()
        self.now += timedelta(hours=1)
        for batch in range(6):
            segments = [{'startOffsetMs': n * 5000, 'endOffsetMs': (n + 1) * 5000}
                        for n in range(batch * 120, (batch + 1) * 120)]
            self.observe(session, segments, batch + 1)
        self.save(session, 3600)
        self.now += timedelta(days=2)
        with self.assertRaises(timing.TrackingSessionError):
            self.verify(session)
        restored = self.save(session, 3500)
        self.assertEqual(restored['savedSeconds'], 3600)
        self.assertEqual(restored['startedAt'], session['startedAt'])
        self.now += timedelta(seconds=5)
        offset = (2 * 86400 + 3600) * 1000
        segments = [{'startOffsetMs': offset, 'endOffsetMs': offset + 5000}]
        result = self.observe(restored, segments, 7)
        retry = self.observe(restored, segments, 7)
        self.assertFalse(result['duplicate'])
        self.assertTrue(retry['duplicate'])
        self.assertEqual(retry['cumulativeObservedMilliseconds'], 3605000)
        pid = self.progress(restored, 3605)
        replies = self.concurrent([1, 2], lambda _: rewards.reconcile_progress(pid))
        self.assertTrue(all(reply['status'] == 'done' for reply in replies))
        self.assertEqual(sum(not reply['duplicate'] for reply in replies), 1)
        self.assertEqual(points_summary(self.learner)['earned'], 1)
        self.assertEqual(points_summary(self.other)['earned'], 0)
        self.assertEqual(PointsGrant.objects.filter(learner_id=self.learner).count(), 1)
        self.assertEqual(sql('SELECT accepted_ms FROM "Engagement".shared_reward_acceptances WHERE progress_id=%s',
                             [pid]), [(3605000,)])
        self.assertEqual(sql('SELECT count(*) FROM "Engagement".shared_reward_observations WHERE session_id=%s',
                             [session['sessionId']])[0][0], 7)
        self.assertEqual(sql('SELECT state FROM "Engagement".shared_reward_outbox WHERE progress_id=%s', [pid]), [('done',)])

    def test_unleased_gap_rejected_without_reward_rows(self):
        session = self.start()
        self.now += timedelta(days=3)
        self.save(session)
        with self.assertRaises(RewardError) as caught:
            self.observe(session, [{'startOffsetMs': LEASE_MS + 1000, 'endOffsetMs': LEASE_MS + 2000}])
        self.assertEqual(caught.exception.code, 'observation_outside_timing_lease')
        self.assertEqual(sql('SELECT count(*) FROM "Engagement".shared_reward_sessions WHERE session_id=%s',
                             [session['sessionId']])[0][0], 0)
        self.assertEqual(PointsGrant.objects.filter(learner_id=self.learner).count(), 0)

    def test_persisted_completion_prevents_renewal_without_changing_saved_evidence(self):
        session = self.start()
        self.now += timedelta(minutes=5)
        self.save(session, 300)
        pid = self.progress(session, 300)
        self.now += timedelta(days=2)
        with self.assertRaises(timing.TrackingSessionError) as caught:
            self.save(session, 900)
        self.assertEqual(caught.exception.code, 'tracking_session_used')
        row = ActivityTimingDraft.objects.using('enrolment').get(pk=session['sessionId'])
        self.assertEqual(row.elapsed_seconds, 300)
        self.assertEqual(len(row.windows), 1)
        self.assertEqual(sql('SELECT verified_seconds FROM "Learner".learner_progress_entries WHERE id=%s', [pid]), [(300,)])

    def test_wrong_owner_activity_or_signature_cannot_mutate_saved_checkpoint(self):
        session = self.start()
        self.now += timedelta(minutes=5)
        self.save(session, 300)
        self.now += timedelta(days=2)
        for identity in ({'learner_id': self.other}, {'learner_kind': 'apprenticeship'},
                         {'activity_id': 'OTHER'}, {'activity_kind': 'video'}):
            with self.subTest(identity=identity), self.assertRaises(timing.TrackingSessionError):
                self.save(session, 900, **identity)
        with self.assertRaises(timing.TrackingSessionError):
            self.save({**session, 'trackingToken': session['trackingToken'] + 'x'}, 900)
        row = ActivityTimingDraft.objects.using('enrolment').get(pk=session['sessionId'])
        self.assertEqual(row.elapsed_seconds, 300)
        self.assertEqual(len(row.windows), 1)


if __name__ == '__main__':
    # libpq uses the explicit verified database settings above. Any Python-side
    # network request (mail, HTTP, storage, Graph) is forbidden in this runner.
    with patch.object(socket.socket, 'connect', side_effect=AssertionError('External services are forbidden')):
        try:
            prepare_empty_database()
            suite = unittest.defaultTestLoader.loadTestsFromTestCase(PostgreSQLTimingTests)
            result = unittest.TextTestRunner(verbosity=2).run(suite)
        finally:
            connections.close_all()
    raise SystemExit(not result.wasSuccessful())
