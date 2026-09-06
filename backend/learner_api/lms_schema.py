"""Proxy for the Kent Business College WordPress LMS schema endpoint.

The browser should not receive the WordPress API key, so the React app calls
this Django endpoint and Django adds the required header server-side.
"""
import json
import logging
import urllib.error
import urllib.request
from time import monotonic
from urllib.parse import urlencode

from django.conf import settings
from django.http import JsonResponse
from django.views.decorators.http import require_GET

from login.permissions import _auth_gate_enabled
from login.sessions import authenticate_request

logger = logging.getLogger(__name__)

_CACHE = {"expires_at": 0.0, "payload": None}

# The whole-cohort parameters. Only staff/admin may drive them; a learner is
# pinned to their own record regardless of what they send (A6).
_STAFF_QUERY_KEYS = {"page", "per_page", "student_id", "email", "search"}


def _scoped_query(request):
    """(query, error) — the upstream params this caller is allowed to drive.

    A6: this endpoint proxies a WordPress key that can read ANY student's LMS
    record, and it sits under the coarse ``ANY`` prefix. So it must scope by the
    real session identity, never the client-supplied ``email``/``student_id``:
      * learner  -> forced to their OWN email; ``search``/``student_id`` dropped.
      * staff/admin -> the full parameter set (the console needs ``search``).
      * anyone else (employer, …) -> 403.
    ``LEARNER_API_REQUIRE_AUTH=0`` disables the gate for local dev, matching the
    rest of ``learner_api``.
    """
    incoming = {k: v for k, v in request.GET.items() if k in _STAFF_QUERY_KEYS}

    if not _auth_gate_enabled():
        authenticate_request(request)
        return incoming, None

    account = authenticate_request(request)
    if account is None:
        return None, JsonResponse({"error": "Authentication required."}, status=401)

    if account.role in {"admin", "staff"}:
        return incoming, None

    if account.role == "learner":
        own_email = str(getattr(account, "email", "") or "").strip()
        if not own_email:
            # No email to scope to — refuse rather than fall back to a wide read.
            return None, JsonResponse({"error": "Not found."}, status=404)
        # Ignore any client-supplied email/student_id/search: a learner may only
        # ever read their own record. page/per_page are harmless paging controls.
        query = {"email": own_email}
        for key in ("page", "per_page"):
            if key in incoming:
                query[key] = incoming[key]
        return query, None

    return None, JsonResponse({"error": "You do not have access to this resource."}, status=403)


@require_GET
def all_students_schema(request):
    query, error = _scoped_query(request)
    if error is not None:
        return error

    api_key = getattr(settings, "KBC_LMS_API_KEY", "")
    endpoint = getattr(settings, "KBC_LMS_SCHEMA_URL", "")
    if not api_key or not endpoint:
        return JsonResponse({"error": "KBC LMS API is not configured."}, status=503)
    cache_key = urlencode(sorted(query.items()))

    now = monotonic()
    cached = _CACHE.get(cache_key)
    if cached is not None and cached["expires_at"] > now:
        return JsonResponse(cached["payload"], safe=False)

    headers = {
        "Accept": "application/json",
        "X-KBC-API-Key": api_key,
        "User-Agent": "KBC-LearningOS/1.0",
    }
    target_url = f"{endpoint}?{urlencode(query)}" if query else endpoint
    req = urllib.request.Request(target_url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        if exc.code == 400 and query:
            fallback_query = {k: v for k, v in query.items() if k in {"page", "student_id", "email", "search"}}
            fallback_url = f"{endpoint}?{urlencode(fallback_query)}" if fallback_query else endpoint
            try:
                with urllib.request.urlopen(urllib.request.Request(fallback_url, headers=headers), timeout=30) as response:
                    payload = json.loads(response.read().decode("utf-8"))
            except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, ValueError):
                logger.warning("KBC LMS schema returned %s", exc.code)
                return JsonResponse({"error": f"KBC LMS API returned {exc.code}."}, status=502)
        else:
            logger.warning("KBC LMS schema returned %s", exc.code)
            return JsonResponse({"error": f"KBC LMS API returned {exc.code}."}, status=502)
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        logger.warning("Could not read KBC LMS schema: %s", exc)
        return JsonResponse({"error": "Could not read KBC LMS API."}, status=502)

    _CACHE[cache_key] = {"payload": payload, "expires_at": now + 300}
    return JsonResponse(payload, safe=False)
