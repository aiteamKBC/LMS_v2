"""Synthetic identity, renewal, revocation and concurrency; no DB/live network."""
import copy
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
import json
import threading
import time
from types import SimpleNamespace
from unittest.mock import Mock, patch
from urllib.parse import parse_qs, urlencode, urlsplit

from django.test import RequestFactory, SimpleTestCase, override_settings
from django.core.cache import cache

from . import teams_organization_calendar as org, teams_imported_calendar_auth as auth
from . import teams_imported_calendar_update as imported

TENANT = '11111111-1111-4111-8111-111111111111'
OID = '22222222-2222-4222-8222-222222222222'
CFG = {'tenant': TENANT, 'client_id': 'synthetic-client', 'client_secret': 'synthetic-secret',
       'callback': 'http://localhost/login_api/microsoft/callback/', 'callbackOrigin': 'http://localhost'}
SERIES = {'id': 'LIVE-ORG', 'meeting_type': 'linked-external', 'status': 'active',
          'organizer_email': 'group@example.invalid',
          'join_url': 'https://teams.microsoft.com/synthetic?' + urlencode({'context': json.dumps({'Tid': TENANT, 'Oid': OID})})}


@override_settings(DEBUG=True, SESSION_COOKIE_SECURE=False,
                   CACHES={'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}})
class OrganizationCalendarTests(SimpleTestCase):
    def setUp(self):
        self.rows = {}
        self.lock = threading.Lock()
        self.factory = RequestFactory()
        self.patchers = [
            patch.dict('os.environ', {'CREDENTIAL_ENCRYPTION_KEY': 'synthetic-organization-key'}),
            patch.object(org, 'schema_ready', return_value=True),
            patch.object(org, 'group_calendar', return_value=True),
            patch.object(org, '_load', side_effect=lambda cfg: copy.deepcopy(self.rows.get(org._key(cfg)))),
            patch.object(org, '_store', side_effect=lambda cfg, row: self.rows.__setitem__(org._key(cfg), copy.deepcopy(row))),
            patch.object(org, '_locked', side_effect=self.locked),
            patch.object(auth, '_series', return_value=dict(SERIES)),
            patch.object(auth, '_configuration', return_value=dict(CFG)),
            patch.object(auth, '_frontend_origin', return_value='http://localhost'),
            patch('login.microsoft_sso.config', return_value=dict(CFG)),
            patch('coach_api.views.get_graph_settings', return_value={'tenant_id': TENANT}),
        ]
        for patcher in self.patchers:
            patcher.start()
            self.addCleanup(patcher.stop)
        cache.clear()
        self.addCleanup(cache.clear)

    @contextmanager
    def locked(self, cfg):
        with self.lock:
            yield

    def request(self, role='admin', account=1, session=2, data=None, method='get'):
        request = (self.factory.post('/connect/', json.dumps(data or {}), content_type='application/json')
                   if method == 'post' else self.factory.get('/connection/', data or {}))
        request.login_account = SimpleNamespace(pk=account, role=role)
        request.login_session = SimpleNamespace(pk=session)
        return request

    def grant(self, **changes):
        return {'actorId': OID, 'accessToken': 'secret-access', 'refreshToken': 'secret-refresh',
                'scopes': ['User.Read', 'Group.ReadWrite.All'], 'calendarKind': 'group',
                'expires': int(time.time()) + 3600, 'accountName': 'Synthetic administrator',
                'accountEmail': 'admin@example.invalid', **changes}

    def connect(self, **changes):
        org.save(self.request(), CFG, self.grant(**changes), '')
        return self.rows[org._key(CFG)]

    def refresh_client(self, status=200, **changes):
        client = Mock()
        data = {'token_type': 'Bearer', 'scope': 'User.Read Group.ReadWrite.All', 'expires_in': 3600,
                'access_token': 'renewed-access', 'refresh_token': 'rotated-refresh', **changes}
        client.post.return_value = Mock(status_code=status, json=Mock(return_value=data))
        client.get.return_value = Mock(status_code=200, json=Mock(return_value={'id': OID}))
        return client

    @contextmanager
    def transport(self, client):
        with patch.object(org.httpx, 'Client') as factory:
            factory.return_value.__enter__.return_value = client
            yield

    def test_staff_use_the_encrypted_organization_grant_across_sessions_without_reconnecting(self):
        row = self.connect()
        self.assertNotIn('secret-access', row['credential_ciphertext'])
        self.assertNotIn('secret-refresh', row['credential_ciphertext'])
        with patch.object(org, '_refresh') as refresh:
            first = org.access(self.request('staff', 7, 10), SERIES, CFG)
            second = org.access(self.request('staff', 8, 11), SERIES, CFG)
        self.assertEqual(first['accessToken'], 'secret-access')
        self.assertEqual(second['accessToken'], first['accessToken'])
        self.assertNotEqual(first['lmsAccountId'], second['lmsAccountId'])
        self.assertTrue(first['organizationManaged'])
        refresh.assert_not_called()

    def test_no_organization_grant_keeps_the_existing_application_fallback(self):
        with patch.object(auth, '_configuration') as configuration, patch.object(auth, '_series') as series:
            self.assertIsNone(org.for_series(self.request('staff'), SERIES['id']))
        configuration.assert_not_called()
        series.assert_not_called()

    def test_only_an_admin_can_create_or_disconnect_shared_access(self):
        self.connect()
        revision = self.rows[org._key(CFG)]['revision']
        before = copy.deepcopy(self.rows)
        for role in ('staff', 'learner', 'coach'):
            with self.subTest(role=role):
                for operation in (lambda: org.begin(self.request(role), CFG),
                                  lambda: org.save(self.request(role), CFG, self.grant(), revision),
                                  lambda: org.disconnect(self.request(role), CFG, revision)):
                    with self.assertRaises(auth.CalendarConnectionError) as caught:
                        operation()
                    self.assertEqual(caught.exception.status, 403)
        self.assertEqual(self.rows, before)

    def test_refresh_rotates_secret_and_reuses_it_without_changing_configuration_revision(self):
        row = self.connect(expires=int(time.time()) - 1)
        client = self.refresh_client()
        with self.transport(client):
            result = org.access(self.request('staff'), SERIES, CFG)
            again = org.access(self.request('staff', 3, 4), SERIES, CFG)
        self.assertEqual(result['accessToken'], 'renewed-access')
        self.assertEqual(again['accessToken'], result['accessToken'])
        client.post.assert_called_once()
        client.get.assert_called_once()
        fresh = self.rows[org._key(CFG)]
        self.assertEqual(fresh['revision'], row['revision'])
        self.assertEqual(org._unseal(CFG, fresh)['refreshToken'], 'rotated-refresh')
        self.assertNotIn('rotated-refresh', fresh['credential_ciphertext'])

    def test_concurrent_reads_refresh_once_and_both_receive_the_same_new_access(self):
        self.connect(expires=int(time.time()) - 1)
        barrier = threading.Barrier(2)
        client = self.refresh_client()
        with self.transport(client), patch.object(org, 'group_calendar', side_effect=lambda series: (barrier.wait(5), True)[1]):
            with ThreadPoolExecutor(max_workers=2) as pool:
                futures = [pool.submit(org.access, self.request('staff', index + 3), SERIES, CFG) for index in range(2)]
                results = [future.result(timeout=10) for future in futures]
        self.assertEqual([value['accessToken'] for value in results], ['renewed-access', 'renewed-access'])
        client.post.assert_called_once()

    def test_revoked_refresh_is_persisted_as_reauth_required_and_never_retried_as_app_access(self):
        self.connect(expires=int(time.time()) - 1)
        client = self.refresh_client(400, error='invalid_grant')
        with self.transport(client):
            for _ in range(2):
                with self.assertRaises(auth.CalendarConnectionError):
                    org.access(self.request('staff'), SERIES, CFG)
        self.assertEqual(self.rows[org._key(CFG)]['status'], 'reauth_required')
        self.assertIsNone(self.rows[org._key(CFG)]['credential_ciphertext'])
        client.post.assert_called_once()
        with patch.object(org, 'for_series', side_effect=auth.CalendarConnectionError('Reconnect')), \
             patch('coach_api.views.microsoft_graph_token') as application:
            with self.assertRaises(auth.CalendarConnectionError):
                imported.access_for(self.request('staff'), SERIES['id'])
        application.assert_not_called()

    def test_transient_refresh_failure_preserves_the_stored_credential_for_retry(self):
        self.connect(expires=int(time.time()) - 1)
        before = copy.deepcopy(self.rows)
        with self.transport(self.refresh_client(503)):
            with self.assertRaises(auth.CalendarConnectionError) as caught:
                org.access(self.request('staff'), SERIES, CFG)
        self.assertEqual(caught.exception.status, 503)
        self.assertEqual(self.rows, before)

    def test_oauth_client_and_temporary_errors_preserve_the_connection_instead_of_requesting_new_consent(self):
        self.connect(expires=int(time.time()) - 1)
        before = copy.deepcopy(self.rows)
        for reason in ('invalid_client', 'temporarily_unavailable'):
            with self.subTest(reason=reason), self.transport(self.refresh_client(400, error=reason)):
                with self.assertRaises(auth.CalendarConnectionError) as caught:
                    org.access(self.request('staff'), SERIES, CFG)
                self.assertEqual(caught.exception.status, 503)
                self.assertEqual(self.rows, before)

    def test_malformed_successful_responses_do_not_destroy_the_refresh_credential(self):
        self.connect(expires=int(time.time()) - 1)
        before = copy.deepcopy(self.rows)
        for data in ([], {'access_token': 'fresh', 'expires_in': 3600, 'token_type': 'Bearer', 'refresh_token': {}}):
            client = self.refresh_client()
            client.post.return_value.json.return_value = data
            with self.subTest(data=type(data).__name__), self.transport(client):
                with self.assertRaises(auth.CalendarConnectionError) as caught:
                    org.access(self.request('staff'), SERIES, CFG)
                self.assertEqual(caught.exception.status, 503)
                self.assertEqual(self.rows, before)

    def test_a_refresh_with_reduced_permissions_or_another_identity_cannot_be_used(self):
        for change in ('scope', 'identity'):
            self.rows.clear()
            self.connect(expires=int(time.time()) - 1)
            client = self.refresh_client(**({'scope': 'User.Read'} if change == 'scope' else {}))
            if change == 'identity':
                client.get.return_value.json.return_value = {'id': TENANT}
            with self.subTest(change=change), self.transport(client):
                with self.assertRaises(auth.CalendarConnectionError):
                    org.access(self.request('staff'), SERIES, CFG)
            self.assertEqual(self.rows[org._key(CFG)]['status'], 'reauth_required')

    def test_other_tenants_apps_user_calendars_and_unauthorised_roles_cannot_borrow_the_grant(self):
        self.connect()
        with self.assertRaises(auth.CalendarConnectionError):
            org.access(self.request('staff'), {**SERIES, 'join_url': 'https://example.invalid/no-tenant'}, CFG)
        for role in ('learner', 'coach'):
            with self.assertRaises(auth.CalendarConnectionError):
                org.access(self.request(role), SERIES, CFG)
        self.assertIsNone(org.access(self.request('staff'), SERIES, {**CFG, 'client_id': 'another-app'}))
        with patch.object(org, 'group_calendar', return_value=False):
            self.assertIsNone(org.access(self.request('staff'), SERIES, CFG))

    def test_disconnect_clears_secrets_and_a_stale_admin_action_cannot_remove_a_new_connection(self):
        old = self.connect()
        org.save(self.request(), CFG, self.grant(accessToken='new-owner-access'), old['revision'])
        current = copy.deepcopy(self.rows[org._key(CFG)])
        with self.assertRaises(auth.CalendarConnectionError):
            org.disconnect(self.request(), CFG, old['revision'])
        self.assertEqual(self.rows[org._key(CFG)], current)
        org.disconnect(self.request(), CFG, current['revision'])
        self.assertIsNone(self.rows[org._key(CFG)]['credential_ciphertext'])
        self.assertIsNone(org.access(self.request('staff'), SERIES, CFG))

    def test_missing_encryption_configuration_does_not_discard_the_existing_grant(self):
        self.connect()
        before = copy.deepcopy(self.rows)
        with patch.dict('os.environ', {'CREDENTIAL_ENCRYPTION_KEY': ''}):
            with self.assertRaises(auth.CalendarConnectionError) as caught:
                org.access(self.request('staff'), SERIES, CFG)
        self.assertEqual(caught.exception.status, 503)
        self.assertEqual(self.rows, before)

    def test_unreadable_ciphertext_stays_available_for_configuration_recovery(self):
        self.connect()
        self.rows[org._key(CFG)]['credential_ciphertext'] = 'unreadable-synthetic-ciphertext'
        before = copy.deepcopy(self.rows)
        with self.assertRaises(auth.CalendarConnectionError) as caught:
            org.access(self.request('staff'), SERIES, CFG)
        self.assertEqual(caught.exception.code, 'organization_calendar_storage_unreadable')
        self.assertEqual(self.rows, before)

    def test_staff_status_exposes_capability_but_never_credentials(self):
        self.connect()
        response = auth.imported_calendar_connection(self.request('staff', data={'organization': '1'}), SERIES['id'])
        data = json.loads(response.content)
        self.assertTrue(data['connected'])
        self.assertTrue(data['organizationManaged'])
        self.assertFalse(data['canManageOrganization'])
        for secret in ('secret-access', 'secret-refresh', 'synthetic-secret'):
            self.assertNotIn(secret, response.content.decode())

    def test_admin_connect_requests_renewable_access_but_staff_cannot_start_it(self):
        payload = {'calendarKind': 'group', 'organizationManaged': True}
        denied = auth.imported_calendar_connect(self.request('staff', data=payload, method='post'), SERIES['id'])
        self.assertEqual(denied.status_code, 403)
        started = auth.imported_calendar_connect(self.request(data=payload, method='post'), SERIES['id'])
        self.assertEqual(started.status_code, 200)
        query = parse_qs(urlsplit(json.loads(started.content)['authorizationUrl']).query)
        self.assertEqual(query['scope'], [org.OAUTH_SCOPE])
        self.assertIn('offline_access', query['scope'][0])
        self.assertEqual(query['code_challenge_method'], ['S256'])

    def test_failed_original_calendar_verification_does_not_store_a_shared_grant(self):
        started = auth.imported_calendar_connect(self.request(data={'calendarKind': 'group', 'organizationManaged': True}, method='post'), SERIES['id'])
        query = parse_qs(urlsplit(json.loads(started.content)['authorizationUrl']).query)
        callback = self.request(data={'state': query['state'][0], 'code': 'synthetic-one-use-code'})
        callback.COOKIES[auth.NONCE_COOKIE] = started.cookies[auth.NONCE_COOKIE].value
        client = Mock()
        client.__enter__ = Mock(return_value=client)
        client.__exit__ = Mock(return_value=False)
        with patch.object(auth, '_exchange', return_value=(self.grant(), 500)), \
             patch.object(imported, 'CalendarClient', return_value=client), \
             patch.object(imported, 'original_master', side_effect=imported.GraphRefusal(403)):
            response = auth.imported_calendar_callback(callback)
        self.assertIn('No organization connection was saved', response.content.decode())
        self.assertFalse(self.rows)

    def test_verified_callback_makes_access_available_to_other_staff_without_creating_a_meeting(self):
        started = auth.imported_calendar_connect(self.request(data={'calendarKind': 'group', 'organizationManaged': True}, method='post'), SERIES['id'])
        query = parse_qs(urlsplit(json.loads(started.content)['authorizationUrl']).query)
        callback = self.request(data={'state': query['state'][0], 'code': 'synthetic-one-use-code'})
        callback.COOKIES[auth.NONCE_COOKIE] = started.cookies[auth.NONCE_COOKIE].value
        client = Mock()
        client.__enter__ = Mock(return_value=client)
        client.__exit__ = Mock(return_value=False)
        master = {'isOrganizer': True, 'type': 'seriesMaster', 'onlineMeeting': {'joinUrl': SERIES['join_url']}}
        with patch.object(auth, '_exchange', return_value=(self.grant(), 500)), \
             patch.object(imported, 'CalendarClient', return_value=client), \
             patch.object(imported, 'original_master', return_value=('groups/SYNTHETIC/events/MASTER', master)), \
             patch('login.microsoft_sso.missing_settings', return_value=[]):
            response = auth.imported_calendar_callback(callback)
            access = imported.access_for(self.request('staff', 8, 9), SERIES['id'])
        self.assertIn('"ok": true', response.content.decode())
        self.assertTrue(access['organizationManaged'])
        self.assertEqual(access['lmsAccountId'], '8')
        self.assertNotIn('secret-refresh', response.content.decode())
        client.extend.assert_not_called()
        client.client.patch.assert_not_called()

    def test_downgraded_admin_cannot_complete_an_organization_connection(self):
        started = auth.imported_calendar_connect(self.request(data={'calendarKind': 'group', 'organizationManaged': True}, method='post'), SERIES['id'])
        query = parse_qs(urlsplit(json.loads(started.content)['authorizationUrl']).query)
        callback = self.request('staff', data={'state': query['state'][0], 'code': 'synthetic-code'})
        callback.COOKIES[auth.NONCE_COOKIE] = started.cookies[auth.NONCE_COOKIE].value
        with patch.object(auth, '_exchange') as exchange:
            response = auth.imported_calendar_callback(callback)
        exchange.assert_not_called()
        self.assertNotIn('"ok": true', response.content.decode())
        self.assertFalse(self.rows)
