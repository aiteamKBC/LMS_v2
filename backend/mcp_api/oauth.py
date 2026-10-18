"""OAuth 2.1 authorization-server logic for MCP connectors (no HTTP in here).

Public clients only (``token_endpoint_auth_method: none``), PKCE S256 required,
codes single use for ``MCP_CODE_TTL`` seconds, refresh tokens rotated on every use.

Token families
--------------
Every token row carries a ``family_id``: all rows descended from one consent share
it. It is ``uuid5(FAMILY_NAMESPACE, code_hash)`` -- derived from the authorization
code's SHA-256 hash, so a reused code finds exactly the tokens it minted (and
their refreshed descendants) without storing a code reference on the token row.
Refresh-token reuse and every permanent rejection revoke the whole family.

Failure paths inside the locked transactions return an ``OAuthError`` instead of
raising it, so what they write -- a burned code, a revoked family -- commits.
"""
import base64
import hashlib
import hmac
import re
import secrets
import uuid
from datetime import timedelta
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from django.db import transaction
from django.utils import timezone

from learner_api.routers import ENROLMENT_DB
from login.models import LoginAccount

from . import settings as mcp_settings
from .auth import PERMANENT_REASONS, rejection_reason, revoke_family
from .crypto import hash_token, new_token
from .events import event
from .models import McpOAuthClient, McpOAuthCode, McpOAuthToken

#: Fixed namespace for ``family_for_code``. Changing it would orphan nothing (the
#: family is stored on each row) but would stop code-reuse detection for codes
#: issued before the change, so it never changes.
FAMILY_NAMESPACE = uuid.UUID("6f1d2b8e-4c2a-5b7e-9a51-3d0c8e2f7a19")

#: RFC 7636 code_verifier: 43-128 unreserved characters.
VERIFIER_RE = re.compile(r"^[A-Za-z0-9\-._~]{43,128}$")
#: An S256 challenge is base64url(SHA-256) without padding: exactly 43 characters.
CHALLENGE_RE = re.compile(r"^[A-Za-z0-9\-_]{43}$")

MAX_REDIRECT_URIS = 10
MAX_CLIENT_NAME = 100


class OAuthError(Exception):
    """An RFC 6749 error: ``error`` code, human description, HTTP status."""

    def __init__(self, error, description, status=400):
        super().__init__(description)
        self.error = error
        self.description = description
        self.status = status


# --- primitives ---------------------------------------------------------------

def family_for_code(code_hash):
    return uuid.uuid5(FAMILY_NAMESPACE, code_hash)


def pkce_s256(verifier):
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def verify_pkce(verifier, challenge):
    if not VERIFIER_RE.match(verifier or "") or not challenge:
        return False
    return hmac.compare_digest(pkce_s256(verifier), challenge)


def add_query(uri, params):
    """``uri`` with ``params`` appended, keeping any query it already has."""
    parts = urlsplit(uri)
    query = parse_qsl(parts.query, keep_blank_values=True)
    query += [(key, value) for key, value in params.items() if value is not None]
    return urlunsplit(parts._replace(query=urlencode(query)))


def redirect_uri_problem(uri):
    """Why ``uri`` may not be registered, or None if it may."""
    try:
        parts = urlsplit(uri)
        host = (parts.hostname or "").lower()
        parts.port  # noqa: B018 - raises ValueError on a malformed port
    except (TypeError, ValueError):
        return "is not a valid URL"
    if not host or parts.username or parts.password or parts.fragment:
        return "must be an absolute URL with no credentials or fragment"
    if host not in mcp_settings.allowed_redirect_hosts():
        return f"host {host!r} is not allowed"
    if parts.scheme == "https":
        return None
    if parts.scheme == "http" and host in mcp_settings.LOOPBACK_HOSTS and mcp_settings.loopback_http_allowed():
        return None
    return "must use https"


def resource_url():
    return f"{mcp_settings.public_base_url()}/mcp/"


# --- registration (RFC 7591) ----------------------------------------------------

def register_client(data):
    if not isinstance(data, dict):
        raise OAuthError("invalid_client_metadata", "Body must be a JSON object.")
    method = data.get("token_endpoint_auth_method", "none")
    if method != "none":
        raise OAuthError("invalid_client_metadata", "Only public clients (auth method 'none') are supported.")
    for key, allowed in (("grant_types", {"authorization_code", "refresh_token"}), ("response_types", {"code"})):
        values = data.get(key)
        if values is not None and (not isinstance(values, list) or not set(values) <= allowed):
            raise OAuthError("invalid_client_metadata", f"Unsupported {key}.")
    uris = data.get("redirect_uris")
    if not isinstance(uris, list) or not uris or len(uris) > MAX_REDIRECT_URIS or not all(isinstance(u, str) for u in uris):
        raise OAuthError("invalid_redirect_uri", f"Give 1-{MAX_REDIRECT_URIS} redirect_uris.")
    for uri in uris:
        problem = redirect_uri_problem(uri)
        if problem:
            raise OAuthError("invalid_redirect_uri", f"Redirect URI {problem}.")
    name = " ".join(str(data.get("client_name") or "").split())[:MAX_CLIENT_NAME] or "MCP client"

    client = McpOAuthClient.objects.create(
        client_id=f"mcp_{secrets.token_urlsafe(24)}", client_name=name, redirect_uris=uris
    )
    event("mcp.client_registered", client=client, outcome="created")
    return client


def client_body(client):
    return {
        "client_id": client.client_id,
        "client_id_issued_at": int(client.created_at.timestamp()),
        "client_name": client.client_name,
        "redirect_uris": client.redirect_uris,
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "none",
    }


def active_client(client_id):
    if not client_id:
        return None
    return McpOAuthClient.objects.filter(client_id=client_id, disabled_at__isnull=True).first()


# --- authorization request ------------------------------------------------------

class AuthorizeError(Exception):
    """A bad authorization request.

    ``redirect`` False: the client or redirect URI could not be trusted, so the
    user sees an error page. True: the error goes back to the validated redirect.
    """

    def __init__(self, error, description, *, redirect, redirect_uri=None, state=None):
        super().__init__(description)
        self.error = error
        self.description = description
        self.redirect = redirect
        self.redirect_uri = redirect_uri
        self.state = state

    def redirect_url(self):
        return add_query(self.redirect_uri, {"error": self.error, "error_description": self.description, "state": self.state})


def validate_authorization_request(params):
    """``(client, request)`` for valid ``/oauth/authorize`` parameters, else AuthorizeError."""
    client = active_client(params.get("client_id"))
    if client is None:
        raise AuthorizeError("invalid_client", "This application is not registered with the LMS.", redirect=False)
    redirect_uri = params.get("redirect_uri", "")
    if redirect_uri not in client.redirect_uris:
        raise AuthorizeError("invalid_request", "The return address does not match this application's registration.", redirect=False)

    state = params.get("state")

    def fail(error, description):
        return AuthorizeError(error, description, redirect=True, redirect_uri=redirect_uri, state=state)

    if params.get("response_type") != "code":
        raise fail("unsupported_response_type", "response_type must be 'code'.")
    if params.get("code_challenge_method") != "S256" or not CHALLENGE_RE.match(params.get("code_challenge", "")):
        raise fail("invalid_request", "PKCE with code_challenge_method=S256 is required.")
    scopes = set((params.get("scope") or mcp_settings.SCOPE).split())
    if not scopes <= {mcp_settings.SCOPE}:
        raise fail("invalid_scope", f"Only the {mcp_settings.SCOPE!r} scope is supported.")
    resource = params.get("resource")
    if resource and resource.rstrip("/") != resource_url().rstrip("/"):
        raise fail("invalid_target", "This server only issues tokens for its own /mcp/ endpoint.")

    return client, {
        "client_id": client.client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "code_challenge": params["code_challenge"],
        "code_challenge_method": "S256",
        "scope": mcp_settings.SCOPE,
        "state": state,
        "resource": resource,
    }


def create_code(client, account, request):
    """Mint a code for an approved consent. Returns the plaintext (only place it exists)."""
    code = new_token()
    McpOAuthCode.objects.create(
        code_hash=hash_token(code),
        client=client,
        account_id=account.pk,
        code_challenge=request["code_challenge"],
        redirect_uri=request["redirect_uri"],
        scope=request["scope"],
        expires_at=timezone.now() + timedelta(seconds=mcp_settings.code_ttl()),
    )
    return code


# --- token endpoint -------------------------------------------------------------

def _issue(account_id, client, family_id, scope):
    access, refresh = new_token(), new_token()
    now = timezone.now()
    McpOAuthToken.objects.create(
        access_hash=hash_token(access),
        refresh_hash=hash_token(refresh),
        family_id=family_id,
        client=client,
        account_id=account_id,
        scope=scope,
        expires_at=now + timedelta(seconds=mcp_settings.access_ttl()),
        refresh_expires_at=now + timedelta(seconds=mcp_settings.refresh_ttl()),
    )
    return {
        "access_token": access,
        "token_type": "Bearer",
        "expires_in": mcp_settings.access_ttl(),
        "refresh_token": refresh,
        "scope": scope,
    }


def _invalid_grant(description="The grant is invalid, expired or already used."):
    return OAuthError("invalid_grant", description)


def exchange_code(client, code, redirect_uri, verifier):
    """authorization_code grant. Returns the token body or raises OAuthError."""
    if not code or not redirect_uri or not verifier:
        raise OAuthError("invalid_request", "code, redirect_uri and code_verifier are required.")
    code_hash = hash_token(code)
    with transaction.atomic(using=ENROLMENT_DB):
        result = _exchange_locked(client, code_hash, redirect_uri, verifier)
    if isinstance(result, OAuthError):
        raise result
    return result


def _exchange_locked(client, code_hash, redirect_uri, verifier):
    row = McpOAuthCode.objects.select_for_update().filter(code_hash=code_hash).first()
    if row is None:
        return _invalid_grant()
    if row.used_at is not None:
        # RFC 6749 4.1.2: a replayed code revokes what it already issued.
        revoked = revoke_family(family_for_code(code_hash), "code_reuse")
        event("mcp.token_revoked", account_id=row.account_id, client=client, reason="code_reuse", row_count=revoked)
        return _invalid_grant()

    now = timezone.now()
    # Burned on the first presentation, whatever happens next.
    row.used_at = now
    row.save(update_fields=["used_at"])

    if row.expires_at <= now:
        return _invalid_grant("The authorization code has expired.")
    if row.client_id != client.client_id or not hmac.compare_digest(row.redirect_uri, redirect_uri):
        return _invalid_grant()
    if not verify_pkce(verifier, row.code_challenge):
        return _invalid_grant("PKCE verification failed.")
    account = LoginAccount.objects.filter(pk=row.account_id).first()
    if account is None or rejection_reason(account, row.created_at, now) is not None:
        return _invalid_grant("This account can no longer connect.")

    body = _issue(account.pk, client, family_for_code(code_hash), row.scope)
    event("mcp.token_issued", account_id=account.pk, client=client, outcome="authorization_code")
    return body


def refresh(client, refresh_token, scope=None):
    """refresh_token grant with rotation and reuse detection."""
    if not refresh_token:
        raise OAuthError("invalid_request", "refresh_token is required.")
    with transaction.atomic(using=ENROLMENT_DB):
        result = _refresh_locked(client, hash_token(refresh_token), scope)
    if isinstance(result, OAuthError):
        raise result
    return result


def _refresh_locked(client, refresh_hash, scope):
    row = McpOAuthToken.objects.select_for_update().filter(refresh_hash=refresh_hash).first()
    if row is None or row.client_id != client.client_id:
        return _invalid_grant()
    if row.revoked_at is not None:
        revoked = revoke_family(row.family_id, "refresh_reuse")
        event("mcp.refresh_reuse_detected", account_id=row.account_id, client=client, row_count=revoked)
        return _invalid_grant()

    now = timezone.now()
    if row.refresh_expires_at is None or row.refresh_expires_at <= now:
        return _invalid_grant("The refresh token has expired.")
    if scope and not set(scope.split()) <= set(row.scope.split()):
        return OAuthError("invalid_scope", "A refresh cannot widen the scope.")
    account = LoginAccount.objects.filter(pk=row.account_id).first()
    reason = "account_missing" if account is None else rejection_reason(account, row.created_at, now)
    if reason is not None:
        if reason in PERMANENT_REASONS:
            revoked = revoke_family(row.family_id, reason)
            event("mcp.token_revoked", account_id=row.account_id, client=client, reason=reason, row_count=revoked)
        return _invalid_grant("This account can no longer connect.")

    row.revoked_at = now
    row.revoked_reason = "rotated"
    row.save(update_fields=["revoked_at", "revoked_reason"])
    body = _issue(account.pk, client, row.family_id, row.scope)
    event("mcp.token_refreshed", account_id=account.pk, client=client)
    return body


def revoke_token(token, client=None):
    """RFC 7009: revoke the family the token belongs to. Silent when nothing matches."""
    if not token:
        return
    token_hash = hash_token(token)
    row = (
        McpOAuthToken.objects.filter(access_hash=token_hash).first()
        or McpOAuthToken.objects.filter(refresh_hash=token_hash).first()
    )
    if row is None or (client is not None and row.client_id != client.client_id):
        return
    with transaction.atomic(using=ENROLMENT_DB):
        revoked = revoke_family(row.family_id, "revoked_by_client")
    event("mcp.token_revoked", account_id=row.account_id, client=client, reason="revoked_by_client", row_count=revoked)
