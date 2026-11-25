"""Bounded Curriculum Home response; the full overview remains a separate read."""

import json

from datetime import datetime, timezone

from django.conf import settings
from django.http import JsonResponse
from django.views.decorators.http import require_GET

from .catalogue.application.projections import build_home_summary
from .catalogue.application.programme_enrichment import home_programmes_need_enrichment
from .catalogue.infrastructure.programme_reads import home_source_rows
from .catalogue.infrastructure.projection_sources import (
    home_relationship_rows, _HOME_MODULE_FIELDS, _HOME_GROUP_FIELDS, _HOME_COHORT_FIELDS, _HOME_WEEK_FIELDS,
)


ATTENTION_ISSUES = ('programme-ksb-source', 'module-mapping', 'group-coach', 'module-tutor')
# Keys of the cached projection that only the on-demand detail read returns.
from .catalogue.application.home_projection import (
    _DETAIL_KEYS, _clean, _key, _missing, _zero, _date_value, project_home_summary, summary_only, project_home
)


def _home_projection(
    request, *, curriculum_visibility, request_bypasses_curriculum_cache,
    cached_curriculum_value, build_home_summary, get_curriculum_home,
    enqueue_curriculum_home_refresh,
):
    """The cached Home projection for this request's visibility, plus a cache header.

    The existing /curriculum_api/ staff gate applies before both Home views, just
    as it does to overview. Cache by visibility and the shared write epoch, so a
    curriculum write invalidates the summary and every detail read together.
    """
    visibility = curriculum_visibility(request)
    force = request_bypasses_curriculum_cache(request)
    shared_enabled = getattr(settings, 'CURRICULUM_HOME_SHARED_READ_MODEL_ENABLED', False)
    if not force and shared_enabled:
        shared = get_curriculum_home(visibility)
        if shared is not None and isinstance(shared.payload.get('overview'), dict) and isinstance(shared.payload.get('programmes'), list):
            # Do not put a stale snapshot in the long-lived payload cache. The
            # worker can refresh it without moving the curriculum write epoch.
            if shared.stale:
                enqueue_curriculum_home_refresh(visibility, reason='stale-read')
            projection = project_home(shared.payload['overview'], shared.payload['programmes'])
            return projection, 'READ-MODEL-STALE' if shared.stale else 'READ-MODEL-HIT'
    projection = cached_curriculum_value(
        f'home-summary:v3:{visibility}',
        lambda: build_home_summary(visibility, force=force),
        force=force,
    )
    if not shared_enabled:
        return projection, None
    enqueue_curriculum_home_refresh(visibility, reason='forced-read' if force else 'missing-read-model')
    return projection, 'READ-MODEL-MISS'


def _respond(payload, cache_state):
    response = JsonResponse(payload)
    if cache_state:
        response['X-LMS-Cache'] = cache_state
    return response


@require_GET
def curriculum_home_summary(request, *, load_projection):
    projection, cache_state = load_projection(request)
    return _respond(summary_only(projection), cache_state)


@require_GET
def curriculum_home_attention(request, *, load_projection):
    """The records behind one Home count (?issue=) or one programme card (?programme=).

    Filtered from the same cached projection as the summary: no overview
    payload, no extra SQL on a warm cache, and the same write-epoch invalidation.
    """
    issue = _clean(request.GET.get('issue'))
    programme = _clean(request.GET.get('programme'))
    if bool(issue) == bool(programme):
        return JsonResponse({'error': 'Provide exactly one of issue or programme.'}, status=400)
    if issue and issue not in ATTENTION_ISSUES:
        return JsonResponse({'error': 'Unknown attention issue.'}, status=400)
    projection, cache_state = load_projection(request)
    if issue:
        records = (projection.get('attentionRecords') or {}).get(issue) or []
        return _respond({'issue': issue, 'count': len(records), 'records': records}, cache_state)
    detail = (projection.get('programmeDetails') or {}).get(programme)
    if detail is None:
        # Not one of the programme cards Home shows (or its gaps were resolved).
        return _respond({'programme': {'id': programme, 'name': ''}, 'sections': []}, cache_state)
    return _respond(detail, cache_state)
