"""Bounded Curriculum Home response; the full overview remains a separate read."""

import json
from datetime import datetime, timezone

from django.conf import settings
from django.http import JsonResponse
from django.views.decorators.http import require_GET

from . import views, curriculum_names


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


ATTENTION_ISSUES = ('programme-ksb-source', 'module-mapping', 'draft-content', 'group-coach', 'module-tutor')
# Keys of the cached projection that only the on-demand detail read returns.
_DETAIL_KEYS = ('attentionRecords', 'programmeDetails')


def project_home_summary(overview, programmes):
    """Preserve Home's existing counting, matching, ordering and link identities.

    Only five module cards and six programme cards leave the server. No source
    rows, learner counts, KSB definitions or authoring content are exposed.
    """
    return summary_only(project_home(overview, programmes))


def summary_only(projection):
    return {key: value for key, value in projection.items() if key not in _DETAIL_KEYS}


def project_home(overview, programmes):
    """The summary plus the affected records each modal lists, built in one pass.

    The records stay in the server cache; Home reads them per issue or per
    programme only when a modal opens.
    """
    modules = overview.get('modules') or []
    cohorts = overview.get('cohorts') or []
    groups = overview.get('groups') or []
    # Only a module still marked 'draft' is unfinished authoring. The current
    # curriculum database has no draft/published state (a module is 'active'
    # or archived), so there nothing counts as a draft.
    drafts = [module for module in modules if _key(module.get('status')) == 'draft']

    def needs_source(programme):
        return _zero(programme.get('ksbTotal')) and not _clean(programme.get('ksbProfileSourceId'))

    counts = {
        'programme-ksb-source': sum(needs_source(programme) for programme in programmes),
        'module-mapping': sum(_zero(module.get('ksbCount')) for module in modules),
        'draft-content': len(drafts),
        'group-coach': sum(_missing(group.get('coach')) for group in groups),
        'module-tutor': sum(_missing(module.get('tutor')) for module in modules),
    }

    def _module_id(module):
        return _clean(module.get('moduleCatalogueId') or module.get('catalogueId') or module.get('id') or module.get('sourceId') or module.get('name'))

    def _context(row):
        # 'Unassigned' is the overview's placeholder for no programme, not a name.
        programme = _clean(row.get('programme') or row.get('programmeName'))
        return {
            'programme': '' if _missing(programme) else programme,
            'cohort': _clean(row.get('cohort') or row.get('cohortName')),
            'group': _clean(row.get('group') or row.get('groupName')),
        }

    def _module_rec(m):
        return {'id': _module_id(m), 'name': _clean(m.get('name')), **_context(m)}

    def _group_rec(g):
        return {
            'id': _clean(g.get('id') or g.get('sourceId') or g.get('groupId') or g.get('name')),
            **_context(g),
            'name': _clean(g.get('name') or g.get('groupName')),
            'group': '',
        }

    attention_records = {
        'programme-ksb-source': [
            {'id': _clean(p.get('sourceId') or p.get('id') or p.get('name')), 'name': _clean(p.get('name')),
             'programme': '', 'cohort': '', 'group': ''}
            for p in programmes if needs_source(p)
        ],
        'module-mapping': [_module_rec(m) for m in modules if _zero(m.get('ksbCount'))],
        'draft-content': [_module_rec(m) for m in drafts],
        'group-coach': [_group_rec(g) for g in groups if _missing(g.get('coach'))],
        'module-tutor': [_module_rec(m) for m in modules if _missing(m.get('tutor'))],
    }

    focus = []
    programme_details = {}
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
            programme_id = _clean(programme.get('sourceId') or programme.get('id') or programme.get('name'))
            focus.append({
                'programme': {'id': programme_id, 'name': programme.get('name') or ''},
                'issues': issues,
                'issueCount': len(issues),
            })
            # Same membership as the counts above, so each section lists exactly
            # the records its card counted.
            sections = [
                {'key': 'programme-ksb-source', 'count': int(needs_source(programme)), 'records': []},
                {'key': 'no-modules', 'count': int(not programme_modules), 'records': []},
                {'key': 'no-delivery', 'count': int(not programme_cohorts), 'records': []},
                {'key': 'module-mapping', 'count': mapping_gaps,
                 'records': [_module_rec(m) for m in programme_modules if _zero(m.get('ksbCount'))]},
                {'key': 'module-tutor', 'count': tutor_gaps,
                 'records': [_module_rec(m) for m in programme_modules if _missing(m.get('tutor'))]},
                {'key': 'group-coach', 'count': coach_gaps,
                 'records': [_group_rec(g) for g in programme_groups if _missing(g.get('coach'))]},
            ]
            programme_details[programme_id] = {
                'programme': {'id': programme_id, 'name': programme.get('name') or ''},
                'sections': [section for section in sections if section['count']],
            }
    focus.sort(key=lambda item: -item['issueCount'])
    focus = focus[:6]
    shown = {item['programme']['id'] for item in focus}
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
        'programmeFocus': focus,
        'attentionRecords': attention_records,
        'programmeDetails': {key: value for key, value in programme_details.items() if key in shown},
    }


# Only relationship/visibility fields reach the Home builder. Large descriptions,
# cover images and stored holiday/schedule payloads stay in their detail reads.
_DELETION_FIELDS = ('deleted_at', 'is_programme_deleted', 'is_deleted', 'isDeleted', 'isProgrammeDeleted')
_HOME_MODULE_FIELDS = (
    'module_catalogue_id', 'title', 'programme_id', 'programme_name', 'cohort_id', 'cohort_name',
    'group_id', 'group_name', 'sessions_number', 'status', 'tutor_id', 'tutor_name', 'start_date', 'end_date',
    'source_id', 'source_type', 'is_archived', *_DELETION_FIELDS,
)
_HOME_GROUP_FIELDS = (
    'group_id', 'group_name', 'programme_id', 'programme_name', 'cohort_id', 'cohort_name',
    'coach_name', 'status', *_DELETION_FIELDS,
)
_HOME_COHORT_FIELDS = (
    'cohort_id', 'cohort_name', 'programme_id', 'programme_name', 'status', 'start_date', 'end_date',
    *_DELETION_FIELDS,
)


_HOME_WEEK_FIELDS = ('module_catalogue_id', 'display_order', 'week_number', 'title')


def home_relationship_rows(*, include_weeks=False):
    sources = [
        ('modules', views.AUTHORING_MODULES_TABLE, _HOME_MODULE_FIELDS, ''),
        ('groups', views.GROUPS_TABLE, _HOME_GROUP_FIELDS, ''),
        ('cohorts', views.COHORT_AUTHORING_DETAILS_TABLE, _HOME_COHORT_FIELDS, ''),
    ]
    if include_weeks:
        sources.append(('weeks', views.AUTHORING_WEEKS_TABLE, _HOME_WEEK_FIELDS, ''))
    if views.connection.vendor != 'postgresql':
        return {
            **{name: views.authoring_fetch_all(table, columns=fields) for name, table, fields, _ in sources},
            'program_configs': views.get_program_config_rows(), 'ksb_profiles': views.get_ksb_profile_rows(),
        }
    views.ensure_module_authoring_tables()
    # Preserve the exact programme/profile order used by the ordinary readers.
    # A missing legacy display_order column means all rows sort by name.
    sources.append(('program_configs', 'programmes', None,
                    "coalesce((to_jsonb(source_row)->>'display_order')::numeric, 0), name"))
    has_profiles = views.table_exists('ksb_profiles')
    if has_profiles:
        sources.append(('ksb_profiles', 'ksb_profiles', None, 'is_active desc, name'))
    # One database round trip, and one consistent statement snapshot. Selecting
    # keys from JSON handles optional legacy columns without three schema probes.
    # Table names and aliases are server constants; keys are bound parameters.
    selections = []
    params = []
    for name, table, fields, ordering in sources:
        expression = 'to_jsonb(source_row)'
        if fields is not None:
            expression = '(select jsonb_object_agg(key, value) from jsonb_each(to_jsonb(source_row)) where key = any(%s))'
            params.append(list(fields))
        order_sql = f' order by {ordering}' if ordering else ''
        selections.append(
            f'(select coalesce(jsonb_agg({expression}{order_sql}), \'[]\'::jsonb) '
            f'from {views.authoring_table_name(table)} source_row) as {views.quote_ident(name)}'
        )
    result = views.fetch_all('select ' + ', '.join(selections), params)[0]
    # Django's PostgreSQL backend can return raw JSON strings for computed
    # columns, while standalone psycopg configurations may decode them already.
    decoded = {name: json.loads(value) if isinstance(value, str) else value for name, value in result.items()}
    if not has_profiles:
        decoded['ksb_profiles'] = []
    return decoded


def home_source_rows(visibility):
    """Read each relationship table once; Home needs no holiday/schedule detail.

    The ordinary overview keeps its full source path. Use the same serializers
    and grouping rules here, but pass already-read rows instead of asking them
    to read the same tables again under different SQL orderings.
    """
    legacy_catalogue = views.table_exists('Modules')
    relationships = home_relationship_rows(include_weeks=visibility == 'all' and not legacy_catalogue)
    modules, groups, cohorts = (relationships[key] for key in ('modules', 'groups', 'cohorts'))
    # The raw jsonb_agg path bypasses authoring_fetch_all's curriculum_names.attach(),
    # which resolves tutor_name (modules.tutor_id -> tutors) and coach_name
    # (group_coaches -> coaches) in the normalised schema. Apply before training
    # rows are built, as those read tutor_name and coach_name from these rows.
    curriculum_names.attach('modules', modules)
    curriculum_names.attach('groups', groups)
    training = views.authoring_modules_as_training_rows(
        module_rows=modules, group_rows=groups, cohort_rows=cohorts,
    )
    if legacy_catalogue:
        # Legacy catalogue KSB codes still contribute to Home's mapping gaps.
        catalogue = views.get_module_rows()
    else:
        # Operational delivery rows already carry a numeric sessions_number,
        # including zero. Only unused catalogue modules fall back to week titles.
        weeks = relationships.get('weeks', [])
        catalogue = views.authoring_modules_as_catalogue_rows(module_rows=modules, week_rows=weeks)
    rows = {
        'training': training, 'modules': catalogue, 'authoring_modules': modules,
        'ksb_profiles': relationships['ksb_profiles'], 'program_configs': relationships['program_configs'],
        'holidays': [], 'tutors': [], 'coaches': [], 'tutor_modules': [],
    }
    delivery = {
        'modules': modules,
        'cohorts': [views.serialize_cohort_authoring_detail(row, []) for row in cohorts],
        'groups': [views.serialize_group_authoring_detail(row) for row in groups],
    }
    return rows, delivery


def home_programmes_need_enrichment(overview, authoring_rows, program_configs, *, include_archived=False):
    """Conservatively detect whether enrichment can introduce a programme.

    Existing programme counts are not Home inputs. If every possible programme
    name is already represented, the content-count queries used to rank module
    matches cannot affect the projected result. Unknown names keep the complete
    matching/archive logic, including programmes that exist only through modules.
    """
    known = {
        views.normalise(programme.get(field))
        for programme in overview['programmes']
        for field in ('id', 'sourceId', 'name', 'standard')
    }
    if not include_archived:
        # Enrichment cannot resurrect programmes explicitly archived by staff.
        known.update(
            views.normalise(config.get(field))
            for config in program_configs if views.is_archived_program_config(config)
            for field in ('programme_id', 'program_id', 'id', 'name')
        )
    names = [module.get('programme') or module.get('programmeName') for module in overview['modules']]
    names.extend(row.get('programme_name') for row in authoring_rows)
    return any(
        views.normalise(name) not in known | {'', 'unassigned', 'unassignedprogramme'}
        for name in names
    )


def build_home_summary(visibility, *, force=False):
    with views.curriculum_read_scope():
        rows, delivery = home_source_rows(visibility)
        overview = views.build_curriculum_payload_from_rows(
            rows, visibility, compact=True, home_summary=True, delivery_source=delivery,
        )
        if not home_programmes_need_enrichment(
            overview, rows['authoring_modules'], rows['program_configs'], include_archived=visibility == 'all',
        ):
            return project_home(overview, overview['programmes'])
        # Programme enrichment can introduce module-only programmes. Preserve
        # those identities, but do not load component bodies or KSB mappings.
        modules = views.enrich_modules_with_authoring(
            overview['modules'], include_programme_deleted=visibility == 'all', include_content=False,
        )
        programmes = views.enrich_programmes_with_module_counts(
            overview['programmes'], modules, modules_enriched=True, include_archived=visibility == 'all',
            # Home derives its counts from overview and only needs programme
            # identities/source metadata, including module-only programmes.
            include_structure_counts=False,
        )
        return project_home(overview, programmes)


def _home_projection(request):
    """The cached Home projection for this request's visibility, plus a cache header.

    The existing /curriculum_api/ staff gate applies before both Home views, just
    as it does to overview. Cache by visibility and the shared write epoch, so a
    curriculum write invalidates the summary and every detail read together.
    """
    visibility = views.curriculum_visibility(request)
    force = views.request_bypasses_curriculum_cache(request)
    shared_enabled = getattr(settings, 'CURRICULUM_HOME_SHARED_READ_MODEL_ENABLED', False)
    if not force and shared_enabled:
        from .read_model import enqueue_curriculum_home_refresh, get_curriculum_home
        shared = get_curriculum_home(visibility)
        if shared is not None and isinstance(shared.payload.get('overview'), dict) and isinstance(shared.payload.get('programmes'), list):
            # Do not put a stale snapshot in the long-lived payload cache. The
            # worker can refresh it without moving the curriculum write epoch.
            if shared.stale:
                enqueue_curriculum_home_refresh(visibility, reason='stale-read')
            projection = project_home(shared.payload['overview'], shared.payload['programmes'])
            return projection, 'READ-MODEL-STALE' if shared.stale else 'READ-MODEL-HIT'
    projection = views.cached_curriculum_value(
        f'home-summary:v2:{visibility}',
        lambda: build_home_summary(visibility, force=force),
        force=force,
    )
    if not shared_enabled:
        return projection, None
    from .read_model import enqueue_curriculum_home_refresh
    enqueue_curriculum_home_refresh(visibility, reason='forced-read' if force else 'missing-read-model')
    return projection, 'READ-MODEL-MISS'


def _respond(payload, cache_state):
    response = JsonResponse(payload)
    if cache_state:
        response['X-LMS-Cache'] = cache_state
    return response


@require_GET
def curriculum_home_summary(request):
    projection, cache_state = _home_projection(request)
    return _respond(summary_only(projection), cache_state)


@require_GET
def curriculum_home_attention(request):
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
    projection, cache_state = _home_projection(request)
    if issue:
        records = (projection.get('attentionRecords') or {}).get(issue) or []
        return _respond({'issue': issue, 'count': len(records), 'records': records}, cache_state)
    detail = (projection.get('programmeDetails') or {}).get(programme)
    if detail is None:
        # Not one of the programme cards Home shows (or its gaps were resolved).
        return _respond({'programme': {'id': programme, 'name': ''}, 'sections': []}, cache_state)
    return _respond(detail, cache_state)
