"""Existing template HTTP handlers, request validation and response status contracts."""
from __future__ import annotations

from curriculum_api.catalogue.infrastructure.database_reads import CURRICULUM_SCHEMA
from django.http import JsonResponse
from curriculum_api.review_management.api.commands import archive_review
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.review_management.application.template_commands import clone_review
from django.db import connection
from curriculum_api.review_management.api.commands import create_review
from django.views.decorators.csrf import csrf_exempt
from curriculum_api.catalogue.api.adapters import curriculum_results_response
from curriculum_api.review_management.infrastructure.template_schema import ensure_review_tables
from curriculum_api.review_management.infrastructure.template_rows import get_review_template_row
from curriculum_api.review_management.infrastructure.template_rows import get_review_template_rows
from curriculum_api.catalogue.api.responses import json_body
from curriculum_api.catalogue.api.cache_lifecycle import invalidate_curriculum_cache
from curriculum_api.catalogue.api.responses import json_error
from curriculum_api.catalogue.infrastructure.cache_composition import log_curriculum_decision
from curriculum_api.catalogue.infrastructure.hierarchy_composition import programme_config_by_identifier
from curriculum_api.catalogue.api.catalogue_endpoints import programme_response
from curriculum_api.review_management.application.template_queries import review_template_detail_payload
from curriculum_api.review_management.application.template_queries import review_template_summary_payload
from curriculum_api.review_management.infrastructure.type_rows import review_type_index
from django.db import transaction
from curriculum_api.review_management.api.commands import update_review


def review_detail_response(review_id, **extra):
    row = get_review_template_row(review_id)
    if not row:
        return json_error('Review not found.', status=404)
    payload = {'schema': CURRICULUM_SCHEMA, 'review': review_template_detail_payload(row)}
    payload.update(extra)
    return JsonResponse(payload)


def _programme_exists(programme_id):
    return bool(programme_config_by_identifier(programme_id) or programme_response(programme_id))


def _actor(request):
    # No per-request account is threaded into curriculum_api writes anywhere
    # else in this module (see week_template deletes, which hardcode a reason
    # string); Reviews follows the same convention rather than inventing one.
    return 'staff'


@csrf_exempt
def curriculum_programme_review_collection(request, programme_id):
    ensure_review_tables()
    programme_id = clean_str(programme_id)

    if request.method == 'GET':
        if not _programme_exists(programme_id):
            return json_error('Programme not found.', status=404)
        rows = get_review_template_rows('programme_id = %s', [programme_id])
        type_index = review_type_index()
        return curriculum_results_response(
            [review_template_summary_payload(row, type_index=type_index) for row in rows]
        )

    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)

    if not _programme_exists(programme_id):
        return json_error('Programme not found.', status=404)

    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')

    review_id, errors = create_review(programme_id, payload, actor=_actor(request))
    if errors:
        return json_error('Please fix the highlighted fields.', fields=errors)

    log_curriculum_decision('review.create', outcome='created', entity_id=review_id)
    return review_detail_response(review_id, created=True)


@csrf_exempt
def curriculum_review_detail(request, review_id):
    ensure_review_tables()
    review_id = clean_str(review_id)
    row = get_review_template_row(review_id)
    if not row:
        return json_error('Review not found.', status=404)

    if request.method == 'GET':
        return review_detail_response(review_id)

    if request.method == 'DELETE':
        archive_review(review_id, actor=_actor(request))
        log_curriculum_decision('review.archive', outcome='archived', entity_id=review_id)
        return JsonResponse({'deleted': True, 'permanent': False, 'archived': True, 'id': review_id})

    if request.method not in {'PATCH', 'PUT'}:
        return json_error('Method not allowed.', status=405)

    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')

    _, errors = update_review(review_id, payload, actor=_actor(request))
    if errors:
        status = 404 if errors.get('_') == 'Review not found.' else 400
        return json_error(errors.get('_') or 'Please fix the highlighted fields.', status=status, fields=errors)

    log_curriculum_decision('review.update', outcome='updated', entity_id=review_id)
    return review_detail_response(review_id, updated=True)


@csrf_exempt
def curriculum_review_clone(request, programme_id):
    """Clone one or more Reviews from another Programme into this one.

    POST body: {"sourceProgrammeId": "...", "reviewIds": ["REV-...", ...]}
    """
    ensure_review_tables()
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)

    destination_programme_id = clean_str(programme_id)
    if not _programme_exists(destination_programme_id):
        return json_error('Programme not found.', status=404)

    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')

    source_programme_id = clean_str(payload.get('sourceProgrammeId'))
    if not source_programme_id:
        return json_error('Choose a source Programme.', fields=['sourceProgrammeId'])
    if not _programme_exists(source_programme_id):
        return json_error('Source Programme not found.', status=404, fields=['sourceProgrammeId'])

    review_ids = payload.get('reviewIds')
    if not isinstance(review_ids, list) or not [r for r in review_ids if clean_str(r)]:
        return json_error('Please choose one or more types.', fields=['reviewIds'])
    review_ids = [clean_str(r) for r in review_ids if clean_str(r)]

    source_rows = get_review_template_rows(
        'programme_id = %s and id = any(%s)' if connection.vendor == 'postgresql' else 'programme_id = %s',
        [source_programme_id, review_ids] if connection.vendor == 'postgresql' else [source_programme_id],
    )
    if connection.vendor != 'postgresql':
        source_rows = [row for row in source_rows if row.get('id') in review_ids]
    found_ids = {row.get('id') for row in source_rows}
    missing = [r for r in review_ids if r not in found_ids]
    if missing:
        return json_error(
            f'Some selected reviews were not found in the source Programme: {", ".join(missing)}.',
            status=404, fields=['reviewIds'],
        )

    actor = _actor(request)
    new_ids = []
    with transaction.atomic():
        for row in source_rows:
            new_ids.append(clone_review(row, destination_programme_id, actor=actor))

    invalidate_curriculum_cache()
    log_curriculum_decision(
        'review.clone', outcome='cloned', entity_id=destination_programme_id,
        reason=f'from={source_programme_id} count={len(new_ids)}',
    )

    rows = get_review_template_rows('programme_id = %s', [destination_programme_id])
    type_index = review_type_index()
    return JsonResponse({
        'cloned': True,
        'sourceProgrammeId': source_programme_id,
        'programmeId': destination_programme_id,
        'reviewIds': new_ids,
        'reviews': [review_template_summary_payload(row, type_index=type_index) for row in rows],
    })
