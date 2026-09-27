"""Dashboard cache compatibility boundary."""

from coach_api.dashboard_cache import (
    CACHE_NAMESPACE,
    cache_coach_dashboard,
    coach_dashboard_cache_key,
    coach_dashboard_cache_ttl,
    get_cached_coach_dashboard,
    invalidate_coach_dashboard_cache,
)

__all__ = [
    "CACHE_NAMESPACE",
    "cache_coach_dashboard",
    "coach_dashboard_cache_key",
    "coach_dashboard_cache_ttl",
    "get_cached_coach_dashboard",
    "invalidate_coach_dashboard_cache",
]
