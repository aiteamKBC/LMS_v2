"""Run only through a verified non-production PostgreSQL runner.

Creates the additive connection table idempotently and cleans only this test's
random tenant/client keys. No flush, shared fixture cleanup, or live HTTP.
"""
import copy
from concurrent.futures import ThreadPoolExecutor
import importlib
import json
import threading
import time
from types import SimpleNamespace
from unittest.mock import Mock, patch
from urllib.parse import urlencode
import uuid

from django.db import connection, connections
from django.test import SimpleTestCase

from . import teams_organization_calendar as org, teams_imported_calendar_auth as auth


class OrganizationCalendarSqlTests(SimpleTestCase):
    databases = {'default'}

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        assert connection.vendor == 'postgresql', 'Use the verified PostgreSQL runner'
        migration = importlib.import_module('curriculum_api.migrations.0075_teams_organization_calendar_connection')
        with connection.schema_editor() as editor:
            migration.create_connection_table(None, editor)
            migration.create_connection_table(None, editor)

    def setUp(self):
        self.tenant = str(uuid.uuid4())
        self.cfg = {'tenant': self.tenant, 'client_id': 'org-sql-' + uuid.uuid4().hex, 'client_secret': 'synthetic-secret'}
        self.oid = str(uuid.uuid4())
        self.series = {'organizer_email': 'synthetic@example.invalid',
                       'join_url': 'https://teams.microsoft.com/synthetic?' + urlencode({'context': json.dumps({'Tid': self.tenant})})}
        self.patches = [patch.dict('os.environ', {'CREDENTIAL_ENCRYPTION_KEY': 'synthetic-organization-sql-key'}),
                        patch.object(org, 'group_calendar', return_value=True)]
        for patcher in self.patches:
            patcher.start()
            self.addCleanup(patcher.stop)
        self.addCleanup(self.clean_own_rows)

    def clean_own_rows(self):
        with connection.cursor() as cursor:
            cursor.execute(f'DELETE FROM {org.TABLE} WHERE tenant_id=%s', [self.tenant])

    def request(self, account=1, role='admin'):
        return SimpleNamespace(login_account=SimpleNamespace(pk=account, role=role),
                               login_session=SimpleNamespace(pk=account + 100))

    def grant(self, **changes):
        return {'accessToken': 'synthetic-access', 'refreshToken': 'synthetic-refresh', 'actorId': self.oid,
                'scopes': ['User.Read', 'Group.ReadWrite.All'], 'calendarKind': 'group',
                'expires': int(time.time()) + 3600, **changes}

    def test_migration_and_shared_encrypted_access_preserve_tenant_and_app_scope(self):
        self.assertTrue(org.schema_ready())
        org.save(self.request(), self.cfg, self.grant(), '')
        row = org._load(self.cfg)
        self.assertNotIn('synthetic-refresh', row['credential_ciphertext'])
        self.assertNotIn('synthetic-access', row['credential_ciphertext'])
        access = org.access(self.request(2, 'staff'), self.series, self.cfg)
        self.assertTrue(access['organizationManaged'])
        self.assertEqual(access['lmsAccountId'], '2')
        self.assertIsNone(org.access(self.request(2, 'staff'), self.series, {**self.cfg, 'client_id': 'other-app'}))
        self.assertEqual(org._load(self.cfg)['credential_ciphertext'], row['credential_ciphertext'])

    def test_concurrent_sql_renewal_posts_once_and_persists_rotated_refresh(self):
        org.save(self.request(), self.cfg, self.grant(expires=int(time.time()) - 1), '')
        before = org._load(self.cfg)
        barrier = threading.Barrier(2)
        client = Mock()
        client.post.return_value = Mock(status_code=200, json=Mock(return_value={
            'token_type': 'Bearer', 'scope': 'User.Read Group.ReadWrite.All', 'expires_in': 3600,
            'access_token': 'renewed-sql-access', 'refresh_token': 'rotated-sql-refresh',
        }))
        client.get.return_value = Mock(status_code=200, json=Mock(return_value={'id': self.oid}))

        def worker(account):
            try:
                return org.access(self.request(account, 'staff'), self.series, self.cfg)
            finally:
                connections.close_all()

        with patch.object(org, 'group_calendar', side_effect=lambda series: (barrier.wait(15), True)[1]), \
             patch.object(org.httpx, 'Client') as transport:
            transport.return_value.__enter__.return_value = client
            with ThreadPoolExecutor(max_workers=2) as pool:
                futures = [pool.submit(worker, number) for number in (2, 3)]
                values = [future.result(timeout=30) for future in futures]
        self.assertEqual([item['accessToken'] for item in values], ['renewed-sql-access', 'renewed-sql-access'])
        client.post.assert_called_once()
        current = org._load(self.cfg)
        self.assertEqual(current['revision'], before['revision'])
        self.assertEqual(org._unseal(self.cfg, current)['refreshToken'], 'rotated-sql-refresh')

    def test_revocation_marker_commits_after_failed_renewal_and_leaves_another_app_unchanged(self):
        org.save(self.request(), self.cfg, self.grant(expires=int(time.time()) - 1), '')
        other = {**self.cfg, 'client_id': self.cfg['client_id'] + '-other'}
        org.save(self.request(), other, self.grant(), '')
        unrelated = copy.deepcopy(org._load(other))
        with patch.object(org, '_refresh', return_value=None) as refresh:
            with self.assertRaises(auth.CalendarConnectionError):
                org.access(self.request(2, 'staff'), self.series, self.cfg)
            with self.assertRaises(auth.CalendarConnectionError):
                org.access(self.request(3, 'staff'), self.series, self.cfg)
        refresh.assert_called_once()
        row = org._load(self.cfg)
        self.assertEqual(row['status'], 'reauth_required')
        self.assertIsNone(row['credential_ciphertext'])
        self.assertEqual(org._load(other), unrelated)

    def test_stale_admin_callbacks_and_disconnects_cannot_replace_a_new_connection(self):
        org.save(self.request(), self.cfg, self.grant(), '')
        before = copy.deepcopy(org._load(self.cfg))
        with self.assertRaises(auth.CalendarConnectionError):
            org.save(self.request(2), self.cfg, self.grant(accessToken='stale-new-access'), '')
        self.assertEqual(org._load(self.cfg), before)
        org.disconnect(self.request(), self.cfg, before['revision'])
        disconnected = copy.deepcopy(org._load(self.cfg))
        self.assertIsNone(disconnected['credential_ciphertext'])
        with self.assertRaises(auth.CalendarConnectionError):
            org.disconnect(self.request(), self.cfg, before['revision'])
        self.assertEqual(org._load(self.cfg), disconnected)
