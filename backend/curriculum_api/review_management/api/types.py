"""Existing review-type HTTP handlers and response contracts."""
from __future__ import annotations

from django.http import JsonResponse
from curriculum_api.review_management.api.commands import archive_review_type
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.review_management.api.commands import create_review_type
from django.views.decorators.csrf import csrf_exempt
from curriculum_api.catalogue.api.adapters import curriculum_results_response
from curriculum_api.review_management.infrastructure.type_schema import ensure_review_types_table
from curriculum_api.review_management.infrastructure.type_rows import get_review_type
from curriculum_api.catalogue.api.responses import json_body
from curriculum_api.catalogue.api.responses import json_error
from curriculum_api.review_management.infrastructure.type_rows import list_review_types
from curriculum_api.catalogue.infrastructure.cache_composition import log_curriculum_decision
from curriculum_api.review_management.api.commands import rename_review_type
from curriculum_api.review_management.domain.classification import review_type_payload


def _actor(request):
    # Matches reviews.py: curriculum_api writes are not per-account today.
    return 'staff'


@csrf_exempt
def curriculum_review_type_collection(request):
    """GET  -- every active Review Type (add ?includeInactive=1 for archived).
    POST -- create a custom type from {"name": "Career Review"} alone. Every
            other column (id, code, is_system, is_active) is generated here,
            so the create UI stays a single text box.
    """
    ensure_review_types_table()

    if request.method == 'GET':
        include_inactive = clean_str(request.GET.get('includeInactive')).lower() in ('1', 'true', 'yes')
        rows = list_review_types(include_inactive=include_inactive)
        return curriculum_results_response([review_type_payload(row) for row in rows])

    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)

    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')

    row, errors = create_review_type(payload.get('name'), actor=_actor(request))
    if errors:
        return json_error(
            errors.get('name') or 'Please fix the highlighted fields.', fields=errors,
        )

    log_curriculum_decision('review-type.create', outcome='created', entity_id=row.get('id'))
    return JsonResponse({'created': True, 'reviewType': review_type_payload(row)}, status=201)


@csrf_exempt
def curriculum_review_type_detail(request, review_type_id):
    """PATCH  -- rename a custom type (its code, and therefore its routing,
                 is untouched).
    DELETE -- archive a custom type: deactivated, never hard-deleted, so the
              Reviews already classified with it keep working. A system type
              is refused.
    """
    ensure_review_types_table()
    review_type_id = clean_str(review_type_id)
    row = get_review_type(review_type_id)
    if not row:
        return json_error('Review type not found.', status=404)

    if request.method == 'GET':
        return JsonResponse({'reviewType': review_type_payload(row)})

    if request.method == 'DELETE':
        archived, errors = archive_review_type(review_type_id, actor=_actor(request))
        if errors:
            return json_error(errors.get('_') or 'Unable to delete this review type.', status=400, fields=errors)
        log_curriculum_decision('review-type.archive', outcome='archived', entity_id=review_type_id)
        return JsonResponse({
            'deleted': True, 'permanent': False, 'archived': True,
            'id': review_type_id, 'reviewType': review_type_payload(archived),
        })

    if request.method not in {'PATCH', 'PUT'}:
        return json_error('Method not allowed.', status=405)

    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')

    renamed, errors = rename_review_type(review_type_id, payload.get('name'), actor=_actor(request))
    if errors:
        return json_error(
            errors.get('_') or errors.get('name') or 'Please fix the highlighted fields.', fields=errors,
        )
    log_curriculum_decision('review-type.update', outcome='updated', entity_id=review_type_id)
    return JsonResponse({'updated': True, 'reviewType': review_type_payload(renamed)})
