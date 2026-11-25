"""Api archive reads. Explicit read capabilities preserve legacy contracts."""


def curriculum_archived_cohorts(
    request, *, COHORT_AUTHORING_DETAILS_TABLE, CURRICULUM_SCHEMA, GROUPS_TABLE, JsonResponse,
    active_learner_delivery_counts, archived_authoring_rows, archived_cohort_payload, clean_str,
    get_holiday_rows_safe,
):
    """Archived cohorts, each with what a restore or a delete would move."""
    archived_groups = archived_authoring_rows(GROUPS_TABLE)
    cohort_learner_counts, _group_learner_counts = active_learner_delivery_counts()
    # What serialize_cohort_authoring_detail() reads per row when given none.
    holiday_rows = get_holiday_rows_safe()
    results = [
        archived_cohort_payload(row, archived_groups, cohort_learner_counts, holiday_rows)
        for row in archived_authoring_rows(COHORT_AUTHORING_DETAILS_TABLE)
        if clean_str(row.get('cohort_id'))
    ]
    return JsonResponse({'schema': CURRICULUM_SCHEMA, 'count': len(results), 'results': results})


def curriculum_archived_groups(
    request, *, COHORT_AUTHORING_DETAILS_TABLE, CURRICULUM_SCHEMA, GROUPS_TABLE, JsonResponse,
    active_learner_delivery_counts, archived_authoring_rows, archived_group_payload, authoring_fetch_all,
    clean_str,
):
    """Archived groups, each with what a restore or a delete would move."""
    cohort_rows_by_id = {
        clean_str(row.get('cohort_id')): row
        for row in authoring_fetch_all(COHORT_AUTHORING_DETAILS_TABLE)
        if clean_str(row.get('cohort_id'))
    }
    _cohort_learner_counts, group_learner_counts = active_learner_delivery_counts()
    results = [
        archived_group_payload(row, cohort_rows_by_id, group_learner_counts)
        for row in archived_authoring_rows(GROUPS_TABLE)
        if clean_str(row.get('group_id'))
    ]
    return JsonResponse({'schema': CURRICULUM_SCHEMA, 'count': len(results), 'results': results})


def curriculum_archived_modules(
    request, *, CURRICULUM_SCHEMA, JsonResponse, archived_module_component_counts,
    archived_module_payload, archived_module_rows, clean_str, curriculum_read_scope,
):
    """Archived modules, each with what a restore or a delete would move."""
    with curriculum_read_scope():
        rows = [row for row in archived_module_rows() if clean_str(row.get('module_catalogue_id'))]
        component_counts = archived_module_component_counts(
            [row.get('module_catalogue_id') for row in rows],
        )
        results = [archived_module_payload(row, component_counts) for row in rows]
    return JsonResponse({'schema': CURRICULUM_SCHEMA, 'count': len(results), 'results': results})


def curriculum_archived_module_structure(
    request, module_catalogue_id, *, JsonResponse, archive_stamp_fields, authoring_module_exists,
    clean_str, curriculum_read_scope, curriculum_row_effectively_deleted,
    get_authoring_structure_payload, json_error, logger, resolve_stored_module_catalogue_id,
):
    """One archived module's weeks and the components inside them.

    The archive is the only place an archived module can be looked at. Every
    workspace in the app reads the curriculum overview payload, which excludes
    archived rows, and the live structure endpoint next to this one filters its
    children through ``active_*`` -- correct for a live read, and the reason an
    archived module read through it comes back with an empty week list.

    Read-only by design: an archived module is restored or removed, never edited,
    so there is no PATCH here. Uncached for the same reason the archive lists are
    revalidated -- this is opened in order to act on it, and the very next thing
    the reader does is restore or delete the module it belongs to.
    """
    identifier = clean_str(module_catalogue_id)
    catalogue_id = resolve_stored_module_catalogue_id(identifier)
    module_row = authoring_module_exists(catalogue_id) if catalogue_id else None
    if not module_row:
        return json_error('Module not found.', status=404)
    if not curriculum_row_effectively_deleted(module_row):
        # The live endpoint is this module's door, and it is the one that can
        # serve an editable structure. Saying so is better than quietly serving a
        # second, read-only copy of a module that is not in the archive at all.
        return json_error(
            'Module is not archived.', status=409,
            reason='module-not-archived', id=catalogue_id,
        )
    try:
        with curriculum_read_scope(targeted_child_reads=True):
            payload = get_authoring_structure_payload(catalogue_id, include_archived=True)
    except Exception:
        logger.exception('Unable to load archived module structure for %s.', identifier)
        return json_error('Unable to load archived module structure.', status=500)
    if not payload:
        return json_error('Module authoring structure not found.', status=404)
    return JsonResponse({**payload, **archive_stamp_fields(module_row), 'status': 'archived'})
