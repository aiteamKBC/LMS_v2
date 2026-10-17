"""Bounded Curriculum Home response; the full overview remains a separate read."""

from datetime import datetime, timezone

from django.conf import settings
from django.http import JsonResponse
from django.views.decorators.http import require_GET

from . import views


def _clean(value):
    return str(value if value is not None else '').strip()


def _key(value):
    # Match Home's former JS trim().toLowerCase(), not the curriculum identifier
    # normaliser, which also removes punctuation and spaces.
    return _clean(value).lower()


def _missing(value):
    return _key(value) in {'', 'unassigned', 'not assigned', 'tbc'}


def _zero(value):
    try:
        return float(value or 0) == 0
    except (TypeError, ValueError):
        return False


def _date_value(value):
    try:
        parsed = datetime.fromisoformat(_clean(value).replace('Z', '+00:00'))
        return parsed.replace(tzinfo=timezone.utc).timestamp() if parsed.tzinfo is None else parsed.timestamp()
    except (ValueError, OverflowError):
        return 0


def project_home_summary(overview, programmes):
    """Preserve Home's existing counting, matching, ordering and link identities.

    Only five module cards and six programme cards leave the server. No source
    rows, learner counts, KSB definitions or authoring content are exposed.
    """
    modules = overview.get('modules') or []
    cohorts = overview.get('cohorts') or []
    groups = overview.get('groups') or []
    drafts = [module for module in modules if _key(module.get('status')) != 'published']

    def needs_source(programme):
        return _zero(programme.get('ksbTotal')) and not _clean(programme.get('ksbProfileSourceId'))

    counts = {
        'programme-ksb-source': sum(needs_source(programme) for programme in programmes),
        'module-mapping': sum(_zero(module.get('ksbCount')) for module in modules),
        'draft-content': len(drafts),
        'group-coach': sum(_missing(group.get('coach')) for group in groups),
        'module-tutor': sum(_missing(module.get('tutor')) for module in modules),
    }
    focus = []
    for programme in programmes:
        keys = {_key(programme.get(field)) for field in ('id', 'sourceId', 'name')} - {''}

        def belongs(row):
            return _key(row.get('programmeId')) in keys or _key(row.get('programme')) in keys

        programme_modules = [module for module in modules if belongs(module)]
        programme_cohorts = [cohort for cohort in cohorts if belongs(cohort)]
        cohort_ids = {_key(cohort.get('id')) for cohort in programme_cohorts}
        programme_groups = [group for group in groups if belongs(group) or _key(group.get('cohortId')) in cohort_ids]
        issues = []
        if needs_source(programme):
            issues.append('No KSB source')
        if not programme_modules:
            issues.append('No modules')
        if not programme_cohorts:
            issues.append('No delivery setup')
        mapping_gaps = sum(_zero(module.get('ksbCount')) for module in programme_modules)
        tutor_gaps = sum(_missing(module.get('tutor')) for module in programme_modules)
        coach_gaps = sum(_missing(group.get('coach')) for group in programme_groups)
        if mapping_gaps:
            issues.append(f'{mapping_gaps} mapping {"gap" if mapping_gaps == 1 else "gaps"}')
        if tutor_gaps:
            issues.append(f'{tutor_gaps} without tutor')
        if coach_gaps:
            issues.append(f'{coach_gaps} without coach')
        if issues:
            focus.append({
                'programme': {
                    'id': _clean(programme.get('sourceId') or programme.get('id') or programme.get('name')),
                    'name': programme.get('name') or '',
                },
                'issues': issues,
                'issueCount': len(issues),
            })
    focus.sort(key=lambda item: -item['issueCount'])
    recent = sorted(drafts or modules, key=lambda module: -_date_value(module.get('lastUpdated')))[:5]
    return {
        'stats': {
            'programmes': len(programmes),
            'activeCohorts': sum(_key(cohort.get('status')) == 'active' for cohort in cohorts),
            'groups': len(groups),
            'openIssues': sum(counts.values()),
        },
        'attentionCounts': counts,
        'continueModules': [{
            'id': _clean(module.get('moduleCatalogueId') or module.get('catalogueId') or module.get('id') or module.get('sourceId') or module.get('name')),
            'name': module.get('name') or '',
            'programme': module.get('programme') or '',
            'weeks': module.get('weeks') or 0,
            'status': module.get('status') or '',
        } for module in recent],
        'programmeFocus': focus[:6],
    }


def build_home_summary(visibility, *, force=False):
    with views.curriculum_read_scope():
        rows = views.get_cached_curriculum_rows(compact=True, force=force)
        overview = views.build_curriculum_payload_from_rows(rows, visibility, compact=True, home_summary=True)
        # Programme enrichment can introduce module-only programmes. Preserve
        # those identities, but do not load component bodies or KSB mappings.
        modules = views.enrich_modules_with_authoring(
            overview['modules'], include_programme_deleted=visibility == 'all', include_content=False,
        )
        programmes = views.enrich_programmes_with_module_counts(
            overview['programmes'], modules, modules_enriched=True, include_archived=visibility == 'all',
        )
        return project_home_summary(overview, programmes)


@require_GET
def curriculum_home_summary(request):
    # The existing /curriculum_api/ staff gate applies before this view, just
    # as it does to overview. Cache by visibility and the shared write epoch.
    visibility = views.curriculum_visibility(request)
    force = views.request_bypasses_curriculum_cache(request)
    shared_enabled = getattr(settings, 'CURRICULUM_HOME_SHARED_READ_MODEL_ENABLED', False)
    if not force and shared_enabled:
        from .read_model import enqueue_curriculum_home_refresh, get_curriculum_home
        shared = get_curriculum_home(visibility)
        if shared is not None and isinstance(shared.payload.get('overview'), dict) and isinstance(shared.payload.get('programmes'), list):
            # Do not put a stale snapshot in the long-lived payload cache. The
            # worker can refresh it without moving the curriculum write epoch.
            response = JsonResponse(project_home_summary(shared.payload['overview'], shared.payload['programmes']))
            response['X-LMS-Cache'] = 'READ-MODEL-STALE' if shared.stale else 'READ-MODEL-HIT'
            if shared.stale:
                enqueue_curriculum_home_refresh(visibility, reason='stale-read')
            return response
    payload = views.cached_curriculum_value(
        f'home-summary:v1:{visibility}',
        lambda: build_home_summary(visibility, force=force),
        force=force,
    )
    response = JsonResponse(payload)
    if shared_enabled:
        from .read_model import enqueue_curriculum_home_refresh
        enqueue_curriculum_home_refresh(visibility, reason='forced-read' if force else 'missing-read-model')
        response['X-LMS-Cache'] = 'READ-MODEL-MISS'
    return response
