"""Authentication and ownership boundary for the Coach workspace.

Coach data is still keyed by email in the existing schemas.  The email used for
that lookup must nevertheless come from the authenticated staff row, never from
the browser.  Legacy ``owner_email``/``ownerEmail`` values are accepted only as
an equality assertion while the frontend is migrated away from sending them.

One deliberate exception exists: a ``super-admin`` may **read** a named coach's
workspace by asking for it explicitly with ``viewAsCoach``.  See
``coach_access_required`` for why that is a separate parameter and why it is
read-only.
"""

from __future__ import annotations

import functools
import json
import logging

from django.db import DatabaseError
from django.db.models.functions import Lower, Trim
from django.http import JsonResponse

from learner_api.constants import ACCESS_COACH, ACCESS_SUPER_ADMIN
from learner_api.models import StaffUser
from login.permissions import require_access
from login.security import normalize_email


logger = logging.getLogger(__name__)

#: Methods that only read.  A super-admin viewing a coach's workspace is held to
#: these; see ``coach_access_required``.
_SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})

#: The parameter a super-admin uses to name whose workspace to open.  Distinct
#: from the legacy ``owner_email`` on purpose — that one is an assertion about
#: the caller's own identity and stays refused for everybody else.
_VIEW_AS_KEYS = ("viewAsCoach", "view_as_coach")

_LEGACY_OWNER_KEYS = ("owner_email", "ownerEmail")


def _forbidden(*, code: str = "forbidden", message: str | None = None):
    return JsonResponse(
        {
            "error": message or "Coach access is required.",
            "code": code,
            "requiredRole": [ACCESS_COACH],
        },
        status=403,
    )


def _json_payload(request) -> dict:
    content_type = (request.content_type or "").split(";", 1)[0].strip().lower()
    if content_type != "application/json" or not request.body:
        return {}
    try:
        payload = json.loads(request.body.decode("utf-8"))
    except (TypeError, ValueError, UnicodeDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def _request_values(request, keys: tuple[str, ...]) -> list:
    values: list = []
    for key in keys:
        values.extend(request.GET.getlist(key))

    payload = _json_payload(request)
    for key in keys:
        if key in payload:
            values.append(payload.get(key))
    return values


def _legacy_owner_values(request) -> list:
    return _request_values(request, _LEGACY_OWNER_KEYS)


def _requested_view_as_email(request) -> str:
    for value in _request_values(request, _VIEW_AS_KEYS):
        candidate = normalize_email(value)
        if candidate:
            return candidate
    return ""


def _staff_access(staff) -> str:
    return (getattr(staff, "access", "") or "").strip().lower()


def _find_coach_staff(email: str):
    """The staff row for ``email``, but only if it actually holds Coach access.

    Matched on the normalised address rather than the raw column: the staff table
    is free text, so the same address turns up with stray whitespace or mixed
    case across records.
    """
    if not email:
        return None
    return (
        StaffUser.objects.annotate(
            staff_email_key=Lower(Trim("email")),
            staff_access_key=Lower(Trim("access")),
        )
        .filter(staff_email_key=email, staff_access_key=ACCESS_COACH)
        .only("id", "email", "access", "username")
        .first()
    )


def _legacy_owner_mismatch(request, canonical_email: str):
    for supplied in _legacy_owner_values(request):
        if normalize_email(supplied) != canonical_email:
            return _forbidden(
                code="coach_identity_mismatch",
                message="The requested Coach identity does not match the authenticated session.",
            )
    return None


def coach_access_required(view):
    """Require a real Coach session and attach its canonical server identity.

    ``require_access`` supplies the standard 401/403 behavior and refreshes the
    grant from ``Staff_users``.  Its documented super-admin bypass is then
    narrowed here: an ordinary Coach route is not an implicit impersonation
    mechanism, so a super-admin receives a Coach identity only when the request
    **names** the coach it wants through ``viewAsCoach``.

    That view-as path is read-only.  A super-admin may already change any record
    on the platform, but a write issued through these routes would be recorded
    against the coach whose workspace is open — a booked session, an approved
    absence, a marking decision — with nothing in the data to show that somebody
    else made it.  Refusing unsafe methods keeps the audit trail honest; the
    admin surfaces remain the place to edit.

    Without ``viewAsCoach`` a super-admin is refused with
    ``coach_selection_required``, which is what tells the workspace to show its
    coach picker rather than an empty dashboard.
    """

    @functools.wraps(view)
    def scoped(request, *args, **kwargs):
        account = request.login_account
        # Set on every path, so a view can read them without a getattr default.
        request.coach_view_as = False
        request.coach_view_as_admin = None

        if account.subject_type != "staff":
            return _forbidden()

        staff = (
            StaffUser.objects.filter(pk=account.subject_id)
            .only("id", "email", "access", "username")
            .first()
        )
        if staff is None:
            return _forbidden()

        access = _staff_access(staff)
        requested_view_as = _requested_view_as_email(request)

        if access == ACCESS_SUPER_ADMIN:
            if not requested_view_as:
                return _forbidden(
                    code="coach_selection_required",
                    message="Choose a coach to open their workspace.",
                )
            if request.method not in _SAFE_METHODS:
                return _forbidden(
                    code="coach_view_as_read_only",
                    message=(
                        "A coach's workspace opens read-only. "
                        "Make changes from the admin area instead."
                    ),
                )

            try:
                coach = _find_coach_staff(requested_view_as)
            except DatabaseError:
                logger.exception("coach_view_as_lookup_failed admin_staff_id=%s", staff.id)
                return _forbidden(
                    code="coach_lookup_unavailable",
                    message="Unable to confirm that account's Coach access right now.",
                )
            if coach is None:
                return _forbidden(
                    code="coach_not_found",
                    message="That account does not have Coach access.",
                )

            canonical_email = normalize_email(coach.email)
            if not canonical_email:
                return _forbidden(message="The selected Coach account has no email address.")

            mismatch = _legacy_owner_mismatch(request, canonical_email)
            if mismatch is not None:
                return mismatch

            request.coach_staff = coach
            request.coach_email = canonical_email
            request.coach_view_as = True
            request.coach_view_as_admin = staff
            logger.info(
                "coach_view_as admin_staff_id=%s coach_staff_id=%s path=%s",
                staff.id,
                coach.id,
                request.path,
            )
            return view(request, *args, **kwargs)

        if access != ACCESS_COACH:
            return _forbidden()

        canonical_email = normalize_email(staff.email)
        if not canonical_email:
            return _forbidden(message="The authenticated Coach account has no email address.")

        # A coach naming somebody else — through either parameter — is refused
        # rather than quietly served their own data, matching how the legacy
        # ``owner_email`` assertion has always been treated.
        if requested_view_as and requested_view_as != canonical_email:
            return _forbidden(
                code="coach_identity_mismatch",
                message="The requested Coach identity does not match the authenticated session.",
            )

        mismatch = _legacy_owner_mismatch(request, canonical_email)
        if mismatch is not None:
            return mismatch

        request.coach_staff = staff
        request.coach_email = canonical_email
        return view(request, *args, **kwargs)

    return require_access(ACCESS_COACH)(scoped)


def authenticated_coach_email(request) -> str:
    """Return the canonical identity installed by ``coach_access_required``."""

    return request.coach_email


def is_coach_view_as(request) -> bool:
    """True when a super-admin is reading somebody else's coach workspace."""

    return bool(getattr(request, "coach_view_as", False))
