"""Small, read-only assigned-learner directory; no progress aggregation."""
from django.http import JsonResponse
from django.db import DatabaseError
from django.views.decorators.http import require_GET
from login.permissions import staff_only

SCOPES = {'programme', 'cohort', 'group', 'module'}


def roster(scope, identifier, status, refresh=False):
    from . import views

    def load():
        lineage = views.scope_placement_lineage(scope, identifier)
        if not lineage.get('found'):
            return None
        rows = views.assigned_learners_for_scope(
            scope, identifier, 'active' if status == 'active' else '', lineage=lineage, strict=True,
        )
        # Canonical learner identity, not a sum of module memberships.
        unique = {str(row['id']): {
            'id': str(row['id']), 'name': row.get('name') or '',
            'email': row.get('email') or '',
            'status': row.get('lifecycleStatus') or row.get('programmeStatus') or '',
        } for row in rows}
        return sorted(unique.values(), key=lambda row: (row['name'].casefold(), row['id']))

    return views.cached_curriculum_value(
        f'assigned-directory:{scope}:{identifier}:{status}', load, force=refresh, ttl=30,
    )


@require_GET
@staff_only()
def counts(request):
    from . import views
    scope = request.GET.get('scope', '')
    ids = list(dict.fromkeys(value.strip() for value in request.GET.get('ids', '').split(',') if value.strip()))
    if scope not in SCOPES or not ids or len(ids) > 30 or any(len(value) > 200 for value in ids):
        return JsonResponse({'error': 'Choose a valid scope and up to 30 identifiers.'}, status=400)
    result = {}
    try:
        with views.curriculum_read_scope(targeted_child_reads=True):
            for identifier in ids:
                rows = roster(scope, identifier, 'active', request.GET.get('refresh') == '1')
                result[identifier] = len(rows) if rows is not None else None
    except DatabaseError:
        return JsonResponse({'error': 'Assigned learner counts are temporarily unavailable. Please retry.'}, status=503)
    return JsonResponse({'counts': result})


@require_GET
@staff_only()
def learners(request):
    from . import views
    scope, identifier = request.GET.get('scope', ''), request.GET.get('id', '').strip()
    status = request.GET.get('status', 'active')
    try:
        page = int(request.GET.get('page', '1'))
    except ValueError:
        page = 0
    query = request.GET.get('q', '').strip().casefold()
    if scope not in SCOPES or not identifier or len(identifier) > 200 or status not in {'active', 'all'} or page < 1 or len(query) > 100:
        return JsonResponse({'error': 'Choose a valid scope, status, search and page.'}, status=400)
    try:
        with views.curriculum_read_scope(targeted_child_reads=True):
            rows = roster(scope, identifier, status, request.GET.get('refresh') == '1')
    except DatabaseError:
        return JsonResponse({'error': 'Assigned learners are temporarily unavailable. Please retry.'}, status=503)
    if rows is None:
        return JsonResponse({'error': 'This curriculum record could not be found.'}, status=404)
    filtered = [row for row in rows if query in f"{row['name']} {row['email']}".casefold()] if query else rows
    return JsonResponse({
        'scope': scope, 'id': identifier, 'status': status,
        'total': len(rows), 'filteredTotal': len(filtered), 'page': page, 'pageSize': 25,
        'learners': filtered[(page - 1) * 25:page * 25],
    })
