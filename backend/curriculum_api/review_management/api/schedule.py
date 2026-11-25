"""Existing programme schedule and clash-resolution HTTP handlers."""
from __future__ import annotations

from curriculum_api.catalogue.infrastructure.database_reads import CURRICULUM_SCHEMA
from curriculum_api.review_management.domain.recurrence import DEFAULT_PREVIEW_MONTHS
from django.http import JsonResponse
from curriculum_api.review_management.domain.recurrence import MAX_PREVIEW_MONTHS
from curriculum_api.review_management.api.templates import _programme_exists
from curriculum_api.review_management.api.templates import _actor as _template_actor
from curriculum_api.review_management.application.scheduling import build_programme_schedule
from curriculum_api.catalogue.domain.values import clean_str
from django.views.decorators.csrf import csrf_exempt
from curriculum_api.review_management.infrastructure.schedule_schema import ensure_review_schedule_tables
from curriculum_api.review_management.infrastructure.template_schema import ensure_review_tables
from curriculum_api.catalogue.api.responses import json_body
from curriculum_api.catalogue.api.responses import json_error
from curriculum_api.catalogue.infrastructure.cache_composition import log_curriculum_decision
from curriculum_api.catalogue.domain.values import parse_int
from curriculum_api.review_management.api.commands import resolve_clash_decision
from curriculum_api.review_management.application.scheduling import validate_clash_resolution_payload


@csrf_exempt
def curriculum_programme_review_schedule(request, programme_id):
    ensure_review_tables()
    ensure_review_schedule_tables()
    programme_id = clean_str(programme_id)

    if request.method != 'GET':
        return json_error('Method not allowed.', status=405)
    if not _programme_exists(programme_id):
        return json_error('Programme not found.', status=404)

    months = parse_int(request.GET.get('months'), DEFAULT_PREVIEW_MONTHS)
    months = max(1, min(months, MAX_PREVIEW_MONTHS))

    payload = build_programme_schedule(programme_id, months=months)
    return JsonResponse({'schema': CURRICULUM_SCHEMA, **payload})


@csrf_exempt
def curriculum_programme_review_clash_resolve(request, programme_id):
    """POST body: {"month": "2027-03", "occurrences": [{"reviewId", "occurrenceDate", "action": "skip"|"keep"}]}

    "skip" removes one occurrence from the effective schedule without
    touching the recurring template; "keep" restores a previously skipped
    occurrence (or is a no-op if it was already scheduled). Selecting "keep"
    for every occurrence in a clash persists an explicit "kept both/all"
    acknowledgement so the same clash does not keep reappearing as
    unresolved.
    """
    ensure_review_tables()
    ensure_review_schedule_tables()
    programme_id = clean_str(programme_id)

    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)
    if not _programme_exists(programme_id):
        return json_error('Programme not found.', status=404)

    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')

    month, items, errors = validate_clash_resolution_payload(programme_id, payload)
    if errors:
        return json_error('Please fix the highlighted fields.', fields=errors)

    actor = _template_actor(request)
    month_payload = resolve_clash_decision(programme_id, month, items, actor=actor)

    log_curriculum_decision(
        'review.clash_resolve', outcome='resolved', entity_id=programme_id, reason=f'month={month}',
    )
    return JsonResponse({'resolved': True, 'programmeId': programme_id, 'month': month_payload})
