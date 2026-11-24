"""Compatibility exports: Delivery HTTP/read composition using the existing scheduling policy."""
from .catalogue.infrastructure.calendar_row_runtime import live_rows
from .catalogue.api.delivery_dashboard import (
    FLAGS, MODULE_FIELDS, read_inputs,
    relationships, build_overview, build_calendar_snapshot,
    build_calendar_sessions, slim_sessions, build_sessions,
    cached_calendar_snapshot, cached_calendar_sessions, calendar_sessions,
    response_for,
)

from django.db import DatabaseError
from django.http import JsonResponse
from django.views.decorators.http import require_GET
from login.permissions import require_access
from .catalogue.application.overview import CurriculumOverviewUnavailable

@require_GET
@require_access('curriculum')
def overview(request):
    return response_for(request, 'overview', build_overview)


@require_GET
@require_access('curriculum')
def sessions(request):
    try:
        snapshot = cached_calendar_snapshot(request)
    except (DatabaseError, CurriculumOverviewUnavailable):
        return JsonResponse({'error': 'Delivery data could not be loaded. Please try again.'}, status=503)
    return JsonResponse(slim_sessions(snapshot['sessions'], undated_count=snapshot['undatedSessionCount']))
