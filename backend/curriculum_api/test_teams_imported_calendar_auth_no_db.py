"""Credential/identity boundaries for imported-calendar consent; no Graph/DB calls."""
import base64
import json
import time
from contextlib import contextmanager
from types import SimpleNamespace
from urllib.parse import parse_qs, urlencode, urlsplit
from unittest.mock import Mock, patch

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from django.core import signing
from django.core.cache import cache
from django.test import RequestFactory, SimpleTestCase, override_settings

from . import teams_imported_calendar_auth as auth


REAL_CONFIGURATION = auth._configuration
TENANT = '11111111-1111-4111-8111-111111111111'
OID = '22222222-2222-4222-8222-222222222222'
CONFIG = {'client_id': 'test-client', 'client_secret': 'test-client-secret', 'tenant': TENANT,
          'callback': 'http://localhost/login_api/microsoft/callback/', 'callbackOrigin': 'http://localhost'}
SERIES = {'id': 'LIVE-TEST', 'meeting_type': 'linked-external', 'status': 'active',
          'join_url': 'https://teams.microsoft.com/test-original-meeting', 'organizer_email': 'group@example.test'}


@override_settings(DEBUG=True, SESSION_COOKIE_SECURE=False,
                   CACHES={'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache',
                                       'LOCATION': 'teams-imported-calendar-auth-tests'}})
class ImportedCalendarConnectionTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.env = patch.dict('os.environ', {'CREDENTIAL_ENCRYPTION_KEY': 'isolated-test-key'})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.series = patch.object(auth, '_series', return_value=dict(SERIES))
        self.series_mock = self.series.start()
        self.addCleanup(self.series.stop)
        self.configuration = patch.object(auth, '_configuration', return_value=dict(CONFIG))
        self.configuration.start()
        self.addCleanup(self.configuration.stop)
        cache.clear()
        self.addCleanup(cache.clear)

    def request(self, method='get', data=None, *, account=1, session=2):
        if method == 'post':
            request = self.factory.post('/connect/', json.dumps(data or {'calendarKind': 'group'}),
                                        content_type='application/json', HTTP_ORIGIN='http://localhost')
        else:
            request = self.factory.get('/login_api/microsoft/callback/', data or {})
        request.login_account = SimpleNamespace(pk=account, role='staff')
        request.login_session = SimpleNamespace(pk=session)
        return request

    def begin(self, kind='group'):
        with patch.object(auth, '_frontend_origin', return_value='http://localhost'):
            response = auth.imported_calendar_connect(self.request('post', {'calendarKind': kind}), 'LIVE-TEST')
        self.assertEqual(response.status_code, 200)
        payload = json.loads(response.content)
        query = parse_qs(urlsplit(payload['authorizationUrl']).query)
        return response, query

    def finish(self, response, query, *, account=1, session=2):
        request = self.request(data={'state': query['state'][0], 'code': 'one-use-code'},
                               account=account, session=session)
        request.COOKIES[auth.NONCE_COOKIE] = response.cookies[auth.NONCE_COOKIE].value
        return auth.imported_calendar_callback(request)

    def grant(self):
        return {'accessToken': 'private-access-token', 'actorId': OID,
                'scopes': ['User.Read', 'Group.ReadWrite.All'], 'calendarKind': 'group',
                'expires': int(time.time()) + 500, 'accountName': 'Test organiser',
                'accountEmail': 'organiser@example.test'}, 500

    @contextmanager
    def real_proxy_configuration(self):
        """Exercise real origin/config validation with entirely synthetic settings."""
        self.series_mock.return_value = {
            **SERIES,
            'join_url': 'https://teams.microsoft.com/test-original-meeting?' + urlencode({
                'context': json.dumps({'Tid': TENANT, 'Oid': OID}),
            }),
        }
        with (
            override_settings(ALLOWED_HOSTS=['localhost', '127.0.0.1', 'testserver'],
                              CSRF_TRUSTED_ORIGINS=['http://localhost:3000', 'http://127.0.0.1:3000']),
            patch.object(auth, '_configuration', wraps=REAL_CONFIGURATION),
            patch('login.microsoft_sso.config', return_value=dict(CONFIG)),
            patch('login.microsoft_sso.missing_settings', return_value=[]),
            patch('coach_api.views.get_graph_settings', return_value={'tenant_id': TENANT}),
            patch('login.invitations.frontend_base_url', return_value='http://localhost:3000'),
        ):
            yield

    def proxy_request(self, method='get', data=None, *, origin=None):
        request = self.request(method, data)
        request.META['HTTP_HOST'] = '127.0.0.1:8000'
        request.META.pop('HTTP_ORIGIN', None)
        if origin is not None:
            request.META['HTTP_ORIGIN'] = origin
        return request

    def test_proxy_host_does_not_block_allowed_localhost_browser_and_callback(self):
        with self.real_proxy_configuration():
            request = self.proxy_request('post', origin='http://localhost:3000')
            response = auth.imported_calendar_connect(request, 'LIVE-TEST')
        self.assertEqual(response.status_code, 200)
        payload = json.loads(response.content)
        query = parse_qs(urlsplit(payload['authorizationUrl']).query)
        self.assertEqual(query['redirect_uri'], [CONFIG['callback']])
        self.assertEqual(payload['callbackOrigin'], 'http://localhost')
        self.assertIn(auth.NONCE_COOKIE, response.cookies)
        state = signing.loads(query['state'][0][len(auth.STATE_PREFIX):], salt=auth.STATE_SALT)
        pending = auth._unseal(cache.get('teams-calendar:pending:' + state['n']))
        self.assertEqual(pending['origin'], 'http://localhost:3000')

    def test_actual_browser_ip_cannot_share_localhost_callback_cookie(self):
        with self.real_proxy_configuration():
            response = auth.imported_calendar_connect(
                self.proxy_request('post', origin='http://127.0.0.1:3000'), 'LIVE-TEST',
            )
        self.assertEqual(response.status_code, 503)
        self.assertIn('browser host', json.loads(response.content)['error'])
        self.assertNotIn('authorizationUrl', json.loads(response.content))
        self.assertNotIn(auth.NONCE_COOKIE, response.cookies)

    def test_proxy_callback_and_access_without_origin_use_saved_browser_origin(self):
        with self.real_proxy_configuration():
            started = auth.imported_calendar_connect(
                self.proxy_request('post', origin='http://localhost:3000'), 'LIVE-TEST',
            )
            self.assertEqual(started.status_code, 200)
            query = parse_qs(urlsplit(json.loads(started.content)['authorizationUrl']).query)
            callback = self.proxy_request(data={'state': query['state'][0], 'code': 'one-use-code'})
            callback.COOKIES[auth.NONCE_COOKIE] = started.cookies[auth.NONCE_COOKIE].value
            self.assertNotIn('Origin', callback.headers)
            with patch.object(auth, '_exchange', return_value=self.grant()):
                completed = auth.imported_calendar_callback(callback)
            self.assertIn('"ok": true', completed.content.decode())
            key = auth._access_key({'account': '1', 'session': '2'}, 'LIVE-TEST')
            self.assertEqual(auth._unseal(cache.get(key))['origin'], 'http://localhost:3000')
            access_request = self.proxy_request()
            self.assertNotIn('Origin', access_request.headers)
            access = auth.delegated_calendar_access(access_request, 'LIVE-TEST')
            self.assertEqual(access['accessToken'], 'private-access-token')
            status = auth.imported_calendar_connection(self.proxy_request(), 'LIVE-TEST')
        self.assertTrue(json.loads(status.content)['connected'])
        self.assertNotIn('private-access-token', completed.content.decode())
        self.assertNotIn('private-access-token', status.content.decode())

    def test_proxy_readiness_without_origin_remains_configured_before_connection(self):
        with self.real_proxy_configuration():
            request = self.proxy_request()
            self.assertNotIn('Origin', request.headers)
            response = auth.imported_calendar_connection(request, 'LIVE-TEST')
        self.assertEqual(response.status_code, 200)
        self.assertTrue(json.loads(response.content)['configured'])
        self.assertFalse(json.loads(response.content)['connected'])

    def test_legacy_credential_without_saved_origin_requires_reconnect(self):
        with self.real_proxy_configuration():
            record, ttl = self.grant()
            record.update(binding={'account': '1', 'session': '2'},
                          seriesBinding=auth._series_binding(self.series_mock.return_value),
                          tenant=TENANT, clientId=CONFIG['client_id'])
            key = auth._access_key(record['binding'], 'LIVE-TEST')
            cache.set(key, auth._seal(record), ttl)
            self.assertIsNone(auth.delegated_calendar_access(self.proxy_request(), 'LIVE-TEST'))
            response = auth.imported_calendar_connection(self.proxy_request(), 'LIVE-TEST')
        self.assertTrue(json.loads(response.content)['configured'])
        self.assertFalse(json.loads(response.content)['connected'])

    def test_proxy_connect_rejects_untrusted_origin_despite_allowed_upstream_host(self):
        with self.real_proxy_configuration():
            request = self.proxy_request('post', origin='https://untrusted.example.test')
            request.META['HTTP_X_FORWARDED_HOST'] = 'localhost:3000'
            response = auth.imported_calendar_connect(request, 'LIVE-TEST')
        self.assertEqual(response.status_code, 403)
        self.assertEqual(json.loads(response.content)['code'], 'calendar_connection_origin')
        self.assertNotIn('authorizationUrl', json.loads(response.content))
        self.assertNotIn(auth.NONCE_COOKIE, response.cookies)

    def test_connect_requests_only_selected_calendar_scope_with_pkce_and_bound_nonce(self):
        response, query = self.begin()
        self.assertEqual(query['scope'], ['openid User.Read Group.ReadWrite.All'])
        self.assertNotIn('offline_access', query['scope'][0])
        self.assertEqual(query['code_challenge_method'], ['S256'])
        self.assertEqual(query['redirect_uri'], [CONFIG['callback']])
        self.assertTrue(response.cookies[auth.NONCE_COOKIE]['httponly'])
        self.assertEqual(response.cookies[auth.NONCE_COOKIE]['samesite'], 'Lax')
        signed = signing.loads(query['state'][0][len(auth.STATE_PREFIX):], salt=auth.STATE_SALT)
        pending = auth._unseal(cache.get('teams-calendar:pending:' + signed['n']))
        self.assertEqual(pending['binding'], {'account': '1', 'session': '2'})
        self.assertEqual(pending['liveId'], 'LIVE-TEST')
        self.assertNotIn(pending['verifier'], response.content.decode())
        self.assertIn('no-store', response['Cache-Control'])
        self.assertFalse(getattr(auth.imported_calendar_connect, 'csrf_exempt', False))

    def test_user_calendar_scope_is_separate(self):
        _, query = self.begin('user')
        self.assertEqual(query['scope'], ['openid User.Read Calendars.ReadWrite'])

    def test_completion_stores_encrypted_session_scoped_token_and_status_never_returns_it(self):
        response, query = self.begin()
        with patch.object(auth, '_exchange', return_value=self.grant()) as exchange:
            completed = self.finish(response, query)
        exchange.assert_called_once()
        self.assertNotIn('private-access-token', completed.content.decode())
        self.assertIn('"ok": true', completed.content.decode())
        self.assertIn('no-store', completed['Cache-Control'])
        raw = cache.get(auth._access_key({'account': '1', 'session': '2'}, 'LIVE-TEST'))
        self.assertIsInstance(raw, str)
        self.assertNotIn('private-access-token', raw)
        status = auth.imported_calendar_connection(self.request(), 'LIVE-TEST')
        self.assertTrue(json.loads(status.content)['connected'])
        self.assertNotIn('private-access-token', status.content.decode())
        self.assertIsNone(auth.delegated_calendar_access(self.request(session=3), 'LIVE-TEST'))
        self.assertIsNone(auth.delegated_calendar_access(self.request(account=3), 'LIVE-TEST'))

    def test_other_session_and_missing_nonce_cannot_redeem_the_connection(self):
        response, query = self.begin()
        with patch.object(auth, '_exchange') as exchange:
            completed = self.finish(response, query, session=3)
            without_cookie = auth.imported_calendar_callback(self.request(data={'state': query['state'][0], 'code': 'code'}))
        exchange.assert_not_called()
        self.assertNotIn('"ok": true', completed.content.decode())
        self.assertNotIn('"ok": true', without_cookie.content.decode())

    def test_successful_callback_cannot_be_replayed(self):
        response, query = self.begin()
        with patch.object(auth, '_exchange', return_value=self.grant()) as exchange:
            self.finish(response, query)
            replay = self.finish(response, query)
        exchange.assert_called_once()
        self.assertNotIn('"ok": true', replay.content.decode())

    def test_replaced_link_invalidates_pending_and_existing_credentials(self):
        response, query = self.begin()
        self.series_mock.return_value = {**SERIES, 'join_url': 'https://teams.microsoft.com/different-meeting'}
        with patch.object(auth, '_exchange') as exchange:
            completed = self.finish(response, query)
        exchange.assert_not_called()
        self.assertIn('changed', completed.content.decode())
        self.series_mock.return_value = dict(SERIES)
        response, query = self.begin()
        with patch.object(auth, '_exchange', return_value=self.grant()):
            self.finish(response, query)
        self.series_mock.return_value = {**SERIES, 'join_url': 'https://teams.microsoft.com/different-meeting'}
        self.assertIsNone(auth.delegated_calendar_access(self.request(), 'LIVE-TEST'))

    def test_expired_or_unreadable_credentials_are_not_connected(self):
        response, query = self.begin()
        expired, ttl = self.grant()
        expired['expires'] = int(time.time()) - 1
        with patch.object(auth, '_exchange', return_value=(expired, ttl)):
            self.finish(response, query)
        self.assertIsNone(auth.delegated_calendar_access(self.request(), 'LIVE-TEST'))
        cache.set(auth._access_key({'account': '1', 'session': '2'}, 'LIVE-TEST'), 'not-ciphertext', 60)
        self.assertIsNone(auth.delegated_calendar_access(self.request(), 'LIVE-TEST'))

    def test_untrusted_frontend_origin_is_refused(self):
        request = self.request('post')
        request.META['HTTP_ORIGIN'] = 'https://untrusted.example.test'
        with self.assertRaises(auth.CalendarConnectionError):
            auth._frontend_origin(request)


class CalendarIdentityVerificationTests(SimpleTestCase):
    def signed_token(self, **changes):
        private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        now = time.time()
        claims = {'aud': CONFIG['client_id'], 'tid': TENANT, 'oid': OID,
                  'iss': f'{auth.AUTHORITY}/{TENANT}/v2.0', 'nonce': 'expected-nonce',
                  'exp': now + 3600, 'nbf': now - 10, 'iat': now - 10, **changes}
        encode = lambda value: base64.urlsafe_b64encode(value).decode().rstrip('=')
        header = encode(json.dumps({'alg': 'RS256', 'kid': 'test-key'}).encode())
        payload = encode(json.dumps(claims).encode())
        data = f'{header}.{payload}'
        signature = encode(private.sign(data.encode(), padding.PKCS1v15(), hashes.SHA256()))
        numbers = private.public_key().public_numbers()
        integer = lambda value: encode(value.to_bytes((value.bit_length() + 7) // 8, 'big'))
        response = Mock()
        response.json.return_value = {'keys': [{'kid': 'test-key', 'kty': 'RSA', 'use': 'sig',
                                              'n': integer(numbers.n), 'e': integer(numbers.e)}]}
        client = Mock()
        client.get.return_value = response
        return data + '.' + signature, client

    def test_signed_tenant_identity_is_checked_before_accepting_calendar_account(self):
        token, client = self.signed_token()
        result = auth._verified_id_claims(token, CONFIG, 'expected-nonce', client)
        self.assertEqual(result['oid'], OID)
        client.get.assert_called_once_with(f'{auth.AUTHORITY}/{TENANT}/discovery/v2.0/keys')

    def test_wrong_tenant_audience_nonce_or_expired_identity_is_refused(self):
        for change in ({'tid': OID}, {'aud': 'other-client'}, {'nonce': 'other-browser'}, {'exp': time.time() - 1}):
            with self.subTest(change=list(change)):
                token, client = self.signed_token(**change)
                with self.assertRaises(auth.CalendarConnectionError):
                    auth._verified_id_claims(token, CONFIG, 'expected-nonce', client)

    def test_unsigned_or_tampered_token_is_refused(self):
        token, client = self.signed_token()
        parts = token.split('.')
        parts[1] = base64.urlsafe_b64encode(json.dumps({'oid': OID}).encode()).decode().rstrip('=')
        with self.assertRaises(auth.CalendarConnectionError):
            auth._verified_id_claims('.'.join(parts), CONFIG, 'expected-nonce', client)
        with self.assertRaises(auth.CalendarConnectionError):
            auth._verified_id_claims('not-a-jwt', CONFIG, 'expected-nonce', client)
