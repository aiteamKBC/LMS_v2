"""HTTP boundary for the Coach Dashboard read model."""

from time import perf_counter

from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_GET

from config.observability import metric_event

from .auth import authenticated_coach_email, coach_access_required
from . import dashboard_cache
from .errors import coach_error
from .services.dashboard.service import CoachDashboardService


def _dashboard_perf(stage, started, *, learner_count=None):
    payload = {
        "event": "coach_perf",
        "endpoint": "dashboard",
        "stage": stage,
        "duration_ms": round((perf_counter() - started) * 1000, 2),
    }
    if learner_count is not None:
        payload["learner_count"] = learner_count
    metric_event("coach_perf", **payload)


@coach_access_required
@require_GET
def coach_dashboard(request):
    """Return the cached or persisted Dashboard read model for one effective coach."""
    endpoint_started = perf_counter()
    owner_email = authenticated_coach_email(request)
    cached_dashboard = dashboard_cache.get_cached_coach_dashboard(owner_email)
    if cached_dashboard is not None:
        _dashboard_perf(
            "cache_hit", endpoint_started,
            learner_count=len(cached_dashboard.get("learners", [])),
        )
        return JsonResponse(cached_dashboard)

    try:
        response_payload = CoachDashboardService(
            owner_email, today=timezone.localdate(),
        ).build()
    except Exception:
        import logging
        logging.getLogger(__name__).exception(
            "coach_dashboard_load_failed coach_account_id=%s", owner_email,
        )
        return coach_error(
            request,
            code="database_unavailable",
            message="Unable to load coach dashboard data.",
            status=503,
        )

    metric_event(
        "coach_dashboard_cache",
        status="MISS_COMPUTED",
        namespace="coach-dashboard-summary:v1",
        duration_ms=round((perf_counter() - endpoint_started) * 1000, 2),
    )
    _dashboard_perf(
        "total", endpoint_started,
        learner_count=len(response_payload.get("learners", [])),
    )
    dashboard_cache.cache_coach_dashboard(owner_email, response_payload)
    return JsonResponse(response_payload)
