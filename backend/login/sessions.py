"""Server-side session issue / resolve / revoke, and the request authenticator.

The cookie holds a random token; the database holds its SHA-256 and the state
that makes it revocable. See ``models.LoginSession`` for why this is not a JWT.

Cookie flags are set from one place (``set_session_cookie``) so a future change
to SameSite or the cookie name cannot drift between login and logout.
"""
from __future__ import annotations

from django.conf import settings
from django.utils import timezone

from .models import LoginSession
from .security import (
    SESSION_TTL,
    SESSION_TTL_REMEMBER,
    generate_token,
    hash_token,
)

#: Distinct from Django's own ``sessionid`` so the two auth systems cannot be
#: confused for one another while the legacy admin session still exists.
COOKIE_NAME = "kbc_session"


def _cookie_kwargs(max_age):
    """Flags for the session cookie.

    ``HttpOnly`` always: no frontend code has any reason to read this value, and
    it is the single control that keeps an XSS bug from becoming account theft.

    ``Secure`` follows ``SESSION_COOKIE_SECURE``, which the settings module ties
    to DEBUG — a cookie marked Secure is simply not stored over plain http, so
    hard-coding it True would break local development.

    ``SameSite=Lax`` lets the SPA's same-origin XHR through (the Vite dev server
    proxies the API, and production serves both from one host) while refusing the
    cross-site POSTs that CSRF depends on.
    """
    return {
        "max_age": int(max_age.total_seconds()),
        "httponly": True,
        "secure": getattr(settings, "SESSION_COOKIE_SECURE", not settings.DEBUG),
        "samesite": getattr(settings, "SESSION_COOKIE_SAMESITE", "Lax"),
        "path": "/",
    }


def issue_session(account, *, remember=False, ip=None, user_agent=None):
    """Create a session row and return ``(plaintext_token, session, ttl)``.

    The plaintext is returned to the caller and never stored; only the caller
    (``views.login``) ever sees it, and it goes straight into a cookie.
    """
    ttl = SESSION_TTL_REMEMBER if remember else SESSION_TTL
    token = generate_token()

    session = LoginSession.objects.create(
        account=account,
        token_hash=hash_token(token),
        expires_at=timezone.now() + ttl,
        ip_address=ip,
        user_agent=user_agent,
        last_seen_at=timezone.now(),
    )
    return token, session, ttl


def set_session_cookie(response, token, ttl):
    response.set_cookie(COOKIE_NAME, token, **_cookie_kwargs(ttl))
    return response


def clear_session_cookie(response):
    response.delete_cookie(COOKIE_NAME, path="/")
    return response


def resolve_session(token):
    """Return the live ``LoginSession`` for a token, or None.

    "Live" means: exists, not revoked, not expired, and its account is still
    active. The account is fetched in the same query so the common case — an
    authenticated request — costs one round-trip.
    """
    if not token:
        return None

    session = (
        LoginSession.objects.select_related("account")
        .filter(token_hash=hash_token(token), revoked_at__isnull=True)
        .first()
    )
    if session is None:
        return None
    if session.expires_at <= timezone.now():
        return None
    if not session.account.is_active:
        return None
    return session


#: Only refresh ``Last_seen_at`` if it is this stale, so a busy console does not
#: issue a write on every single request.
_LAST_SEEN_REFRESH_SECONDS = 300


def touch_session(session):
    now = timezone.now()
    last = session.last_seen_at
    if last is None or (now - last).total_seconds() >= _LAST_SEEN_REFRESH_SECONDS:
        session.last_seen_at = now
        session.save(update_fields=["last_seen_at"])


def revoke_session(session):
    if session.revoked_at is None:
        session.revoked_at = timezone.now()
        session.save(update_fields=["revoked_at"])


def revoke_all_for_account(account, *, except_session_id=None):
    """Sign the account out everywhere.

    Called on password change and on deactivation: a credential that has been
    replaced must not leave live sessions behind that were established with it.
    """
    qs = LoginSession.objects.filter(account=account, revoked_at__isnull=True)
    if except_session_id:
        qs = qs.exclude(pk=except_session_id)
    return qs.update(revoked_at=timezone.now())


def authenticate_request(request):
    """Attach ``request.login_session`` / ``request.login_account``; return the account.

    Idempotent and cheap to call more than once per request — the middleware
    calls it, and the permission decorators re-read the cached attribute.
    """
    if hasattr(request, "login_account"):
        return request.login_account

    token = request.COOKIES.get(COOKIE_NAME)
    session = resolve_session(token)

    request.login_session = session
    request.login_account = session.account if session else None

    if session is not None:
        touch_session(session)

    return request.login_account
