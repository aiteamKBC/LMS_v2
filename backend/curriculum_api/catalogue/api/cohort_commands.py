"""Cohort create, patch, archive, restore and permanent-delete HTTP contracts.

Named capabilities are supplied by the existing composition seam during migration.
No legacy module, provider or settings object is imported here.
"""


def create_curriculum_cohort(
    payload,
    *,
    COHORT_AUTHORING_DETAILS_TABLE,
    JsonResponse,
    apprenticeship_end_override_sent,
    archived_authoring_ids,
    canonical_programme_id,
    clean_str,
    cohort_apprenticeship_end_date,
    cohort_authoring_detail_rows,
    cohort_practical_end_date,
    curriculum_cohort_from_authoring_detail,
    fetch_cohort_row,
    format_date,
    get_holiday_rows,
    invalidate_curriculum_cache,
    json_db_value,
    json_error,
    log_curriculum_decision,
    normalise,
    parse_epa_months,
    parse_int,
    parse_notes_id_list,
    payload_apprenticeship_end_override,
    payload_epa_months,
    persist_cohort_authoring_detail,
    policy_write,
    require_fields,
    restore_soft_delete_payload,
    title_case_status,
    unique_cohort_id,
    update_authoring_rows,
    update_cohort_fields,
):
    """Create a cohort directly in ``curriculum.cohorts`` (normalized only)."""
    calendar_update = {}
    if 'calendarPolicy' in payload:
        try:
            calendar_update = policy_write(payload, None, COHORT_AUTHORING_DETAILS_TABLE)
        except ValueError as exc:
            return json_error(str(exc), fields=['calendarPolicy'])
    missing = require_fields(payload, ['name', 'programme'])
    if missing:
        log_curriculum_decision('cohort.create', outcome='rejected', reason='missing-fields')
        return json_error('Missing required fields.', fields=missing)
    programme = clean_str(payload.get('programme'))
    programme_id = canonical_programme_id(
        payload.get('programmeId') or payload.get('programme_id') or payload.get('programId') or payload.get('program_id'),
        programme,
    )
    name = clean_str(payload.get('name'))
    cohort_id = unique_cohort_id(payload.get('id') or payload.get('cohortId') or payload.get('cohort_id'))
    duration_months = payload.get('durationMonths') or 24
    # Same rule as the editor's preview: cohort contract dates are fixed.
    # Applied holidays are stored for module session planning, not folded into
    # the cohort practical end date.
    end_date = payload.get('endDate') or format_date(cohort_practical_end_date(
        payload.get('startDate'),
        duration_months,
        payload.get('holidayIds') or payload.get('holiday_ids'),
        payload.get('holidays') or payload.get('holidayDetails'),
    ))
    epa_months = payload_epa_months(payload)
    apprenticeship_end_override = format_date(payload_apprenticeship_end_override(payload))
    apprenticeship_end_date = format_date(
        cohort_apprenticeship_end_date(end_date, epa_months, apprenticeship_end_override)
    )
    holiday_ids = parse_notes_id_list(payload.get('holidayIds') or payload.get('holiday_ids'))
    # The holidays unticked in the cohort drawer -- explicit key presence, not
    # ``or``, so an explicit empty list (nothing excluded, i.e. select all) is
    # never confused with the key simply being absent from an older caller.
    excluded_holiday_ids_sent = 'excludedHolidayIds' in payload or 'excluded_holiday_ids' in payload
    excluded_holiday_ids = parse_notes_id_list(
        payload.get('excludedHolidayIds') if 'excludedHolidayIds' in payload else payload.get('excluded_holiday_ids')
    ) if excluded_holiday_ids_sent else []

    # A cohort with the same canonical id, or the same name within the same
    # programme, is treated as the same cohort. Rather than failing the save,
    # update it in place and report created=False — mirroring the idempotent
    # programme create handler. This keeps wizard re-saves and retries safe:
    # a POST that repeats an already-persisted cohort (e.g. because the freshly
    # minted id was not written back into the client draft) updates the stored
    # row instead of forking a duplicate or dying with a user-facing 409.
    # An archived cohort is a soft-deleted row, not a missing one. It must not
    # answer the duplicate question, or recreating a cohort under a name that
    # was archived earlier would silently update the tombstone. Same rule, and
    # same reason, as create_curriculum_group.
    archived_cohort_ids = archived_authoring_ids(COHORT_AUTHORING_DETAILS_TABLE, 'cohort_id')
    if clean_str(cohort_id) in archived_cohort_ids:
        update_authoring_rows(
            COHORT_AUTHORING_DETAILS_TABLE,
            'cohort_id = %s',
            [clean_str(cohort_id)],
            restore_soft_delete_payload(COHORT_AUTHORING_DETAILS_TABLE),
        )
        archived_cohort_ids.discard(clean_str(cohort_id))
        log_curriculum_decision(
            'cohort.create', outcome='revived_archived', entity_id=cohort_id,
            parent_id=programme_id, reason='explicit-id-names-archived-row',
        )

    duplicate = next((
        detail for detail in cohort_authoring_detail_rows()
        if clean_str(detail.get('cohortId')) not in archived_cohort_ids
        and (
            clean_str(detail.get('cohortId')) == clean_str(cohort_id)
            or (
                normalise(detail.get('programmeId') or detail.get('programmeName')) in {normalise(programme_id), normalise(programme)}
                and normalise(detail.get('cohortName')) == normalise(name)
            )
        )
    ), None)
    if duplicate:
        existing_id = clean_str(duplicate.get('cohortId')) or cohort_id
        updates = {
            'cohort_name': name,
            'programme_id': programme_id or None,
            'start_date': payload.get('startDate') or None,
            'end_date': end_date or None,
            'duration_months': parse_int(duration_months, duplicate.get('durationMonths') or 0),
            'epa_months': epa_months if epa_months is not None else parse_epa_months(duplicate.get('epaMonths')),
            # An unsent apprenticeship end date leaves the stored override alone;
            # an explicit blank clears it and restores the calculated date.
            'apprenticeship_end_override': (
                apprenticeship_end_override or None
                if apprenticeship_end_override_sent(payload)
                else format_date(duplicate.get('apprenticeshipEndOverride')) or None
            ),
            'color': payload.get('color') or None,
            'status': title_case_status(
                normalise(duplicate.get('status')) == 'archived',
                payload.get('startDate'),
                end_date,
            ),
        }
        # Recomputed from the end date being written, not from the payload, so a
        # POST that only moves the end date still lands a matching EPA window --
        # unless an authored apprenticeship end date stands, which wins outright.
        updates['apprenticeship_end_date'] = format_date(
            cohort_apprenticeship_end_date(
                end_date,
                updates['epa_months'],
                updates['apprenticeship_end_override'],
            )
        ) or None
        if 'holidayIds' in payload or 'holiday_ids' in payload:
            updates['holiday_ids'] = json_db_value(holiday_ids)
        if excluded_holiday_ids_sent:
            updates['excluded_holiday_ids'] = json_db_value(excluded_holiday_ids)
        nullable = ['apprenticeship_end_date', 'apprenticeship_end_override']
        if 'epaMonths' in payload or 'epa_months' in payload:
            nullable.append('epa_months')
        log_curriculum_decision(
            'cohort.create', outcome='matched_existing', entity_id=existing_id,
            parent_id=programme_id, matched_id=existing_id,
            reason='live-namesake-in-same-programme' if existing_id != clean_str(cohort_id) else 'same-id',
        )
        updates.update(calendar_update)
        nullable.append('calendar_policy')
        update_cohort_fields(existing_id, updates, allow_null_columns=tuple(nullable))
        invalidate_curriculum_cache()
        return JsonResponse({'created': False, 'cohort': curriculum_cohort_from_authoring_detail({
            'cohortId': existing_id,
            'cohortName': name,
            'programmeId': programme_id,
            'programmeName': programme,
            'startDate': payload.get('startDate'),
            'endDate': end_date,
            'epaMonths': updates['epa_months'],
            'apprenticeshipEndDate': updates['apprenticeship_end_date'] or '',
            'apprenticeshipEndOverride': updates['apprenticeship_end_override'] or '',
            'durationMonths': duration_months,
            'color': payload.get('color') or '',
            'holidayIds': holiday_ids,
            'excludedHolidayIds': excluded_holiday_ids if excluded_holiday_ids_sent else (duplicate.get('excludedHolidayIds') or []),
            'status': updates['status'],
        })})

    cohort = {
        'id': cohort_id,
        'name': name,
        'programme': programme,
        'programmeId': programme_id,
        'startDate': payload.get('startDate'),
        'endDate': end_date,
        'epaMonths': epa_months,
        'apprenticeshipEndDate': apprenticeship_end_override,
        'status': title_case_status(False, payload.get('startDate'), end_date),
        'color': payload.get('color') or '',
        'holidayIds': holiday_ids,
        'excludedHolidayIds': excluded_holiday_ids,
        **({'calendarPolicy': payload['calendarPolicy']} if 'calendarPolicy' in payload else {}),
        'groups': [],
        'modules': [],
    }
    # The write is confirmed before this reports success, both ways it can fail
    # quietly. persist_* swallowed its exception and returned None, so a failed
    # insert used to answer 201 with a freshly minted id and no row behind it:
    # the wizard put that phantom cohort in its rail and its picker, and the next
    # step died on "Parent cohort not found" -- naming the step that could not
    # see the cohort rather than the one that failed to store it.
    try:
        persist_cohort_authoring_detail(
            cohort,
            [],
            [],
            payload.get('holidays') or payload.get('holidayDetails') or payload.get('linkedHolidays') or get_holiday_rows(),
            {'source_type': 'module_authoring', 'source_id': cohort_id},
            raise_on_error=True,
        )
    except (Exception, AssertionError) as exc:
        log_curriculum_decision(
            'cohort.create', outcome='failed', entity_id=cohort_id,
            parent_id=programme_id, reason='write-failed',
        )
        invalidate_curriculum_cache()
        return json_error(f'The cohort could not be stored: {exc}', status=500)
    # And read back, because a write can report success and still leave nothing
    # the id lookup behind every child create can find.
    if not fetch_cohort_row(cohort_id):
        log_curriculum_decision(
            'cohort.create', outcome='failed', entity_id=cohort_id,
            parent_id=programme_id, reason='row-not-stored',
        )
        invalidate_curriculum_cache()
        return json_error('The cohort could not be stored. Nothing was saved.', status=500)
    # Logged here rather than before the write, so the decision log cannot claim
    # a cohort was created and then report the same one failed.
    log_curriculum_decision(
        'cohort.create', outcome='created', entity_id=cohort_id, parent_id=programme_id,
        reason='archived-namesake-ignored' if archived_cohort_ids else '',
    )
    invalidate_curriculum_cache()
    return JsonResponse({'created': True, 'cohort': curriculum_cohort_from_authoring_detail({
        'cohortId': cohort_id,
        'cohortName': name,
        'programmeId': programme_id,
        'programmeName': programme,
        'startDate': payload.get('startDate'),
        'endDate': end_date,
        'epaMonths': epa_months,
        'apprenticeshipEndDate': apprenticeship_end_date,
        'apprenticeshipEndOverride': apprenticeship_end_override,
        'durationMonths': duration_months,
        'color': payload.get('color') or '',
        'holidayIds': holiday_ids,
        'excludedHolidayIds': excluded_holiday_ids,
        **({'calendarPolicy': payload['calendarPolicy']} if 'calendarPolicy' in payload else {}),
        'status': cohort['status'],
    })}, status=201)


def curriculum_cohort_collection(request, *, create_curriculum_cohort, json_body, json_error):
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)
    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')
    return create_curriculum_cohort(payload)


def curriculum_cohort_detail(
    request,
    identifier,
    *,
    AUTHORING_MODULES_TABLE,
    COHORT_AUTHORING_DETAILS_TABLE,
    GROUPS_TABLE,
    JsonResponse,
    apprenticeship_end_override_sent,
    authoring_fetch_all,
    authoring_soft_delete,
    canonical_programme_id,
    clean_str,
    cohort_apprenticeship_end_date,
    cohort_conflict_record,
    cohort_practical_end_date,
    cohort_record_revision,
    cohort_rename_bindings,
    curriculum_name_only_patch,
    fetch_cohort_row,
    format_date,
    invalidate_curriculum_cache,
    json_body,
    json_db_value,
    json_error,
    lock_record_row,
    log_curriculum_decision,
    parse_int,
    parse_json_value,
    parse_notes_id_list,
    payload_apprenticeship_end_override,
    payload_epa_months,
    permanent_cohort_delete_response,
    policy_write,
    record_conflict_response,
    request_wants_permanent_delete,
    requested_expected_revision,
    resolve_cohort_row,
    title_case_status,
    transaction,
    unassign_authoring_modules_from_group,
    update_authoring_rows,
    update_cohort_fields,
):
    if request.method not in {'PATCH', 'DELETE'}:
        return json_error('Method not allowed.', status=405)

    # Look the cohort up by its stored canonical id in curriculum.cohorts. This
    # row is the only source of truth; updates target it in place so the
    # canonical cohort_id and every unrelated column are preserved.
    cohort_row = resolve_cohort_row(identifier)
    if not cohort_row:
        log_curriculum_decision(
            f'cohort.{request.method.lower()}', outcome='rejected',
            reason='not-found', entity_id=identifier,
        )
        return json_error('Cohort not found.', status=404)
    cohort_id = clean_str(cohort_row.get('cohort_id'))

    if request.method == 'DELETE':
        # An archived cohort can be removed for good, with the groups archived
        # alongside it. Archiving stays the default so a delete is never
        # irreversible by accident -- see permanent_cohort_delete_response.
        if request_wants_permanent_delete(request):
            log_curriculum_decision(
                'cohort.delete', outcome='permanent_requested', entity_id=cohort_id,
            )
            return permanent_cohort_delete_response(cohort_row)

        for stored_group in authoring_fetch_all(GROUPS_TABLE, 'cohort_id = %s', [cohort_id]):
            stored_group_id = clean_str(stored_group.get('group_id'))
            if not stored_group_id:
                continue
            unassign_authoring_modules_from_group(stored_group_id)
            authoring_soft_delete(GROUPS_TABLE, 'group_id = %s', [stored_group_id], via_parent=cohort_id, deleted_by='cohort-delete')
        # Any module row still naming this cohort directly, rather than through
        # one of its groups, is detached too: it has to be given a new cohort and
        # group from the module drawer, never left on an archived cohort.
        update_authoring_rows(AUTHORING_MODULES_TABLE, 'cohort_id = %s', [cohort_id], {
            'cohort_id': None,
            'group_id': None,
        })
        authoring_soft_delete(COHORT_AUTHORING_DETAILS_TABLE, 'cohort_id = %s', [cohort_id], deleted_by='cohort-delete')
        log_curriculum_decision(
            'cohort.archive', outcome='soft_deleted', entity_id=cohort_id,
            parent_id=clean_str(cohort_row.get('programme_id')),
        )
        invalidate_curriculum_cache()
        return JsonResponse({'deleted': True, 'permanent': False, 'id': cohort_id})

    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')

    duration_months = payload.get('durationMonths')
    start_date = payload.get('startDate') if 'startDate' in payload else format_date(cohort_row.get('start_date'))
    # An unsent holiday selection keeps the stored one. The selection is used by
    # module session planning; it does not change the cohort contract dates.
    patch_holiday_ids = (
        payload.get('holidayIds') if 'holidayIds' in payload
        else payload.get('holiday_ids') if 'holiday_ids' in payload
        else parse_json_value(cohort_row.get('holiday_ids'), [])
    )
    computed_end = (
        format_date(cohort_practical_end_date(start_date, duration_months, patch_holiday_ids))
        if duration_months else ''
    )
    end_date = payload.get('endDate') or computed_end or format_date(cohort_row.get('end_date'))
    # end_date is the practical period end; the apprenticeship end date is
    # re-derived from it on every PATCH so moving one moves the other.
    epa_months = payload_epa_months(payload, cohort_row)
    epa_sent = 'epaMonths' in payload or 'epa_months' in payload
    # An authored apprenticeship end date overrides that derivation. Unsent keeps
    # the stored one; an explicit blank clears it and the EPA rule takes over.
    override = format_date(payload_apprenticeship_end_override(payload, cohort_row))
    override_sent = apprenticeship_end_override_sent(payload)

    # Build a targeted update: only columns explicitly present in the payload
    # (or derived from them) are written. programme_id / group_ids / source_type
    # are never rebuilt from name-derived data.
    updates = {}
    if 'calendarPolicy' in payload:
        try:
            updates.update(policy_write(payload, cohort_row, COHORT_AUTHORING_DETAILS_TABLE))
        except ValueError as exc:
            return json_error(str(exc), fields=['calendarPolicy'])
    if 'name' in payload and clean_str(payload.get('name')):
        updates['cohort_name'] = clean_str(payload.get('name'))
    if 'startDate' in payload:
        updates['start_date'] = payload.get('startDate') or None
    if end_date:
        updates['end_date'] = end_date or None
    if duration_months is not None:
        updates['duration_months'] = parse_int(duration_months, cohort_row.get('duration_months') or 0)
    if epa_sent:
        updates['epa_months'] = epa_months
    if override_sent:
        updates['apprenticeship_end_override'] = override or None
    if end_date or epa_sent or override_sent:
        updates['apprenticeship_end_date'] = format_date(
            cohort_apprenticeship_end_date(end_date, epa_months, override)
        ) or None
    if 'color' in payload and clean_str(payload.get('color')):
        updates['color'] = payload.get('color')
    if 'holidayIds' in payload or 'holiday_ids' in payload:
        updates['holiday_ids'] = json_db_value(parse_notes_id_list(
            payload.get('holidayIds') if 'holidayIds' in payload else payload.get('holiday_ids')
        ))
    # The holidays unticked in the cohort drawer. Unsent leaves the stored
    # exclusions alone -- checked the same way as holidayIds above, by key
    # presence rather than truthiness, so an explicit empty list (nothing
    # excluded, i.e. "Select all") is written rather than ignored.
    if 'excludedHolidayIds' in payload or 'excluded_holiday_ids' in payload:
        updates['excluded_holiday_ids'] = json_db_value(parse_notes_id_list(
            payload.get('excludedHolidayIds') if 'excludedHolidayIds' in payload else payload.get('excluded_holiday_ids')
        ))
    # Programme reassignment is only honoured when an explicit canonical id or a
    # resolvable programme name is supplied; otherwise the stored parent stands.
    explicit_programme_id = clean_str(payload.get('programmeId') or payload.get('programme_id'))
    if explicit_programme_id or clean_str(payload.get('programme')):
        resolved = canonical_programme_id(explicit_programme_id, clean_str(payload.get('programme')))
        if resolved:
            updates['programme_id'] = resolved
            if clean_str(payload.get('programme')):
                updates['programme_name'] = clean_str(payload.get('programme'))
    updates['status'] = title_case_status(
        clean_str(cohort_row.get('status')) == 'archived',
        start_date,
        end_date,
    )
    if curriculum_name_only_patch(payload):
        # Stored dates, EPA boundaries and status are not authored by a rename.
        updates = {'cohort_name': updates['cohort_name']}

    nullable = ['apprenticeship_end_date', 'calendar_policy']
    if epa_sent:
        nullable.append('epa_months')
    if override_sent:
        nullable.append('apprenticeship_end_override')
    # Optimistic concurrency, opt-in, as on the module structure PATCH. The
    # drawer sends every field it renders, including the ones this reader never
    # touched, so a save built before a colleague's would put their work back to
    # what it was -- silently, because nothing here compared the two.
    expected_revision = requested_expected_revision(request, payload)
    # One transaction around the check and the write; see lock_record_row.
    CohortRenameConflict, propagate_cohort_name = cohort_rename_bindings()
    try:
        with transaction.atomic():
            if expected_revision or 'cohort_name' in updates:
                lock_record_row(COHORT_AUTHORING_DETAILS_TABLE, 'cohort_id = %s', [cohort_id])
            if expected_revision:
                current_revision = cohort_record_revision(cohort_id)
                if current_revision != expected_revision:
                    return record_conflict_response(
                        expected_revision, current_revision, cohort=cohort_conflict_record(cohort_id),
                    )
            if 'cohort_name' in updates:
                propagate_cohort_name(fetch_cohort_row(cohort_id), updates['cohort_name'])
            update_cohort_fields(cohort_id, updates, allow_null_columns=tuple(nullable))
    except CohortRenameConflict as exc:
        return json_error(str(exc), status=409)
    invalidate_curriculum_cache()
    # Read after the commit, so the token handed back is the one a reader would
    # fingerprint now rather than one a rollback could take away.
    return JsonResponse({'updated': True, 'id': cohort_id, 'revision': cohort_record_revision(cohort_id)})


def curriculum_cohort_restore(
    request,
    identifier,
    *,
    ARCHIVE_MODULE_REATTACH_NOTE,
    COHORT_AUTHORING_DETAILS_TABLE,
    GROUPS_TABLE,
    JsonResponse,
    RESTORE_NULLABLE_COLUMNS,
    archived_parent_programme,
    clean_str,
    curriculum_row_is_archived,
    fetch_cohort_row,
    has_column,
    invalidate_curriculum_cache,
    json_error,
    log_curriculum_decision,
    resolve_cohort_row,
    restore_rows_via_parent,
    restore_soft_delete_payload,
    title_case_status,
    transaction,
    update_rows,
):
    """Take a cohort back out of the archive, with the groups archived with it."""
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)

    cohort_row = fetch_cohort_row(identifier) or resolve_cohort_row(identifier)
    if not cohort_row:
        log_curriculum_decision('cohort.restore', outcome='rejected', reason='not-found', entity_id=identifier)
        return json_error('Cohort not found.', status=404)
    cohort_id = clean_str(cohort_row.get('cohort_id'))
    if not curriculum_row_is_archived(cohort_row):
        return json_error(
            'Cohort is not archived.', status=409,
            reason='cohort-not-archived', restored=False, id=cohort_id,
        )

    programme_id = clean_str(cohort_row.get('programme_id'))
    archived_programme = archived_parent_programme(programme_id)
    if archived_programme:
        name = clean_str(archived_programme.get('name')) or 'The programme'
        return json_error(
            f'{name} is archived, so this cohort has no programme to come back to. Restore the '
            'programme instead - it brings back everything archived with it, this cohort included.',
            status=409, reason='programme-archived', restored=False, id=cohort_id,
        )

    with transaction.atomic():
        payload = restore_soft_delete_payload(COHORT_AUTHORING_DETAILS_TABLE)
        if has_column(COHORT_AUTHORING_DETAILS_TABLE, 'status'):
            # Back to whatever the dates say it is now, not to a blanket
            # 'active': a cohort archived before it started is still planned.
            payload['status'] = title_case_status(
                False, cohort_row.get('start_date'), cohort_row.get('end_date'),
            )
        update_rows(
            COHORT_AUTHORING_DETAILS_TABLE, 'cohort_id = %s', [cohort_id], payload,
            allow_null_columns=RESTORE_NULLABLE_COLUMNS,
        )
        # Only the groups this cohort's own archive took down carry it as their
        # parent marker. A group archived on its own carries none and stays
        # archived - the same rule ``restore_rows_via_parent`` applies to a
        # programme, so restoring is never a way to resurrect an unrelated
        # deletion.
        groups = restore_rows_via_parent(GROUPS_TABLE, cohort_id)
    invalidate_curriculum_cache()
    log_curriculum_decision('cohort.restore', outcome='restored', entity_id=cohort_id, parent_id=programme_id)
    return JsonResponse({
        'restored': True,
        'id': cohort_id,
        'details': {'groups': len(groups)},
        'message': f'Cohort restored. {ARCHIVE_MODULE_REATTACH_NOTE}',
    })


def permanent_cohort_delete_response(
    cohort_row,
    *,
    AUTHORING_MODULES_TABLE,
    COHORT_AUTHORING_DETAILS_TABLE,
    DatabaseError,
    GROUPS_TABLE,
    IntegrityError,
    JsonResponse,
    archived_cohort_learners,
    authoring_fetch_all,
    calendar_holidays,
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
    update_authoring_rows,
):
    """HTTP outcome of a permanent cohort delete: the row and its archived groups.

    Module rows are never deleted with a cohort. Module content outlives the
    delivery it was scheduled into - that is what the plain archive already
    promises - so only the delivery link is cleared here.
    """
    cohort_id = clean_str(cohort_row.get('cohort_id'))
    if not curriculum_row_is_archived(cohort_row):
        return json_error(
            'Archive the cohort before deleting it permanently.',
            status=409, reason='cohort-not-archived', deleted=False, permanent=False, id=cohort_id,
        )

    learners = archived_cohort_learners(cohort_row)
    if learners:
        return json_error(
            f'{learners} active learner{"" if learners == 1 else "s"} are still placed in this cohort, '
            'so it cannot be deleted permanently. Move them to another cohort first.',
            status=409, reason='cohort-has-learner-delivery', deleted=False, permanent=False,
            id=cohort_id, blockers={'learners': learners},
        )

    group_rows = authoring_fetch_all(GROUPS_TABLE, 'cohort_id = %s', [cohort_id])
    live_groups = [row for row in group_rows if not curriculum_row_is_archived(row)]
    if live_groups:
        return json_error(
            f'{len(live_groups)} group{"" if len(live_groups) == 1 else "s"} under this cohort '
            'are still active, so it cannot be deleted permanently. Archive them first.',
            status=409, reason='cohort-has-live-groups', deleted=False, permanent=False,
            id=cohort_id, blockers={'groups': len(live_groups)},
        )
    blocked = permanent_delete_reference_refusal('cohort', cohort_id)
    if blocked is not None:
        return blocked

    try:
        with transaction.atomic():
            for group in group_rows:
                unassign_authoring_modules_from_group(clean_str(group.get('group_id')))
            # Any module row still naming this cohort directly, rather than
            # through one of its groups.
            update_authoring_rows(AUTHORING_MODULES_TABLE, 'cohort_id = %s', [cohort_id], {
                'cohort_id': None,
            })
            # Its holiday choices reference it with RESTRICT on the normalised
            # schema: they go with it (authoring_delete does the same).
            calendar_holidays.release_cohorts('cohort_id = %s', [cohort_id])
            removed = {
                'groups': len(delete_rows(GROUPS_TABLE, 'cohort_id = %s', [cohort_id])),
                'cohorts': len(delete_rows(COHORT_AUTHORING_DETAILS_TABLE, 'cohort_id = %s', [cohort_id])),
            }
    except (IntegrityError, DatabaseError) as exc:
        logger.warning('Permanent delete of cohort %s was refused: %s', cohort_id, exc)
        return json_error(
            'The database refused the permanent delete because other rows still reference this cohort.',
            status=409, reason='cohort-delete-restricted', deleted=False, permanent=False,
            id=cohort_id, detail=clean_str(str(exc)),
        )

    invalidate_curriculum_cache()
    log_curriculum_decision(
        'cohort.delete', outcome='permanent', entity_id=cohort_id,
        parent_id=clean_str(cohort_row.get('programme_id')),
        reason=','.join(f'{table}:{count}' for table, count in sorted(removed.items())),
    )
    return JsonResponse({
        'deleted': True,
        'permanent': True,
        'id': cohort_id,
        'removed': removed,
        'message': 'Cohort and the groups archived with it were removed from the database. Module content was kept.',
    })
