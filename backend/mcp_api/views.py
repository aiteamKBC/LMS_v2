"""MCP server endpoints -- skeleton only.

Everything here is behind ``MCP_ENABLED`` and answers 404 while it is off, so an
unconfigured deployment looks exactly as it did before this app existed.

These paths are exempt from ``login.api_gate`` (see ``rule_for``): they
authenticate themselves with bearer tokens issued by the OAuth flow, never with
the ``kbc_session`` cookie. No view reads a cookie yet, hence ``csrf_exempt``.
The authorize consent POST, when it lands, is cookie-based and must keep CSRF.
"""
from functools import wraps

from django.http import HttpResponse, HttpResponseNotFound, JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from .settings import mcp_enabled, public_base_url

PROTECTED_RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource"


def mcp_feature_required(view):
    """Plain 404 while ``MCP_ENABLED`` is off -- indistinguishable from no route."""
    @wraps(view)
    def wrapped(request, *args, **kwargs):
        if not mcp_enabled():
            return HttpResponseNotFound()
        return view(request, *args, **kwargs)
    return wrapped


def _not_implemented():
    return JsonResponse(
        {"error": "Not implemented yet.", "code": "not_implemented"},
        status=501,
    )


@csrf_exempt
@mcp_feature_required
@require_http_methods(["GET", "POST", "DELETE"])
def mcp_endpoint(request):
    """No token can be valid yet, so every call is told where to get one (RFC 9728)."""
    response = HttpResponse(status=401)
    response["WWW-Authenticate"] = (
        f'Bearer resource_metadata="{public_base_url()}{PROTECTED_RESOURCE_METADATA_PATH}"'
    )
    return response


@csrf_exempt
@mcp_feature_required
def oauth_protected_resource_metadata(request):
    return _not_implemented()


@csrf_exempt
@mcp_feature_required
def oauth_authorization_server_metadata(request):
    return _not_implemented()
