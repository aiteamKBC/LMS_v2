"""Who may hold an MCP token, and whether a presented one still stands.

One predicate decides "may this account use MCP": staff or admin whose access
grant includes ``curriculum`` or ``super-admin`` -- ``require_access("curriculum")``'s
rule. The grant is re-read on every call through ``login.permissions._accesses_of``
(fails closed on a database error). The ``Role`` column is only re-derived on
cookie requests, so on bearer-only traffic the grant, not the role, is the truth.

When a token stops working (``rejection_reason``), checked on every bearer call
and on every refresh against the row being presented:

1. ``account.is_active`` is false (admin "suspend").
2. ``account.locked_until`` is in the future (failed-password lockout).
3. ``account.password_set_at`` is later than the token row's ``created_at``.
   Every caller of ``login.sessions.revoke_all_for_account`` -- invitation
   acceptance, password reset, change password, ``seed_demo_admin`` -- sets
   ``password_set_at`` first, so "all sessions revoked for a credential change"
   is exactly "the password changed after this token was issued". NULL (an
   SSO-only account that never set one) is "no change".
4. The account no longer holds the curriculum or super-admin grant.

A single browser sign-out (``revoke_session``) deliberately does not end MCP
access; ``/oauth/revoke`` and the admin view are how a connector is disconnected.

Reasons 1 and 3 are permanent, so the whole token family is revoked when one is
seen. 2 and 4 only refuse: a lockout can be triggered by anyone who knows the
email address, and ``_accesses_of`` cannot tell a removed grant from an
unreadable one, so neither may destroy tokens.
"""
from django.db import transaction
from django.utils import timezone

from learner_api.constants import ACCESS_CURRICULUM, ACCESS_SUPER_ADMIN
from learner_api.routers import ENROLMENT_DB
from login.permissions import _accesses_of

from .crypto import hash_token
from .events import event
from .models import McpOAuthToken

MCP_ACCESSES = frozenset({ACCESS_CURRICULUM, ACCESS_SUPER_ADMIN})
STAFF_ROLES = frozenset({"staff", "admin"})

REASON_INACTIVE = "account_inactive"
REASON_LOCKED = "account_locked"
REASON_CREDENTIAL_CHANGED = "credential_changed"
REASON_NO_ACCESS = "no_curriculum_access"

#: Reasons after which the token family can never be valid again.
PERMANENT_REASONS = frozenset({REASON_INACTIVE, REASON_CREDENTIAL_CHANGED})


def has_mcp_access(account):
    """Staff/admin holding the curriculum or super-admin grant, read fresh."""
    if account is None or account.role not in STAFF_ROLES:
        return False
    return bool(_accesses_of(account) & MCP_ACCESSES)


def rejection_reason(account, issued_at, now=None):
    """Why a token issued at ``issued_at`` no longer stands for ``account``, or None."""
    now = now or timezone.now()
    if not account.is_active:
        return REASON_INACTIVE
    if account.locked_until is not None and account.locked_until > now:
        return REASON_LOCKED
    if account.password_set_at is not None and account.password_set_at > issued_at:
        return REASON_CREDENTIAL_CHANGED
    if not has_mcp_access(account):
        return REASON_NO_ACCESS
    return None


def revoke_family(family_id, reason):
    """Revoke every live token in a family. Returns the number revoked."""
    return McpOAuthToken.objects.filter(family_id=family_id, revoked_at__isnull=True).update(
        revoked_at=timezone.now(), revoked_reason=reason
    )


def bearer_token(request):
    """The raw token from ``Authorization: Bearer <token>``, or None."""
    scheme, _, value = request.headers.get("Authorization", "").partition(" ")
    value = value.strip()
    if scheme.lower() != "bearer" or not value or " " in value:
        return None
    return value


def resolve_bearer(request):
    """``(account, token_row)`` for a live access token on this request, or None.

    Only the ``/mcp/`` endpoint calls this: bearer tokens are accepted nowhere else.
    """
    raw = bearer_token(request)
    if raw is None:
        return None
    token = (
        McpOAuthToken.objects.select_related("account", "client")
        .filter(access_hash=hash_token(raw), revoked_at__isnull=True)
        .first()
    )
    if token is None:
        return None
    now = timezone.now()
    if token.expires_at <= now or token.client.disabled_at is not None:
        return None
    reason = rejection_reason(token.account, token.created_at, now)
    if reason is not None:
        if reason in PERMANENT_REASONS:
            with transaction.atomic(using=ENROLMENT_DB):
                revoked = revoke_family(token.family_id, reason)
            event("mcp.token_revoked", account_id=token.account_id, client=token.client,
                  reason=reason, row_count=revoked)
        return None
    return token.account, token
