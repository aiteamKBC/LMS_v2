"""Coverage trace and readiness HTTP responses."""

from curriculum_api.reporting.domain.readiness import coverage_readiness


def curriculum_ksb_trace(
    request,
    ksb_id,
    *,
    JsonResponse,
    coverage_normalise_code,
    coverage_response,
    json,
    json_error
):
    response = coverage_response(request)
    if response.status_code != 200:
        return response
    payload = json.loads(response.content)
    ident = coverage_normalise_code(ksb_id)
    item = next((
        row for row in payload.get('items', [])
        if coverage_normalise_code(row.get('code')) == ident
        or coverage_normalise_code(row.get('ksb_id') or row.get('ksbId')) == ident
    ), None)
    if not item:
        return json_error('KSB trace not found.', status=404)
    return JsonResponse(item)


def curriculum_readiness_validation(
    request,
    *,
    JsonResponse,
    coverage_response,
    json
):
    response = coverage_response(request, request.GET.get('scope') or '', request.GET.get('identifier') or '')
    if response.status_code != 200:
        return response
    payload = json.loads(response.content)
    return JsonResponse(coverage_readiness(payload))
