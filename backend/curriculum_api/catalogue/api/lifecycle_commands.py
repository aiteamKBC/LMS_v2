"""Curriculum lifecycle HTTP contracts, guarded transactions and existing error mapping.

Explicit capabilities are supplied at the existing views composition seam.
No legacy views, application settings or provider runtime is imported here.
"""


def permanent_programme_delete_response(
    identifier,
    programme=None,
    config=None,
    force_content=False,
    *,
    DatabaseError,
    IntegrityError,
    JsonResponse,
    ProgrammeContentRetained,
    clean_str,
    invalidate_curriculum_cache,
    is_archived_program_config,
    json_error,
    log_curriculum_decision,
    logger,
    permanent_delete_reference_refusal,
    permanently_delete_programme_structure,
    programme_config_rows_remaining,
    programme_permanent_delete_plan,
    programme_status_is_archived,
    transaction,
):
    """HTTP outcome of a permanent programme delete.

    Archived-only by design: ``is_archived`` is the switch that turns an
    irreversible delete on. A live programme is refused with 409 so the caller
    archives it first, which is what the plain DELETE does.
    """
    archived = is_archived_program_config(config) or programme_status_is_archived(
        (programme or {}).get('status')
    )
    if not archived:
        return json_error(
            'Archive the programme before deleting it permanently.',
            status=409,
            reason='programme-not-archived',
            deleted=False,
            permanent=False,
            id=clean_str(identifier),
        )

    plan = programme_permanent_delete_plan(identifier, programme, config)
    if plan['blockers']:
        return json_error(
            'Learner training plans still reference this curriculum, so the programme '
            'cannot be deleted permanently.',
            status=409,
            reason='programme-has-learner-delivery',
            deleted=False,
            permanent=False,
            id=clean_str(identifier),
            blockers=plan['blockers'],
        )
    for candidate in plan['candidates']:
        blocked = permanent_delete_reference_refusal('programme', candidate)
        if blocked is not None:
            return blocked

    try:
        with transaction.atomic():
            removed = permanently_delete_programme_structure(plan, force_content=force_content)
        # Again, now the delete is committed. The invalidation inside the
        # transaction cannot be the last word: a read arriving before the commit
        # refills every cache from rows that are on their way out, and the
        # programme then keeps its card on the list until that entry ages out --
        # which is exactly what makes a discarded run look like it was saved.
        invalidate_curriculum_cache()
    except ProgrammeContentRetained as exc:
        # The programme still owns authored content: refused whole (nothing was
        # written) and it stays archived.
        logger.info('Permanent delete of programme %s refused: %s', identifier, exc)
        return json_error(
            str(exc), status=409, reason='programme-content-cannot-detach',
            deleted=False, permanent=False, id=clean_str(identifier),
        )
    except (IntegrityError, DatabaseError) as exc:
        logger.warning('Permanent delete of programme %s was refused: %s', identifier, exc)
        return json_error(
            'The database refused the permanent delete because other rows still '
            'reference this programme.',
            status=409,
            reason='programme-delete-restricted',
            deleted=False,
            permanent=False,
            id=clean_str(identifier),
            detail=clean_str(str(exc)),
        )

    # Never report a delete the database did not make. A candidate set that
    # matched no programme row leaves the wipes as no-ops, and answering 'deleted'
    # to that is what tells a discarded wizard run it left nothing behind while
    # the programme is still on the list. The archive that ran first still
    # stands, so this is the same outcome the caller already handles for a
    # refusal: out of the active lists, still in the database.
    if programme_config_rows_remaining(plan['candidates']):
        log_curriculum_decision(
            'programme.delete', outcome='incomplete', entity_id=identifier,
            reason='programme-row-survived-delete',
        )
        return json_error(
            'The programme row is still in the database after the delete, so it was '
            'not removed permanently. It stays archived and out of the active lists.',
            status=409,
            reason='programme-delete-incomplete',
            deleted=False,
            permanent=False,
            id=clean_str(identifier),
            removed=removed,
        )

    return JsonResponse({
        'deleted': True,
        'permanent': True,
        'forced': bool(force_content),
        'archived': False,
        'id': clean_str(identifier),
        'removed': removed,
        'learners': plan['learners'],
        'message': 'Programme and every curriculum row beneath it were deleted permanently.',
    })


def curriculum_module_restore(
    request,
    identifier,
    *,
    ARCHIVE_MODULE_QUIZ_NOTE,
    AUTHORING_COMPONENTS_TABLE,
    AUTHORING_MODULES_TABLE,
    AUTHORING_WEEKS_TABLE,
    JsonResponse,
    MODULE_CHILD_AUTHORING_TABLES,
    RESTORE_NULLABLE_COLUMNS,
    archived_parent_programme,
    authoring_module_exists,
    clean_str,
    curriculum_row_effectively_deleted,
    invalidate_curriculum_cache,
    json_error,
    log_curriculum_decision,
    module_archive_event_bounds,
    resolve_stored_module_catalogue_id,
    restore_rows_via_parent,
    restore_soft_delete_payload,
    transaction,
    update_rows,
):
    """Take a module, and everything archived under it, back out of the archive."""
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)

    catalogue_id = resolve_stored_module_catalogue_id(clean_str(identifier))
    module_row = authoring_module_exists(catalogue_id) if catalogue_id else None
    if not module_row:
        log_curriculum_decision('module.restore', outcome='rejected', reason='not-found', entity_id=identifier)
        return json_error('Module not found.', status=404)
    if not curriculum_row_effectively_deleted(module_row):
        return json_error(
            'Module is not archived.', status=409,
            reason='module-not-archived', restored=False, id=catalogue_id,
        )

    programme_id = clean_str(module_row.get('programme_id'))
    archived_programme = archived_parent_programme(programme_id)
    if archived_programme:
        name = clean_str(archived_programme.get('name')) or 'The programme'
        return json_error(
            f'{name} is archived, so this module has no programme to come back to. Restore the '
            'programme instead - it brings back everything archived with it, this module included.',
            status=409, reason='programme-archived', restored=False, id=catalogue_id,
        )

    with transaction.atomic():
        # Matched on the marker this module's own archive stamped, so only that
        # cascade comes back: a component deleted by hand beforehand stays
        # deleted rather than being resurrected by an unrelated restore.
        # ...and only rows that archive stamped: an earlier archive of this
        # same module, undone by a save, left its children stamped with this
        # id too, and they are not part of what is being restored.
        bounds = module_archive_event_bounds(module_row)
        restored = {
            table: len(restore_rows_via_parent(table, catalogue_id, bounds))
            for table in MODULE_CHILD_AUTHORING_TABLES
        }
        update_rows(
            AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s', [catalogue_id],
            restore_soft_delete_payload(AUTHORING_MODULES_TABLE),
            allow_null_columns=RESTORE_NULLABLE_COLUMNS,
        )
    invalidate_curriculum_cache()
    log_curriculum_decision(
        'module.restore', outcome='restored', entity_id=catalogue_id,
        parent_id=clean_str(module_row.get('group_id')),
        reason=','.join(f'{table}:{count}' for table, count in sorted(restored.items())),
    )
    return JsonResponse({
        'restored': True,
        'id': catalogue_id,
        'details': {
            'weeks': restored.get(AUTHORING_WEEKS_TABLE, 0),
            'components': restored.get(AUTHORING_COMPONENTS_TABLE, 0),
        },
        'message': f'Module restored. {ARCHIVE_MODULE_QUIZ_NOTE}',
    })


def permanent_module_delete_response(
    module_row,
    *,
    AUTHORING_KSB_MAPPINGS_TABLE,
    AUTHORING_MODULES_TABLE,
    DatabaseError,
    IntegrityError,
    JsonResponse,
    MODULE_CHILD_AUTHORING_TABLES,
    clean_str,
    curriculum_row_effectively_deleted,
    delete_rows,
    invalidate_curriculum_cache,
    json_error,
    ksb_mapping_placement,
    log_curriculum_decision,
    logger,
    module_teams_calendar_block_response,
    permanent_delete_reference_refusal,
    transaction,
):
    """HTTP outcome of a permanent module delete: the module and all its authoring."""
    catalogue_id = clean_str(module_row.get('module_catalogue_id'))
    if not curriculum_row_effectively_deleted(module_row):
        return json_error(
            'Archive the module before deleting it permanently.',
            status=409, reason='module-not-archived', deleted=False, permanent=False, id=catalogue_id,
        )
    # A module archived before this check existed can still own a running
    # calendar; deleting it would orphan that calendar's rows for good.
    blocked = module_teams_calendar_block_response(catalogue_id)
    if blocked is not None:
        return blocked
    blocked = permanent_delete_reference_refusal('module', catalogue_id)
    if blocked is not None:
        return blocked

    try:
        with transaction.atomic():
            # Children first: the module row is what the rest point at, and a
            # database with the foreign keys in place refuses it the other way
            # round.
            removed = {}
            for table in MODULE_CHILD_AUTHORING_TABLES:
                # Normalized mappings belong to components, so resolve their
                # module scope before the components themselves are deleted.
                where_sql, params = (
                    ksb_mapping_placement.where(catalogue_id)
                    if table == AUTHORING_KSB_MAPPINGS_TABLE
                    else ('module_catalogue_id = %s', [catalogue_id])
                )
                removed[table] = len(delete_rows(table, where_sql, params))
            removed[AUTHORING_MODULES_TABLE] = len(
                delete_rows(AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s', [catalogue_id])
            )
    except (IntegrityError, DatabaseError) as exc:
        logger.warning('Permanent delete of module %s was refused: %s', catalogue_id, exc)
        return json_error(
            'The database refused the permanent delete because other rows still reference this module.',
            status=409, reason='module-delete-restricted', deleted=False, permanent=False,
            id=catalogue_id, detail=clean_str(str(exc)),
        )

    invalidate_curriculum_cache()
    log_curriculum_decision(
        'module.delete', outcome='permanent', entity_id=catalogue_id,
        parent_id=clean_str(module_row.get('group_id')),
        reason=','.join(f'{table}:{count}' for table, count in sorted(removed.items())),
    )
    return JsonResponse({
        'deleted': True,
        'permanent': True,
        'id': catalogue_id,
        'removed': removed,
        'message': 'Module and its authored weeks, components and mappings were removed from the database.',
    })


def curriculum_module_component_detail(
    request,
    module_catalogue_id,
    component_id,
    *,
    AUTHORING_COMPONENTS_TABLE,
    AUTHORING_KSB_MAPPINGS_TABLE,
    JsonResponse,
    authoring_soft_delete,
    check_removal,
    clean_str,
    ensure_module_authoring_tables,
    invalidate_curriculum_cache,
    json_body,
    json_error,
    ksb_mapping_placement,
    refuse_stale_module_write,
    transaction,
):
    if request.method != 'DELETE':
        return json_error('Method not allowed.', status=405)
    module_catalogue_id = clean_str(module_catalogue_id)
    component_id = clean_str(component_id)
    ensure_module_authoring_tables()
    payload = json_body(request) if request.body else {}
    with transaction.atomic():
        refused = refuse_stale_module_write(request, payload or {}, module_catalogue_id)
        if refused is not None:
            return refused
        refused = check_removal(request, module_catalogue_id, 'component', component_id, payload or {})
        if refused is not None:
            return refused
        authoring_soft_delete(AUTHORING_KSB_MAPPINGS_TABLE, *ksb_mapping_placement.where(module_catalogue_id, component_ids=[component_id]), via_parent=component_id, deleted_by='component-delete')
        authoring_soft_delete(AUTHORING_COMPONENTS_TABLE, 'module_catalogue_id = %s and id = %s', [module_catalogue_id, component_id], deleted_by='component-delete')
    invalidate_curriculum_cache()
    return JsonResponse({'deleted': True, 'permanent': False, 'moduleCatalogueId': module_catalogue_id, 'componentId': component_id})


def curriculum_module_week_detail(
    request,
    module_catalogue_id,
    week_id,
    *,
    AUTHORING_COMPONENTS_TABLE,
    AUTHORING_KSB_MAPPINGS_TABLE,
    AUTHORING_WEEKS_TABLE,
    JsonResponse,
    authoring_fetch_all,
    authoring_soft_delete,
    check_removal,
    clean_str,
    invalidate_curriculum_cache,
    json_body,
    json_error,
    ksb_mapping_placement,
    log_curriculum_decision,
    refuse_stale_module_write,
    transaction,
):
    if request.method != 'DELETE':
        return json_error('Method not allowed.', status=405)
    module_catalogue_id = clean_str(module_catalogue_id)
    week_id = clean_str(week_id)
    payload = json_body(request) if request.body else {}
    with transaction.atomic():
        refused = refuse_stale_module_write(request, payload or {}, module_catalogue_id)
        if refused is not None:
            return refused
        refused = check_removal(request, module_catalogue_id, 'week', week_id, payload or {})
        if refused is not None:
            return refused
        # Read under the lock: a component added to this week after the caller
        # read it is part of what the caller's version check just accepted.
        component_rows = authoring_fetch_all(AUTHORING_COMPONENTS_TABLE, 'module_catalogue_id = %s and week_id = %s', [module_catalogue_id, week_id])
        component_ids = [str(row.get('id')) for row in component_rows]
        if component_ids:
            placeholders = ', '.join(['%s'] * len(component_ids))
            authoring_soft_delete(AUTHORING_KSB_MAPPINGS_TABLE, *ksb_mapping_placement.where(module_catalogue_id, component_ids=component_ids), via_parent=week_id, deleted_by='week-delete')
        authoring_soft_delete(AUTHORING_KSB_MAPPINGS_TABLE, *ksb_mapping_placement.where(module_catalogue_id, week_id=week_id), via_parent=week_id, deleted_by='week-delete')
        authoring_soft_delete(AUTHORING_COMPONENTS_TABLE, 'module_catalogue_id = %s and week_id = %s', [module_catalogue_id, week_id], via_parent=week_id, deleted_by='week-delete')
        authoring_soft_delete(AUTHORING_WEEKS_TABLE, 'module_catalogue_id = %s and id = %s', [module_catalogue_id, week_id], deleted_by='week-delete')
    log_curriculum_decision(
        'week.archive', outcome='soft_deleted', entity_id=week_id,
        parent_id=module_catalogue_id, row_count=len(component_ids),
    )
    invalidate_curriculum_cache()
    return JsonResponse({'deleted': True, 'permanent': False, 'moduleCatalogueId': module_catalogue_id, 'weekId': week_id})
