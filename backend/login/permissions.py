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


def employer_or_staff(employer_kwarg="employer_id"):
    """Gate an employer-portal endpoint on its owner, or on staff/admin.

    The portal endpoints were written to be opened by an admin from the Users
    directory and had no authentication at all, so the employer id in the URL
    was the only thing naming whose data came back. That is fine while the link
    exists in one staff-only place; it stops being fine the moment employers
    sign in and land there themselves, because the id is a small integer and
    changing it in the address bar would read another employer's learners.

    Staff and admin keep full access — the directory's View action opens the
    same page and must go on working. An employer reaches only their own record:
    ``account.subject_id`` is their ``enrolment."Employers".id``, which is
    exactly what the URL names.

    Naming somebody else's id gets **404**, not 403, matching
    ``staff_only(allow_own_learner=...)`` — a 403 would confirm the id exists.

    Honours ``LEARNER_API_REQUIRE_AUTH=0`` like ``staff_only``, so local
    development toggles every gate in this module the same way.
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
                authenticate_request(request)
                return view(request, *args, **kwargs)

            account = authenticate_request(request)
            if account is None:
                return _unauthenticated()

            if account.role in allowed:
                return view(request, *args, **kwargs)

            if account.role == "employer":
                try:
                    target_id = int(kwargs.get(employer_kwarg))
                except (TypeError, ValueError):
                    return _forbidden(allowed)
                if target_id != account.subject_id:
                    return JsonResponse({"error": "Not found."}, status=404)
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


def _auth_gate_enabled():
    """Whether the ``learner_api`` auth gates are switched on for this request.

    Used by the learner-progress gates below, and deliberately the same env var
    and the same ``_DISABLED_VALUES`` as the inline check in ``staff_only`` and
    ``employer_or_staff``, so ``LEARNER_API_REQUIRE_AUTH=0`` turns every gate in
    this module off together rather than leaving a half-open API.

    Read per-request so tests can toggle it.
    """
    import os

    return os.environ.get(
        "LEARNER_API_REQUIRE_AUTH", "1"
    ).strip().lower() not in _DISABLED_VALUES


def _read_only_learner_view():
    """403 for somebody reading a learner's plan who may not write to it.

    Carries its own code rather than reusing ``_forbidden``'s: the caller is
    *correctly* signed in and *is* allowed to read this learner, so the UI has to
    tell them "you are viewing this learner, not working as them" rather than
    "you lack a role". No id is being probed — the caller already had read
    access to reach the page — so being explicit leaks nothing.
    """
    return JsonResponse(
        {
            "error": (
                "Only the learner can record progress on their own training plan. "
                "You are viewing this learner's workspace read-only."
            ),
            "code": "read_only_learner_view",
        },
        status=403,
    )


def _target_learner_id(request, kwargs, *, kwarg, query_param, body_field):
    """The learner id a progress write names, or None if it cannot be read.

    The five progress endpoints disagree about where the id lives — a URL kwarg
    (evidence upload), a query parameter (quiz/video/component completion) or a
    JSON body field (reflection submissions) — so the source is named at each
    call site instead of assumed.

    Reading ``request.body`` here is safe for the body case: Django caches it on
    the request, so the view's own ``json.loads(request.body)`` still sees it.
    That is why the body source is only ever used for JSON endpoints; touching
    ``body`` on a multipart upload would break the view's ``request.FILES``.
    """
    raw = None
    if kwarg:
        raw = kwargs.get(kwarg)
    elif query_param:
        raw = request.GET.get(query_param)
    elif body_field:
        import json

        if "multipart" in (request.content_type or ""):
            return None
        try:
            payload = json.loads(request.body or b"{}")
        except (TypeError, ValueError, UnicodeDecodeError):
            return None
        raw = payload.get(body_field) if isinstance(payload, dict) else None

    try:
        return int(str(raw).strip())
    except (TypeError, ValueError):
        return None


def _learner_progress_gate(view, *, kwarg, query_param, body_field, allow_staff):
    """Shared body for ``learner_self_only`` / ``learner_self_or_staff``."""

    @functools.wraps(view)
    def wrapped(request, *args, **kwargs):
        if not _auth_gate_enabled():
            authenticate_request(request)
            return view(request, *args, **kwargs)

        # OPTIONS is a CORS/preflight probe: it carries no identity and returns no
        # data, and ChatCorsMiddleware answers real cross-origin preflights before
        # the view is reached. Leave it to the view. GET and HEAD are now
        # ownership-scoped below, exactly like writes: reading another learner's
        # record by changing the id in the URL is the A5 read-path IDOR
        # (SECURITY_AUDIT.md A5), so a safe method is no longer a free pass. Staff
        # keep read access wherever the endpoint uses ``learner_self_or_staff``
        # (``allow_staff`` below); ``learner_self_only`` reads are the owner's alone.
        if request.method == "OPTIONS":
            authenticate_request(request)
            return view(request, *args, **kwargs)

        account = authenticate_request(request)
        if account is None:
            return _unauthenticated()

        if account.role == "learner":
            target_id = _target_learner_id(
                request, kwargs, kwarg=kwarg, query_param=query_param, body_field=body_field
            )
            if target_id is None:
                return _error_bad_target()
            # Matched on id alone, like ``staff_only(allow_own_learner=...)``:
            # ids are unique across the single Created_users table, so the
            # learner kind is not part of the comparison.
            if target_id != account.subject_id:
                # 404, not 403 — a learner poking at another learner's id must
                # not have its existence confirmed.
                return JsonResponse({"error": "Not found."}, status=404)
            return view(request, *args, **kwargs)

        if allow_staff and account.role in {"admin", "staff"}:
            return view(request, *args, **kwargs)

        return _read_only_learner_view()

    return wrapped


def _error_bad_target():
    return JsonResponse(
        {"error": "The learner this request applies to could not be determined."},
        status=400,
    )


def learner_self_only(*, kwarg=None, query_param=None, body_field=None):
    """Only the learner themselves may write this learner's training-plan progress.

    The progress endpoints (quiz attempts, video and component completion,
    reflection submissions, evidence uploads) were ``@csrf_exempt`` with no
    authentication of any kind: the learner id travelled in the URL or the body
    and was the only thing deciding whose plan got marked off. Every staff page
    that drills into a learner — the workspace overview, the coach case file, the
    employer portal — renders that learner's own plan pages, so a caseowner
    opening a learner to *look* at their week could complete components as them,
    and the progress log would record it as the learner's own work.

    That matters beyond tidiness: these records are the audit trail for
    off-the-job hours and KSB coverage. A component ticked off by staff is a
    false claim about what the apprentice did, and neither the learner nor an
    auditor could tell it apart from the real thing.

    So: **staff and admin get 403 here, deliberately**, unlike every other gate
    in this module where they are the privileged case — for BOTH writes and reads.
    A ``learner_self_only`` endpoint is the owner's alone: its GET is scoped to the
    learner too (private data such as calendar credentials), so staff do not read
    it here. Staff still review a learner's plan and evidence, but through the
    endpoints that use ``learner_self_or_staff`` (which admits them on read).
    Booking a coaching session is the one write staff keep, and it uses
    ``learner_self_or_staff`` instead. Only ``OPTIONS`` (CORS preflight) is exempt.

    ``kwarg`` / ``query_param`` / ``body_field`` name where the learner id is
    found; exactly one applies per endpoint. A learner naming somebody else's id
    gets **404**, matching ``staff_only(allow_own_learner=...)``.

    Honours ``LEARNER_API_REQUIRE_AUTH=0`` like the rest of this module, which
    turns the gate off for local development. It must never be set in a
    deployment — with it set, any caller can write any learner's progress again.
    """

    def decorator(view):
        return _learner_progress_gate(
            view, kwarg=kwarg, query_param=query_param, body_field=body_field, allow_staff=False
        )

    return decorator


def learner_self_or_staff(*, kwarg=None, query_param=None, body_field=None):
    """The learner themselves, or staff/admin acting on their behalf.

    For coaching-session booking and cancellation, which staff legitimately do
    *for* a learner — arranging a catch-up is administration, not a claim about
    the learner's own work, so it is the one thing a staff viewer keeps on a
    learner's page.

    Still a real gate: before this, the learner id in the URL was the only thing
    naming whose calendar was written, so any signed-out caller could book
    against any learner and any learner could book against another's coach.
    """

    def decorator(view):
        return _learner_progress_gate(
            view, kwarg=kwarg, query_param=query_param, body_field=body_field, allow_staff=True
        )

    return decorator
