"""Step 3: OAuth 2.1 for MCP connectors -- DB-free.

The DB-backed suites cannot start (docs/mcp/README.md), so the four MCP managers
and ``LoginAccount`` are replaced by a small in-memory store (``FakeStore``) and
the flow runs through the real views and ``mcp_api.oauth``. The real-database
round trip is ``manage.py mcp_selfcheck --mode oauth`` on the test branch.
"""
import json
import logging
from datetime import timedelta
from itertools import count
from types import SimpleNamespace
from unittest import mock
from urllib.parse import parse_qs, urlsplit

from django.core.cache import cache
from django.db import DatabaseError
from django.test import Client, SimpleTestCase
from django.utils import timezone

from learner_api.models import StaffUser
from mcp_api import auth, oauth, views
from mcp_api.crypto import hash_token

BASE = "https://lms.example.com"
REDIRECT = "https://claude.ai/api/mcp/auth_callback"
VERIFIER = "v" * 43 + "-._~0123456789"
CHALLENGE = oauth.pkce_s256(VERIFIER)


# --- in-memory stand-in for the four tables + LoginAccount -----------------------

class Row(SimpleNamespace):
    def save(self, update_fields=None):
        pass


class FakeQuerySet:
    def __init__(self, rows):
        self._rows = list(rows)

    @staticmethod
    def _match(row, key, value):
        if key == "pk":
            key = "id"
        if key.endswith("__isnull"):
            return (getattr(row, key[: -len("__isnull")]) is None) == value
        return getattr(row, key) == value

    def filter(self, **lookups):
        return FakeQuerySet(r for r in self._rows if all(self._match(r, k, v) for k, v in lookups.items()))

    def select_related(self, *fields):
        return self

    def select_for_update(self):
        return self

    def first(self):
        return self._rows[0] if self._rows else None

    def update(self, **values):
        for row in self._rows:
            for key, value in values.items():
                setattr(row, key, value)
        return len(self._rows)


class FakeManager:
    def __init__(self, rows, factory=None):
        self.rows = rows
        self.factory = factory

    def filter(self, **lookups):
        return FakeQuerySet(self.rows).filter(**lookups)

    def select_related(self, *fields):
        return FakeQuerySet(self.rows)

    def select_for_update(self):
        return FakeQuerySet(self.rows)

    def create(self, **values):
        row = self.factory(**values)
        self.rows.append(row)
        return row


class FakeStore:
    def __init__(self):
        self.ids = count(1)
        self.accounts, self.clients, self.codes, self.tokens = [], [], [], []
        self.accesses = {}

    def _row(self, **values):
        pk = next(self.ids)
        return Row(id=pk, pk=pk, created_at=timezone.now(), **values)

    def account(self, role="staff", subject_type="staff", accesses=("curriculum",), **values):
        row = self._row(role=role, subject_type=subject_type, is_active=True, locked_until=None,
                        password_set_at=None, display_name="Dana Designer", email="dana@example.com")
        for key, value in values.items():
            setattr(row, key, value)
        self.accounts.append(row)
        self.accesses[row.pk] = frozenset(accesses)
        return row

    def _client(self, **values):
        return self._row(disabled_at=None, **values)

    def _code(self, client, **values):
        return self._row(client_id=client.client_id, used_at=None, **values)

    def _token(self, client, account_id, **values):
        account = next(a for a in self.accounts if a.pk == account_id)
        return self._row(client=client, client_id=client.client_id, account=account, account_id=account_id,
                         revoked_at=None, revoked_reason=None, last_used_at=None, **values)

    def patches(self):
        clients = SimpleNamespace(objects=FakeManager(self.clients, self._client))
        codes = SimpleNamespace(objects=FakeManager(self.codes, self._code))
        tokens = SimpleNamespace(objects=FakeManager(self.tokens, self._token))
        accounts = SimpleNamespace(objects=FakeManager(self.accounts))
        no_tx = mock.MagicMock()
        return [
            mock.patch.object(oauth, "McpOAuthClient", clients),
            mock.patch.object(oauth, "McpOAuthCode", codes),
            mock.patch.object(oauth, "McpOAuthToken", tokens),
            mock.patch.object(oauth, "LoginAccount", accounts),
            mock.patch.object(auth, "McpOAuthToken", tokens),
            # oauth and auth share django.db.transaction; one patch covers both.
            mock.patch.object(oauth.transaction, "atomic", no_tx),
            mock.patch.object(auth, "_accesses_of", lambda account: self.accesses.get(account.pk, frozenset())),
        ]


class OAuthTestCase(SimpleTestCase):
    def setUp(self):
        self.enterContext(mock.patch.dict("os.environ", {
            "MCP_ENABLED": "1",
            "MCP_PUBLIC_BASE_URL": BASE,
            "MCP_ALLOWED_REDIRECT_HOSTS": "claude.ai,localhost",
        }, clear=False))
        self.store = FakeStore()
        for patcher in self.store.patches():
            self.enterContext(patcher)
        self.signed_in = None
        self.enterContext(mock.patch.object(views, "authenticate_request", lambda request: self.signed_in))
        cache.clear()
        self.client = Client()
        self.staff = self.store.account()

    # --- helpers ---

    def register(self, redirect_uris=(REDIRECT,)):
        response = self.client.post("/oauth/register", json.dumps({
            "client_name": "Claude", "redirect_uris": list(redirect_uris),
        }), content_type="application/json")
        return response

    def registered(self):
        response = self.register()
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()["client_id"]

    def authorize_params(self, client_id, **overrides):
        params = {
            "response_type": "code", "client_id": client_id, "redirect_uri": REDIRECT,
            "code_challenge": CHALLENGE, "code_challenge_method": "S256",
            "state": "st-123", "scope": "lms.curriculum", "resource": f"{BASE}/mcp",
        }
        params.update(overrides)
        return {k: v for k, v in params.items() if v is not None}

    def consent(self, client_id, account=None, decision="allow"):
        self.signed_in = account or self.staff
        response = self.client.post("/oauth/authorize", {**self.authorize_params(client_id), "decision": decision})
        self.assertEqual(response.status_code, 302)
        return parse_qs(urlsplit(response["Location"]).query)

    def exchange(self, client_id, code, verifier=VERIFIER, redirect_uri=REDIRECT):
        return self.client.post("/oauth/token", {
            "grant_type": "authorization_code", "client_id": client_id, "code": code,
            "redirect_uri": redirect_uri, "code_verifier": verifier,
        })

    def tokens(self, account=None):
        client_id = self.registered()
        code = self.consent(client_id, account)["code"][0]
        response = self.exchange(client_id, code)
        self.assertEqual(response.status_code, 200, response.content)
        return client_id, response.json()

    def refresh(self, client_id, refresh_token):
        return self.client.post("/oauth/token", {
            "grant_type": "refresh_token", "client_id": client_id, "refresh_token": refresh_token,
        })

    def bearer(self, access_token):
        return auth.resolve_bearer(SimpleNamespace(headers={"Authorization": f"Bearer {access_token}"}))


class HappyPathTests(OAuthTestCase):
    def test_register_consent_exchange_and_use(self):
        client_id = self.registered()
        self.signed_in = self.staff

        page = self.client.get("/oauth/authorize", self.authorize_params(client_id))
        self.assertEqual(page.status_code, 200)
        self.assertContains(page, "Claude")
        self.assertContains(page, "claude.ai")  # redirect host shown
        self.assertContains(page, "Dana Designer")
        self.assertEqual(page["X-Frame-Options"], "DENY")
        self.assertEqual(page["Content-Security-Policy"], "frame-ancestors 'none'")
        self.assertNotIn("Access-Control-Allow-Origin", page)

        query = self.consent(client_id)
        self.assertEqual(query["state"], ["st-123"])
        response = self.exchange(client_id, query["code"][0])
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Cache-Control"], "no-store")
        body = response.json()
        self.assertEqual(body["token_type"], "Bearer")
        self.assertEqual(body["scope"], "lms.curriculum")
        self.assertEqual(body["expires_in"], 3600)

        account, token = self.bearer(body["access_token"])
        self.assertIs(account, self.staff)
        # Only hashes are stored.
        self.assertEqual(token.access_hash, hash_token(body["access_token"]))
        self.assertEqual(token.family_id, oauth.family_for_code(hash_token(query["code"][0])))

    def test_consent_is_shown_every_time(self):
        client_id, _ = self.tokens()
        page = self.client.get("/oauth/authorize", self.authorize_params(client_id))
        self.assertEqual(page.status_code, 200)
        self.assertContains(page, 'value="allow"')

    def test_deny_redirects_with_access_denied(self):
        client_id = self.registered()
        query = self.consent(client_id, decision="deny")
        self.assertEqual(query["error"], ["access_denied"])
        self.assertEqual(query["state"], ["st-123"])
        self.assertNotIn("code", query)

    def test_signed_out_user_gets_the_signin_page_with_a_same_origin_continue(self):
        client_id = self.registered()
        params = self.authorize_params(client_id)
        page = self.client.get("/oauth/authorize", params)
        self.assertEqual(page.status_code, 401)
        self.assertEqual(page["X-Frame-Options"], "DENY")
        self.assertEqual(page["Content-Security-Policy"], "frame-ancestors 'none'")
        continue_url = page.context["continue_url"]
        self.assertTrue(continue_url.startswith("/oauth/authorize?"))
        self.assertTrue(page.context["login_url"].endswith("/login"))


class AuthorizeValidationTests(OAuthTestCase):
    def assertRedirectError(self, params, error):
        self.signed_in = self.staff
        response = self.client.get("/oauth/authorize", params)
        self.assertEqual(response.status_code, 302)
        self.assertTrue(response["Location"].startswith(REDIRECT))
        query = parse_qs(urlsplit(response["Location"]).query)
        self.assertEqual(query["error"], [error])
        self.assertEqual(query["state"], ["st-123"])

    def test_missing_pkce_is_refused(self):
        client_id = self.registered()
        self.assertRedirectError(self.authorize_params(client_id, code_challenge=None), "invalid_request")

    def test_plain_pkce_is_refused(self):
        client_id = self.registered()
        self.assertRedirectError(
            self.authorize_params(client_id, code_challenge_method="plain", code_challenge=VERIFIER),
            "invalid_request",
        )

    def test_unsupported_scope_and_foreign_resource_are_refused(self):
        client_id = self.registered()
        self.assertRedirectError(self.authorize_params(client_id, scope="lms.everything"), "invalid_scope")
        self.assertRedirectError(
            self.authorize_params(client_id, resource="https://evil.example/mcp"), "invalid_target"
        )

    def test_unregistered_client_gets_an_error_page_not_a_redirect(self):
        self.signed_in = self.staff
        response = self.client.get("/oauth/authorize", self.authorize_params("mcp_unknown"))
        self.assertEqual(response.status_code, 400)
        self.assertNotIn("Location", response)

    def test_redirect_mismatch_gets_an_error_page_not_a_redirect(self):
        client_id = self.registered()
        self.signed_in = self.staff
        response = self.client.get(
            "/oauth/authorize", self.authorize_params(client_id, redirect_uri="https://claude.ai/other")
        )
        self.assertEqual(response.status_code, 400)
        self.assertNotIn("Location", response)

    def test_consent_post_without_csrf_is_rejected(self):
        client_id = self.registered()
        self.signed_in = self.staff
        response = Client(enforce_csrf_checks=True).post(
            "/oauth/authorize", {**self.authorize_params(client_id), "decision": "allow"}
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.store.codes, [])


class ConsentAccessTests(OAuthTestCase):
    def consent_status(self, account):
        client_id = self.registered()
        self.signed_in = account
        get = self.client.get("/oauth/authorize", self.authorize_params(client_id)).status_code
        post = self.client.post(
            "/oauth/authorize", {**self.authorize_params(client_id), "decision": "allow"}
        ).status_code
        return get, post

    def test_refused_accounts(self):
        for label, account in (
            ("learner", self.store.account(role="learner", subject_type="learner", accesses=())),
            ("employer", self.store.account(role="employer", subject_type="employer", accesses=())),
            ("staff without curriculum", self.store.account(accesses=("coach",))),
            ("staff with no grant", self.store.account(accesses=())),
        ):
            with self.subTest(account=label):
                self.assertEqual(self.consent_status(account), (403, 403))
        self.assertEqual(self.store.codes, [])

    def test_allowed_accounts(self):
        for label, account in (
            ("curriculum staff", self.staff),
            ("super-admin", self.store.account(role="admin", accesses=("super-admin",))),
        ):
            with self.subTest(account=label):
                self.assertEqual(self.consent_status(account), (200, 302))


class TokenEndpointTests(OAuthTestCase):
    def code(self):
        client_id = self.registered()
        return client_id, self.consent(client_id)["code"][0]

    def assertInvalidGrant(self, response):
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"], "invalid_grant")
        self.assertEqual(response["Cache-Control"], "no-store")

    def test_wrong_verifier_fails_and_burns_the_code(self):
        client_id, code = self.code()
        self.assertInvalidGrant(self.exchange(client_id, code, verifier="w" * 43))
        self.assertInvalidGrant(self.exchange(client_id, code))
        self.assertEqual(self.store.tokens, [])

    def test_code_reuse_revokes_the_tokens_it_issued(self):
        client_id, code = self.code()
        body = self.exchange(client_id, code).json()
        refreshed = self.refresh(client_id, body["refresh_token"]).json()
        self.assertInvalidGrant(self.exchange(client_id, code))
        self.assertIsNone(self.bearer(body["access_token"]))
        self.assertIsNone(self.bearer(refreshed["access_token"]))
        self.assertTrue(all(t.revoked_at for t in self.store.tokens))

    def test_expired_code(self):
        client_id, code = self.code()
        self.store.codes[0].expires_at = timezone.now() - timedelta(seconds=1)
        self.assertInvalidGrant(self.exchange(client_id, code))

    def test_redirect_mismatch_at_exchange(self):
        client_id, code = self.code()
        self.assertInvalidGrant(self.exchange(client_id, code, redirect_uri="https://claude.ai/other"))

    def test_code_bound_to_its_client(self):
        _, code = self.code()
        other = self.registered()
        self.assertInvalidGrant(self.exchange(other, code))

    def test_unknown_client_is_invalid_client(self):
        response = self.exchange("mcp_unknown", "x")
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["error"], "invalid_client")

    def test_password_change_between_consent_and_exchange(self):
        client_id, code = self.code()
        self.staff.password_set_at = self.store.codes[0].created_at + timedelta(seconds=1)
        self.assertInvalidGrant(self.exchange(client_id, code))


class RefreshTests(OAuthTestCase):
    def test_rotation(self):
        client_id, first = self.tokens()
        second = self.refresh(client_id, first["refresh_token"])
        self.assertEqual(second.status_code, 200)
        second = second.json()
        self.assertNotEqual(second["refresh_token"], first["refresh_token"])
        self.assertIsNone(self.bearer(first["access_token"]))
        self.assertIsNotNone(self.bearer(second["access_token"]))
        self.assertEqual(self.store.tokens[0].revoked_reason, "rotated")
        self.assertEqual(self.store.tokens[0].family_id, self.store.tokens[1].family_id)

    def test_reuse_revokes_the_whole_family(self):
        client_id, first = self.tokens()
        second = self.refresh(client_id, first["refresh_token"]).json()
        reused = self.refresh(client_id, first["refresh_token"])
        self.assertEqual(reused.json()["error"], "invalid_grant")
        self.assertIsNone(self.bearer(second["access_token"]))
        self.assertEqual(self.refresh(client_id, second["refresh_token"]).json()["error"], "invalid_grant")
        self.assertEqual(self.store.tokens[1].revoked_reason, "refresh_reuse")

    def test_refresh_after_password_change_revokes_the_family(self):
        client_id, first = self.tokens()
        self.staff.password_set_at = timezone.now() + timedelta(seconds=1)
        self.assertEqual(self.refresh(client_id, first["refresh_token"]).json()["error"], "invalid_grant")
        self.assertEqual(self.store.tokens[0].revoked_reason, "credential_changed")
        self.assertEqual(len(self.store.tokens), 1)

    def test_refresh_cannot_widen_scope(self):
        client_id, first = self.tokens()
        response = self.client.post("/oauth/token", {
            "grant_type": "refresh_token", "client_id": client_id,
            "refresh_token": first["refresh_token"], "scope": "lms.curriculum lms.everything",
        })
        self.assertEqual(response.json()["error"], "invalid_scope")
        self.assertIsNone(self.store.tokens[0].revoked_at)  # not rotated
        self.assertEqual(self.refresh(client_id, first["refresh_token"]).status_code, 200)


class BearerRuleTests(OAuthTestCase):
    """The 3.8 rule, checked on every bearer call."""

    def test_deactivated_account_is_rejected_and_family_revoked(self):
        _, body = self.tokens()
        self.staff.is_active = False
        self.assertIsNone(self.bearer(body["access_token"]))
        self.assertEqual(self.store.tokens[0].revoked_reason, "account_inactive")
        self.staff.is_active = True  # restored later: the family stays dead
        self.assertIsNone(self.bearer(body["access_token"]))

    def test_password_change_after_issue_is_rejected(self):
        _, body = self.tokens()
        self.staff.password_set_at = self.store.tokens[0].created_at + timedelta(seconds=1)
        self.assertIsNone(self.bearer(body["access_token"]))
        self.assertEqual(self.store.tokens[0].revoked_reason, "credential_changed")

    def test_password_set_before_issue_is_fine(self):
        self.staff.password_set_at = timezone.now() - timedelta(days=1)
        _, body = self.tokens()
        self.assertIsNotNone(self.bearer(body["access_token"]))

    def test_sso_only_account_without_a_password_is_fine(self):
        self.assertIsNone(self.staff.password_set_at)
        client_id, body = self.tokens()
        self.assertIsNotNone(self.bearer(body["access_token"]))
        self.assertEqual(self.refresh(client_id, body["refresh_token"]).status_code, 200)

    def test_grant_removed_is_rejected_on_the_next_call_without_destroying_tokens(self):
        _, body = self.tokens()
        self.store.accesses[self.staff.pk] = frozenset({"coach"})
        self.assertIsNone(self.bearer(body["access_token"]))
        self.assertIsNone(self.store.tokens[0].revoked_at)
        self.store.accesses[self.staff.pk] = frozenset({"curriculum"})
        self.assertIsNotNone(self.bearer(body["access_token"]))

    def test_lockout_refuses_without_destroying_tokens(self):
        _, body = self.tokens()
        self.staff.locked_until = timezone.now() + timedelta(minutes=5)
        self.assertIsNone(self.bearer(body["access_token"]))
        self.assertIsNone(self.store.tokens[0].revoked_at)

    def test_expired_access_token_and_bad_headers(self):
        _, body = self.tokens()
        self.store.tokens[0].expires_at = timezone.now() - timedelta(seconds=1)
        self.assertIsNone(self.bearer(body["access_token"]))
        for header in ("", "Basic abc", "Bearer", f"Token {body['access_token']}", "Bearer a b"):
            with self.subTest(header=header):
                self.assertIsNone(auth.resolve_bearer(SimpleNamespace(headers={"Authorization": header})))


class RevokeAndRegisterTests(OAuthTestCase):
    def test_revoke_kills_the_family_and_always_answers_200(self):
        client_id, body = self.tokens()
        response = self.client.post("/oauth/revoke", {"token": body["refresh_token"], "client_id": client_id})
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(self.bearer(body["access_token"]))
        self.assertEqual(self.client.post("/oauth/revoke", {"token": "unknown"}).status_code, 200)

    def test_another_client_cannot_revoke(self):
        _, body = self.tokens()
        other = self.registered()
        self.client.post("/oauth/revoke", {"token": body["access_token"], "client_id": other})
        self.assertIsNotNone(self.bearer(body["access_token"]))

    def test_redirect_host_allowlist(self):
        for uri, ok in (
            ("https://evil.example/cb", False),
            ("http://claude.ai/cb", False),
            ("https://user:pw@claude.ai/cb", False),
            ("https://claude.ai/cb#frag", False),
            ("https://claude.ai/cb", True),
        ):
            with self.subTest(uri=uri):
                response = self.register([uri])
                self.assertEqual(response.status_code, 201 if ok else 400)
                if not ok:
                    self.assertEqual(response.json()["error"], "invalid_redirect_uri")

    def test_http_loopback_only_on_dev_or_branch(self):
        with mock.patch("mcp_api.settings.loopback_http_allowed", return_value=True):
            self.assertEqual(self.register(["http://localhost:6274/oauth/callback"]).status_code, 201)
        with mock.patch("mcp_api.settings.loopback_http_allowed", return_value=False):
            self.assertEqual(self.register(["http://localhost:6274/oauth/callback"]).status_code, 400)

    def test_confidential_clients_are_refused(self):
        response = self.client.post("/oauth/register", json.dumps({
            "redirect_uris": [REDIRECT], "token_endpoint_auth_method": "client_secret_basic",
        }), content_type="application/json")
        self.assertEqual(response.json()["error"], "invalid_client_metadata")

    def test_registration_is_rate_limited_per_ip(self):
        with mock.patch.object(views, "REGISTRATIONS_PER_HOUR", 2):
            statuses = [self.register().status_code for _ in range(3)]
        self.assertEqual(statuses, [201, 201, 429])


class MetadataAndMisconfigTests(OAuthTestCase):
    def test_metadata(self):
        resource = self.client.get("/.well-known/oauth-protected-resource").json()
        self.assertEqual(resource["resource"], f"{BASE}/mcp/")
        self.assertEqual(resource["authorization_servers"], [BASE])
        server = self.client.get("/.well-known/oauth-authorization-server")
        self.assertEqual(server["Cache-Control"], "public, max-age=3600")
        self.assertEqual(server["Access-Control-Allow-Origin"], "*")
        body = server.json()
        self.assertEqual(body["token_endpoint"], f"{BASE}/oauth/token")
        self.assertEqual(body["code_challenge_methods_supported"], ["S256"])
        self.assertEqual(body["token_endpoint_auth_methods_supported"], ["none"])

    def test_blank_base_url_fails_closed_everywhere(self):
        with mock.patch.dict("os.environ", {"MCP_PUBLIC_BASE_URL": " "}), \
                self.assertLogs("mcp_api", level="ERROR"):
            for method, url in (
                ("get", "/.well-known/oauth-protected-resource"),
                ("get", "/.well-known/oauth-authorization-server"),
                ("get", "/oauth/authorize"),
                ("post", "/oauth/token"),
                ("post", "/oauth/register"),
                ("post", "/oauth/revoke"),
                ("post", "/mcp/"),
            ):
                with self.subTest(url=url):
                    response = getattr(self.client, method)(url)
                    self.assertEqual(response.status_code, 503)
                    self.assertEqual(response.json()["code"], "mcp_misconfigured")
                    self.assertNotIn("WWW-Authenticate", response)


class NoSecretsInLogsTests(OAuthTestCase):
    def test_events_never_carry_codes_tokens_or_hashes(self):
        with self.assertLogs("mcp_api.oauth", level="INFO") as logs:
            client_id = self.registered()
            code = self.consent(client_id)["code"][0]
            body = self.exchange(client_id, code).json()
            refreshed = self.refresh(client_id, body["refresh_token"]).json()
            self.refresh(client_id, body["refresh_token"])  # reuse
            self.client.post("/oauth/revoke", {"token": refreshed["access_token"]})
        secrets_ = {code, body["access_token"], body["refresh_token"], refreshed["access_token"],
                    refreshed["refresh_token"], VERIFIER, CHALLENGE, client_id}
        secrets_ |= {hash_token(s) for s in list(secrets_)}
        names = {record.event for record in logs.records}
        self.assertTrue({"mcp.client_registered", "mcp.consent_granted", "mcp.token_issued",
                         "mcp.token_refreshed", "mcp.refresh_reuse_detected", "mcp.token_revoked"} <= names)
        for record in logs.records:
            dumped = json.dumps(record.__dict__, default=str)
            for secret in secrets_:
                self.assertNotIn(secret, dumped)


class HasMcpAccessTests(SimpleTestCase):
    """Pins the wrapped ``login.permissions._accesses_of`` behaviour (real, not mocked)."""

    def allowed(self, role, subject_type="staff", access="", access_extra="", raises=False):
        account = SimpleNamespace(role=role, subject_type=subject_type, subject_id=7)
        manager = mock.MagicMock()
        query = manager.filter.return_value.only.return_value
        if raises:
            query.first.side_effect = DatabaseError("down")
        else:
            query.first.return_value = SimpleNamespace(access=access, access_extra=access_extra)
        with mock.patch.object(StaffUser, "objects", manager):
            return auth.has_mcp_access(account)

    def test_allowed(self):
        self.assertTrue(self.allowed("staff", access="curriculum"))
        self.assertTrue(self.allowed("staff", access="coach", access_extra="curriculum"))
        self.assertTrue(self.allowed("admin", access="super-admin"))

    def test_refused(self):
        self.assertFalse(self.allowed("staff", access="coach"))
        self.assertFalse(self.allowed("staff", access=""))
        self.assertFalse(self.allowed("learner", subject_type="learner"))
        self.assertFalse(self.allowed("employer", subject_type="employer"))
        self.assertFalse(self.allowed("staff", access="curriculum", raises=True))
        self.assertFalse(auth.has_mcp_access(None))
