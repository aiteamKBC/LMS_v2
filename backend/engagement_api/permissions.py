"""Authorisation helpers for the engagement/points endpoints.

The engagement app previously took learner identity from whatever the client
sent in the JSON body or query string, and had no staff/admin role check on
any mutation. `/engagement_api/` stays gated at session-only ("ANY role") in
`login.api_gate`, since learners and staff both use it — the per-record and
per-role scoping below is what actually protects it.

There is no engagement-specific staff access grant (`login.permissions` also
has no `require_access("engagement", ...)` value defined) — every staff/admin
account may operate the engagement workspace, matching the other broad
staff areas until a dedicated grant is introduced.
"""
from __future__ import annotations

import functools

from django.http import JsonResponse

from login.sessions import authenticate_request

STAFF_ROLES = frozenset({"admin", "staff"})


def _unauthenticated():
    return JsonResponse({"error": "Authentication required.", "code": "unauthenticated"}, status=401)


def _forbidden():
    return JsonResponse(
        {"error": "You do not have permission to perform this action.", "code": "forbidden"},
        status=403,
    )


def actor_name(request):
    """Display name of the signed-in account, for attributing a mutation. Best-effort."""
    account = authenticate_request(request)
    if account is None:
        return None
    return account.display_name or account.email


def require_staff(view):
    """Gate a view on an authenticated staff/admin session.

    Applied to every engagement-workspace mutation: rewards/rules/recognition
    CRUD, voucher-claim review, events/clubs/meetings CRUD, deck authoring,
    AI generation, and manual point grants.
    """

    @functools.wraps(view)
    def wrapped(request, *args, **kwargs):
        account = authenticate_request(request)
        if account is None:
            return _unauthenticated()
        if account.role not in STAFF_ROLES:
            return _forbidden()
        return view(request, *args, **kwargs)

    return wrapped


def learner_identity(request):
    """(learner_id, learner_name) for the signed-in learner, else None.

    `learner_id` is `str(account.subject_id)` — the same integer
    `enrolment."Created_users".id` the engagement `learner_id` text columns
    already store, so no id translation is needed.
    """
    account = authenticate_request(request)
    if account is None or account.subject_type != "learner":
        return None
    return str(account.subject_id), (account.display_name or "")


def require_learner_identity(request):
    """`(learner_id, learner_name, None)` on success, `(None, None, error_response)` otherwise.

    For learner-self write endpoints (voucher claims, event bookings): the
    caller must be a signed-in learner, and their identity is always taken
    from the session — never from the request body.
    """
    account = authenticate_request(request)
    if account is None:
        return None, None, _unauthenticated()
    if account.subject_type != "learner":
        return None, None, _forbidden()
    return str(account.subject_id), (account.display_name or ""), None


def learner_read_scope(request):
    """`(learner_id_filter, None)` on success, `(None, error_response)` otherwise.

    For GET endpoints on learner-owned collections (voucher claims,
    recognitions, event bookings, point grants):
    - staff/admin may pass `?learnerId=` to scope the read, or omit it to see
      everyone (the existing reporting behaviour);
    - a learner is always scoped to their own id — any `?learnerId` they send
      is ignored, so omitting it can never mean "everyone's data".
    """
    account = authenticate_request(request)
    if account is None:
        return None, _unauthenticated()
    if account.role in STAFF_ROLES:
        return request.GET.get("learnerId") or None, None
    if account.subject_type == "learner":
        return str(account.subject_id), None
    return None, _forbidden()


def is_staff(request):
    """Whether the caller is a signed-in staff/admin account.

    For endpoints that mix a broader read (any session) with a narrower
    staff-only view of the same data — e.g. deck drafts + answers are
    staff-only, published decks without answers are learner-visible.
    Treats an unresolvable session as "not staff" (the safer default)
    rather than erroring, since the prefix gate already requires a session
    to reach the view at all.
    """
    account = authenticate_request(request)
    return account is not None and account.role in STAFF_ROLES


def staff_error(request):
    """`None` if the caller is staff/admin, else the error response to return.

    For views that mix an open read (any session, e.g. the rewards
    catalogue) with a staff-only write — call this inline in the
    POST/PATCH/DELETE branch rather than decorating the whole view.
    """
    account = authenticate_request(request)
    if account is None:
        return _unauthenticated()
    if account.role not in STAFF_ROLES:
        return _forbidden()
    return None


def require_self_or_staff(request, owner_learner_id):
    """`None` if the caller is staff/admin, or the learner who owns this record.

    404 (not 403) when a learner names a record that isn't theirs, matching
    `login.permissions.staff_only(allow_own_learner=...)` — a 403 would
    confirm the record exists.
    """
    account = authenticate_request(request)
    if account is None:
        return _unauthenticated()
    if account.role in STAFF_ROLES:
        return None
    if account.subject_type == "learner" and str(account.subject_id) == str(owner_learner_id):
        return None
    return JsonResponse({"error": "Not found."}, status=404)


def learner_target_identity(request, payload):
    """`(learner_id, learner_name, None)` on success, else `(None, None, error_response)`.

    For endpoints staff use to act *as* a chosen learner (flash-card preview
    flips): staff/admin may target any learner via `payload['learnerId']` /
    `['learnerName']`. A learner is always resolved from their own session —
    any `learnerId`/`learnerName` they send is ignored.
    """
    account = authenticate_request(request)
    if account is None:
        return None, None, _unauthenticated()
    if account.role in STAFF_ROLES:
        learner_id = payload.get("learnerId")
        learner_name = payload.get("learnerName")
        if not learner_id or not learner_name:
            return None, None, JsonResponse(
                {"error": "Missing required fields.", "fields": ["learnerId", "learnerName"]},
                status=400,
            )
        return str(learner_id), learner_name, None
    if account.subject_type == "learner":
        return str(account.subject_id), (account.display_name or ""), None
    return None, None, _forbidden()
