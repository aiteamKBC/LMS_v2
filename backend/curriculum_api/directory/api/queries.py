"""Directory HTTP validation and responses; public decorators remain at existing routes."""


def counts(request, *, SCOPES, JsonResponse, DatabaseError, status_counts):
    scope = request.GET.get('scope', '')
    identifiers = list(dict.fromkeys(value.strip() for value in request.GET.get('ids', '').split(',') if value.strip()))
    if scope not in SCOPES or not identifiers or len(identifiers) > 100 or any(len(value) > 200 for value in identifiers):
        return JsonResponse({'error': 'Choose a valid scope and up to 100 identifiers.'}, status=400)
    try:
        result = status_counts(scope, identifiers)
    except DatabaseError:
        return JsonResponse({'error': 'Learner counts are temporarily unavailable. Please retry.'}, status=503)
    return JsonResponse({'counts': result})


def learners(request, *, SCOPES, JsonResponse, DatabaseError, curriculum_read_scope, roster, status_key):
    scope, identifier = request.GET.get('scope', ''), request.GET.get('id', '').strip()
    status = request.GET.get('status', 'active')
    lifecycle_status = request.GET.get('lifecycle_status', '').strip()
    try:
        page = int(request.GET.get('page', '1'))
    except ValueError:
        page = 0
    query = request.GET.get('q', '').strip().casefold()
    if scope not in SCOPES or not identifier or len(identifier) > 200 or status not in {'active', 'all'} or page < 1 or len(query) > 100 or len(lifecycle_status) > 60:
        return JsonResponse({'error': 'Choose a valid scope, status, search and page.'}, status=400)
    try:
        with curriculum_read_scope(targeted_child_reads=True):
            rows = roster(scope, identifier, status)
    except DatabaseError:
        return JsonResponse({'error': 'Assigned learners are temporarily unavailable. Please retry.'}, status=503)
    if rows is None:
        return JsonResponse({'error': 'This curriculum record could not be found.'}, status=404)
    if lifecycle_status:
        rows = [row for row in rows if status_key(row.get('status')) == status_key(lifecycle_status)]
    filtered = [row for row in rows if query in f"{row['name']} {row['email']}".casefold()] if query else rows
    return JsonResponse({
        'scope': scope, 'id': identifier, 'status': status,
        'total': len(rows), 'filteredTotal': len(filtered), 'page': page, 'pageSize': 25,
        'learners': filtered[(page - 1) * 25:page * 25],
    })
