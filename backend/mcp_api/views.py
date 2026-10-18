"""MCP server endpoints: the bearer challenge, OAuth metadata and the OAuth flow.

Everything here is behind ``MCP_ENABLED`` and answers 404 while it is off, so an
unconfigured deployment looks exactly as it did before this app existed. With the
flag on but ``MCP_PUBLIC_BASE_URL`` blank, every endpoint answers 503
``mcp_misconfigured`` rather than advertise relative URLs (3.1a).

These paths are exempt from ``login.api_gate`` (see ``rule_for``). The token,
registration, revocation and metadata endpoints use no cookie, hence
``csrf_exempt`` and a credential-free ``Access-Control-Allow-Origin: *`` (browser
clients such as MCP Inspector call them directly). ``/oauth/authorize`` is the
exception: it reads the ``kbc_session`` cookie, keeps CSRF on its consent POST,
sends no CORS headers and may not be framed.
"""
import json
import logging
import time
from functools import wraps
from urllib.parse import urlsplit

from django.core.cache import cache
from django.http import HttpResponse, HttpResponseNotFound, HttpResponseRedirect, JsonResponse
from django.shortcuts import render
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from login.invitations import frontend_base_url
from login.security import client_ip
from login.sessions import authenticate_request

from . import oauth, protocol
from .auth import has_mcp_access, resolve_bearer
from .context import mcp_call
from .events import call_event, event
from .models import McpOAuthToken
from .settings import SCOPE, allowed_origins, mcp_enabled, public_base_url

logger = logging.getLogger("mcp_api")

PROTECTED_RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource"

#: Dynamic registrations allowed per client IP per hour.
REGISTRATIONS_PER_HOUR = 10


def mcp_feature_required(view):
    """404 while ``MCP_ENABLED`` is off; 503 while it is on without a public base URL."""
    @wraps(view)
    def wrapped(request, *args, **kwargs):
        if not mcp_enabled():
            return HttpResponseNotFound()
        if not public_base_url():
            logger.error("MCP_ENABLED is on but MCP_PUBLIC_BASE_URL is unset; refusing MCP/OAuth requests.")
            return JsonResponse(
                {"error": "The MCP server is not configured.", "code": "mcp_misconfigured"},
                status=503,
            )
        return view(request, *args, **kwargs)
    return wrapped


def public_cors(view):
    """Credential-free CORS for endpoints that read no cookie; answers preflights."""
    @wraps(view)
    def wrapped(request, *args, **kwargs):
        if request.method == "OPTIONS":
            response = HttpResponse(status=204)
        else:
            response = view(request, *args, **kwargs)
        response["Access-Control-Allow-Origin"] = "*"
        response["Access-Control-Allow-Methods"] = "GET, POST, DELETE, OPTIONS"
        response["Access-Control-Allow-Headers"] = "Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Session-Id"
        response["Access-Control-Expose-Headers"] = "WWW-Authenticate, Mcp-Session-Id"
        return response
    return wrapped


def _no_store(response):
    response["Cache-Control"] = "no-store"
    response["Pragma"] = "no-cache"
    return response


def _oauth_error(error):
    return _no_store(JsonResponse(
        {"error": error.error, "error_description": error.description}, status=error.status
    ))


# --- /mcp/ ----------------------------------------------------------------------

def _bearer_challenge():
    response = HttpResponse(status=401)
    response["WWW-Authenticate"] = (
        f'Bearer resource_metadata="{public_base_url()}{PROTECTED_RESOURCE_METADATA_PATH}"'
    )
    return response


def _origin_allowed(request):
    """DNS-rebinding guard: a browser Origin must be this server or an allowlisted one."""
    origin = request.headers.get("Origin")
    if not origin:
        return True
    return origin.rstrip("/") in {public_base_url(), *allowed_origins()}


#: Refresh ``Last_used_at`` at most this often, so a busy client does not write per call.
_LAST_USED_REFRESH_SECONDS = 300


def _touch(token):
    now = timezone.now()
    if token.last_used_at is None or (now - token.last_used_at).total_seconds() >= _LAST_USED_REFRESH_SECONDS:
        McpOAuthToken.objects.filter(pk=token.pk).update(last_used_at=now)


@csrf_exempt
@public_cors
@mcp_feature_required
def mcp_endpoint(request):
    """MCP Streamable HTTP, stateless JSON: POST one JSON-RPC message, get one reply.

    Bearer tokens are accepted here and nowhere else. The token's account becomes
    ``request.login_account`` and the curriculum-history actor for the whole call,
    and both are cleared in ``finally`` (``context.mcp_call``).
    """
    if not _origin_allowed(request):
        return JsonResponse({"error": "Origin not allowed.", "code": "origin_not_allowed"}, status=403)
    if request.method != "POST":
        response = HttpResponse(status=405)
        response["Allow"] = "POST"
        return response
    resolved = resolve_bearer(request)
    if resolved is None:
        return _bearer_challenge()
    account, token = resolved

    version = request.headers.get("Mcp-Protocol-Version")
    if version and version not in protocol.SUPPORTED_PROTOCOL_VERSIONS:
        status, body = protocol.error(None, protocol.INVALID_REQUEST, f"Unsupported MCP-Protocol-Version {version}.", 400)
        return JsonResponse(body, status=status)

    _touch(token)
    started = time.monotonic()
    action, outcome = "", "error"
    try:
        try:
            message = json.loads(request.body or b"")
        except ValueError:
            status, body = protocol.error(None, protocol.PARSE_ERROR, "Parse error: the body is not JSON.", 400)
        else:
            action = message.get("method", "") if isinstance(message, dict) else ""
            with mcp_call(request, account, token.client):
                try:
                    status, body, tool_name = protocol.handle(request, message, account.pk)
                except Exception:
                    logger.exception("MCP request failed")
                    status, body, tool_name = (*protocol.error(
                        message.get("id") if isinstance(message, dict) else None,
                        protocol.INTERNAL_ERROR, protocol.GENERIC_FAILURE,
                    ), None)
            action = tool_name or action
        failed = body is not None and ("error" in body or body.get("result", {}).get("isError"))
        outcome = "error" if failed else "ok"
    finally:
        call_event(account.pk, token.client, action, outcome, round((time.monotonic() - started) * 1000))
    if body is None:
        return HttpResponse(status=status)
    return JsonResponse(body, status=status)


# --- metadata (RFC 9728 / RFC 8414) -----------------------------------------------

def _metadata(body):
    response = JsonResponse(body)
    response["Cache-Control"] = "public, max-age=3600"
    return response


@csrf_exempt
@public_cors
@mcp_feature_required
@require_http_methods(["GET"])
def oauth_protected_resource_metadata(request):
    base = public_base_url()
    return _metadata({
        "resource": oauth.resource_url(),
        "authorization_servers": [base],
        "scopes_supported": [SCOPE],
        "bearer_methods_supported": ["header"],
    })


@csrf_exempt
@public_cors
@mcp_feature_required
@require_http_methods(["GET"])
def oauth_authorization_server_metadata(request):
    base = public_base_url()
    return _metadata({
        "issuer": base,
        "authorization_endpoint": f"{base}/oauth/authorize",
        "token_endpoint": f"{base}/oauth/token",
        "registration_endpoint": f"{base}/oauth/register",
        "revocation_endpoint": f"{base}/oauth/revoke",
        "scopes_supported": [SCOPE],
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code", "refresh_token"],
        "code_challenge_methods_supported": ["S256"],
        "token_endpoint_auth_methods_supported": ["none"],
        "revocation_endpoint_auth_methods_supported": ["none"],
    })


# --- /oauth/register (RFC 7591) ---------------------------------------------------

def _registration_allowed(request):
    """At most REGISTRATIONS_PER_HOUR per IP. Per worker unless CACHE_URL (Redis) is set."""
    key = f"mcp:register:{client_ip(request) or 'unknown'}"
    try:
        cache.add(key, 0, timeout=3600)
        return cache.incr(key) <= REGISTRATIONS_PER_HOUR
    except Exception:  # noqa: BLE001 - a cache outage must not take registration down
        logger.warning("MCP registration rate limit unavailable; allowing the request.")
        return True


@csrf_exempt
@public_cors
@mcp_feature_required
@require_http_methods(["POST"])
def oauth_register(request):
    if not _registration_allowed(request):
        return _no_store(JsonResponse(
            {"error": "too_many_requests", "error_description": "Too many registrations; try again later."},
            status=429,
        ))
    try:
        data = json.loads(request.body or b"null")
    except ValueError:
        data = None
    try:
        client = oauth.register_client(data)
    except oauth.OAuthError as error:
        return _oauth_error(error)
    return _no_store(JsonResponse(oauth.client_body(client), status=201))


# --- /oauth/authorize --------------------------------------------------------------

def _page(request, template, context, status=200):
    response = render(request, f"mcp_api/{template}", context, status=status)
    response["X-Frame-Options"] = "DENY"
    response["Content-Security-Policy"] = "frame-ancestors 'none'"
    response["Referrer-Policy"] = "no-referrer"
    return _no_store(response)


@mcp_feature_required
@require_http_methods(["GET", "POST"])
def oauth_authorize(request):
    """Consent for a connector to act as the signed-in staff member.

    GET shows the consent page (or a sign-in page); POST is the decision, CSRF
    protected. Both re-validate the request and re-check the session and grant.
    Never auto-approves: every authorization shows the consent page.
    """
    params = request.POST if request.method == "POST" else request.GET
    try:
        client, auth_request = oauth.validate_authorization_request(params)
    except oauth.AuthorizeError as error:
        if error.redirect:
            return HttpResponseRedirect(error.redirect_url())
        return _page(request, "error.html", {"message": error.description}, status=400)

    account = authenticate_request(request)
    if account is None:
        # Neither sign-in route can return here (see the Step 3 report), so the
        # page links to the LMS login and "Continue" re-requests this same,
        # already-validated URL -- a relative path, never a caller-supplied target.
        return _page(request, "signin.html", {
            "client_name": client.client_name,
            "login_url": f"{frontend_base_url()}/login",
            "continue_url": request.get_full_path(),
        }, status=401)
    if not has_mcp_access(account):
        return _page(request, "error.html", {
            "message": "Only staff with curriculum access can connect an AI assistant to the LMS.",
        }, status=403)

    if request.method == "GET":
        return _page(request, "consent.html", {
            "client_name": client.client_name,
            "redirect_host": urlsplit(auth_request["redirect_uri"]).hostname,
            "display_name": account.display_name or account.email,
            "params": {k: v for k, v in auth_request.items() if v is not None},
        })

    if request.POST.get("decision") != "allow":
        event("mcp.consent_denied", account_id=account.pk, client=client)
        return HttpResponseRedirect(oauth.add_query(
            auth_request["redirect_uri"], {"error": "access_denied", "state": auth_request["state"]}
        ))
    code = oauth.create_code(client, account, auth_request)
    event("mcp.consent_granted", account_id=account.pk, client=client)
    return HttpResponseRedirect(oauth.add_query(
        auth_request["redirect_uri"], {"code": code, "state": auth_request["state"]}
    ))


# --- /oauth/token, /oauth/revoke ----------------------------------------------------

@csrf_exempt
@public_cors
@mcp_feature_required
@require_http_methods(["POST"])
def oauth_token(request):
    client = oauth.active_client(request.POST.get("client_id"))
    if client is None:
        return _oauth_error(oauth.OAuthError("invalid_client", "Unknown or disabled client.", status=401))
    grant_type = request.POST.get("grant_type")
    try:
        if grant_type == "authorization_code":
            body = oauth.exchange_code(
                client,
                request.POST.get("code"),
                request.POST.get("redirect_uri"),
                request.POST.get("code_verifier"),
            )
        elif grant_type == "refresh_token":
            body = oauth.refresh(client, request.POST.get("refresh_token"), request.POST.get("scope"))
        else:
            raise oauth.OAuthError("unsupported_grant_type", "Use authorization_code or refresh_token.")
    except oauth.OAuthError as error:
        return _oauth_error(error)
    return _no_store(JsonResponse(body))


@csrf_exempt
@public_cors
@mcp_feature_required
@require_http_methods(["POST"])
def oauth_revoke(request):
    """RFC 7009: always 200, whether or not the token existed."""
    client_id = request.POST.get("client_id")
    client = oauth.active_client(client_id) if client_id else None
    if client_id and client is None:
        return _no_store(HttpResponse(status=200))
    oauth.revoke_token(request.POST.get("token"), client)
    return _no_store(HttpResponse(status=200))
