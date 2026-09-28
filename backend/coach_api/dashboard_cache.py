"""Short-lived, identity-scoped cache for the Coach Dashboard response."""

from __future__ import annotations

import hashlib
import logging

from django.conf import settings
from django.core.cache import cache

from .auth import normalize_email


logger = logging.getLogger(__name__)
CACHE_NAMESPACE = "coach-dashboard-summary:v2"


def coach_dashboard_cache_key(coach_identity: str) -> str:
    """Return a non-sensitive key for the already-authorised effective coach."""
    canonical = normalize_email(coach_identity)
    if not canonical:
        raise ValueError("A canonical coach identity is required for dashboard caching.")
    identity_hash = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    return f"{CACHE_NAMESPACE}:{identity_hash}"


def coach_dashboard_cache_ttl() -> int:
    return max(int(getattr(settings, "COACH_DASHBOARD_CACHE_TTL", 90)), 1)


def get_cached_coach_dashboard(coach_identity: str):
    key = coach_dashboard_cache_key(coach_identity)
    try:
        payload = cache.get(key)
    except Exception:  # noqa: BLE001 - cache availability must not gate reads
        logger.warning(
            "coach_dashboard_cache status=READ_FAILED namespace=%s",
            CACHE_NAMESPACE,
            exc_info=True,
        )
        return None
    logger.info(
        "coach_dashboard_cache status=%s namespace=%s",
        "HIT" if payload is not None else "MISS",
        CACHE_NAMESPACE,
    )
    return payload


def cache_coach_dashboard(coach_identity: str, payload: dict) -> None:
    try:
        cache.set(
            coach_dashboard_cache_key(coach_identity),
            payload,
            timeout=coach_dashboard_cache_ttl(),
        )
    except Exception:  # noqa: BLE001 - a computed response remains valid
        logger.warning(
            "coach_dashboard_cache status=WRITE_FAILED namespace=%s",
            CACHE_NAMESPACE,
            exc_info=True,
        )


def invalidate_coach_dashboard_cache(coach_identity: str) -> None:
    """Invalidate the final response cache for one effective coach only."""
    try:
        cache.delete(coach_dashboard_cache_key(coach_identity))
    except Exception:  # noqa: BLE001 - never turn a successful write into 500
        logger.warning(
            "coach_dashboard_cache status=INVALIDATE_FAILED namespace=%s",
            CACHE_NAMESPACE,
            exc_info=True,
        )
        return
    logger.info("coach_dashboard_cache status=INVALIDATED namespace=%s", CACHE_NAMESPACE)
