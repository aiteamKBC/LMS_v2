"""Small, read-only assigned-learner directory; no progress aggregation."""
from django.http import JsonResponse
from django.db import DatabaseError
from django.views.decorators.http import require_GET
from django.views.decorators.cache import never_cache
from login.permissions import staff_only

SCOPES = {'programme', 'cohort', 'group', 'module'}


@never_cache
@require_GET
@staff_only()
def counts(request):
    from .learner_status_counts import status_counts
    scope = request.GET.get('scope', '')
    identifiers = list(dict.fromkeys(value.strip() for value in request.GET.get('ids', '').split(',') if value.strip()))
    if scope not in SCOPES or not identifiers or len(identifiers) > 100 or any(len(value) > 200 for value in identifiers):
        return JsonResponse({'error': 'Choose a valid scope and up to 100 identifiers.'}, status=400)
    try:
        result = status_counts(scope, identifiers)
    except DatabaseError:
        return JsonResponse({'error': 'Learner counts are temporarily unavailable. Please retry.'}, status=503)
    return JsonResponse({'counts': result})


def roster(scope, identifier, status):
    from . import views
    from .learner_status_counts import status_key
    lineage = views.scope_placement_lineage(scope, identifier)
    if not lineage.get('found'):
        return None
    rows = views.assigned_learners_for_scope(
        scope, identifier, '', lineage=lineage, strict=True,
    )
    # Canonical learner identity, not a sum of module memberships.
    unique = {str(row['id']): {
        'id': str(row['id']), 'name': row.get('name') or '',
        'email': row.get('email') or '',
        'status': str(row.get('lifecycleStatus') or '').strip() or str(row.get('programmeStatus') or '').strip(),
    } for row in rows}
    if status == 'active':
        # Match the count buckets, including legacy programme-status fallback.
        unique = {key: row for key, row in unique.items() if status_key(row['status']) == 'active'}
    return sorted(unique.values(), key=lambda row: (row['name'].casefold(), row['id']))


@never_cache
@require_GET
@staff_only()
def learners(request):
    from . import views
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
        with views.curriculum_read_scope(targeted_child_reads=True):
            rows = roster(scope, identifier, status)
    except DatabaseError:
        return JsonResponse({'error': 'Assigned learners are temporarily unavailable. Please retry.'}, status=503)
    if rows is None:
        return JsonResponse({'error': 'This curriculum record could not be found.'}, status=404)
    if lifecycle_status:
        from .learner_status_counts import status_key
        rows = [row for row in rows if status_key(row.get('status')) == status_key(lifecycle_status)]
    filtered = [row for row in rows if query in f"{row['name']} {row['email']}".casefold()] if query else rows
    return JsonResponse({
        'scope': scope, 'id': identifier, 'status': status,
        'total': len(rows), 'filteredTotal': len(filtered), 'page': page, 'pageSize': 25,
        'learners': filtered[(page - 1) * 25:page * 25],
    })
