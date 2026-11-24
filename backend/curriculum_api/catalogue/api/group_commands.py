"""Group HTTP contracts and module attachment orchestration.

Named capabilities are supplied by the existing composition seam during migration.
No legacy module, provider or settings object is imported here.
"""
from curriculum_api.weekly_schedule import module_week_boundary_mode


def curriculum_groups(
    request,
    *,
    CURRICULUM_SCHEMA,
    curriculum_collection_response,
    delivery_scope_lists,
    matches_curriculum_identifier,
):
    # The groups only (see delivery_scope_lists): building the whole curriculum
    # payload for them took 34-49 s cold on the new database.
    payload = {'schema': CURRICULUM_SCHEMA, 'groups': delivery_scope_lists(request)['groups']}
    cohort_id = request.GET.get('cohort_id') or request.GET.get('cohortId') or request.GET.get('cohort')
    results = payload['groups']
    if cohort_id:
        results = [
            group for group in results
            if matches_curriculum_identifier(group.get('cohortId'), cohort_id)
            or matches_curriculum_identifier(group.get('cohort'), cohort_id)
        ]
    return curriculum_collection_response(payload, 'groups', results)


def create_curriculum_group(
    payload,
    *,
    GROUPS_TABLE,
    JsonResponse,
    archived_authoring_ids,
    build_group_schedule,
    canonical_group_coaches,
    clean_str,
    curriculum_group_from_authoring_detail,
    fetch_group_row,
    group_authoring_detail_rows,
    invalidate_curriculum_cache,
    json_error,
    log_curriculum_decision,
    normalise,
    notify_staff_assignment_change,
    parse_notes_id_list,
    persist_group_authoring_detail,
    require_fields,
    resolve_cohort_row,
    restore_soft_delete_payload,
    safe_authoring_module_rows,
    unique_group_id,
    update_authoring_rows,
    update_group_fields,
):
    """Create a group directly in ``curriculum.groups`` (normalized only).

    The parent cohort is resolved from ``curriculum.cohorts`` and the new group
    inherits the cohort's stored canonical programme_id/cohort_id. The cohort's
    ``group_ids`` array is updated to include the new group.
    """
    missing = require_fields(payload, ['name', 'cohortId'])
    if missing:
        log_curriculum_decision('group.create', outcome='rejected', reason='missing-fields')
        return json_error('Missing required fields.', fields=missing)
    cohort_row = resolve_cohort_row(payload.get('cohortId'))
    if not cohort_row:
        log_curriculum_decision(
            'group.create', outcome='rejected', reason='parent-cohort-not-found',
            parent_id=payload.get('cohortId'),
        )
        return json_error(
            f'Parent cohort not found: {clean_str(payload.get("cohortId")) or "(blank)"}.',
            status=404,
        )

    cohort_id = clean_str(cohort_row.get('cohort_id'))
    cohort_name = clean_str(cohort_row.get('cohort_name'))
    programme_id = clean_str(cohort_row.get('programme_id'))
    programme = clean_str(cohort_row.get('programme_name'))
    group_name = clean_str(payload.get('name'))
    group_id = unique_group_id(payload.get('id') or payload.get('groupId') or payload.get('group_id'))
    requested_week_day = clean_str(payload.get('weekDays') or payload.get('deliveryDays') or payload.get('sessionWeekDay') or payload.get('session_week_day'))
    requested_start_time = clean_str(payload.get('startTime') or payload.get('start_time') or payload.get('sessionStartTime') or payload.get('session_start_time'))
    requested_end_time = clean_str(payload.get('endTime') or payload.get('end_time') or payload.get('sessionEndTime') or payload.get('session_end_time'))

    # Archiving a group soft-deletes its row rather than removing it, so the
    # archived group is still in group_authoring_detail_rows(). Only a surviving
    # row counts as a duplicate: matching the tombstone used to turn "create the
    # same group again" into an update of the archived row, which is why the
    # group never reappeared in the list.
    archived_group_ids = archived_authoring_ids(GROUPS_TABLE, 'group_id')
    if clean_str(group_id) in archived_group_ids:
        # An explicit id naming an archived group is the caller asserting that
        # identity, so bring the row back rather than writing into the tombstone
        # or forking a second row under a minted id.
        update_authoring_rows(
            GROUPS_TABLE, 'group_id = %s', [clean_str(group_id)], restore_soft_delete_payload(GROUPS_TABLE),
        )
        archived_group_ids.discard(clean_str(group_id))
        log_curriculum_decision(
            'group.create', outcome='revived_archived', entity_id=group_id,
            parent_id=cohort_id, reason='explicit-id-names-archived-row',
        )

    duplicate = next((
        detail for detail in group_authoring_detail_rows()
        if clean_str(detail.get('id')) not in archived_group_ids
        and (
            clean_str(detail.get('id')) == clean_str(group_id)
            or (
                clean_str(detail.get('cohortId')) == cohort_id
                and normalise(detail.get('name')) == normalise(group_name)
            )
        )
    ), None)
    if duplicate:
        existing_id = clean_str(duplicate.get('id')) or group_id
        updates = {
            'group_name': group_name,
            'cohort_id': cohort_id,
            'programme_id': programme_id,
            'coach_name': canonical_group_coaches(payload.get('coach')) if 'coach' in payload else clean_str(duplicate.get('coach')),
            'session_week_day': requested_week_day if any(key in payload for key in ('weekDays', 'deliveryDays', 'sessionWeekDay', 'session_week_day')) else clean_str(duplicate.get('weekDays') or duplicate.get('session_week_day')),
            'session_start_time': requested_start_time if any(key in payload for key in ('startTime', 'start_time', 'sessionStartTime', 'session_start_time')) else clean_str(duplicate.get('startTime') or duplicate.get('session_start_time')),
            'session_end_time': requested_end_time if any(key in payload for key in ('endTime', 'end_time', 'sessionEndTime', 'session_end_time')) else clean_str(duplicate.get('endTime') or duplicate.get('session_end_time')),
            'color': clean_str(payload.get('color')) if 'color' in payload else clean_str(duplicate.get('color')),
            'status': clean_str(duplicate.get('status')) or 'planned',
        }
        log_curriculum_decision(
            'group.create', outcome='matched_existing', entity_id=existing_id,
            parent_id=cohort_id, matched_id=existing_id,
            reason='live-namesake-in-same-cohort' if existing_id != clean_str(group_id) else 'same-id',
        )
        update_group_fields(existing_id, updates)
        module_assignment_ids = [
            clean_str(row.get('module_catalogue_id'))
            for row in safe_authoring_module_rows()
            if clean_str(row.get('group_id')) == existing_id and row.get('module_catalogue_id')
        ]
        notify_staff_assignment_change()
        invalidate_curriculum_cache()
        return JsonResponse({'created': False, 'group': curriculum_group_from_authoring_detail({
            'id': existing_id,
            'name': group_name,
            'cohortId': cohort_id,
            'cohort': cohort_name,
            'programmeId': programme_id,
            'programme': programme,
            'coach': updates['coach_name'],
            'tutor': duplicate.get('tutor') or 'Unassigned',
            'weekDays': updates['session_week_day'],
            'startTime': updates['session_start_time'],
            'endTime': updates['session_end_time'],
            'schedule': build_group_schedule(updates['session_week_day'], updates['session_start_time'], updates['session_end_time']),
            'color': updates.get('color') or '',
            'status': updates['status'],
            'modules': parse_notes_id_list(duplicate.get('modules') or duplicate.get('moduleNames')),
        })})

    group = {
        'id': group_id,
        'name': group_name,
        'cohortId': cohort_id,
        'cohort': cohort_name,
        'programmeId': programme_id,
        'programme': programme,
        'coach': canonical_group_coaches(payload.get('coach')),
        'weekDays': requested_week_day,
        'startTime': requested_start_time,
        'endTime': requested_end_time,
        'color': payload.get('color') or '',
        'status': 'planned',
        'modules': [payload.get('moduleName')] if clean_str(payload.get('moduleName')) else [],
    }
    # Confirmed before reporting success, and before the cohort is told to point
    # at the group. See create_curriculum_cohort: a swallowed write here would
    # otherwise leave the cohort's group_ids naming a group that does not exist.
    try:
        persist_group_authoring_detail(
            group, [], safe_authoring_module_rows(),
            {'source_type': 'module_authoring', 'source_id': group_id},
            raise_on_error=True,
        )
    except (Exception, AssertionError) as exc:
        log_curriculum_decision(
            'group.create', outcome='failed', entity_id=group_id,
            parent_id=cohort_id, reason='write-failed',
        )
        invalidate_curriculum_cache()
        return json_error(f'The group could not be stored: {exc}', status=500)
    if not fetch_group_row(group_id):
        log_curriculum_decision(
            'group.create', outcome='failed', entity_id=group_id,
            parent_id=cohort_id, reason='row-not-stored',
        )
        invalidate_curriculum_cache()
        return json_error('The group could not be stored. Nothing was saved.', status=500)
    # Logged once the row is confirmed, for the reason given in the cohort create.
    log_curriculum_decision(
        'group.create', outcome='created', entity_id=group_id, parent_id=cohort_id,
        # Says out loud that an archived namesake was correctly stepped over,
        # which is the branch that used to silently swallow the create.
        reason='archived-namesake-ignored' if archived_group_ids else '',
    )
    notify_staff_assignment_change()
    invalidate_curriculum_cache()
    return JsonResponse({'created': True, 'group': curriculum_group_from_authoring_detail({
        'id': group_id,
        'name': group_name,
        'cohortId': cohort_id,
        'cohort': cohort_name,
        'programmeId': programme_id,
        'programme': programme,
        'coach': group['coach'],
        'tutor': 'Unassigned',
        'weekDays': group['weekDays'],
        'startTime': group['startTime'],
        'endTime': group['endTime'],
        'schedule': build_group_schedule(group['weekDays'], group['startTime'], group['endTime']),
        'color': group['color'],
        'status': group['status'],
        'modules': group['modules'],
    })}, status=201)


def curriculum_group_collection(request, *, create_curriculum_group, curriculum_groups, json_body, json_error, with_group_coaches):
    if request.method == 'GET':
        return curriculum_groups(request)
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)
    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')
    return create_curriculum_group(with_group_coaches(payload))


def curriculum_cohort_group_collection(request, cohort_id, *, create_curriculum_group, json_body, json_error, with_group_coaches):
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)

    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')
    payload['cohortId'] = cohort_id
    return create_curriculum_group(with_group_coaches(payload))


def curriculum_group_detail(
    request,
    identifier,
    *,
    AUTHORING_MODULES_TABLE,
    GROUPS_TABLE,
    JsonResponse,
    authoring_fetch_all,
    authoring_soft_delete,
    canonical_group_coaches,
    canonical_programme_id,
    canonical_staff_assignment_name,
    clean_str,
    curriculum_name_only_patch,
    datetime,
    group_conflict_record,
    group_record_revision,
    group_tutor_assignment_conflict,
    group_tutor_assignment_delivery_day_error,
    invalidate_curriculum_cache,
    json_body,
    json_db_value,
    json_error,
    lock_record_row,
    log_curriculum_decision,
    notify_staff_assignment_change,
    permanent_group_delete_response,
    persist_group_module_session_dates,
    propagate_group_name_to_learners,
    record_conflict_response,
    repair_curriculum_parent_links,
    request_wants_permanent_delete,
    requested_expected_revision,
    resolve_cohort_row,
    resolve_group_row,
    resync_group_module_delivery_counts,
    safe_authoring_module_rows,
    stale_teams_calendar_modules,
    transaction,
    tutor_conflict_error,
    tutor_conflict_override_requested,
    unassign_authoring_modules_from_group,
    update_authoring_rows,
    update_group_fields,
    with_group_coaches,
):
    if request.method not in {'PATCH', 'DELETE'}:
        return json_error('Method not allowed.', status=405)

    # Resolve the group by its stored canonical id in curriculum.groups. Updates
    # target this row in place, preserving group_id, cohort_id, programme_id,
    # module relationships, status and any staff assignment not being explicitly
    # changed.
    group_row = resolve_group_row(identifier)
    if not group_row:
        log_curriculum_decision(
            f'group.{request.method.lower()}', outcome='rejected',
            reason='not-found', entity_id=identifier,
        )
        return json_error('Group not found.', status=404)
    group_id = clean_str(group_row.get('group_id'))

    if request.method == 'DELETE':
        # Same two operations behind one verb as the cohort above: archive by
        # default, remove for good only when the caller asks and the group is
        # already archived.
        if request_wants_permanent_delete(request):
            log_curriculum_decision(
                'group.delete', outcome='permanent_requested', entity_id=group_id,
            )
            return permanent_group_delete_response(group_row)

        cohort_id = clean_str(group_row.get('cohort_id'))
        unassign_authoring_modules_from_group(group_id)
        authoring_soft_delete(GROUPS_TABLE, 'group_id = %s', [group_id], deleted_by='group-delete')
        log_curriculum_decision(
            'group.archive', outcome='soft_deleted', entity_id=group_id, parent_id=cohort_id,
        )
        invalidate_curriculum_cache()
        return JsonResponse({'deleted': True, 'permanent': False, 'id': group_id})

    payload = with_group_coaches(json_body(request))
    if payload is None:
        return json_error('Invalid JSON body.')

    previous_coach = clean_str(group_row.get('coach_name'))
    stored_coach = clean_str(group_row.get('coach_name'))

    # Checked before the first write: a group tutor is pushed onto every module
    # in the group further down, and the group's own fields are updated before
    # that happens, so refusing later would leave a half-applied PATCH.
    if 'tutor' in payload:
        delivery_day_error = group_tutor_assignment_delivery_day_error(
            group_id,
            canonical_staff_assignment_name('tutor', payload.get('tutor')),
            next_week_day=payload.get('weekDays') or payload.get('deliveryDays')
            or payload.get('sessionWeekDay') or payload.get('session_week_day'),
        )
        if delivery_day_error:
            log_curriculum_decision(
                'group.patch', outcome='rejected', reason='missing-delivery-day', entity_id=group_id,
            )
            return delivery_day_error
    if 'tutor' in payload and not tutor_conflict_override_requested(payload):
        candidate, conflicts = group_tutor_assignment_conflict(
            group_id,
            canonical_staff_assignment_name('tutor', payload.get('tutor')),
        )
        if conflicts:
            log_curriculum_decision(
                'group.patch', outcome='rejected', reason='tutor-conflict', entity_id=group_id,
            )
            return tutor_conflict_error(candidate, conflicts)

    updates = {}
    if 'name' in payload and clean_str(payload.get('name')):
        updates['group_name'] = clean_str(payload.get('name'))
    if 'coach' in payload:
        updates['coach_name'] = canonical_group_coaches(payload.get('coach'))
    if any(key in payload for key in ('weekDays', 'deliveryDays', 'sessionWeekDay', 'session_week_day')):
        updates['session_week_day'] = clean_str(payload.get('weekDays') or payload.get('deliveryDays') or payload.get('sessionWeekDay') or payload.get('session_week_day'))
    if any(key in payload for key in ('startTime', 'start_time', 'sessionStartTime', 'session_start_time')):
        updates['session_start_time'] = clean_str(payload.get('startTime') or payload.get('start_time') or payload.get('sessionStartTime') or payload.get('session_start_time'))
    if any(key in payload for key in ('endTime', 'end_time', 'sessionEndTime', 'session_end_time')):
        updates['session_end_time'] = clean_str(payload.get('endTime') or payload.get('end_time') or payload.get('sessionEndTime') or payload.get('session_end_time'))
    if 'color' in payload:
        updates['color'] = clean_str(payload.get('color'))
    if 'status' in payload and clean_str(payload.get('status')):
        updates['status'] = clean_str(payload.get('status'))
    previous_cohort_id = clean_str(group_row.get('cohort_id'))
    target_cohort = None
    # Parent reassignment only on explicit, resolvable input.
    if clean_str(payload.get('cohortId') or payload.get('cohort_id')):
        target_cohort = resolve_cohort_row(payload.get('cohortId') or payload.get('cohort_id'))
        if target_cohort:
            updates['cohort_id'] = clean_str(target_cohort.get('cohort_id'))
            updates['cohort_name'] = clean_str(target_cohort.get('cohort_name'))
            updates['programme_id'] = clean_str(target_cohort.get('programme_id'))
            updates['programme_name'] = clean_str(target_cohort.get('programme_name'))
    explicit_programme_id = clean_str(payload.get('programmeId') or payload.get('programme_id'))
    if explicit_programme_id and 'programme_id' not in updates:
        resolved = canonical_programme_id(explicit_programme_id, clean_str(payload.get('programme')))
        if resolved:
            updates['programme_id'] = resolved
            if clean_str(payload.get('programme')):
                updates['programme_name'] = clean_str(payload.get('programme'))

    # Optimistic concurrency, opt-in, as on the module structure PATCH. The
    # check sits inside the transaction that already wraps this save, and takes
    # the row lock before the first write -- see lock_record_row. Placing it any
    # later would leave a half-applied PATCH, which is the same reason the tutor
    # conflict above is checked before anything is written.
    expected_revision = requested_expected_revision(request, payload)
    with transaction.atomic():
        if expected_revision:
            lock_record_row(GROUPS_TABLE, 'group_id = %s', [group_id])
            current_revision = group_record_revision(group_id)
            if current_revision != expected_revision:
                return record_conflict_response(
                    expected_revision, current_revision, group=group_conflict_record(group_id),
                )
        updated_group = update_group_fields(group_id, updates) or group_row
        if 'group_name' in updates:
            # Inside this save's transaction, from the row as it was before it.
            propagate_group_name_to_learners(group_row, updates['group_name'])
        module_delivery_updates = {
            key: updates[key]
            for key in ('session_week_day', 'session_start_time', 'session_end_time')
            if key in updates
        }
        # Read before the write: the session count is re-derived from the week
        # count these rows carried under the *old* delivery pattern.
        previous_module_rows = (
            authoring_fetch_all(AUTHORING_MODULES_TABLE, "group_id = %s and coalesce(schedule_mode, 'group') <> 'custom'", [group_id])
            if module_delivery_updates else []
        )
        if module_delivery_updates:
            module_delivery_updates['weekly_schedule'] = json_db_value([])
            module_delivery_updates['updated_at'] = datetime.utcnow()
            # Module rows are the source used to derive the session calendar.
            # They inherit the group's slot when attached, so a later group edit
            # must move those inherited copies too or the calendar stays on the
            # day/time chosen when the group was first created.
            update_authoring_rows(
                AUTHORING_MODULES_TABLE,
                "group_id = %s and coalesce(schedule_mode, 'group') <> 'custom'",
                [group_id],
                module_delivery_updates,
            )
            # Adding a delivery day adds sessions -- it does not compress the
            # module into fewer weeks -- so the count derived from the old day
            # list has to be re-derived before anything reads the calendar off
            # these rows.
            if 'session_week_day' in module_delivery_updates:
                resync_group_module_delivery_counts(previous_module_rows, {
                    'session_week_day': module_delivery_updates['session_week_day'],
                })
            # The module row now owns the new plan, but learner delivery reads
            # each component's concrete date.  Persist the planner's answer for
            # unbooked sessions now; confirmed Teams occurrences are left for
            # the explicit calendar-update flow advertised in this response.
            persist_group_module_session_dates(
                authoring_fetch_all(AUTHORING_MODULES_TABLE, "group_id = %s and coalesce(schedule_mode, 'group') <> 'custom'", [group_id]),
                updated_group,
            )
        next_cohort_id = clean_str(updated_group.get('cohort_id'))
        if next_cohort_id and next_cohort_id != previous_cohort_id:
            for module in authoring_fetch_all(AUTHORING_MODULES_TABLE, 'group_id = %s', [group_id]):
                update_authoring_rows(AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s', [module.get('module_catalogue_id')], {
                    'cohort_id': next_cohort_id,
                    'programme_id': clean_str(updated_group.get('programme_id')),
                })
        if not curriculum_name_only_patch(payload):
            repair_curriculum_parent_links(clean_str(updated_group.get('programme_id')))

    if 'coach' in payload or 'tutor' in payload:
        next_group_id = clean_str(updated_group.get('group_id')) or group_id
        module_assignment_ids = [
            clean_str(row.get('module_catalogue_id'))
            for row in safe_authoring_module_rows()
            if clean_str(row.get('group_id')) == next_group_id and row.get('module_catalogue_id')
        ]
        next_tutor = canonical_staff_assignment_name('tutor', payload.get('tutor')) if 'tutor' in payload else ''
        if next_tutor or 'tutor' in payload:
            for module_id in module_assignment_ids:
                update_authoring_rows(AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s', [module_id], {
                    'tutor_name': next_tutor or None,
                    'updated_at': datetime.utcnow(),
                })
        notify_staff_assignment_change()
    log_curriculum_decision(
        'group.patch', outcome='updated', entity_id=group_id,
        parent_id=clean_str(updated_group.get('cohort_id')),
        # The columns that changed, never their values: a column list is enough
        # to see what a request touched without logging anyone's name.
        reason=','.join(sorted(updates)) or 'no-columns',
    )
    invalidate_curriculum_cache()
    # The slot moved, so every Teams calendar under this group is now on the old
    # days. Named back to the caller so the drawer that made the change can send
    # the reader to update them rather than leaving it to be discovered.
    return JsonResponse({
        'updated': True,
        'id': group_id,
        # Read after the commit, so the token handed back is the one a reader
        # would fingerprint now rather than one a rollback could take away.
        'revision': group_record_revision(group_id),
        'teamsCalendarsToUpdate': stale_teams_calendar_modules([
            clean_str(row.get('module_catalogue_id')) for row in previous_module_rows
        ]) if module_delivery_updates else [],
    })


def curriculum_group_restore(
    request,
    identifier,
    *,
    ARCHIVE_MODULE_REATTACH_NOTE,
    GROUPS_TABLE,
    JsonResponse,
    RESTORE_NULLABLE_COLUMNS,
    clean_str,
    curriculum_row_is_archived,
    fetch_cohort_row,
    fetch_group_row,
    invalidate_curriculum_cache,
    json_error,
    log_curriculum_decision,
    resolve_group_row,
    restore_soft_delete_payload,
    transaction,
    update_rows,
):
    """Take a group back out of the archive and back onto its cohort."""
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)

    group_row = fetch_group_row(identifier) or resolve_group_row(identifier)
    if not group_row:
        log_curriculum_decision('group.restore', outcome='rejected', reason='not-found', entity_id=identifier)
        return json_error('Group not found.', status=404)
    group_id = clean_str(group_row.get('group_id'))
    if not curriculum_row_is_archived(group_row):
        return json_error(
            'Group is not archived.', status=409,
            reason='group-not-archived', restored=False, id=group_id,
        )

    cohort_id = clean_str(group_row.get('cohort_id'))
    cohort_row = fetch_cohort_row(cohort_id) if cohort_id else None
    if cohort_id and (not cohort_row or curriculum_row_is_archived(cohort_row)):
        name = clean_str(group_row.get('cohort_name')) or 'The cohort'
        return json_error(
            f'{name} is archived, so this group has no cohort to come back to. Restore the cohort '
            'first - it brings back the groups archived with it.',
            status=409, reason='cohort-archived', restored=False, id=group_id,
        )

    with transaction.atomic():
        payload = restore_soft_delete_payload(GROUPS_TABLE)
        update_rows(
            GROUPS_TABLE, 'group_id = %s', [group_id], payload,
            allow_null_columns=RESTORE_NULLABLE_COLUMNS,
        )
    invalidate_curriculum_cache()
    log_curriculum_decision('group.restore', outcome='restored', entity_id=group_id, parent_id=cohort_id)
    return JsonResponse({
        'restored': True,
        'id': group_id,
        'message': f'Group restored. {ARCHIVE_MODULE_REATTACH_NOTE}',
    })


def permanent_group_delete_response(
    group_row,
    *,
    DatabaseError,
    GROUPS_TABLE,
    IntegrityError,
    JsonResponse,
    archived_group_learners,
    clean_str,
    curriculum_row_is_archived,
    delete_rows,
    invalidate_curriculum_cache,
    json_error,
    log_curriculum_decision,
    logger,
    permanent_delete_reference_refusal,
    transaction,
    unassign_authoring_modules_from_group,
):
    """HTTP outcome of a permanent group delete. Module content is kept."""
    group_id = clean_str(group_row.get('group_id'))
    if not curriculum_row_is_archived(group_row):
        return json_error(
            'Archive the group before deleting it permanently.',
            status=409, reason='group-not-archived', deleted=False, permanent=False, id=group_id,
        )

    learners = archived_group_learners(group_row)
    if learners:
        return json_error(
            f'{learners} active learner{"" if learners == 1 else "s"} are still placed in this group, '
            'so it cannot be deleted permanently. Move them to another group first.',
            status=409, reason='group-has-learner-delivery', deleted=False, permanent=False,
            id=group_id, blockers={'learners': learners},
        )

    blocked = permanent_delete_reference_refusal('group', group_id)
    if blocked is not None:
        return blocked

    cohort_id = clean_str(group_row.get('cohort_id'))
    try:
        with transaction.atomic():
            unassign_authoring_modules_from_group(group_id)
            removed = {'groups': len(delete_rows(GROUPS_TABLE, 'group_id = %s', [group_id]))}
    except (IntegrityError, DatabaseError) as exc:
        logger.warning('Permanent delete of group %s was refused: %s', group_id, exc)
        return json_error(
            'The database refused the permanent delete because other rows still reference this group.',
            status=409, reason='group-delete-restricted', deleted=False, permanent=False,
            id=group_id, detail=clean_str(str(exc)),
        )

    invalidate_curriculum_cache()
    log_curriculum_decision(
        'group.delete', outcome='permanent', entity_id=group_id, parent_id=cohort_id,
        reason=','.join(f'{table}:{count}' for table, count in sorted(removed.items())),
    )
    return JsonResponse({
        'deleted': True,
        'permanent': True,
        'id': group_id,
        'removed': removed,
        'message': 'Group was removed from the database. Module content was kept.',
    })


def curriculum_group_modules(
    request,
    identifier,
    *,
    JsonResponse,
    ModuleAuthoringValidationError,
    StaleModuleStructureWrite,
    TutorAssignmentDeliveryDayError,
    TutorScheduleConflictError,
    attachment_session_count,
    attachment_week_structure,
    clean_str,
    contentful_catalogue_id_for_attachment,
    curriculum_cohort_from_authoring_detail,
    curriculum_collection_response,
    curriculum_group_from_authoring_detail,
    get_cached_payload,
    invalidate_curriculum_cache,
    is_canonical_module_catalogue_id,
    json_body,
    json_error,
    locked_attachment_structure,
    matches_curriculum_identifier,
    module_attachment_authoring_payload,
    module_belongs_to_group,
    module_calendar_end_date,
    module_cohort_date_error,
    module_schedule_assignment_changed,
    module_schedule_view,
    module_week_starts_on,
    module_weekly_schedule,
    normalise,
    notify_staff_assignment_change,
    parse_int,
    repair_curriculum_parent_links,
    resolve_cohort_row,
    resolve_group_row,
    safe_authoring_module_rows,
    save_module_authoring_structure,
    schedule_day_part,
    serialize_cohort_authoring_detail,
    serialize_group_authoring_detail,
    transaction,
    tutor_assignment_delivery_day_error,
    tutor_conflict_override_requested,
    tutor_schedule_conflicts_created,
    unassign_authoring_modules_from_group,
    unique_module_catalogue_id,
):
    if request.method == 'GET':
        from .module_reads import curriculum_group_modules_get
        return curriculum_group_modules_get(
            request, identifier,
            get_cached_payload=get_cached_payload,
            matches_curriculum_identifier=matches_curriculum_identifier,
            module_belongs_to_group=module_belongs_to_group,
            curriculum_collection_response=curriculum_collection_response,
            json_error=json_error,
        )

    if request.method not in {'POST', 'PATCH'}:
        return json_error('Method not allowed.', status=405)

    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')

    modules = payload.get('modules') if isinstance(payload.get('modules'), list) else [payload]
    if not isinstance(modules, list):
        return json_error('At least one module is required.', fields=['modules'])
    for item in modules:
        if not isinstance(item, dict):
            return json_error('Each module attachment must be an object.', status=400)
        try:
            module_week_starts_on(item)
            if module_week_boundary_mode(item) and not module_week_starts_on(item):
                raise ValueError('Choose the first day of the study week.')
            if module_week_boundary_mode(item) and parse_int(item.get('weeksNumber') or item.get('weeks'), 0) > 104:
                raise ValueError('Choose between 1 and 104 study weeks.')
        except ValueError as exc:
            return json_error(str(exc), fields=['weekStartsOn'])
        try:
            module_weekly_schedule(item)
        except ValueError as exc:
            return json_error(str(exc), fields=['weeklySchedule'])

    # Resolve group and parent cohort from the normalized tables only.
    group_row = resolve_group_row(identifier)
    if not group_row:
        return json_error('Group not found.', status=404)
    group = curriculum_group_from_authoring_detail(serialize_group_authoring_detail(group_row))
    cohort_row = resolve_cohort_row(group_row.get('cohort_id'))
    cohort = curriculum_cohort_from_authoring_detail(serialize_cohort_authoring_detail(cohort_row)) if cohort_row else None
    if not cohort:
        return json_error('Parent cohort not found.', status=404)

    # Existing module attachments for this group come from curriculum.modules.
    existing_rows = [row for row in safe_authoring_module_rows() if clean_str(row.get('group_id')) == clean_str(group_row.get('group_id'))]
    existing_names = {normalise(row.get('title')) for row in existing_rows if row.get('title')}
    existing_catalogue_ids = {clean_str(row.get('module_catalogue_id')) for row in existing_rows if row.get('module_catalogue_id')}
    created_rows = []
    skipped = []
    allow_tutor_conflict = tutor_conflict_override_requested(payload)
    # Read once for the whole request; each attachment is compared against the
    # same snapshot plus the attachments accepted before it.
    stored_module_rows = safe_authoring_module_rows()
    pending_candidates = []

    try:
        with transaction.atomic():
            created_modules = []
            updated_modules = []
            saved_catalogue_ids = set()
            for item in modules:
                if not isinstance(item, dict):
                    return json_error('Each module attachment must be an object.', status=400)
                module_name = clean_str(item.get('moduleName') or item.get('name'))
                if not module_name:
                    return json_error('Module name is required for each attachment.', fields=['moduleName'])
                explicit_catalogue_value = clean_str(item.get('moduleCatalogueId'))
                if explicit_catalogue_value and not is_canonical_module_catalogue_id(explicit_catalogue_value):
                    return json_error('moduleCatalogueId must be a valid MOD-... canonical module ID.', fields=['moduleCatalogueId'])
                requested_value = clean_str(explicit_catalogue_value or item.get('catalogueId') or item.get('moduleId'))
                requested_catalogue_id = requested_value if is_canonical_module_catalogue_id(requested_value) else ''

                try:
                    weekly = module_weekly_schedule(item)
                except ValueError as exc:
                    return json_error(str(exc), fields=['weeklySchedule'])
                start_date = item.get('startDate') or cohort.get('startDate')
                start_error = module_cohort_date_error(module_name, start_date, None, cohort)
                if start_error:
                    return json_error(start_error[0], fields=[start_error[1]], status=400)

                delivery_days = ', '.join(slot['day'] for slot in weekly) or item.get('weekDays') or group.get('weekDays') or group.get('schedule')
                session_count = attachment_session_count(item)
                item_weeks = parse_int(item.get('weeksNumber') or item.get('weeks'), 0)
                end_date = item.get('endDate') or module_calendar_end_date(start_date, item_weeks, item) or cohort.get('endDate')
                # Checked after the plan is generated, so a start date that sits
                # inside the cohort but whose sessions run past its end is caught
                # too -- whether the end date was sent or calculated here.
                end_error = module_cohort_date_error(module_name, start_date, end_date, cohort)
                if end_error:
                    return json_error(end_error[0], fields=[end_error[1]], status=400)
                catalogue_id = contentful_catalogue_id_for_attachment(
                    item,
                    group,
                    cohort,
                    module_name,
                    requested_catalogue_id,
                ) or unique_module_catalogue_id(item.get('catalogueId') or item.get('moduleId') or module_name)
                current_structure = locked_attachment_structure(item, catalogue_id)
                is_duplicate = (
                    bool(requested_catalogue_id and requested_catalogue_id in existing_catalogue_ids)
                    or bool(not requested_catalogue_id and normalise(module_name) in existing_names)
                )
                # An attachment that carries authored weeks must persist them here and
                # now; module_attachment_authoring_payload otherwise falls back to the
                # stored structure and the new content would need a manual Save.
                structure_payload = module_attachment_authoring_payload(
                    item,
                    group,
                    cohort,
                    catalogue_id,
                    module_name,
                    session_count,
                    start_date,
                    end_date,
                    current_structure,
                )
                # Checked against what this save is about to produce, not against
                # what is stored: `pending_candidates` carries the attachments
                # already accepted in this request, so two new modules that clash
                # with each other are caught as well as one that clashes with an
                # existing booking. An attachment is appended either way -- a later
                # one still has to be compared against it.
                candidate = module_schedule_view(structure_payload)
                # The group's own delivery day is what dates these modules -- a
                # day sent for the module alone is the copy that has no effect --
                # so a tutor cannot be put against one until the group has it.
                if not clean_str(group.get('weekDays') or group.get('deliveryDays') or schedule_day_part(group.get('schedule'))):
                    delivery_day_error = tutor_assignment_delivery_day_error(
                        candidate, before=module_schedule_view(current_structure or {}),
                    )
                    if delivery_day_error:
                        raise TutorAssignmentDeliveryDayError(delivery_day_error)
                if not allow_tutor_conflict and module_schedule_assignment_changed(
                    module_schedule_view(current_structure or {}), candidate
                ):
                    conflicts = tutor_schedule_conflicts_created(
                        module_schedule_view(current_structure or {}),
                        candidate,
                        module_rows=stored_module_rows,
                        exclude_catalogue_ids=[catalogue_id],
                        pending=pending_candidates,
                    )
                    if conflicts:
                        raise TutorScheduleConflictError(candidate, conflicts)
                pending_candidates.append(candidate)
                saved = save_module_authoring_structure(catalogue_id, structure_payload)
                notify_staff_assignment_change()
                saved_catalogue_ids.add(catalogue_id)
                if is_duplicate:
                    skipped.append(module_name)
                    updated_modules.append(saved)
                else:
                    created_modules.append(saved)
                existing_names.add(normalise(module_name))
                existing_catalogue_ids.add(catalogue_id)

            # PATCH from the structure wizard represents the group's complete
            # module list, so omitted modules should be unassigned. POST is an
            # append-style endpoint used by createGroupModule(); it must not detach
            # existing modules that were not included in the request.
            removed_module_ids = (
                unassign_authoring_modules_from_group(group_row.get('group_id'), saved_catalogue_ids)
                if request.method == 'PATCH'
                else []
            )
            repair_curriculum_parent_links(clean_str(group.get('programmeId') or group.get('programme_id')))
            invalidate_curriculum_cache()
            return JsonResponse({
                'updated': True,
                'groupId': identifier,
                'created': created_modules,
                'updatedModules': updated_modules,
                'removedModuleIds': removed_module_ids,
                'skippedDuplicates': skipped,
            })
    except ModuleAuthoringValidationError as exc:
        return json_error(
            str(exc),
            fields=list(dict.fromkeys(error['path'] for error in exc.errors)),
            validationErrors=exc.errors,
        )
    except (TutorScheduleConflictError, TutorAssignmentDeliveryDayError, StaleModuleStructureWrite) as exc:
        # Raised mid-loop, so the attachments already written in this
        # request roll back with it and the group is left as it was.
        return exc.as_response()
