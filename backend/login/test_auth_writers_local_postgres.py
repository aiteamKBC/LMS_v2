"""Opt-in Django writer tests on a freshly initialized local PostgreSQL cluster.

Run with -I -B --bundle PATH. No project settings/.env, shared DSN, migrations,
custom application test runner or external services. Uses actual login models,
services and decorated views; omits unrelated application startup hooks. This
is focused writer/response coverage, not a full middleware/SSO deployment test.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
import importlib
import importlib.util
import json
from pathlib import Path
import sys
import threading
import time
import unittest
from unittest.mock import patch
from uuid import uuid4


class WriterTests(unittest.TestCase):
    def setUp(self):
        self.password = 'Vaulted-Harbour-92!'
        self.new_password = 'Changed-Harbour-73!'
        self.account = LoginAccount.objects.create(
            subject_type='learner', subject_id=900001,
            email=f'{uuid4().hex}@example.test', role='learner',
            password_hash=security.hash_password(self.password))
        self.current = sessions.issue_session(self.account)[1]
        self.other = sessions.issue_session(self.account)[1]

    def tearDown(self):
        # Local fixture only; source deletes exercise the unchanged mirrors.
        LoginAccount.objects.filter(pk=self.account.pk).delete()

    def request(self, payload=None, session=None, xhr=True):
        headers = {'HTTP_X_REQUESTED_WITH': 'XMLHttpRequest'} if xhr else {}
        request = RequestFactory().post('/synthetic/', data=json.dumps(payload or {}),
            content_type='application/json', **headers)
        request.login_account = self.account
        request.login_session = self.current if session is None else session
        return request

    def change(self, password=None):
        return views.change_password(self.request({
            'currentPassword': self.password,
            'newPassword': password or self.new_password}))

    def test_logout_stale_concurrent_instances_keep_first_timestamp_and_cookie(self):
        stale = [LoginSession.objects.get(pk=self.current.pk) for _ in range(2)]
        barrier = threading.Barrier(2)
        def logout(row):
            try:
                barrier.wait(timeout=5)
                request = self.request(session=row)
                setattr(request, sessions.RENEWED_UNTIL_ATTR, timezone.now() + timedelta(days=1))
                response = views.logout(request)
                sessions.refresh_session_cookie(request, response)
                return response
            finally:
                connections.close_all()
        with ThreadPoolExecutor(max_workers=2) as pool:
            responses = list(pool.map(logout, stale))
        first_revocation = LoginSession.objects.get(pk=self.current.pk).revoked_at
        self.assertIsNotNone(first_revocation)
        for response in responses:
            self.assertEqual(response.status_code, 200)
            self.assertEqual(json.loads(response.content), {'ok': True})
            self.assertEqual(response.cookies[sessions.COOKIE_NAME]['max-age'], 0)
        sessions.revoke_session(stale[0])
        self.assertEqual(LoginSession.objects.get(pk=self.current.pk).revoked_at, first_revocation)
        self.assertIsNone(LoginSession.objects.get(pk=self.other.pk).revoked_at)

    def test_password_change_keeps_current_and_revokes_other_sessions(self):
        response = self.change()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content), {'ok': True})
        self.account.refresh_from_db()
        self.assertTrue(security.verify_password(self.new_password, self.account.password_hash))
        self.assertIsNone(LoginSession.objects.get(pk=self.current.pk).revoked_at)
        self.assertIsNotNone(LoginSession.objects.get(pk=self.other.pk).revoked_at)
        self.assertFalse(response.cookies)

    def test_password_change_without_current_session_revokes_all(self):
        request = self.request({'currentPassword': self.password, 'newPassword': self.new_password})
        request.login_session = None
        self.assertEqual(views.change_password(request).status_code, 200)
        self.assertFalse(LoginSession.objects.filter(account=self.account, revoked_at__isnull=True).exists())

    def test_password_change_mirror_failure_rolls_back_password_and_revocation(self):
        old_hash = self.account.password_hash
        with connections['enrolment'].cursor() as cursor:
            cursor.execute('''ALTER TABLE "Learner"."Login_sessions"
                ADD CONSTRAINT synthetic_revoke_failure CHECK
                ("Account_id" <> %s OR "Revoked_at" IS NULL)''', [self.account.pk])
        try:
            with self.assertRaises(DatabaseError):
                self.change()
            self.account.refresh_from_db()
            self.assertEqual(self.account.password_hash, old_hash)
            self.assertIsNone(self.account.password_set_at)
            self.assertEqual(LoginSession.objects.filter(account=self.account, revoked_at__isnull=True).count(), 2)
            with connections['enrolment'].cursor() as cursor:
                cursor.execute('SELECT "Password_hash" = %s FROM "Learner"."Login_accounts" WHERE id=%s',
                               [old_hash, self.account.pk])
                self.assertTrue(cursor.fetchone()[0])
        finally:
            with connections['enrolment'].cursor() as cursor:
                cursor.execute('ALTER TABLE "Learner"."Login_sessions" DROP CONSTRAINT synthetic_revoke_failure')

    def test_password_change_denials_preserve_state(self):
        anonymous = self.request()
        anonymous.login_account = None
        self.assertEqual(views.change_password(anonymous).status_code, 401)
        for payload, xhr, status in (
            ({'currentPassword': 'wrong', 'newPassword': self.new_password}, True, 403),
            ({'currentPassword': self.password, 'newPassword': 'x'}, True, 400),
            ({'currentPassword': self.password, 'newPassword': self.new_password}, False, 403),
        ):
            response = views.change_password(self.request(payload, xhr=xhr))
            self.assertEqual(response.status_code, status)
        self.account.refresh_from_db()
        self.assertTrue(security.verify_password(self.password, self.account.password_hash))
        self.assertEqual(LoginSession.objects.filter(account=self.account, revoked_at__isnull=True).count(), 2)

    def test_peeks_do_not_require_transaction_or_lock(self):
        for create, peek in ((invitations.create_invitation, invitations.peek_invitation),
                             (invitations.create_reset, invitations.peek_reset)):
            _, token = create(self.account)
            with connections['enrolment'].execute_wrapper(self.reject_lock):
                self.assertEqual(peek(token)['email'], self.account.email)

    def test_invalid_tokens_keep_response_and_database_outage_is_distinct(self):
        for create, view in ((invitations.create_invitation, views.accept_invitation_view),
                             (invitations.create_reset, views.reset_password)):
            row, token = create(self.account)
            for state in ('unknown', 'expired', 'used'):
                if state == 'expired':
                    row.expires_at = timezone.now() - timedelta(seconds=1)
                    row.save(update_fields=['expires_at'])
                elif state == 'used':
                    row.expires_at = timezone.now() + timedelta(hours=1)
                    row.used_at = timezone.now()
                    row.save(update_fields=['expires_at', 'used_at'])
                response = view(self.request({'token': 'synthetic-unknown' if state == 'unknown' else token,
                                              'password': self.new_password}))
                self.assertEqual(response.status_code, 400)
                self.assertEqual(json.loads(response.content)['code'], 'invalid_token')
            with patch.object(invitations, '_load_token', side_effect=DatabaseError('synthetic unavailable')):
                self.assertEqual(view(self.request({'token': token, 'password': self.new_password})).status_code, 502)

    def test_invitation_activates_but_reset_preserves_inactive_account(self):
        for create, redeem, expected_active in (
            (invitations.create_invitation, invitations.accept_invitation, True),
            (invitations.create_reset, invitations.complete_reset, False),
        ):
            self.account.is_active = False
            self.account.save(update_fields=['is_active'])
            _, token = create(self.account)
            redeem(token, self.new_password)
            self.account.refresh_from_db()
            self.assertEqual(self.account.is_active, expected_active)

    @staticmethod
    def reject_lock(execute, sql, params, many, context):
        if 'FOR UPDATE' in sql.upper():
            raise AssertionError('Peek unexpectedly acquired a row lock')
        return execute(sql, params, many, context)

    def redeem_race(self, create, view):
        _, token = create(self.account)
        first_locked, release_first = threading.Event(), threading.Event()
        original = invitations._load_token
        def load(*args, **kwargs):
            row = original(*args, **kwargs)
            # Only first caller can reach here before release. The second must
            # wait in SELECT FOR UPDATE and then raise TokenError on Used_at.
            first_locked.set()
            if not release_first.wait(10):
                raise AssertionError('Timed out releasing token lock')
            return row
        def redeem():
            try:
                return view(self.request({'token': token, 'password': self.new_password}))
            finally:
                connections.close_all()
        with patch.object(invitations, '_load_token', side_effect=load):
            with ThreadPoolExecutor(max_workers=2) as pool:
                first = pool.submit(redeem)
                try:
                    self.assertTrue(first_locked.wait(10))
                    second = pool.submit(redeem)
                    deadline = time.monotonic() + 10
                    blocked = False
                    while time.monotonic() < deadline:
                        with connections['enrolment'].cursor() as cursor:
                            cursor.execute("SELECT EXISTS(SELECT FROM pg_stat_activity WHERE "
                                "datname=current_database() AND wait_event_type='Lock' "
                                "AND query LIKE 'SELECT%%FOR UPDATE%%')")
                            blocked = cursor.fetchone()[0]
                        if blocked:
                            break
                        time.sleep(0.02)
                    self.assertTrue(blocked, 'Second redemption did not wait on the token lock')
                finally:
                    release_first.set()
                responses = [first.result(timeout=10), second.result(timeout=10)]
        self.assertEqual(sorted(r.status_code for r in responses), [200, 400])
        loser = next(r for r in responses if r.status_code == 400)
        self.assertEqual(json.loads(loser.content)['code'], 'invalid_token')
        self.assertTrue(all(not r.cookies for r in responses))
        self.assertFalse(LoginSession.objects.filter(account=self.account, revoked_at__isnull=True).exists())
        self.account.refresh_from_db()
        self.assertTrue(security.verify_password(self.new_password, self.account.password_hash))

    def test_concurrent_invitation_returns_invalid_token_to_loser(self):
        self.redeem_race(invitations.create_invitation, views.accept_invitation_view)

    def test_concurrent_reset_returns_invalid_token_to_loser(self):
        self.redeem_race(invitations.create_reset, views.reset_password)

    def test_redemption_failure_rolls_back_token_password_and_activation(self):
        for create, redeem in ((invitations.create_invitation, invitations.accept_invitation),
                               (invitations.create_reset, invitations.complete_reset)):
            self.account.is_active = False
            self.account.save(update_fields=['is_active'])
            old_hash = self.account.password_hash
            row, token = create(self.account)
            with patch.object(invitations, 'revoke_all_for_account', side_effect=DatabaseError('synthetic failure')) as revoke:
                with self.assertRaises(DatabaseError):
                    redeem(token, self.new_password)
                revoke.assert_called_once()
            self.account.refresh_from_db()
            row.refresh_from_db()
            self.assertIsNone(row.used_at)
            self.assertEqual(self.account.password_hash, old_hash)
            self.assertFalse(self.account.is_active)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--bundle', type=Path, required=True)
    parser.add_argument('--runtime-only', action='store_true')
    args = parser.parse_args()
    spec = importlib.util.spec_from_file_location('synthetic_pg', args.bundle / 'tests/run_local.py')
    pg = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(pg)
    started = False
    try:
        pg.command('initdb', '-D', pg.CLUSTER / 'data', '-U', 'phase1_test_owner',
                   '-A', 'trust', '--no-locale', '--encoding=UTF8')
        pg.command('pg_ctl', '-D', pg.CLUSTER / 'data', '-l', pg.CLUSTER / 'server.log',
                   '-o', f'-h 127.0.0.1 -p {pg.PORT}', '-w', 'start')
        started = True
        pg.sql(file=pg.HERE / 'fixture.sql')
        pg.sql('''ALTER TABLE "Learner".learners ADD COLUMN programme_id varchar(64),
            ADD COLUMN full_name text, ADD COLUMN programme text, ADD COLUMN coach_name text,
            ADD COLUMN start_date date, ADD COLUMN end_date date, ADD COLUMN learner_type text,
            ADD COLUMN phone_number text;  -- unapproved column; must stay denied''')
        pg.sql(file=pg.BUNDLE / '10-install.sql')
        pg.sql('CREATE ROLE synthetic_auth_reader LOGIN;')
        pg.command('psql', '-X', '-h', '127.0.0.1', '-p', str(pg.PORT), '-U', 'phase1_test_owner',
            '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-v', 'auth_reader=synthetic_auth_reader',
            '-f', pg.BUNDLE / '15-auth-reader-grants.sql')
        # Exact minimum projection from integration-readiness/20-grant-auth-projections.sql;
        # no whole-table SELECT on these two relations.
        pg.sql('''GRANT SELECT(id,enrolment_id,aptem_id,programme_id,full_name,programme,
            coach_name,coach_email,email,start_date,end_date,learner_type,cohort_id)
            ON "Learner".learners TO synthetic_auth_reader;
            GRANT SELECT(enrolment_id) ON "Learner".progress_transfer_requests TO synthetic_auth_reader;''')
        # Fixture used explicit IDs; prepare source-owned allocation for ORM tests.
        for table in ('Login_accounts', 'Login_sessions', 'Invitations', 'Password_resets', 'Login_audit'):
            pg.sql(f'''SELECT setval(pg_get_serial_sequence('login."{table}"','id'),
                (SELECT coalesce(max(id),1) FROM login."{table}"));''')
        sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
        from django.apps import AppConfig
        from django.conf import settings
        from config.learner_auth import configure_learner_auth
        _, reader_databases = configure_learner_auth({
            'LEARNER_AUTH_DB_HOST': '127.0.0.1', 'LEARNER_AUTH_DB_NAME': 'postgres',
            'LEARNER_AUTH_DB_USER': 'synthetic_auth_reader', 'LEARNER_AUTH_DB_PASSWORD': 'synthetic',
            'LEARNER_AUTH_DB_PORT': str(pg.PORT), 'LEARNER_AUTH_DB_SSLMODE': 'disable'})
        settings.configure(
            SECRET_KEY='synthetic-local-only', USE_TZ=True, TIME_ZONE='Europe/London',
            ALLOWED_HOSTS=['testserver', 'localhost'],
            INSTALLED_APPS=['django.contrib.contenttypes', 'django.contrib.auth',
                AppConfig('learner_api', importlib.import_module('learner_api')), 'login'],
            LEARNER_AUTH_READS_ENABLED=False,
            DATABASES={**reader_databases, 'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': ':memory:'},
                'enrolment': {'ENGINE': 'django.db.backends.postgresql', 'NAME': 'postgres',
                    'USER': 'phase1_test_owner', 'HOST': '127.0.0.1', 'PORT': str(pg.PORT)}},
            DATABASE_ROUTERS=['learner_api.routers.EnrolmentRouter'],
        )
        import django
        django.setup()
        from django.db import connections, DatabaseError
        from django.test import RequestFactory
        from django.utils import timezone
        from login import invitations, sessions, security, views, tests_unit
        from login.models import LoginAccount, LoginSession
        from login.test_learner_auth_adapter import AdapterTests, ConfigurationTests
        from login.test_learner_auth_http import RuntimeHTTPTests

        suite = unittest.defaultTestLoader.loadTestsFromTestCase(WriterTests)
        suite.addTests(unittest.defaultTestLoader.loadTestsFromTestCase(ConfigurationTests))
        suite.addTests(unittest.defaultTestLoader.loadTestsFromTestCase(AdapterTests))
        suite.addTests(unittest.defaultTestLoader.loadTestsFromTestCase(RuntimeHTTPTests))
        for name in ('NormalisationTests', 'TokenPrimitiveTests', 'PasswordHashingTests',
                     'PasswordPolicyEdgeTests', 'LockoutScheduleTests', 'LifetimeTests',
                     'ClientIpTests', 'RoleMappingTests', 'InviteAuthorisationTests',
                     'ExpiryReasonTests', 'SessionLifecycleTests', 'RollingRenewalTests',
                     'SessionEventTests', 'MicrosoftSsoConfigTests', 'MicrosoftSsoStartTests'):
            suite.addTests(unittest.defaultTestLoader.loadTestsFromTestCase(getattr(tests_unit, name)))
        from learner_api.tests_programme_access import ProgrammeAccessTests
        suite.addTests(unittest.defaultTestLoader.loadTestsFromTestCase(ProgrammeAccessTests))
        if args.runtime_only:
            suite = unittest.defaultTestLoader.loadTestsFromTestCase(RuntimeHTTPTests)
            suite.addTests(unittest.defaultTestLoader.loadTestsFromTestCase(ProgrammeAccessTests))
        # Any accidental provider call is a test failure, never a live effect.
        with patch('httpx.Client.send', side_effect=AssertionError('External HTTP prohibited')):
            result = unittest.TextTestRunner(verbosity=2).run(suite)
        connections.close_all()
        raise SystemExit(0 if result.wasSuccessful() else 1)
    finally:
        if started:
            pg.command('pg_ctl', '-D', pg.CLUSTER / 'data', '-m', 'fast', '-w', 'stop')
