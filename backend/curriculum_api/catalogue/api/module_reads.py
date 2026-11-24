"""Read-only module collection, component library and bulk-resolution HTTP adapters."""
from curriculum_api.catalogue.application.delivery_schedules import ModuleSessionPlanValidationError


def module_structure_response(module_catalogue_id, *, load_structure, JsonResponse, json_error, logger):
    """Map the existing structure read outcome to its public HTTP contract."""
    try:
        payload = load_structure()
    except Exception:
        logger.exception('Unable to load module authoring structure for %s.', module_catalogue_id)
        return json_error('Unable to load module authoring structure.', status=500)
    if not payload:
        return json_error('Module authoring structure not found.', status=404)
    return JsonResponse(payload)


def curriculum_modules(
    request,
    *,
    CURRICULUM_SCHEMA,
    build_curriculum_payload,
    build_curriculum_payload_from_rows,
    cached_curriculum_value,
    clean_str,
    compact_module_list_rows,
    curriculum_collection_response,
    curriculum_read_scope,
    curriculum_visibility,
    enrich_modules_with_authoring,
    get_cached_curriculum_rows,
    is_archived_module_summary,
    normalise,
    programme_deleted_row,
    request_bypasses_curriculum_cache,
):
    visibility = curriculum_visibility(request)
    bypass_cache = request_bypasses_curriculum_cache(request)
    compact = clean_str(request.GET.get('compact')).lower() in {'1', 'true', 'yes'}
    # One scope around both stages. The enrichment re-reads four of the tables
    # the payload build has already read, and outside a scope there is no memo
    # for it to hit, so a cold build scanned each of them twice. Nested inside,
    # build_curriculum_payload()'s own scope reuses this one.
    with curriculum_read_scope():
        if compact:
            def build_list():
                rows = get_cached_curriculum_rows(compact=True, force=bypass_cache)
                source = build_curriculum_payload_from_rows(rows, visibility, compact=True, module_list=True)
                enriched = enrich_modules_with_authoring(
                    source['modules'], include_programme_deleted=visibility == 'all', list_only=True,
                )
                if visibility != 'all':
                    enriched = [item for item in enriched if not programme_deleted_row(item) and not is_archived_module_summary(item)]
                return compact_module_list_rows(enriched)

            payload = {'schema': CURRICULUM_SCHEMA}
            # v2 entries can predate the free-course/pricing projection. They
            # survive a deploy in the shared cache and otherwise make existing
            # standalone courses look like ordinary modules until expiry.
            modules = cached_curriculum_value(
                f'modules:{visibility}:list-v3', build_list, force=bypass_cache,
            )
        elif bypass_cache:
            payload = build_curriculum_payload(visibility, compact=True, force=True)
            modules = enrich_modules_with_authoring(payload['modules'], include_programme_deleted=visibility == 'all')
        else:
            payload = cached_curriculum_value(f'overview:{visibility}:compact', lambda: build_curriculum_payload(visibility, compact=True))
            modules = cached_curriculum_value(
                f'modules:{visibility}:enriched',
                lambda: enrich_modules_with_authoring(payload['modules'], include_programme_deleted=visibility == 'all'),
            )
    if visibility != 'all':
        modules = [
            module for module in modules
            if not programme_deleted_row(module)
            and not is_archived_module_summary(module)
        ]
    # Opt-in slim response: a whitelist of the fields this endpoint's own callers
    # were traced to read, never the full row minus a few keys. See
    # COMPACT_MODULE_LIST_FIELDS for the set and COMPACT_MODULE_LIST_DROPPED for
    # why each omission is safe. Absent the flag the response is unchanged, so
    # existing consumers are unaffected.
    #
    # Filtering below still works: programmeId, cohortId, groupId and status are
    # all in the whitelist, so the projection cannot make a filter silently
    # match nothing.
    filters = {
        'programmeId': clean_str(request.GET.get('programme_id') or request.GET.get('programmeId')),
        'cohortId': clean_str(request.GET.get('cohort_id') or request.GET.get('cohortId')),
        'groupId': clean_str(request.GET.get('group_id') or request.GET.get('groupId')),
        'status': clean_str(request.GET.get('status')),
    }
    for field, expected in filters.items():
        if expected:
            modules = [item for item in modules if normalise(item.get(field)) == normalise(expected)]
    return curriculum_collection_response(payload, 'modules', modules, request=request)


def curriculum_component_library(
    request,
    *,
    CURRICULUM_SCHEMA,
    JsonResponse,
    LIBRARY_PAGE_SIZE_DEFAULT,
    LIBRARY_PAGE_SIZE_MAX,
    csv_param,
    json_error,
    library_component_rows,
    logger,
    parse_int,
    truthy,
):
    """Read-only search over every component that could be reused.

    Two modes. Without ``ids`` this is the picker list: narrow columns, one page
    at a time. With ``ids`` it returns full authoring detail for those
    components only - what a caller needs to copy them. The split exists because
    ``settings_json`` is 24 MB across this table and the list never shows it.

    Paging is applied in SQL here, so the response is built without going
    through ``paginate_curriculum_results`` (which slices an already-built list).
    """
    if request.method != 'GET':
        return json_error('Method not allowed.', status=405)
    ids = csv_param(request, 'ids', 'id')
    page = parse_int(request.GET.get('page'), 1)
    page_size = parse_int(
        request.GET.get('page_size') or request.GET.get('pageSize'),
        LIBRARY_PAGE_SIZE_DEFAULT,
    )
    try:
        rows = library_component_rows(
            search=request.GET.get('search') or request.GET.get('q') or '',
            types=csv_param(request, 'types', 'type'),
            programme_ids=csv_param(request, 'programme_ids', 'programmeIds'),
            origins=csv_param(request, 'origins', 'origin'),
            ids=ids,
            page=page,
            # An ids request wants exactly those rows, not a page of them.
            page_size=len(ids) if ids else page_size,
            detail=bool(ids) or truthy(request.GET.get('detail')),
        )
    except Exception:
        logger.exception('Unable to load the component reuse library.')
        return json_error('Unable to load the component library.', status=500)
    return JsonResponse({
        'schema': CURRICULUM_SCHEMA,
        'count': len(rows),
        'results': rows,
        'page': max(1, page),
        'pageSize': page_size,
        # A full page back suggests there is more; the alternative is a count(*)
        # over the same predicate on every keystroke.
        'hasNext': not ids and len(rows) >= min(LIBRARY_PAGE_SIZE_MAX, max(1, page_size)),
    })


def curriculum_module_structure_resolve(request, *, JsonResponse, json_body, json_error, resolve_module_structures):
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)

    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')

    requested_modules = payload.get('modules') or payload.get('identifiers') or []
    if not isinstance(requested_modules, list):
        return json_error('modules must be a list.')

    return JsonResponse({'results': resolve_module_structures(requested_modules)})


def curriculum_module_session_plan(
    request, module_catalogue_id, *,
    AUTHORING_MODULES_TABLE,
    JsonResponse,
    authoring_fetch_all,
    clean_str,
    fetch_group_row,
    format_date,
    json_error,
    logger,
    module_delivery_row,
    module_session_plan_for_count,
    module_session_plan_for_weeks,
    module_stored_week_count,
    parse_int,
    resolve_stored_module_catalogue_id,
):
    """The flat session dates for a module week count that is not saved yet.

    Module Builder adds and removes weeks before anything is written, and
    authored week N is calendar week N of the module's own run -- so a seventh
    week added to a six-week module has to be given the seventh Monday-to-Sunday
    window's delivery days. Asking here is what keeps those dates identical to
    the ones the structure payload serves after the save, instead of the browser
    deriving a schedule of its own that then disagrees with the calendar and the
    Teams series.

    ``?weeks=`` is the authored week count, and the plan runs to the end of that
    many Mon-Sun windows -- however many delivery days the group actually has in
    them, which is not the same number for a module that starts mid-week.
    ``?sessions=`` remains available for callers with a raw count of dates.
    """
    if request.method != 'GET':
        return json_error('Method not allowed.', status=405)
    try:
        from ..application.delivery_schedules import load_module_session_plan
        result = load_module_session_plan(
            module_catalogue_id, request.GET,
            resolve_stored_module_catalogue_id=resolve_stored_module_catalogue_id,
            authoring_fetch_all=authoring_fetch_all,
            AUTHORING_MODULES_TABLE=AUTHORING_MODULES_TABLE,
            module_delivery_row=module_delivery_row,
            fetch_group_row=fetch_group_row,
            parse_int=parse_int,
            module_session_plan_for_count=module_session_plan_for_count,
            module_session_plan_for_weeks=module_session_plan_for_weeks,
            module_stored_week_count=module_stored_week_count,
        )
        if result is None:
            return json_error('Module not found.', status=404)
        plan, catalogue_id, module_row, requested_weeks = result
    except ModuleSessionPlanValidationError as exc:
        return json_error(str(exc), fields=['weeks'])
    except Exception:
        logger.exception('Unable to plan module session dates for %s.', module_catalogue_id)
        return json_error('Unable to plan module session dates.', status=500)
    return JsonResponse({
        **plan,
        'moduleCatalogueId': catalogue_id,
        # Calendar plans carry the study-week windows the builder reads. Keep
        # the numeric count only for legacy plans that do not contain them.
        'weeks': plan.get('weeks', requested_weeks or module_stored_week_count(module_row)),
        'startDate': format_date(module_row.get('start_date')),
        'weekDays': clean_str(module_row.get('session_week_day')),
    })


def curriculum_group_modules_get(request, identifier, *, get_cached_payload,
                                 matches_curriculum_identifier, module_belongs_to_group,
                                 curriculum_collection_response, json_error):
    payload = get_cached_payload(request)
    group = next((item for item in payload['groups'] if matches_curriculum_identifier(item.get('id'), identifier)), None)
    if not group:
        return json_error('Group not found.', status=404)
    results = [module for module in payload['modules'] if module_belongs_to_group(module, group)]
    return curriculum_collection_response(payload, 'modules', results)
