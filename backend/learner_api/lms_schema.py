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

logger = logging.getLogger(__name__)

_CACHE = {"expires_at": 0.0, "payload": None}


@require_GET
def all_students_schema(request):
    api_key = getattr(settings, "KBC_LMS_API_KEY", "")
    endpoint = getattr(settings, "KBC_LMS_SCHEMA_URL", "")
    if not api_key or not endpoint:
        return JsonResponse({"error": "KBC LMS API is not configured."}, status=503)

    query = {
        key: value
        for key, value in request.GET.items()
        if key in {"page", "per_page", "student_id", "email", "search"}
    }
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
