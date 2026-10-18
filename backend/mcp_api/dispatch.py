"""Call existing LMS endpoints on behalf of an MCP tool -- modelled on ``config.batch``.

Tools never write business data themselves: they call the same views the SPA uses,
so validation, versioning, cache epochs and audit all fire. A call must be on the
explicit (method, path pattern) allowlist below, passes the same
``login.api_gate.refusal_for`` check ``config.batch`` applies (dispatch calls the
view directly, so no middleware sees the sub-request), and runs as the token's
account: the sub-request carries ``login_account``, so ``authenticate_request``
and every permission decorator resolve to it.

Payloads are refused -- never silently edited -- when they hold any key or value
an MCP write may not send (ground rule 6): ``removeMissing``, ``hydrationComplete``,
``permanent``, any key starting with ``remove`` or ``deleted``, or a
``status`` of ``published``.
"""
import json
import logging
import re
from urllib.parse import urlencode

from django.http import StreamingHttpResponse
from django.test.client import RequestFactory
from django.urls import Resolver404, resolve

from login.api_gate import refusal_for

logger = logging.getLogger("mcp_api")

METHODS = frozenset({"GET", "POST", "PUT", "PATCH"})

#: (method, full-match regex on the path). Empty until tools need endpoints
#: (Step 6 adds read-only ones). Anything not listed is refused.
ALLOWED_CALLS = ()

FORBIDDEN_KEYS = frozenset({"removemissing", "hydrationcomplete", "permanent"})
FORBIDDEN_KEY_PREFIXES = ("remove", "deleted")


class DispatchError(Exception):
    """A refused or failed call, with a message fit to show the user."""

    def __init__(self, message, status=None):
        super().__init__(message)
        self.status = status


def forbidden_key(payload, path="payload"):
    """Where ``payload`` breaks ground rule 6, or None."""
    if isinstance(payload, dict):
        for key, value in payload.items():
            here = f"{path}.{key}"
            norm = str(key).lower()
            if norm in FORBIDDEN_KEYS or norm.startswith(FORBIDDEN_KEY_PREFIXES):
                return here
            if norm == "status" and isinstance(value, str) and value.strip().lower() == "published":
                return here
            found = forbidden_key(value, here)
            if found:
                return found
    elif isinstance(payload, (list, tuple)):
        for index, value in enumerate(payload):
            found = forbidden_key(value, f"{path}[{index}]")
            if found:
                return found
    return None


def is_allowed(method, path, allowed=None):
    for allowed_method, pattern in (ALLOWED_CALLS if allowed is None else allowed):
        if allowed_method == method and re.fullmatch(pattern, path):
            return True
    return False


def _message_for(status, data):
    detail = ""
    if isinstance(data, dict):
        detail = str(data.get("error") or data.get("detail") or data.get("message") or "")[:300]
    if status in (401, 403):
        return "You don't have permission to do that in the LMS."
    if status == 404:
        return "That item doesn't exist, or you can't see it. Look it up again to get the right id."
    if status == 409:
        return f"That conflicts with the item's current state{f': {detail}' if detail else ''}. Look it up again and retry."
    if status == 429:
        return "The LMS is busy. Please wait a minute and try again."
    return f"The LMS did not accept that{f': {detail}' if detail else ''}."


def call_api(request, method, path, *, query=None, json_body=None):
    """``(status, data)`` from an allowlisted LMS endpoint, as the request's account."""
    method = method.upper()
    if method not in METHODS or not path.startswith("/") or ".." in path.split("/") or "?" in path:
        raise DispatchError("That LMS action is not available to the assistant.")
    if not is_allowed(method, path):
        raise DispatchError("That LMS action is not available to the assistant.")
    if json_body is not None:
        found = forbidden_key(json_body)
        if found:
            raise DispatchError(
                "The assistant may not publish, delete, archive or remove anything in the LMS; "
                "this request was refused."
            )

    account = getattr(request, "login_account", None)
    refusal = refusal_for(path, account, method=method)
    if refusal is not None:
        raise DispatchError(_message_for(refusal.status_code, None), refusal.status_code)

    factory = RequestFactory()
    url = f"{path}?{urlencode(query, doseq=True)}" if query else path
    if method == "GET":
        sub = factory.get(url)
    else:
        sub = getattr(factory, method.lower())(
            url, data=json.dumps(json_body if json_body is not None else {}), content_type="application/json"
        )
    sub.login_account = account
    sub.login_session = None
    sub._dont_enforce_csrf_checks = True
    if hasattr(request, "user"):
        sub.user = request.user

    try:
        match = resolve(path)
    except Resolver404:
        raise DispatchError(_message_for(404, None), 404) from None
    try:
        response = match.func(sub, *match.args, **match.kwargs)
    except Exception:
        logger.exception("MCP dispatch to %s %s failed", method, match.route)
        raise DispatchError("Something went wrong in the LMS. Please try again later.", 500) from None

    if isinstance(response, StreamingHttpResponse):
        raise DispatchError("That LMS response cannot be read by the assistant.", response.status_code)
    try:
        data = json.loads(response.content or b"null")
    except ValueError:
        data = None
    if response.status_code >= 500:
        logger.error("MCP dispatch to %s %s returned %s", method, match.route, response.status_code)
        raise DispatchError("Something went wrong in the LMS. Please try again later.", response.status_code)
    if response.status_code >= 400:
        raise DispatchError(_message_for(response.status_code, data), response.status_code)
    if data is None and response.content:
        raise DispatchError("That LMS response cannot be read by the assistant.", response.status_code)
    return response.status_code, data
