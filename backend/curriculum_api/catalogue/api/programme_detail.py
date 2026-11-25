"""Programme detail HTTP assembly and validation; concrete capabilities are injected."""
from ..application.overview import CurriculumOverviewUnavailable
from ..application.programme_modules import ProgrammeModulesUnavailable


def curriculum_programme_tree_detail(
    request,
    identifier,
    *,
    CURRICULUM_LEARNER_DATA_TTL_SECONDS,
    build_curriculum_programme_tree_detail_payload,
    cached_curriculum_value,
    canonical_programme_detail_issues,
    clean_str,
    conditional_json_response,
    curriculum_visibility,
    encode_json_entry,
    encode_json_error_entry,
    query_flag,
    query_list,
    repair_curriculum_parent_links,
):
    visibility = curriculum_visibility(request)
    programme_id = clean_str(identifier)
    # The KSB learner-progress aggregates are comparatively expensive on a cold
    # read. Keep the detail document responsive and let the client hydrate these
    # optional figures through the dedicated ksb-stats endpoint.
    defer_stats = query_flag(request, 'deferStats')
    # ``omit=components`` drops ``flat.components`` from the document. The
    # programme page replaces that list with its own /components/ read the
    # moment it arrives, so for it the copy here was the largest part of the
    # response -- every component of the programme with its settings, a second
    # time -- serialised, compressed and parsed for nothing. Opt-in: every other
    # caller still gets the full document.
    #
    # ``omit=tree`` drops the nested ``cohorts -> groups -> modules`` view. It
    # repeats every module, weekStructure and all, that ``flat.modules``
    # already carries -- over half the document -- and the programme page reads
    # only ``flat``. The free-course pages walk the nested tree, so it stays in
    # the default response.
    #
    # ``omit=weekComponents`` sends each module's ``weekStructure`` as an
    # outline: every week with its own fields, but no ``components`` -- see
    # module_rows_with_week_outline. Those components and their settings are
    # ~97% of the document on a large programme (75 of 78 MB for
    # PROG-PCP-L6), and the programme page reads only the week titles and
    # order. An editor or a Teams push re-reads the module's whole structure
    # from the module's own endpoint before it acts, as it always has.
    omit = query_list(request, 'omit')
    include_components = 'components' not in omit
    include_tree = 'tree' not in omit
    include_week_components = 'weekComponents' not in omit
    # Read-only endpoint: repair runs with allow_writes=False (a no-op), so nothing
    # here mutates curriculum data. Invalidating the shared cache from this GET
    # wiped every cached payload on each wizard open, forcing the programmes list
    # to rebuild from scratch (~30s) and defeating this view's own cache below.
    # Write paths still invalidate, which is what keeps this data fresh.
    repair_curriculum_parent_links(programme_id, allow_writes=False)

    def build_detail_entry():
        payload = build_curriculum_programme_tree_detail_payload(
            identifier, visibility, include_stats=not defer_stats,
            include_components=include_components, include_tree=include_tree,
            include_week_components=include_week_components,
        )
        if not payload:
            return encode_json_error_entry('Programme not found.', status=404)
        issues = canonical_programme_detail_issues(payload)
        if issues:
            return encode_json_entry({
                'error': 'Canonical curriculum data is incomplete.',
                'code': 'CANONICAL_DATA_REQUIRED',
                'validationErrors': issues,
                'message': 'Fix the listed canonical records before opening this programme.',
            }, status=422)
        return encode_json_entry(payload)

    # The encoded response is what is cached (see http_cache): the same key
    # inputs and TTL as the payload cache it replaces, so freshness is
    # unchanged; a hit no longer re-serialises the document, and a client that
    # already holds the current body is answered 304.
    try:
        entry = cached_curriculum_value(
            f'programme-detail-response:authored-v3:{visibility}:{clean_str(identifier)}:'
            f'{"nostats" if defer_stats else "stats"}:{"components" if include_components else "nocomponents"}:'
            f'{"tree" if include_tree else "notree"}:{"weeks" if include_week_components else "weekoutline"}',
            build_detail_entry,
            # The programme, cohorts and groups carry learner counts.
            ttl=CURRICULUM_LEARNER_DATA_TTL_SECONDS,
            scope=clean_str(identifier),
        )
    except ProgrammeModulesUnavailable:
        entry = encode_json_error_entry('Programme modules could not be loaded. Please try again.', status=503)
    except CurriculumOverviewUnavailable:
        entry = encode_json_error_entry('Programme sessions could not be loaded. Please try again.', status=503)
    return conditional_json_response(request, entry)


def curriculum_programme_detail_section(
    request,
    identifier,
    section,
    *,
    JsonResponse,
    PROGRAMME_DETAIL_SECTIONS,
    cached_programme_detail_section,
    clean_str,
    conditional_json_response,
    curriculum_visibility,
    note_programme_section_read,
    refresh_curriculum_generations,
    repair_curriculum_parent_links,
    request_bypasses_curriculum_cache,
    request_reads_after_write,
):
    if section not in PROGRAMME_DETAIL_SECTIONS:
        return JsonResponse({'error': 'Unknown programme detail section.'}, status=404)
    visibility = curriculum_visibility(request)
    workspace_view = section == 'modules' and request.GET.get('view') == 'workspace'
    programme_id = clean_str(identifier)
    repair_curriculum_parent_links(programme_id, allow_writes=False)
    force = request_bypasses_curriculum_cache(request)
    if not force and request_reads_after_write(request):
        refresh_curriculum_generations()
    try:
        entry = cached_programme_detail_section(identifier, visibility, section, workspace_view, force=force)
    except ProgrammeModulesUnavailable:
        return JsonResponse({'error': 'Programme modules could not be loaded. Please try again.'}, status=503)
    except CurriculumOverviewUnavailable:
        return JsonResponse({'error': 'Programme sessions could not be loaded. Please try again.'}, status=503)
    if section == 'modules':
        note_programme_section_read(identifier, visibility, workspace_view)
    return conditional_json_response(request, entry)


def programme_detail_section_entry(
    identifier,
    visibility,
    section,
    workspace_view,
    *,
    build_curriculum_programme_tree_detail_payload,
    canonical_programme_detail_issues,
    encode_json_entry,
    encode_json_error_entry,
    programme_modules_workspace_payload,
):
    payload = build_curriculum_programme_tree_detail_payload(
        identifier, visibility, include_stats=False, include_components=False,
        include_tree=False, include_week_components=False, section=section,
        **({'workspace_view': True} if workspace_view else {}),
    )
    if not payload:
        return encode_json_error_entry('Programme not found.', status=404)
    issues = canonical_programme_detail_issues(payload)
    if issues:
        return encode_json_entry({
            'error': 'Canonical curriculum data is incomplete.',
            'code': 'CANONICAL_DATA_REQUIRED',
            'validationErrors': issues,
            'message': 'Fix the listed canonical records before opening this programme.',
        }, status=422)
    if workspace_view:
        payload = programme_modules_workspace_payload(payload)
    return encode_json_entry(payload)


def canonical_programme_detail_issues(
    payload,
    *,
    clean_str,
):
    """Return actionable validation messages for a canonical detail document.

    A detail response must be navigable from normalized ids.  Name-based
    membership is a legacy representation and is deliberately surfaced as a
    data error instead of being silently interpreted by the UI.
    """
    flat = payload.get('flat') if isinstance(payload, dict) else None
    if not isinstance(flat, dict):
        return ['The programme detail is missing its canonical flat data.']

    issues = []
    for kind in ('cohorts', 'groups', 'modules'):
        for item in flat.get(kind) or []:
            if not isinstance(item, dict):
                issues.append(f'Canonical {kind[:-1]} record is not an object.')
                continue
            if not clean_str(item.get('id') or item.get('sourceId')):
                label = clean_str(item.get('name')) or 'unnamed record'
                issues.append(f'Canonical {kind[:-1]} "{label}" is missing its id.')

    for group in flat.get('groups') or []:
        if not isinstance(group, dict):
            continue
        legacy_names = group.get('modules') or group.get('moduleNames') or group.get('module_names')
        canonical_ids = group.get('moduleIds') or group.get('module_ids')
        if legacy_names and not canonical_ids:
            label = clean_str(group.get('name')) or clean_str(group.get('id')) or 'unnamed group'
            issues.append(f'Group "{label}" has legacy module-name membership; canonical module ids are required.')

    for module in flat.get('modules') or []:
        if not isinstance(module, dict):
            continue
        if (module.get('group') or module.get('groupName') or module.get('group_name')) and not (
            module.get('groupId') or module.get('group_id')
        ):
            label = clean_str(module.get('name')) or clean_str(module.get('id')) or 'unnamed module'
            issues.append(f'Module "{label}" has a legacy group-name link; canonical group id is required.')

    return list(dict.fromkeys(issues))


def request_reads_after_write(
    request,
    *,
    clean_str,
):
    """``Cache-Control: max-age=0``: the client has just saved and wants that save.

    Lighter than ``no-cache``, which rebuilds: the entry is served if it is of
    the generation the database holds now, which this worker would otherwise
    have polled up to SHARED_EPOCH_POLL_SECONDS ago -- before a save another
    worker took. Only for saves that move the epoch, i.e. curriculum_api writes.
    """
    cache_control = clean_str(request.headers.get('Cache-Control')).lower()
    return 'max-age=0' in cache_control.replace(' ', '')
