"""Run ONLY via test_auth_writers_local_postgres.py's disposable cluster.

The adapter runs as an actual non-owner SELECT-only role. Source lifecycle
writes use the real models on a different connection to the same local cluster.
No project settings, shared database or external provider is used.
"""
from datetime import timedelta
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.db import connections, DatabaseError
from django.test import override_settings
from django.utils import timezone

from config.learner_auth import ALIAS, configure_learner_auth
from login import identity, invitations, sessions, security
from login.learner_auth_reader import LearnerAuthDisabled, LearnerAuthReader, _read_query
from login.models import LoginAccount, LoginSession


class ConfigurationTests(unittest.TestCase):
    def test_model_routing_remains_writer_owned_and_reader_never_migrates(self):
        from learner_api.routers import EnrolmentRouter
        router = EnrolmentRouter()
        self.assertEqual(router.db_for_read(LoginAccount), 'enrolment')
        self.assertEqual(router.db_for_write(LoginAccount), 'enrolment')
        for label in ('login', 'learner_api', 'auth', 'sessions', 'unrelated'):
            self.assertFalse(router.allow_migrate(ALIAS, label))

    def test_default_off_without_alias_or_writer_credential_fallback(self):
        self.assertEqual(configure_learner_auth({'DATABASE_URL': 'not-used'}), (False, {}))

    def test_explicit_complete_reader_config_does_not_enable(self):
        env = {f'LEARNER_AUTH_DB_{key}': 'synthetic' for key in ('HOST','NAME','USER','PASSWORD')}
        enabled, dbs = configure_learner_auth(env)
        self.assertFalse(enabled)
        self.assertEqual(set(dbs), {ALIAS})
        self.assertEqual(dbs[ALIAS]['OPTIONS']['sslmode'], 'verify-full')
        self.assertNotIn('enrolment', dbs)
        with self.assertRaises(ValueError):
            configure_learner_auth({'LEARNER_AUTH_READS_ENABLED': '1'})


class AdapterTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(override_settings(LEARNER_AUTH_READS_ENABLED=True))
        self.reader = LearnerAuthReader()
        self.tokens = {}
        self.session_ids = []
        for account_id in (17,18,19):
            account = LoginAccount.objects.get(pk=account_id)
            token, session, _ = sessions.issue_session(account)
            self.tokens[account_id] = token
            self.session_ids.append(session.pk)

    def tearDown(self):
        LoginSession.objects.filter(pk__in=self.session_ids).delete()

    @staticmethod
    def sql(statement, params=()):
        with connections['enrolment'].cursor() as cursor:
            cursor.execute(statement, params)

    @staticmethod
    def forbid_source(execute, sql, params, many, context):
        raise AssertionError('Adapter touched a source/writer connection')

    def test_disabled_gate_performs_no_queries(self):
        with override_settings(LEARNER_AUTH_READS_ENABLED=False):
            with connections[ALIAS].execute_wrapper(self.forbid_source):
                with self.assertRaises(LearnerAuthDisabled):
                    self.reader.me(self.tokens[17])

    def test_disabled_request_path_never_uses_reader(self):
        # Integration is now intentional; the deployment switch still isolates it.
        with override_settings(LEARNER_AUTH_READS_ENABLED=False):
            with connections[ALIAS].execute_wrapper(self.forbid_source):
                self.assertEqual(sessions.resolve_session(self.tokens[18]).account_id, 18)

    def test_reader_transaction_and_acl_forbid_writes(self):
        with _read_query() as query:
            self.assertEqual(query('SHOW transaction_read_only', [])[0]['transaction_read_only'], 'on')
            self.assertEqual(query('SHOW transaction_isolation', [])[0]['transaction_isolation'], 'read committed')
        with self.assertRaises(DatabaseError):
            with _read_query() as query:
                query('UPDATE "Learner"."Login_accounts" SET "Is_active"=FALSE WHERE id=%s', [17])
        # Even outside the adapter transaction the role has no source access.
        with self.assertRaises(DatabaseError):
            with connections[ALIAS].cursor() as cursor:
                cursor.execute('SELECT id FROM login."Login_accounts" LIMIT 1')

    def test_owner_and_write_privileges_are_rejected(self):
        # Role membership change in this disposable cluster only.
        self.sql('GRANT UPDATE ON "Learner"."Login_accounts" TO synthetic_auth_reader')
        try:
            with self.assertRaises(ImproperlyConfigured):
                self.reader.me(self.tokens[17])
        finally:
            self.sql('REVOKE UPDATE ON "Learner"."Login_accounts" FROM synthetic_auth_reader')
        self.sql('GRANT phase1_test_owner TO synthetic_auth_reader')
        try:
            with self.assertRaises(ImproperlyConfigured):
                self.reader.me(self.tokens[17])
        finally:
            self.sql('REVOKE phase1_test_owner FROM synthetic_auth_reader')

    def test_minimum_column_grants_are_sufficient_and_not_broader(self):
        from login.learner_auth_reader import _COLUMN_RELATIONS
        with connections['enrolment'].cursor() as cursor:
            for relation, columns in _COLUMN_RELATIONS.items():
                cursor.execute('''SELECT has_table_privilege('synthetic_auth_reader',%s,'SELECT')''',
                               [f'"Learner".{relation}'])
                self.assertEqual(cursor.fetchone(), (False,), relation)
                cursor.execute('''SELECT a.attname, has_column_privilege('synthetic_auth_reader',a.attrelid,a.attnum,'SELECT')
                    FROM pg_attribute a WHERE a.attrelid=%s::regclass AND a.attnum>0 AND NOT a.attisdropped''',
                               [f'"Learner".{relation}'])
                readable = {name for name, allowed in cursor.fetchall() if allowed}
                self.assertEqual(readable, set(columns), relation)
        self.assertIsNotNone(self.reader.me(self.tokens[18]))
        # Unapproved columns stay denied even through the reader connection.
        with self.assertRaises(DatabaseError):
            with _read_query() as query:
                query('SELECT phone_number FROM "Learner".learners LIMIT 1', [])

    def test_each_missing_required_column_fails_closed(self):
        from login.learner_auth_reader import _REQUIRED_COLUMNS
        for relation, column in _REQUIRED_COLUMNS:
            with self.subTest(relation=relation, column=column):
                self.sql(f'REVOKE SELECT({column}) ON "Learner".{relation} FROM synthetic_auth_reader')
                try:
                    with self.assertRaisesRegex(ImproperlyConfigured, 'column privileges'):
                        self.reader.me(self.tokens[17])
                finally:
                    self.sql(f'GRANT SELECT({column}) ON "Learner".{relation} TO synthetic_auth_reader')
        self.assertIsNotNone(self.reader.me(self.tokens[17]))

    def test_missing_table_and_column_write_privileges_fail_closed(self):
        self.sql('REVOKE SELECT ON "Learner".actor_grants FROM synthetic_auth_reader')
        try:
            with self.assertRaisesRegex(ImproperlyConfigured, 'relation privileges'):
                self.reader.me(self.tokens[17])
        finally:
            self.sql('GRANT SELECT ON "Learner".actor_grants TO synthetic_auth_reader')
        for grant in ('UPDATE(email) ON "Learner".learners', 'INSERT(enrolment_id) ON "Learner".progress_transfer_requests',
                      'REFERENCES(id) ON "Learner".learners', 'UPDATE("Email") ON "Learner"."Login_accounts"'):
            with self.subTest(grant=grant):
                self.sql(f'GRANT {grant} TO synthetic_auth_reader')
                try:
                    with self.assertRaisesRegex(ImproperlyConfigured, 'relation privileges'):
                        self.reader.me(self.tokens[17])
                finally:
                    self.sql(f'REVOKE {grant} FROM synthetic_auth_reader')
        self.assertIsNotNone(self.reader.me(self.tokens[17]))

    def test_me_matches_existing_payload_for_all_roles_and_queries_only_reader(self):
        sources = {
            17: SimpleNamespace(position='Tutor', access='coach', access_extra='enrolment'),
            18: SimpleNamespace(learner_type='apprenticeship', programme='P', aptem_id=None),
            19: SimpleNamespace(employer_group_ids=[1]),
        }
        counts = {}
        for account_id, source in sources.items():
            account = LoginAccount.objects.get(pk=account_id)
            expected = {'user': identity.account_payload(account, subject=source,
                learner_record_resolver=lambda email: SimpleNamespace(pk=271, learner_type='commercial'))}
            queries = []
            def capture(execute, sql, params, many, context):
                queries.append(sql)
                return execute(sql, params, many, context)
            with connections['enrolment'].execute_wrapper(self.forbid_source), \
                    connections['default'].execute_wrapper(self.forbid_source), \
                    connections[ALIAS].execute_wrapper(capture):
                actual = self.reader.me(self.tokens[account_id])
            self.assertEqual(actual, expected)
            data_queries = [sql for sql in queries if 'FROM "Learner".' in sql]
            counts[account.subject_type] = len(data_queries)
            self.assertTrue(all('login."' not in sql and 'enrolment."' not in sql for sql in queries))
            self.assertNotIn('password_hash', actual['user'])
        self.assertEqual(counts, {'staff': 4, 'learner': 2, 'employer': 2})
        print('Measured /me data SELECTs on reader only: staff=4, learner=2, employer=2 (plus 3 catalog checks).')

    def test_staff_grant_removal_demotion_and_ownership_are_fresh(self):
        token = self.tokens[17]
        self.assertTrue(self.reader.has_staff_access(token, 'coach'))
        self.assertTrue(self.reader.owns_learner(token, 271, 'coach'))
        self.assertTrue(self.reader.owns_learner(token, 271, 'staff_self'))
        self.assertFalse(self.reader.owns_learner(token, 272, 'coach'))
        self.sql('UPDATE enrolment."Staff_users" SET "Access"=\'super-admin\',"Access_extra"=NULL WHERE id=83')
        try:
            self.assertEqual(self.reader.me(token)['user']['role'], 'admin')
            self.assertFalse(self.reader.owns_learner(token, 271, 'coach'))
            self.sql('UPDATE enrolment."Staff_users" SET "Access"=NULL,"Access_extra"=NULL WHERE id=83')
            payload = self.reader.me(token)['user']
            self.assertEqual(payload['role'], 'staff')
            self.assertEqual(payload['accesses'], [])
            self.assertFalse(self.reader.has_staff_access(token, 'coach'))
            self.assertFalse(self.reader.owns_learner(token, 271, 'coach'))
        finally:
            self.sql('UPDATE enrolment."Staff_users" SET "Access"=\'coach\',"Access_extra"=\'enrolment\' WHERE id=83')

    def test_onboarding_self_employer_and_staff_study_ambiguity(self):
        self.assertTrue(self.reader.owns_learner(self.tokens[18], 272, 'self'))
        self.assertFalse(self.reader.owns_learner(self.tokens[18], 271, 'self'))
        self.assertTrue(self.reader.owns_learner(self.tokens[19], 271, 'employer'))
        self.assertFalse(self.reader.owns_learner(self.tokens[19], 272, 'employer'))
        self.sql('INSERT INTO enrolment."Created_users"(id,"Email") VALUES(273,\'learner@example.test\')')
        try:
            self.assertNotIn('learnerRecordId', self.reader.me(self.tokens[17])['user'])
            self.assertFalse(self.reader.owns_learner(self.tokens[17], 271, 'staff_self'))
        finally:
            self.sql('DELETE FROM enrolment."Created_users" WHERE id=273')

    def test_login_ambiguity_and_missing_subject_fail_closed(self):
        self.assertEqual(self.reader.account_for_login(' DRAFT@EXAMPLE.TEST ')['account_id'], 18)
        duplicate = LoginAccount.objects.create(subject_type='staff', subject_id=999,
            email='draft@example.test', role='staff')
        try:
            self.assertIsNone(self.reader.account_for_login('draft@example.test'))
        finally:
            duplicate.delete()
        # Missing grants cannot inherit the copied account Role.
        self.sql('DELETE FROM enrolment."Staff_users" WHERE id=83')
        try:
            self.assertIsNone(self.reader.session_actor(self.tokens[17]))
        finally:
            self.sql('''INSERT INTO enrolment."Staff_users"(id,"Email","Username","Position","Access","Access_extra")
                VALUES(83,'learner@example.test','Actor','Tutor','coach','enrolment')''')

    def test_source_renewal_logout_reset_are_visible_without_reader_writes(self):
        account = LoginAccount.objects.get(pk=18)
        session = LoginSession.objects.get(pk=self.session_ids[1])
        LoginSession.objects.filter(pk=session.pk).update(last_seen_at=timezone.now()-timedelta(hours=1),
            expires_at=timezone.now()+timedelta(minutes=1))
        session.refresh_from_db()
        sessions.touch_session(session)
        self.assertGreater(self.reader.session_actor(self.tokens[18])['expires_at'], timezone.now()+timedelta(hours=1))
        sessions.revoke_session(session)
        self.assertIsNone(self.reader.session_actor(self.tokens[18]))
        row, token = invitations.create_reset(account)
        invitations.complete_reset(token, 'Synthetic-Harbour-92!')
        self.assertIsNone(self.reader.pending_token('reset', row.token_hash))
        self.assertTrue(security.verify_password('Synthetic-Harbour-92!',
            self.reader.account_for_login('draft@example.test')['password_hash']))

    def test_canonical_evidence_and_onboarding_facts_preserve_namespaces(self):
        class ProfileError(Exception):
            def __init__(self, message, code, status):
                self.code, self.status = code, status
                super().__init__(message)
        profile = self.reader.profile_for_enrolment(271, error_type=ProfileError)
        self.assertEqual((profile['id'],profile['enrolment_id'],profile['account_record_id']), (510,271,271))
        self.assertEqual(profile['programme_planned_hours'], '0')
        self.assertEqual(self.reader.learner_access_facts(272)['learner_type'], 'apprenticeship')
        self.assertEqual(self.reader.cohort_access_facts('C')['cohort_id'], 'C')
        self.sql('UPDATE enrolment."Created_users" SET "Email"=\'conflict@example.test\' WHERE id=271')
        try:
            with self.assertRaises(ProfileError) as caught:
                self.reader.profile_for_enrolment(271, error_type=ProfileError)
            self.assertEqual((caught.exception.code,caught.exception.status), ('identity_review_required',409))
        finally:
            self.sql('UPDATE enrolment."Created_users" SET "Email"=\'learner@example.test\' WHERE id=271')

    def test_database_unavailability_propagates_without_legacy_fallback(self):
        with connections['enrolment'].execute_wrapper(self.forbid_source):
            with patch.object(connections[ALIAS], 'cursor', side_effect=DatabaseError('synthetic outage')):
                with self.assertRaises(DatabaseError):
                    self.reader.me(self.tokens[17])
