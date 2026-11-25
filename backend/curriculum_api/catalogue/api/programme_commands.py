"""Programme HTTP orchestration; public routes and authentication stay at the existing API seam.

Named capabilities are supplied by the existing composition seam during migration.
No legacy module, provider or settings object is imported here.
"""


def curriculum_programmes(
    request,
    *,
    CURRICULUM_SCHEMA,
    build_programme_list,
    cached_curriculum_value,
    curriculum_collection_response,
    curriculum_visibility,
    enqueue_curriculum_home_refresh,
    get_curriculum_home,
    request_bypasses_curriculum_cache,
    settings,
):
    visibility = curriculum_visibility(request)
    force = request_bypasses_curriculum_cache(request)
    if not force and getattr(settings, 'CURRICULUM_HOME_SHARED_READ_MODEL_ENABLED', False):
        shared = get_curriculum_home(visibility)
        if (
            shared is not None
            and isinstance(shared.payload.get('overview'), dict)
            and isinstance(shared.payload.get('programmes'), list)
        ):
            response = curriculum_collection_response(
                shared.payload['overview'], 'programmes', shared.payload['programmes'],
            )
            response['X-LMS-Cache'] = 'READ-MODEL-STALE' if shared.stale else 'READ-MODEL-HIT'
            if shared.stale:
                enqueue_curriculum_home_refresh(visibility, reason='stale-read')
            return response
    # Consult the list cache before doing any source work. A programme cache hit
    # must not first rebuild a missing/expired overview and its unrelated trees.
    programmes = cached_curriculum_value(
        f'programmes:{visibility}:with-module-counts',
        lambda: build_programme_list(visibility, force=force),
        force=force,
    )
    response = curriculum_collection_response(
        {'schema': CURRICULUM_SCHEMA},
        'programmes',
        programmes,
    )
    if getattr(settings, 'CURRICULUM_HOME_SHARED_READ_MODEL_ENABLED', False):
        enqueue_curriculum_home_refresh(
            visibility, reason='forced-read' if force else 'missing-read-model',
        )
        response['X-LMS-Cache'] = 'READ-MODEL-MISS'
    return response


def curriculum_programme_reorder(
    request,
    *,
    JsonResponse,
    clean_str,
    datetime,
    ensure_program_config_archive_columns,
    get_program_config_rows,
    has_column,
    invalidate_curriculum_cache,
    json_body,
    json_error,
    log_curriculum_decision,
    programme_config_identity,
    programme_config_key_column,
    quote_ident,
    transaction,
    unique,
    update_rows,
):
    """Save the order the programme cards were dragged into.

    The body is the ids in the order they should read, top-left first. Only the
    programmes named are renumbered, and they are renumbered from 1 upward in
    the order given, so a partial list (one page of the grid) still lands in a
    stable order relative to itself. 0 stays reserved for "never ordered", which
    keeps untouched programmes ahead of nothing and still alphabetical among
    themselves.
    """
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)

    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')
    raw_order = payload.get('order')
    if not isinstance(raw_order, list):
        return json_error('Missing required fields.', fields=['order'])

    ensure_program_config_archive_columns()
    if not has_column('programmes', 'display_order'):
        return json_error(
            'This database has no programme display_order column yet. Apply '
            'backend/sql/2026-09-22_programme_display_order.sql first.',
            status=409,
        )

    programme_ids = unique(clean_str(value) for value in raw_order if clean_str(value))
    if not programme_ids:
        return json_error('No programmes were given to order.')

    configs = get_program_config_rows()
    configs_by_id = {programme_config_identity(config): config for config in configs}
    unknown = [programme_id for programme_id in programme_ids if programme_id not in configs_by_id]
    if unknown:
        return json_error('Unknown programmes in the order.', fields=unknown, status=404)

    key_column = programme_config_key_column()
    with transaction.atomic():
        for position, programme_id in enumerate(programme_ids, start=1):
            key_value = configs_by_id[programme_id].get(key_column)
            update_rows(
                'programmes',
                f'{quote_ident(key_column)} = %s',
                [key_value],
                {'display_order': position, 'updated_at': datetime.utcnow()},
            )
    invalidate_curriculum_cache()
    log_curriculum_decision('programme.reorder', outcome='saved', entity_id=','.join(programme_ids[:10]))
    return JsonResponse({'saved': True, 'order': programme_ids})


def curriculum_programme_restore(
    request,
    identifier,
    *,
    JsonResponse,
    ensure_program_config_archive_columns,
    is_archived_program_config,
    json_error,
    log_curriculum_decision,
    programme_config_by_identifier,
    programme_config_identity,
    programme_response,
    programme_status_is_archived,
    restore_programme_authoring_structure,
    transaction,
):
    """Take a programme back out of the archive, children included."""
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)

    ensure_program_config_archive_columns()
    config = programme_config_by_identifier(identifier)
    programme = programme_response(identifier) if not config else {
        'id': programme_config_identity(config),
        'sourceId': programme_config_identity(config),
        'name': config.get('name'),
    }
    if not programme and not config:
        return json_error('Programme not found.', status=404)

    archived = is_archived_program_config(config) or programme_status_is_archived(
        (programme or {}).get('status')
    )
    if not archived:
        return json_error('Programme is not archived.', status=409)

    with transaction.atomic():
        restored = restore_programme_authoring_structure(identifier, programme, config)
    log_curriculum_decision('programme.restore', outcome='restored', entity_id=identifier)
    return JsonResponse({
        'restored': True,
        'id': identifier,
        'programme': programme_response(identifier),
        'details': restored,
        'message': 'Programme and the rows archived with it were restored.',
    })


def curriculum_programme_detail(
    request,
    identifier,
    *,
    JsonResponse,
    clean_str,
    curriculum_name_only_patch,
    datetime,
    ensure_program_config_archive_columns,
    first_programme_response,
    get_program_config_rows,
    insert_row,
    invalidate_curriculum_cache,
    json_body,
    json_error,
    lock_record_row,
    log_curriculum_decision,
    normalise_ksb_profile_source_value,
    payload_required_otjh,
    permanent_programme_delete_response,
    programme_config_by_identifier,
    programme_config_id,
    programme_config_identity,
    programme_config_key_column,
    programme_conflict_record,
    programme_record_revision,
    programme_response,
    programme_status_from_payload,
    propagate_programme_name_to_learners,
    quote_ident,
    record_conflict_response,
    request_wants_forced_programme_delete,
    request_wants_permanent_programme_delete,
    requested_expected_revision,
    rows_for_programme,
    set_programme_modules_ksb_source,
    soft_delete_programme_authoring_structure,
    transaction,
    unique,
    unique_program_id,
    update_rows,
):
    if request.method not in {'PATCH', 'DELETE'}:
        return json_error('Method not allowed.', status=405)

    if request.method == 'DELETE':
        ensure_program_config_archive_columns()
        config = programme_config_by_identifier(identifier)
        programme = programme_response(identifier) if not config else {
            'id': programme_config_identity(config),
            'sourceId': programme_config_identity(config),
            'name': config.get('name'),
            'standard': config.get('standard'),
        }
        if not programme and not config:
            return json_error('Programme not found.', status=404)

        # An archived programme can be removed for good, with everything beneath it.
        # Archiving stays the default so a delete is never irreversible by accident.
        if request_wants_permanent_programme_delete(request):
            log_curriculum_decision(
                'programme.delete', outcome='permanent_requested', entity_id=identifier,
            )
            return permanent_programme_delete_response(
                identifier,
                programme,
                config,
                force_content=request_wants_forced_programme_delete(request),
            )

        with transaction.atomic():
            soft_deleted = soft_delete_programme_authoring_structure(identifier, programme, config)
        # After the commit as well as inside it, for the same reason the permanent
        # delete does: a read that lands mid-transaction caches the pre-archive rows.
        invalidate_curriculum_cache()
        log_curriculum_decision(
            'programme.archive', outcome='soft_deleted', entity_id=identifier,
            # The cascade's own per-table counts; the tables it took down with it.
            reason=','.join(f'{table}:{count}' for table, count in sorted((soft_deleted or {}).items())),
        )
        return JsonResponse({
            'deleted': True,
            'permanent': False,
            'archived': True,
            'id': identifier,
            'softDeleted': soft_deleted,
            'message': 'Programme and linked curriculum rows were soft-deleted.',
        })

    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')

    name = clean_str(payload.get('name'))
    ensure_program_config_archive_columns()
    # programmes.structure_type was dropped; everything is scheduled now.
    structure_type = 'scheduled'
    config = programme_config_by_identifier(identifier)
    # rows_for_programme() assembles the whole 'all' curriculum payload, which is
    # only needed for the legacy fallback below (a delivery-row programme with no
    # programmes config yet). Skipping it when a config exists keeps the common
    # update path off a full payload build.
    programme = None
    if not config:
        programme, _rows = rows_for_programme(identifier, 'all')
        if not programme:
            return json_error('Programme not found.', status=404)
    if not config and programme:
        source_id = unique_program_id(programme.get('sourceId') or name or programme.get('name'), get_program_config_rows())
        programme_status = programme_status_from_payload(payload, programme)
        config = insert_row('programmes', {
            'programme_id': source_id,
            'id': source_id,
            'program_id': source_id,
            'name': name or programme.get('name'),
            'level': payload.get('level') or programme.get('level'),
            'color': payload.get('color') or programme.get('color') or '#6941c6',
            'description': payload.get('description') or programme.get('description') or '',
            'ksb_profile_source_id': normalise_ksb_profile_source_value(payload.get('ksbProfileSourceId') or payload.get('ksb_profile_source_id') or programme.get('ksbProfileSourceId') or ''),
            'required_otjh': payload_required_otjh(payload, programme),
            'status': programme_status,
            'created_at': datetime.utcnow(),
            'updated_at': datetime.utcnow(),
        })

    # Optimistic concurrency, opt-in, as on the module structure PATCH. The
    # drawer sends every field it renders, so a save built before a colleague's
    # would put their work back to what it was -- silently, because nothing here
    # compared the two. The check and the write share one transaction, and the
    # lock is taken first; see lock_record_row.
    expected_revision = requested_expected_revision(request, payload)
    if config:
        with transaction.atomic():
            if expected_revision:
                # Same tolerance as the update below: a key column that cannot
                # be resolved is retried once rather than failing the request.
                try:
                    lock_column = programme_config_key_column()
                except Exception:
                    lock_column = programme_config_key_column()
                lock_record_row(
                    'programmes',
                    quote_ident(lock_column) + ' = %s',
                    [config.get(lock_column)],
                )
                current_revision = programme_record_revision(identifier)
                if current_revision != expected_revision:
                    return record_conflict_response(
                        expected_revision, current_revision,
                        programme=programme_conflict_record(identifier),
                    )
            programme_status = programme_status_from_payload(payload, config)
            updates = {
                'name': name or config.get('name'),
                'level': payload.get('level'),
                'color': payload.get('color') or config.get('color'),
                'description': payload.get('description'),
                'ksb_profile_source_id': normalise_ksb_profile_source_value(payload.get('ksbProfileSourceId') if 'ksbProfileSourceId' in payload else payload.get('ksb_profile_source_id') if 'ksb_profile_source_id' in payload else config.get('ksb_profile_source_id')),
                'required_otjh': payload_required_otjh(payload, config),
                'status': programme_status,
                'updated_at': datetime.utcnow(),
            }
            if curriculum_name_only_patch(payload):
                updates = {'name': name, 'updated_at': updates['updated_at']}
            try:
                key_column = programme_config_key_column()
            except Exception:
                key_column = programme_config_key_column()
            key_value = config.get(key_column)
            update_rows('programmes', f'{quote_ident(key_column)} = %s', [key_value], updates, allow_null_columns=['required_otjh'])
            if 'ksbProfileSourceId' in payload or 'ksb_profile_source_id' in payload:
                set_programme_modules_ksb_source(
                    unique([identifier, key_value, config.get('program_id'), config.get('name'), name]),
                    updates.get('ksb_profile_source_id') or '',
                )

            # Learner records carry the name too; renamed through their profile's
            # programme id, never moved. See placement_rename.
            propagate_programme_name_to_learners(
                programme_config_id(config) or clean_str(key_value), clean_str(config.get('name')), name,
            )

    invalidate_curriculum_cache()
    # Read after the commit, so the token handed back is the one a reader would
    # fingerprint now rather than one a rollback could take away.
    saved_revision = programme_record_revision(identifier)
    payload_keys = set(payload.keys())
    if payload_keys and payload_keys.issubset({'ksbProfileSourceId', 'ksb_profile_source_id'}):
        return JsonResponse({
            'updated': True,
            'revision': saved_revision,
            'programme': {
                'id': identifier,
                'sourceId': identifier,
                'ksbProfileSourceId': normalise_ksb_profile_source_value(payload.get('ksbProfileSourceId') if 'ksbProfileSourceId' in payload else payload.get('ksb_profile_source_id') or ''),
            },
        })
    return JsonResponse({
        'updated': True,
        'revision': saved_revision,
        'programme': first_programme_response(identifier, name) or {'id': identifier},
    })


def curriculum_programme_collection(
    request,
    *,
    JsonResponse,
    clean_str,
    curriculum_programmes,
    datetime,
    ensure_program_config_archive_columns,
    first_programme_response,
    get_program_config_rows,
    insert_row,
    invalidate_curriculum_cache,
    is_archived_program_config,
    json_body,
    json_error,
    normalise_ksb_profile_source_value,
    payload_required_otjh,
    preferred_program_config_by_name,
    programme_config_id,
    programme_config_identity,
    programme_config_key_column,
    programme_response,
    programme_status_from_payload,
    programme_structure_type,
    quote_ident,
    require_fields,
    unique_program_id,
    update_rows,
):
    if request.method == 'GET':
        return curriculum_programmes(request)
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)

    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')
    missing = require_fields(payload, ['name'])
    if missing:
        return json_error('Missing required fields.', fields=missing)

    ensure_program_config_archive_columns()
    name = clean_str(payload.get('name'))
    structure_type = programme_structure_type(payload)
    program_configs = get_program_config_rows()
    explicit_program_id = clean_str(payload.get('programId'))
    existing_config_by_id = next((
        config for config in program_configs
        if explicit_program_id and programme_config_identity(config) == explicit_program_id
    ), None)
    existing_config_by_name = preferred_program_config_by_name(program_configs, name)
    existing_config = existing_config_by_id or existing_config_by_name
    # Reusing an archived programme's name must not reuse its id. A derived id
    # (base + '-2') reads as a variant of the archived record, so any lookup
    # that prefix-matches or strips the suffix attaches the old programme's
    # cohorts, modules and learners to the new one. Mint an unrelated id.
    reusing_archived_name = bool(existing_config) and is_archived_program_config(existing_config)
    if reusing_archived_name:
        existing_config = None
    if existing_config:
        programme_status = programme_status_from_payload(payload, existing_config)
        updates = {
            'name': name,
            'level': payload.get('level') or existing_config.get('level'),
            'color': payload.get('color') or existing_config.get('color') or '#6941c6',
            'description': payload.get('description') if 'description' in payload else existing_config.get('description'),
            'ksb_profile_source_id': normalise_ksb_profile_source_value(payload.get('ksbProfileSourceId') if 'ksbProfileSourceId' in payload else payload.get('ksb_profile_source_id') if 'ksb_profile_source_id' in payload else existing_config.get('ksb_profile_source_id')),
            'required_otjh': payload_required_otjh(payload, existing_config),
            'status': programme_status,
            'updated_at': datetime.utcnow(),
        }
        try:
            key_column = programme_config_key_column()
        except Exception:
            key_column = programme_config_key_column()
        key_value = existing_config.get(key_column)
        update_rows('programmes', f'{quote_ident(key_column)} = %s', [key_value], updates, allow_null_columns=['required_otjh'])
        invalidate_curriculum_cache()
        return JsonResponse({'created': False, 'programme': first_programme_response(key_value, name) or {'sourceId': key_value, 'name': name}})

    source_id = unique_program_id('' if reusing_archived_name else (explicit_program_id or name), program_configs)
    programme_status = programme_status_from_payload(payload, default='active')
    insert_payload = {
        'programme_id': source_id,
        'id': source_id,
        'program_id': source_id,
        'name': name,
        'sub': payload.get('standard') or payload.get('sub') or name,
        'standard': payload.get('standard') or payload.get('sub') or name,
        'level': payload.get('level') or '',
        'owner': payload.get('owner') or '',
        'created_by': payload.get('owner') or '',
        'color': payload.get('color') or '#6941c6',
        'description': payload.get('description') or '',
        'structure_type': structure_type,
        'ksb_profile_source_id': normalise_ksb_profile_source_value(payload.get('ksbProfileSourceId') or payload.get('ksb_profile_source_id') or ''),
        'required_otjh': payload_required_otjh(payload),
        'status': programme_status,
        'created_at': datetime.utcnow(),
        'updated_at': datetime.utcnow(),
    }
    row = insert_row('programmes', insert_payload)
    invalidate_curriculum_cache()
    source_id = programme_config_id(row) or source_id
    return JsonResponse({'created': True, 'programme': programme_response(source_id) or {'sourceId': source_id, 'name': row.get('name')}}, status=201)


def curriculum_programme_tree_save(
    request,
    *,
    AUTHORING_MODULES_TABLE,
    COHORT_AUTHORING_DETAILS_TABLE,
    GROUPS_TABLE,
    JsonResponse,
    ModuleAuthoringValidationError,
    StaleModuleStructureWrite,
    TutorAssignmentDeliveryDayError,
    TutorScheduleConflictError,
    authoring_fetch_all,
    authoring_soft_delete,
    bool_payload,
    clean_str,
    clean_tree_remove_ids,
    fetch_cohort_row,
    fetch_group_row,
    invalidate_curriculum_cache,
    json_body,
    json_error,
    logger,
    repair_curriculum_parent_links,
    save_tree_cohort,
    save_tree_group,
    save_tree_group_modules,
    transaction,
    unassign_authoring_modules_from_group,
    unique,
    update_authoring_rows,
    upsert_programme_for_tree,
    versioning,
):
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)
    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')
    try:
        # Labels every revision this save produces as coming from the tree save,
        # which is the one caller that legitimately rewrites a whole programme's
        # structure in one request. Without it a reader cannot tell a person
        # editing one cohort from the tree rewriting forty.
        from ..application.programme_tree import save_programme_tree
        programme, saved_cohorts, saved_groups, saved_modules, removed_module_ids, removed_group_ids, removed_cohort_ids, remove_missing = save_programme_tree(
            payload,
            AUTHORING_MODULES_TABLE=AUTHORING_MODULES_TABLE,
            COHORT_AUTHORING_DETAILS_TABLE=COHORT_AUTHORING_DETAILS_TABLE,
            GROUPS_TABLE=GROUPS_TABLE,
            authoring_fetch_all=authoring_fetch_all,
            authoring_soft_delete=authoring_soft_delete,
            bool_payload=bool_payload,
            clean_str=clean_str,
            clean_tree_remove_ids=clean_tree_remove_ids,
            fetch_cohort_row=fetch_cohort_row,
            fetch_group_row=fetch_group_row,
            invalidate_curriculum_cache=invalidate_curriculum_cache,
            repair_curriculum_parent_links=repair_curriculum_parent_links,
            save_tree_cohort=save_tree_cohort,
            save_tree_group=save_tree_group,
            save_tree_group_modules=save_tree_group_modules,
            transaction=transaction,
            unassign_authoring_modules_from_group=unassign_authoring_modules_from_group,
            update_authoring_rows=update_authoring_rows,
            upsert_programme_for_tree=upsert_programme_for_tree,
            versioning=versioning,
        )
    except (TutorScheduleConflictError, TutorAssignmentDeliveryDayError, StaleModuleStructureWrite) as exc:
        return exc.as_response()
    except ModuleAuthoringValidationError as exc:
        return json_error(str(exc), status=400, validationErrors=exc.errors)
    except ValueError as exc:
        return json_error(str(exc), status=400)
    except Exception as exc:
        logger.exception('Programme tree save failed.')
        return json_error('Unable to save programme tree.', status=500, detail=str(exc))

    return JsonResponse({
        'saved': True,
        'programme': programme,
        'cohorts': saved_cohorts,
        'groups': saved_groups,
        'modules': saved_modules,
        'removedModuleIds': unique(removed_module_ids),
        'removedGroupIds': unique(removed_group_ids),
        'removedCohortIds': unique(removed_cohort_ids),
        'removedMissing': remove_missing,
    })


def curriculum_programme_cohort_collection(
    request,
    programme_id,
    *,
    build_curriculum_payload,
    create_curriculum_cohort,
    curriculum_collection_response,
    find_programme,
    get_cached_payload,
    json_body,
    json_error,
    matches_curriculum_identifier,
):
    if request.method == 'GET':
        payload = get_cached_payload(request)
        programme = find_programme(payload, programme_id)
        if not programme:
            return json_error('Programme not found.', status=404)
        results = [
            cohort for cohort in payload['cohorts']
            if matches_curriculum_identifier(cohort.get('programmeId'), programme.get('id'))
            or matches_curriculum_identifier(cohort.get('programme'), programme.get('name'))
        ]
        return curriculum_collection_response(payload, 'cohorts', results)

    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)

    body = json_body(request)
    if body is None:
        return json_error('Invalid JSON body.')
    programme = find_programme(build_curriculum_payload('all', force=True), programme_id)
    if not programme:
        return json_error('Programme not found.', status=404)
    body['programme'] = programme.get('name') or programme_id
    return create_curriculum_cohort(body)
