"""Authentication gate for the enrolment endpoints (BE-2).

Every enrolment view — the commercial board, the Extended ILR, the wizard
bootstrap, the generated documents, and the four `learner_api` statutory
documents — was reachable with no authentication at all. Anyone who could reach
the URL could read or patch a learner, and issue or sign a compliance document.

`@enrolment_login_required` closes that. It follows the same env-gated shape as
`audit_api._has_audit_permission`, but defaults to **requiring** auth: a learner
enrolment record and a signed apprenticeship agreement are not things to leave
open by default. Set `ENROLMENT_API_REQUIRE_AUTH=0` (or false/no) to disable the
gate — intended only for local development and test setups that have no session,
never for a deployment.

The check is intentionally coarse (is there an authenticated user?) rather than
per-learner ownership: the enrolment console is staff-facing, so
authenticated-staff is the boundary that matters here. Finer per-object
permissions can be layered on later without touching the call sites.
"""
import functools
import os

from django.http import JsonResponse

#: Env values that turn the gate OFF. Anything else (including unset) keeps it ON.
_DISABLED_VALUES = {"0", "false", "no", "off"}


def auth_required():
    """Whether the gate is active. Read per-request so tests can toggle it."""
    return os.environ.get("ENROLMENT_API_REQUIRE_AUTH", "1").strip().lower() not in _DISABLED_VALUES


def is_authenticated(request):
    user = getattr(request, "user", None)
    return bool(user and user.is_authenticated)


def enrolment_login_required(view):
    """Reject unauthenticated callers with 401 unless the gate is disabled."""

    @functools.wraps(view)
    def wrapped(request, *args, **kwargs):
        if auth_required() and not is_authenticated(request):
            return JsonResponse(
                {"error": "Authentication required."},
                status=401,
            )
        return view(request, *args, **kwargs)

    return wrapped
