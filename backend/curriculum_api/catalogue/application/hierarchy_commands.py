"""Programme tree preparation, attachment concurrency and delivery-count orchestration.

Named capabilities are supplied by the existing composition seam during migration.
No legacy module, provider or settings object is imported here.
"""


def upsert_programme_for_tree(
    payload,
    *,
    clean_str,
    datetime,
    ensure_program_config_archive_columns,
    get_program_config_rows,
    insert_row,
    normalise_ksb_profile_source_value,
    parse_required_otjh,
    payload_required_otjh,
    preferred_program_config_by_name,
    programme_config_by_identifier,
    programme_config_id,
    programme_config_key_column,
    programme_status_from_payload,
    propagate_programme_name_to_learners,
    quote_ident,
    require_fields,
    unique_program_id,
    update_rows,
):
    missing = require_fields(payload, ['name'])
    if missing:
        raise ValueError('Programme name is required.')
    ensure_program_config_archive_columns()
    name = clean_str(payload.get('name'))
    requested_id = clean_str(payload.get('id') or payload.get('sourceId') or payload.get('programmeId') or payload.get('programId'))
    # programmes.structure_type was dropped; everything is scheduled now.
    structure_type = 'scheduled'
    config = programme_config_by_identifier(requested_id) if requested_id else None
    if not config:
        config = preferred_program_config_by_name(get_program_config_rows(), name)
    # The caller still echoes a `standard` back to the client; it is derived
    # from the request/name rather than persisted (column dropped).
    standard = payload.get('standard') or payload.get('sub') or name
    programme_status = programme_status_from_payload(payload, config)
    updates = {
        'name': name,
        'level': payload.get('level') or '',
        'color': payload.get('color') or '#6941c6',
        'description': payload.get('description') or '',
        'ksb_profile_source_id': normalise_ksb_profile_source_value(payload.get('ksbProfileSourceId') or payload.get('ksb_profile_source_id') or (config or {}).get('ksb_profile_source_id') or ''),
        'required_otjh': payload_required_otjh(payload, config),
        'status': programme_status,
        'updated_at': datetime.utcnow(),
    }
    if config:
        key_column = programme_config_key_column()
        key_value = config.get(key_column)
        update_rows('programmes', f'{quote_ident(key_column)} = %s', [key_value], updates, allow_null_columns=['required_otjh'])
        source_id = programme_config_id(config) or clean_str(key_value)
        propagate_programme_name_to_learners(source_id, clean_str(config.get('name')), name)
        return {
            'id': source_id,
            'sourceId': source_id,
            'name': name,
            'standard': standard,
            'level': updates['level'],
            'status': programme_status,
            'color': updates['color'],
            'description': updates['description'],
            'structureType': structure_type,
            'ksbProfileSourceId': normalise_ksb_profile_source_value(updates.get('ksb_profile_source_id') or ''),
            'requiredOtjh': updates.get('required_otjh'),
        }

    source_id = unique_program_id(requested_id or name, get_program_config_rows())
    row = insert_row('programmes', {
        **updates,
        'programme_id': source_id,
        'id': source_id,
        'program_id': source_id,
        'created_at': datetime.utcnow(),
    })
    source_id = programme_config_id(row) or source_id
    return {
        'id': source_id,
        'sourceId': source_id,
        'name': row.get('name') or name,
        'standard': standard,
        'level': row.get('level') or updates['level'],
        'status': programme_status,
        'color': row.get('color') or updates['color'],
        'description': row.get('description') or updates['description'],
        'structureType': structure_type,
        'ksbProfileSourceId': normalise_ksb_profile_source_value(row.get('ksb_profile_source_id') or updates.get('ksb_profile_source_id') or ''),
        'requiredOtjh': parse_required_otjh(row.get('required_otjh')) if row.get('required_otjh') is not None else updates.get('required_otjh'),
    }


def save_tree_cohort(
    cohort,
    programme_id,
    programme_name,
    preserve_missing_groups=False,
    *,
    clean_str,
    cohort_practical_end_date,
    curriculum_cohort_from_authoring_detail,
    curriculum_row_effectively_deleted,
    fetch_cohort_row,
    format_date,
    get_holiday_rows,
    holiday_table_name,
    logger,
    parse_int,
    parse_json_value,
    parse_notes_id_list,
    payload_apprenticeship_end_override,
    payload_epa_months,
    persist_cohort_authoring_detail,
    serialize_cohort_authoring_detail,
    title_case_status,
    unique,
    unique_cohort_id,
):
    name = clean_str(cohort.get('name'))
    if not name:
        raise ValueError('Cohort name is required.')
    cohort_id = unique_cohort_id(cohort.get('id') or cohort.get('cohortId') or cohort.get('sourceId'))
    duration_months = cohort.get('durationMonths') or 24
    # Cohort contract dates are fixed. Applied holidays are stored for module
    # session planning, where clashing sessions extend the module plan instead.
    end_date = cohort.get('endDate') or format_date(cohort_practical_end_date(
        cohort.get('startDate'),
        duration_months,
        cohort.get('holidayIds') or cohort.get('holiday_ids'),
        cohort.get('holidays') or cohort.get('holidayDetails'),
    ))
    existing = fetch_cohort_row(cohort_id) or {}
    if existing and curriculum_row_effectively_deleted(existing):
        logger.warning(
            'Tree save addressed deleted cohort %s; saving as a new cohort instead.', cohort_id
        )
        cohort_id = unique_cohort_id()
        existing = {}
    # The stored period stands in for an omitted one so a partial tree save
    # cannot silently drop it, but it is always re-derived against the end date
    # being written — the apprenticeship end date moves with the practical
    # one, unless an authored apprenticeship end date has been set for the cohort.
    # The authored date is guarded the same way: unsent keeps the stored one.
    epa_months = payload_epa_months(cohort, existing)
    apprenticeship_end_override = format_date(payload_apprenticeship_end_override(cohort, existing))
    holiday_ids = parse_notes_id_list(cohort.get('holidayIds') or cohort.get('holiday_ids'))
    group_ids = [clean_str(group.get('id') or group.get('groupId') or group.get('sourceId')) for group in cohort.get('groups') or []]
    if preserve_missing_groups:
        group_ids = unique([*parse_json_value(existing.get('group_ids'), []), *group_ids])
    payload = {
        'id': cohort_id,
        'name': name,
        'programme': programme_name,
        'programmeId': programme_id,
        'startDate': cohort.get('startDate'),
        'endDate': end_date,
        'epaMonths': epa_months,
        'apprenticeshipEndOverride': apprenticeship_end_override,
        'status': title_case_status(clean_str(existing.get('status')) == 'archived', cohort.get('startDate'), end_date),
        'color': cohort.get('color') or existing.get('color') or '',
        'holidayIds': holiday_ids,
        'groups': group_ids,
    }
    # Only set when the tree save actually carries an opinion: an omitted key
    # leaves cohort_authoring_payload to keep whatever exclusions are already
    # stored, the same as an unsent EPA period or apprenticeship override above.
    if 'calendarPolicy' in cohort or 'calendar_policy' in cohort:
        payload['calendarPolicy'] = cohort.get('calendarPolicy') if 'calendarPolicy' in cohort else cohort.get('calendar_policy')
    if 'excludedHolidayIds' in cohort or 'excluded_holiday_ids' in cohort:
        payload['excludedHolidayIds'] = parse_notes_id_list(
            cohort.get('excludedHolidayIds') if 'excludedHolidayIds' in cohort else cohort.get('excluded_holiday_ids')
        )
    holiday_rows = cohort.get('holidays') or cohort.get('holidayDetails')
    if holiday_rows is None:
        try:
            holiday_rows = [] if not holiday_table_name() else get_holiday_rows()
        except (Exception, AssertionError):
            holiday_rows = []
    row = persist_cohort_authoring_detail(
        payload,
        [],
        [{'id': item} for item in payload['groups'] if item],
        holiday_rows,
        {
            'programme_id': programme_id,
            'duration_months': parse_int(duration_months, existing.get('duration_months') or 0),
            'source_type': 'module_authoring',
            'source_id': cohort_id,
        },
    )
    if not row:
        raise ValueError(f'Could not save cohort "{name}".')
    return curriculum_cohort_from_authoring_detail(serialize_cohort_authoring_detail(row))


def save_tree_group(
    group,
    cohort_row,
    *,
    canonical_group_coaches,
    clean_str,
    curriculum_group_from_authoring_detail,
    curriculum_row_effectively_deleted,
    fetch_group_row,
    logger,
    notify_staff_assignment_change,
    persist_group_authoring_detail,
    safe_authoring_module_rows,
    schedule_day_part,
    schedule_time_parts,
    serialize_cohort_authoring_detail,
    serialize_group_authoring_detail,
    unique_group_id,
    with_group_coaches,
):
    group = with_group_coaches(group)
    name = clean_str(group.get('name'))
    if not name:
        raise ValueError('Group name is required.')
    group_id = unique_group_id(group.get('id') or group.get('groupId') or group.get('sourceId'))
    cohort = serialize_cohort_authoring_detail(cohort_row)
    existing = fetch_group_row(group_id) or {}
    if existing and curriculum_row_effectively_deleted(existing):
        logger.warning(
            'Tree save addressed deleted group %s; saving as a new group instead.', group_id
        )
        group_id = unique_group_id()
        existing = {}
    group_payload = {
        'id': group_id,
        'name': name,
        'cohortId': cohort['cohortId'],
        'cohort': cohort['cohortName'],
        'programmeId': cohort['programmeId'],
        'programme': cohort['programmeName'],
        'coach': canonical_group_coaches(group.get('coach')) if 'coach' in group else clean_str(existing.get('coach_name')),
        'weekDays': group.get('weekDays') or group.get('deliveryDays') or existing.get('session_week_day') or schedule_day_part(existing.get('schedule')),
        'startTime': group.get('startTime') or existing.get('session_start_time') or schedule_time_parts(existing.get('schedule'))[0],
        'endTime': group.get('endTime') or existing.get('session_end_time') or schedule_time_parts(existing.get('schedule'))[1],
        'color': group.get('color') or existing.get('color') or '',
        'status': group.get('status') or existing.get('status') or 'planned',
    }
    row = persist_group_authoring_detail(group_payload, [], safe_authoring_module_rows(), {'source_type': 'module_authoring', 'source_id': group_id})
    if not row:
        raise ValueError(f'Could not save group "{name}".')
    notify_staff_assignment_change()
    return curriculum_group_from_authoring_detail(serialize_group_authoring_detail(row))


def save_tree_group_modules(
    group,
    cohort,
    modules,
    preserve_missing=False,
    *,
    TutorAssignmentDeliveryDayError,
    TutorScheduleConflictError,
    attachment_session_count,
    attachment_week_structure,
    clean_str,
    contentful_catalogue_id_for_attachment,
    is_canonical_module_catalogue_id,
    locked_attachment_structure,
    module_attachment_authoring_payload,
    module_calendar_end_date,
    module_cohort_date_error,
    module_schedule_assignment_changed,
    module_schedule_view,
    notify_staff_assignment_change,
    parse_int,
    safe_authoring_module_rows,
    save_module_authoring_structure,
    schedule_day_part,
    tutor_assignment_delivery_day_error,
    tutor_schedule_conflicts_created,
    unassign_authoring_modules_from_group,
    unique_module_catalogue_id,
):
    saved_catalogue_ids = set()
    saved_modules = []
    # Snapshot taken before the loop writes anything, so a module is never
    # compared against the half-saved state of its own group.
    stored_module_rows = safe_authoring_module_rows()
    pending_candidates = []
    for module in modules or []:
        module_name = clean_str(module.get('moduleName') or module.get('name') or module.get('title'))
        if not module_name:
            raise ValueError('Module name is required for each attachment.')
        requested_catalogue_id = clean_str(module.get('moduleCatalogueId') or module.get('catalogueId') or module.get('moduleId'))
        if requested_catalogue_id and not is_canonical_module_catalogue_id(requested_catalogue_id):
            requested_catalogue_id = ''
        catalogue_id = contentful_catalogue_id_for_attachment(module, group, cohort, module_name, requested_catalogue_id) or unique_module_catalogue_id(requested_catalogue_id or module_name)
        current_structure = locked_attachment_structure(module, catalogue_id)
        start_date = module.get('startDate') or cohort.get('startDate')
        # `weeks` is overloaded in the attachment payload: the wizard's catalogue
        # shape sends it as an integer session count, while older tree payloads
        # sent it as a list of authored weeks. Only accept the list form as a
        # structure, otherwise an integer silently becomes the week structure and
        # every authored week (and its components) is dropped on save.
        module_schedule = module.get('weekDays') or group.get('weekDays') or group.get('schedule')
        attachment_weeks = attachment_week_structure({**module, 'startDate': start_date}, current_structure, schedule=module_schedule)
        session_count = attachment_session_count(module, attachment_weeks)
        attachment_weeks_count = parse_int(module.get('weeksNumber') or module.get('weeks'), 0) or len(attachment_weeks)
        end_date = module.get('endDate') or module_calendar_end_date(start_date, attachment_weeks_count, module) or cohort.get('endDate')
        # Same cohort window the group-modules endpoint enforces: the tree save
        # writes the same module rows, so it cannot be the way around the rule.
        date_error = module_cohort_date_error(module_name, start_date, end_date, cohort)
        if date_error:
            raise ValueError(date_error[0])
        structure_payload = module_attachment_authoring_payload(
            {
                **module,
                'weekStructure': attachment_weeks,
                'moduleKsbMappings': module.get('moduleKsbMappings') or module.get('ksbMappings') or (current_structure or {}).get('moduleKsbMappings') or [],
            },
            group,
            cohort,
            catalogue_id,
            module_name,
            session_count,
            start_date,
            end_date,
            current_structure,
        )
        structure_payload['weekStructure'] = attachment_weeks
        structure_payload['moduleKsbMappings'] = module.get('moduleKsbMappings') or module.get('ksbMappings') or (current_structure or {}).get('moduleKsbMappings') or []
        candidate = module_schedule_view(structure_payload)
        # This save can give the group its delivery day in the same request, so
        # the day it is writing counts before the stored one does.
        if not clean_str(group.get('weekDays') or group.get('deliveryDays') or schedule_day_part(group.get('schedule'))):
            delivery_day_error = tutor_assignment_delivery_day_error(
                candidate, before=module_schedule_view(current_structure or {}),
            )
            if delivery_day_error:
                raise TutorAssignmentDeliveryDayError(delivery_day_error)
        if module_schedule_assignment_changed(module_schedule_view(current_structure or {}), candidate):
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
        if module.get('completionCriteria'):
            structure_payload['completionCriteria'] = module.get('completionCriteria')
        if module.get('advancedDetails'):
            structure_payload['advancedDetails'] = module.get('advancedDetails')
        # The tree save repairs the programme's parent links once, after every
        # cohort, group and module is written.
        saved = save_module_authoring_structure(catalogue_id, structure_payload, repair_links=False)
        saved_catalogue_ids.add(catalogue_id)
        saved_modules.append(saved)
    removed = [] if preserve_missing else unassign_authoring_modules_from_group(group.get('id'), saved_catalogue_ids)
    notify_staff_assignment_change()
    return saved_modules, removed


def locked_attachment_structure(
    item,
    catalogue_id,
    *,
    StaleModuleStructureWrite,
    authoring_module_exists,
    clean_str,
    get_authoring_structure_payload,
    lock_module_structure_row,
    module_structure_revision,
    payload_week_list,
):
    """The stored structure an attachment save builds on, read under the module's lock.

    The tree save and the group-modules save rebuild a module's whole payload
    from what is stored and then write it back. Read without the lock, a
    Builder save landing between the read and the write was reverted. A
    caller that brings its own week list for an existing module must also say
    which version that list was made from (``structureRevision``), or it is
    refused: nothing on screen sends one any more, and an old copy replacing
    a module's weeks is exactly the overwrite this guards against.
    """
    if not authoring_module_exists(catalogue_id):
        return None
    lock_module_structure_row(catalogue_id)
    if payload_week_list((item or {}).get('weekStructure')) or payload_week_list((item or {}).get('weeks')):
        expected = clean_str((item or {}).get('structureRevision') or (item or {}).get('expectedRevision'))
        current = module_structure_revision(catalogue_id)
        if not expected or expected != current:
            raise StaleModuleStructureWrite(catalogue_id, expected, current)
    return get_authoring_structure_payload(catalogue_id)


def resync_group_module_delivery_counts(
    previous_rows,
    delivery_updates,
    *,
    AUTHORING_MODULES_TABLE,
    AUTHORING_WEEKS_TABLE,
    active_week_rows,
    authoring_fetch_all,
    clean_str,
    datetime,
    delivery_days_per_week,
    format_date,
    module_calendar_end_date,
    parse_int,
    update_authoring_rows,
):
    """Re-derive session counts and end dates after a group's delivery days change.

    ``sessions_number`` is the authored week count times the delivery days: a
    group that starts running Mon+Thu delivers two sessions of every authored
    week, not the same total squeezed into half the calendar. Pushing the new day
    list onto the module rows without re-deriving the count left the figure from
    the old one-day pattern in place, so the generated plan -- and the Teams
    calendar fed from it -- still produced one date per authored week.

    The end date is re-derived too, from the start date and the same
    ``weeks`` this reads -- it is the module's calendar span, not a date the
    delivery pattern decides, so a delivery-day change never moves it; this
    only self-heals a stored value that had drifted from that formula.

    ``previous_rows`` are the module rows as they stood *before* the new delivery
    days were written. Week counts are fetched live from ``curriculum.weeks``
    so the resync always reflects the current authored structure.
    """
    if not previous_rows:
        return
    catalogue_ids = [clean_str(r.get('module_catalogue_id')) for r in previous_rows if r.get('module_catalogue_id')]
    live_week_counts = {}
    if catalogue_ids:
        week_rows = [
            row for row in active_week_rows(authoring_fetch_all(
                AUTHORING_WEEKS_TABLE, 'module_catalogue_id = ANY(%s)', [catalogue_ids],
                columns=['module_catalogue_id', 'status'],
            ))
            if clean_str(row.get('status')).lower() not in ('inactive',)
        ]
        for row in week_rows:
            mid = clean_str(row.get('module_catalogue_id'))
            if mid:
                live_week_counts[mid] = live_week_counts.get(mid, 0) + 1
    for previous_row in previous_rows or []:
        catalogue_id = clean_str(previous_row.get('module_catalogue_id'))
        weeks = live_week_counts.get(catalogue_id, 0)
        if not catalogue_id or weeks <= 0:
            continue
        module_row = {**previous_row, **delivery_updates}
        sessions = weeks * delivery_days_per_week(module_row)
        end_date = module_calendar_end_date(module_row.get('start_date'), weeks, module_row) or format_date(module_row.get('end_date'))
        if (
            sessions == parse_int(previous_row.get('sessions_number'), 0)
            and end_date == format_date(previous_row.get('end_date'))
        ):
            continue
        update_authoring_rows(AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s', [catalogue_id], {
            'sessions_number': sessions,
            'end_date': end_date or None,
            'updated_at': datetime.utcnow(),
        })
