"""Issue a short-lived signed token for the KBC Support Portal's LMS entry page.

Token format
------------
The support portal (help-desk backend) expects:

    base64url(json_payload).base64url(hmac_sha256_signature)

where json_payload = {"email": str, "iat": unix_ts, "exp": unix_ts}
and the HMAC-SHA256 key is the shared SUPPORT_SSO_SECRET setting.

This is intentionally different from django.core.signing (used by safeguarding_sso)
so the two secrets never cross purposes.

LMS URL
-------
Add to login/urls.py:

    path("support/authorize/", support_sso.authorize),

and to config/settings.py (or .env):

    SUPPORT_SSO_SECRET = "..."    # must match help-desk SUPPORT_SSO_SECRET
    SUPPORT_SSO_CALLBACK_URL = "https://technicalsupport.kentbusinesscollege.net/lms"
    SUPPORT_SSO_TOKEN_TTL = 300   # seconds (default 5 minutes)

The LMS LiteSpeed server must forward requests under login_api/ to Django:
    login_api/support/authorize/  →  Django

The resulting redirect is:
    https://technicalsupport.kentbusinesscollege.net/lms?token=<signed_token>
"""

import base64
import hashlib
import hmac
import json
import time
from urllib.parse import urlencode

from django.conf import settings
from django.http import JsonResponse
from django.http import HttpResponseRedirect
from django.views.decorators.http import require_GET

from .sessions import authenticate_request

_DEFAULT_TTL = 300  # 5 minutes


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _issue_token(email: str, secret: str, ttl: int = _DEFAULT_TTL) -> str:
    """Create and sign a short-lived support SSO token."""
    now = int(time.time())
    payload = {"email": email, "iat": now, "exp": now + ttl}
    payload_b64 = _b64url(json.dumps(payload, separators=(",", ":")).encode())
    sig = hmac.new(secret.encode(), payload_b64.encode(), hashlib.sha256).digest()
    sig_b64 = _b64url(sig)
    return f"{payload_b64}.{sig_b64}"


@require_GET
def authorize(request):
    """Redirect the authenticated LMS learner to the support portal with a signed token.

    The browser calls this endpoint from within the LMS (learner already signed in).
    Query string parameters are intentionally ignored — the identity comes from the
    active LMS session, never from the URL.
    """
    secret = getattr(settings, "SUPPORT_SSO_SECRET", "")
    callback = getattr(settings, "SUPPORT_SSO_CALLBACK_URL", "")
    ttl = int(getattr(settings, "SUPPORT_SSO_TOKEN_TTL", _DEFAULT_TTL))

    if len(secret) < 32 or not callback:
        return JsonResponse(
            {"error": "Support portal sign-in is not configured."},
            status=503,
        )

    account = authenticate_request(request)
    if account is None or not account.is_active:
        return JsonResponse(
            {"error": "Please sign in to the LMS before opening support."},
            status=401,
        )

    token = _issue_token(account.email, secret, ttl)
    # Append ?token= to the callback URL (the help-desk /lms page reads it from searchParams).
    redirect_url = callback.rstrip("/") + "?" + urlencode({"token": token})
    response = HttpResponseRedirect(redirect_url)
    response["Cache-Control"] = "no-store, no-cache, must-revalidate"
    response["Referrer-Policy"] = "no-referrer"
    return response
