"""Authentication and ownership boundary for the Coach workspace.

Coach data is still keyed by email in the existing schemas.  The email used for
that lookup must nevertheless come from the authenticated staff row, never from
the browser.  Legacy ``owner_email``/``ownerEmail`` values are accepted only as
an equality assertion while the frontend is migrated away from sending them.
"""

from __future__ import annotations

import functools
import json

from django.http import JsonResponse

from learner_api.constants import ACCESS_COACH
from learner_api.models import StaffUser
from login.permissions import require_access
from login.security import normalize_email


def _forbidden(*, code: str = "forbidden", message: str | None = None):
    return JsonResponse(
        {
            "error": message or "Coach access is required.",
            "code": code,
            "requiredRole": [ACCESS_COACH],
        },
        status=403,
    )


def _legacy_owner_values(request) -> list[str]:
    values: list[str] = []
    for key in ("owner_email", "ownerEmail"):
        values.extend(request.GET.getlist(key))

    content_type = (request.content_type or "").split(";", 1)[0].strip().lower()
    if content_type == "application/json" and request.body:
        try:
            payload = json.loads(request.body.decode("utf-8"))
        except (TypeError, ValueError, UnicodeDecodeError):
            payload = None
        if isinstance(payload, dict):
            for key in ("owner_email", "ownerEmail"):
                if key in payload:
                    values.append(payload.get(key))
    return values


def coach_access_required(view):
    """Require a real Coach session and attach its canonical server identity.

    ``require_access`` supplies the standard 401/403 behavior and refreshes the
    grant from ``Staff_users``.  Its documented super-admin bypass is then
    narrowed here: normal Coach routes are not an impersonation mechanism, so
    only a staff row whose actual access grant is ``coach`` receives a Coach
    identity.
    """

    @functools.wraps(view)
    def scoped(request, *args, **kwargs):
        account = request.login_account
        if account.subject_type != "staff":
            return _forbidden()

        staff = (
            StaffUser.objects.filter(pk=account.subject_id)
            .only("id", "email", "access", "username")
            .first()
        )
        if staff is None or (staff.access or "").strip().lower() != ACCESS_COACH:
            return _forbidden()

        canonical_email = normalize_email(staff.email)
        if not canonical_email:
            return _forbidden(message="The authenticated Coach account has no email address.")

        for supplied in _legacy_owner_values(request):
            if normalize_email(supplied) != canonical_email:
                return _forbidden(
                    code="coach_identity_mismatch",
                    message="The requested Coach identity does not match the authenticated session.",
                )

        request.coach_staff = staff
        request.coach_email = canonical_email
        return view(request, *args, **kwargs)

    return require_access(ACCESS_COACH)(scoped)


def authenticated_coach_email(request) -> str:
    """Return the canonical identity installed by ``coach_access_required``."""

    return request.coach_email

