"""HTTP integration for existing learner-scoped authorization rules."""

from __future__ import annotations

import functools
import importlib

from django.http import JsonResponse

from ..composition import coach_owns_learner, learner_owns_target, staff_owns_learner

login_permissions = importlib.import_module("login.permissions")


def _read_only_learner_view():
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
    """Return the learner ID from the one source named by the call site."""
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


def audit_admin_learner_action(request, learner_id, response):
    """Keep the real administrator or Coach actor on the audit trail."""
    account = getattr(request, "login_account", None)
    if request.method in login_permissions._SAFE_METHODS:
        return
    if getattr(account, "role", None) == "admin":
        event = "admin_learner_action"
    elif getattr(request, "coach_learner_action", False):
        event = "coach_learner_action"
    else:
        return
    import json

    invitations = importlib.import_module("login.invitations")
    security = importlib.import_module("login.security")

    invitations.record(
        event,
        email=account.email,
        account_id=account.id,
        succeeded=200 <= response.status_code < 400,
        reason=json.dumps(
            {
                "learnerId": learner_id,
                "method": request.method,
                "path": request.path,
                "status": response.status_code,
            }
        ),
        ip=security.client_ip(request),
        user_agent=security.user_agent(request),
    )


def _learner_progress_gate(
    view,
    *,
    kwarg,
    query_param,
    body_field,
    allow_staff,
    allow_admin=False,
):
    """Enforce ownership and each learner endpoint's privileged roles."""

    @functools.wraps(view)
    def wrapped(request, *args, **kwargs):
        if not login_permissions._auth_gate_enabled():
            login_permissions.authenticate_request(request)
            return view(request, *args, **kwargs)

        if request.method == "OPTIONS":
            login_permissions.authenticate_request(request)
            return view(request, *args, **kwargs)

        account = login_permissions.authenticate_request(request)
        if account is None:
            return login_permissions._unauthenticated(request)

        if allow_admin and account.role == "admin":
            target_id = _target_learner_id(
                request,
                kwargs,
                kwarg=kwarg,
                query_param=query_param,
                body_field=body_field,
            )
            if target_id is None or target_id <= 0:
                return _error_bad_target()
            request.login_account = account
            response = view(request, *args, **kwargs)
            audit_admin_learner_action(request, target_id, response)
            return response

        if allow_admin and account.role == "staff":
            target_id = _target_learner_id(
                request,
                kwargs,
                kwarg=kwarg,
                query_param=query_param,
                body_field=body_field,
            )
            if target_id is not None and coach_owns_learner(account, target_id):
                request.login_account = account
                request.coach_learner_action = True
                response = view(request, *args, **kwargs)
                audit_admin_learner_action(request, target_id, response)
                return response
            if target_id is not None and staff_owns_learner(account, target_id):
                request.login_account = account
                return view(request, *args, **kwargs)

        if account.role == "learner":
            target_id = _target_learner_id(
                request,
                kwargs,
                kwarg=kwarg,
                query_param=query_param,
                body_field=body_field,
            )
            if target_id is None:
                return _error_bad_target()
            if not learner_owns_target(account, target_id):
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
    """Restrict private learner resources to their authenticated owner."""

    def decorator(view):
        return _learner_progress_gate(
            view,
            kwarg=kwarg,
            query_param=query_param,
            body_field=body_field,
            allow_staff=False,
        )

    return decorator


def learner_self_or_staff(*, kwarg=None, query_param=None, body_field=None):
    """Allow the owning learner or existing staff/admin workflow."""

    def decorator(view):
        return _learner_progress_gate(
            view,
            kwarg=kwarg,
            query_param=query_param,
            body_field=body_field,
            allow_staff=True,
        )

    return decorator


def learner_self_or_admin(*, kwarg=None, query_param=None, body_field=None):
    """Allow owner, admin, scoped Coach, or linked staff learner actions."""

    def decorator(view):
        return _learner_progress_gate(
            view,
            kwarg=kwarg,
            query_param=query_param,
            body_field=body_field,
            allow_staff=False,
            allow_admin=True,
        )

    return decorator


__all__ = (
    "audit_admin_learner_action",
    "learner_self_only",
    "learner_self_or_admin",
    "learner_self_or_staff",
)
