"""Authorisation decorators for views protected by the login system.

``enrolment_api.auth.enrolment_login_required`` already gates the enrolment
endpoints on "is there a Django session user". These decorators are the
equivalent for the new login system and additionally understand roles, so a
learner's session cannot reach a staff endpoint.

Both attach the resolved account to the request, so a view body can read
``request.login_account`` without repeating the lookup.
"""
from __future__ import annotations

import functools

from django.http import JsonResponse

from .sessions import authenticate_request


def _unauthenticated():
    return JsonResponse(
        {"error": "Authentication required.", "code": "unauthenticated"},
        status=401,
    )


def _forbidden(required):
    return JsonResponse(
        {
            "error": "You do not have permission to perform this action.",
            "code": "forbidden",
            "requiredRole": list(required),
        },
        status=403,
    )


def login_required(view):
    """Reject callers without a live session."""

    @functools.wraps(view)
    def wrapped(request, *args, **kwargs):
        if authenticate_request(request) is None:
            return _unauthenticated()
        return view(request, *args, **kwargs)

    return wrapped


def require_role(*roles):
    """Reject callers whose account role is not in ``roles``.

    Role names come from ``models.ROLE_CHOICES``. The check is on the role
    stored on the account, which ``identity.ensure_account`` recomputes from the
    person's enrolment row — so demoting somebody in the staff form takes effect
    on their next request, not only when they next sign in.
    """
    allowed = frozenset(roles)

    def decorator(view):
        @functools.wraps(view)
        def wrapped(request, *args, **kwargs):
            account = authenticate_request(request)
            if account is None:
                return _unauthenticated()
            if account.role not in allowed:
                return _forbidden(allowed)
            return view(request, *args, **kwargs)

        return wrapped

    return decorator


#: Env values that turn the staff gate OFF. Anything else (including unset)
#: keeps it ON. Mirrors ``enrolment_api.auth._DISABLED_VALUES`` so the two gates
#: are configured the same way.
_DISABLED_VALUES = {"0", "false", "no", "off"}

#: Methods that only read. A gate can be applied to writes alone while the
#: read paths are still being migrated onto authenticated fetches.
_SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


def staff_only(*, writes_only=False):
    """Gate a staff-facing endpoint on an authenticated staff or admin session.

    Built for the pre-existing ``learner_api`` views, which are ``@csrf_exempt``
    and had no authentication of any kind: anyone who could reach the URL could
    create, read or edit a learner, an employer or a staff record. That is the
    console's own API, so "authenticated staff" is the boundary that matters.

    ``writes_only=True`` gates POST/PATCH/PUT/DELETE and leaves GET open. It is
    for endpoints whose read path is still consumed by something that has no
    session yet — closing the write path is the urgent half, since that is what
    mutates records and issues invitations.

    Set ``LEARNER_API_REQUIRE_AUTH=0`` to disable the gate entirely. That exists
    for local development and for the migration window while the frontend's
    remaining unauthenticated fetches are moved over; it must never be set in a
    deployment. Read per-request so tests can toggle it.
    """
    allowed = frozenset({"admin", "staff"})

    def decorator(view):
        @functools.wraps(view)
        def wrapped(request, *args, **kwargs):
            import os

            enabled = os.environ.get(
                "LEARNER_API_REQUIRE_AUTH", "1"
            ).strip().lower() not in _DISABLED_VALUES

            if not enabled:
                # Still resolve the session, so a signed-in caller is attributed
                # correctly in the audit trail even with the gate off.
                authenticate_request(request)
                return view(request, *args, **kwargs)

            if writes_only and request.method in _SAFE_METHODS:
                authenticate_request(request)
                return view(request, *args, **kwargs)

            account = authenticate_request(request)
            if account is None:
                return _unauthenticated()
            if account.role not in allowed:
                return _forbidden(allowed)
            return view(request, *args, **kwargs)

        return wrapped

    return decorator


def require_permission(*permissions):
    """Reject callers lacking every one of the named permissions.

    Thin wrapper over ``identity.permissions_for``; useful where a capability
    spans several roles and naming the roles at the call site would duplicate
    that mapping.
    """
    needed = frozenset(permissions)

    def decorator(view):
        @functools.wraps(view)
        def wrapped(request, *args, **kwargs):
            from .identity import permissions_for

            account = authenticate_request(request)
            if account is None:
                return _unauthenticated()
            if not needed.issubset(set(permissions_for(account.role))):
                return _forbidden(needed)
            return view(request, *args, **kwargs)

        return wrapped

    return decorator
