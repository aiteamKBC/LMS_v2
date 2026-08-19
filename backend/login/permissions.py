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


def staff_only(*, writes_only=False, allow_own_learner=None):
    """Gate a staff-facing endpoint on an authenticated staff or admin session.

    Built for the pre-existing ``learner_api`` views, which are ``@csrf_exempt``
    and had no authentication of any kind: anyone who could reach the URL could
    create, read or edit a learner, an employer or a staff record. That is the
    console's own API, so "authenticated staff" is the boundary that matters.

    ``writes_only=True`` gates POST/PATCH/PUT/DELETE and leaves GET open. It is
    for endpoints whose read path is still consumed by something that has no
    session yet — closing the write path is the urgent half, since that is what
    mutates records and issues invitations.

    ``allow_own_learner="pk"`` additionally lets a **learner** write, but only to
    the record named by that URL kwarg — i.e. their own. The onboarding wizard
    is the reason: a learner at the 'Onboarding' status fills it in themselves,
    so refusing every learner write means the wizard loads and then cannot be
    submitted, which loses their answers at the last step.

    Two things this does **not** grant. A learner naming somebody else's id gets
    **404**, not 403 — a 403 would confirm the id exists, matching how
    ``login.invitations._load_token`` collapses its failure modes. And owning the
    record is not permission to set every field on it: the view is told via
    ``request.learner_self_write`` so it can restrict the payload (see
    ``learner_api.mappers.restrict_to_self_writable``), because the write mapping
    includes ``programmeStatus`` and a learner who could set it would promote
    themselves straight past the enrolment flow.

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

            # Default: the view is not serving a learner acting on themselves.
            # Set on every path so a view can read it without a getattr default.
            request.learner_self_write = False

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

            if account.role in allowed:
                return view(request, *args, **kwargs)

            if allow_own_learner and account.role == "learner":
                try:
                    target_id = int(kwargs.get(allow_own_learner))
                except (TypeError, ValueError):
                    return _forbidden(allowed)
                # Matched on id alone: ids are unique across the single
                # Created_users table, so the learner kind is not part of it.
                if target_id != account.subject_id:
                    return JsonResponse({"error": "Not found."}, status=404)
                request.learner_self_write = True
                return view(request, *args, **kwargs)

            return _forbidden(allowed)

        return wrapped

    return decorator


def require_access(*accesses):
    """Gate an endpoint on the caller's staff **access** grant.

    Roles are too coarse for this. Every account the console creates carries
    ``Position = 'Admin'``, and an account whose access is ``super-admin`` gets
    ``role='admin'`` while the other three get ``role='staff'`` — so
    ``staff_only`` cannot tell an enrolment officer from a curriculum designer.
    The access grant is what distinguishes them, and this is where it is enforced.

    ``super-admin`` always passes: it means "everything" by definition, so it
    never has to be listed at a call site.

    Learners and employers are refused outright — these are staff areas, and
    their own surfaces are gated by ``require_role``/``enrolment_api.auth``.

    An account with **no** access recorded is refused. That is the whole point:
    "unset" means nobody has decided yet, and defaulting an undecided account
    into an area would hand out exactly the access this mechanism exists to
    control. The SPA sends such an account to ``/access-required``, where it can
    ask an administrator for one.

    Refusals are 403 with the required list, matching ``require_role``: unlike the
    per-learner scoping in ``enrolment_api.auth``, no record id is being probed
    here, so there is nothing to leak by being explicit.
    """
    required = frozenset(accesses)

    def decorator(view):
        @functools.wraps(view)
        def wrapped(request, *args, **kwargs):
            from learner_api.constants import ACCESS_SUPER_ADMIN

            account = authenticate_request(request)
            if account is None:
                return _unauthenticated()
            if account.role not in {"admin", "staff"}:
                return _forbidden(required)

            access = _access_of(account)
            if access == ACCESS_SUPER_ADMIN or access in required:
                return view(request, *args, **kwargs)

            return _forbidden(required)

        return wrapped

    return decorator


def _access_of(account):
    """The access grant on a staff account, or "" for anyone else.

    Read from the staff row rather than cached on the account, for the same
    reason ``role`` is recomputed per request: an access changed in the console
    must take effect on the account's next request, not their next sign-in.
    """
    if account.subject_type != "staff":
        return ""
    from django.db import DatabaseError

    from learner_api.models import StaffUser

    try:
        row = StaffUser.objects.filter(pk=account.subject_id).only("access").first()
    except DatabaseError:
        # Fail closed: an unreadable grant is not a grant.
        return ""
    return (getattr(row, "access", "") or "").strip().lower() if row else ""


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
