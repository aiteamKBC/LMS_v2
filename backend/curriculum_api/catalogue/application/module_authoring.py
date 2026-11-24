"""Module authoring save orchestration: validation, atomic content persistence and post-save reconciliation.

Named capabilities are supplied by the existing composition seam during migration.
No application settings, legacy views or provider runtime is imported here.
"""
from curriculum_api.weekly_schedule import merged_week_boundary_mode


def save_module_authoring_structure(
    module_catalogue_id,
    payload,
    *,
    repair_links=True,
    write_changed_only=False,
    light=False,
    stored_rows=None,
    stored_structure=None,
    build_result=True,
    _legacy_live_ids=None,
    AUTHORING_ADVANCED_TABLE,
    AUTHORING_COMPLETION_TABLE,
    AUTHORING_COMPONENTS_TABLE,
    AUTHORING_KSB_MAPPINGS_TABLE,
    AUTHORING_MODULES_TABLE,
    AUTHORING_WEEKS_TABLE,
    LEGACY_REFLECTION_QUESTION_SETTING,
    LIVE_SESSIONS_TABLE,
    LIVE_SESSION_OCCURRENCES_TABLE,
    MODULE_ARCHIVED_SAVE_REFUSED,
    MODULE_TEAMS_SHARES_TABLE,
    ModuleAuthoringValidationError,
    REFLECTION_QUESTION_COLUMN,
    archive_state,
    as_json_value,
    attach_teams_meeting_to_module_weeks,
    authoring_bulk_upsert,
    authoring_comparable,
    authoring_fetch_all,
    authoring_mapping_payload,
    authoring_module_exists,
    authoring_row_differs,
    authoring_row_is_active,
    authoring_soft_delete,
    authoring_upsert,
    bool_payload,
    canonical_authoring_id,
    canonical_staff_assignment_name,
    clean_str,
    component_assurance_flag,
    component_builder_settings,
    component_expected_otjh,
    component_expected_otjh_minutes,
    datetime,
    default_completion_payload,
    delete_rows,
    delivery_days_per_week,
    ensure_module_authoring_tables,
    ensure_programme_config_for_authoring,
    fetch_cohort_row,
    fetch_group_row,
    first_weekly_session_day,
    free_course_errors,
    free_course_pricing,
    free_course_sale_values,
    frontend_component_type,
    get_authoring_structure_payload,
    get_program_config_rows,
    has_column,
    invalidate_curriculum_cache,
    json,
    json_db_value,
    ksb_mapping_placement,
    link_live_session_series_to_module,
    live_session_row_to_component_settings,
    manual_link_settings,
    merged_week_starts_on,
    merged_weekly_schedule,
    module_authoring_quality_check,
    module_live_sessions_affected,
    module_recovered_by_move_to_live,
    module_stored_week_count,
    module_structure_live_session_counts,
    module_withdrawn_on_its_own,
    normalise_component_ksb_mappings,
    normalise_component_type,
    normalise_ksb_profile_source_value,
    otjh_hours_from_minutes,
    parse_date,
    parse_int,
    parse_json_value,
    payload_reflection_question,
    persist_group_authoring_detail,
    persistable_programme_id,
    policy_write,
    preserve_additional_meeting_settings,
    programme_archived_for_authoring,
    programme_config_identity,
    refresh_totals,
    repair_curriculum_parent_links,
    resolve_staff_assignment_email,
    retained_live_component_ids,
    row_has_deleted_at,
    stored_calendar_series,
    stored_module_cover_image,
    strip_shared_teams_delivery_settings,
    sync_progress_ksbs,
    transaction,
    truthy,
    unique_module_catalogue_id,
    validate_module_authoring_payload,
    without_retired_components,
    write_changed_authoring_rows,
):
    """Persist one module's structure.

    ``repair_links=False`` skips the parent-link repair, which a caller that is
    saving a whole tree passes: the repair reads every cohort, group and module
    row and writes back the ones it corrects, so running it per module made a
    save cost one full pass per module on top of the single pass the tree save
    already runs once every module is written.

    ``write_changed_only=True`` writes only the week, component and KSB mapping
    rows that differ from what is stored, and withdraws only the ones the
    payload no longer holds, instead of withdrawing and rewriting them all. The
    rows are built identically either way; see merge_partial_module_structure.

    ``light=True`` is the Module Builder's partial save, made under the module's
    lock with ``stored_rows`` (module_structure_source_rows) and
    ``stored_structure`` (the payload built from them) already read. It skips
    the work an edit inside the module cannot need, each skip conditional on
    the thing it maintains being unchanged:

    * the group row and the programme's parent-link repair, unless the module's
      programme, cohort, group, title or archive state moved -- they maintain
      exactly those, and rewrote every group and cohort of the programme on
      every save, serialising saves of unrelated modules;
    * the Teams attachment pass, unless a live session, the week order or the
      delivery schedule changed -- every Teams write path re-attaches itself;
    * learner KSB snapshots, for components whose mappings did not change;
    * the completion and details rows, when they would be rewritten unchanged.

    ``build_result=False`` returns only the catalogue id; the caller reads the
    saved module back after its transaction commits.
    """
    validation_errors = validate_module_authoring_payload(payload)
    if validation_errors:
        raise ModuleAuthoringValidationError(validation_errors)
    ensure_module_authoring_tables()
    light = bool(light and stored_rows is not None and stored_structure)
    stored_module_id = clean_str(((stored_rows or {}).get(AUTHORING_MODULES_TABLE) or [{}])[0].get('module_catalogue_id')) if light else ''
    if light and stored_module_id and stored_module_id == clean_str(module_catalogue_id):
        # Already read under the lock: the module exists under exactly this id,
        # which is the answer unique_module_catalogue_id would reach after
        # reading every module row in the table.
        module_catalogue_id = stored_module_id
    else:
        module_catalogue_id = unique_module_catalogue_id(module_catalogue_id or payload.get('catalogueId') or payload.get('moduleCatalogueId'))
    if light:
        existing_module_rows = list(stored_rows.get(AUTHORING_MODULES_TABLE) or [])
    else:
        existing_module_rows = authoring_fetch_all(AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s', [module_catalogue_id]) if module_catalogue_id else []
    existing_module_row = existing_module_rows[0] if existing_module_rows else {}
    is_free_course = (existing_module_row.get('source_type') == 'free_course'
                      or payload.get('isFreeCourse') is True
                      or payload.get('sourceType', payload.get('source_type')) == 'free_course')
    # Only a free course is for sale, and its price lives on its free_courses
    # row (free_course_pricing), never on the module.
    course_pricing = free_course_sale_values(payload, existing_module_row, is_free_course)
    if is_free_course:
        allowed_live_ids = retained_live_component_ids(existing_module_row) if _legacy_live_ids is None else set(_legacy_live_ids)
        errors = free_course_errors(payload, existing_module_row, allowed_live_ids=allowed_live_ids)
        if errors:
            raise ModuleAuthoringValidationError(errors)
        payload = {**payload, 'sourceType': 'free_course', 'learnerRosterMode': 'manual'}
    # An editor that still believes an archived module is live sends
    # `isProgrammeDeleted: false` (the Builder derives it from the copy it
    # loaded). Honouring that cleared the archive on the module row alone: the
    # weeks and components archived with it kept their stamp, and the save wrote
    # a second set beside them. Restore is the only way back out of the archive.
    if (module_withdrawn_on_its_own(existing_module_row)
            and ('isProgrammeDeleted' in payload or 'is_programme_deleted' in payload)
            and not truthy(payload.get('isProgrammeDeleted') or payload.get('is_programme_deleted'))):
        raise ModuleAuthoringValidationError([{
            'path': 'isProgrammeDeleted',
            'message': MODULE_ARCHIVED_SAVE_REFUSED,
        }])
    # Validation above has already rejected a non-list weekStructure/weeks, so the
    # list form is the only thing that can reach here.
    has_explicit_weeks = 'weekStructure' in payload or 'weeks' in payload
    if has_explicit_weeks:
        weeks = without_retired_components(
            payload.get('weekStructure') if payload.get('weekStructure') is not None else payload.get('weeks') or []
        )
    elif existing_module_row:
        current_structure = get_authoring_structure_payload(module_catalogue_id) or {}
        weeks = without_retired_components(current_structure.get('weekStructure') or [])
    else:
        weeks = []
    if is_free_course:
        errors = free_course_errors({**payload, 'weekStructure': weeks}, existing_module_row, allowed_live_ids=allowed_live_ids)
        if errors:
            raise ModuleAuthoringValidationError(errors)
    checklist, quality_score = module_authoring_quality_check({**payload, 'weekStructure': weeks})
    all_components = [component for week in weeks for component in (week.get('components') or [])]
    total_otjh = otjh_hours_from_minutes(sum(component_expected_otjh_minutes(component) for component in all_components))
    # total_otjh is the persisted aggregate used by catalogue/list views.
    # Keep it derived from components so stale frontend payloads cannot pin it to 0.
    declared_total = total_otjh
    programme_name = '' if is_free_course else payload.get('programmeName') or payload.get('programme') or existing_module_row.get('programme_name') or 'Unassigned programme'
    programme = None if is_free_course else ensure_programme_config_for_authoring(
        programme_name,
        payload.get('programmeId') or payload.get('programme_id') or existing_module_row.get('programme_id'),
        payload.get('programmeStatus') or payload.get('programme_status'),
    )
    # A module saved with no programme ("assign later") carries NULL, never the
    # placeholder name: programme_id is a foreign key into programmes, so
    # falling back to programme_name made the insert fail on
    # modules_programme_id_fkey with key (programme_id)=(Unassigned programme).
    programme_id = None if is_free_course else (programme or {}).get('sourceId') or persistable_programme_id(
        payload.get('programmeId') or payload.get('programme_id') or existing_module_row.get('programme_id')
    ) or None
    delivery_metadata = payload.get('deliveryMetadata') if isinstance(payload.get('deliveryMetadata'), dict) else {}
    cohort_id = clean_str(payload.get('cohortId') or payload.get('cohort_id') or delivery_metadata.get('cohortId') or delivery_metadata.get('cohort_id') or existing_module_row.get('cohort_id'))
    cohort_name = clean_str(payload.get('cohortName') or payload.get('cohort_name') or payload.get('cohort') or delivery_metadata.get('cohort') or existing_module_row.get('cohort_name'))
    group_id = clean_str(payload.get('groupId') or payload.get('group_id') or delivery_metadata.get('groupId') or delivery_metadata.get('group_id') or existing_module_row.get('group_id'))
    group_name = clean_str(payload.get('groupName') or payload.get('group_name') or payload.get('group') or delivery_metadata.get('group') or existing_module_row.get('group_name'))
    if truthy(payload.get('duplicateDestination')):
        destination_errors = []
        programme_row = next((row for row in get_program_config_rows() if programme_config_identity(row) == programme_id), None) if programme_id else None
        cohort_row = fetch_cohort_row(cohort_id) if cohort_id else None
        group_row = fetch_group_row(group_id) if group_id else None
        if not programme_id or not programme_row:
            destination_errors.append({'path': 'programmeId', 'message': 'The destination Programme was not found.'})
        if not cohort_id or not cohort_row:
            destination_errors.append({'path': 'cohortId', 'message': 'The destination Cohort was not found.'})
        if not group_id or not group_row:
            destination_errors.append({'path': 'groupId', 'message': 'The destination Group was not found.'})
        if cohort_row and programme_id and clean_str(cohort_row.get('programme_id')) != programme_id:
            destination_errors.append({'path': 'cohortId', 'message': 'The destination Cohort does not belong to the selected Programme.'})
        if group_row and cohort_id and clean_str(group_row.get('cohort_id')) != cohort_id:
            destination_errors.append({'path': 'groupId', 'message': 'The destination Group does not belong to the selected Cohort.'})
        if group_row and programme_id and clean_str(group_row.get('programme_id')) != programme_id:
            destination_errors.append({'path': 'groupId', 'message': 'The destination Group does not belong to the selected Programme.'})
        if destination_errors:
            raise ModuleAuthoringValidationError(destination_errors)
    if 'ksbRemapReport' in payload or 'ksb_remap_report' in payload:
        ksb_remap_report = payload.get('ksbRemapReport') if 'ksbRemapReport' in payload else payload.get('ksb_remap_report')
        if not isinstance(ksb_remap_report, dict):
            ksb_remap_report = {}
    else:
        ksb_remap_report = parse_json_value(existing_module_row.get('ksb_remap_report'), {})
    learner_roster_mode = clean_str(
        payload.get('learnerRosterMode')
        or payload.get('learner_roster_mode')
        or existing_module_row.get('learner_roster_mode')
        or 'inherited'
    ).lower()
    if learner_roster_mode not in {'inherited', 'manual'}:
        learner_roster_mode = 'inherited'
    if 'teamsSharedSourceModuleId' in payload:
        teams_shared_source_module_value = payload.get('teamsSharedSourceModuleId')
    elif 'teams_shared_source_module_id' in payload:
        teams_shared_source_module_value = payload.get('teams_shared_source_module_id')
    else:
        teams_shared_source_module_value = existing_module_row.get('teams_shared_source_module_id')
    teams_shared_source_module_id = clean_str(teams_shared_source_module_value)
    stored_teams_share = clean_str(existing_module_row.get('teams_shared_source_module_id'))
    if teams_shared_source_module_id and teams_shared_source_module_id == stored_teams_share:
        # Unchanged: the share was validated when it was made, and the source
        # cannot be hard-deleted while it is shared (the share table restricts
        # it). Re-checking it here could only ever DELETE a working share on a
        # failed or momentary read -- the accidental Teams-share loss.
        pass
    elif (teams_shared_source_module_id == module_catalogue_id
            or (teams_shared_source_module_id and not authoring_module_exists(teams_shared_source_module_id))):
        # A share must point at a different, existing module. Invalid input is
        # treated as an independent Teams copy rather than creating a cycle or
        # a dangling relation that could steal a calendar later.
        teams_shared_source_module_id = ''
    # Every other save still rewrites the share table, which also repairs a
    # table row that has drifted from the column; the Builder's partial save
    # writes it only when the share actually changed.
    teams_share_changed = (
        not light or not existing_module_row or teams_shared_source_module_id != stored_teams_share
    )
    raw_tutor = payload.get('tutor') or payload.get('tutorName') or payload.get('tutor_name') or delivery_metadata.get('tutor') or existing_module_row.get('tutor_name')
    if light and clean_str(raw_tutor) == clean_str(existing_module_row.get('tutor_name')):
        # The tutor this module already carries: no directory lookups.
        tutor_name = clean_str(existing_module_row.get('tutor_name'))
        tutor_email = clean_str(existing_module_row.get('tutor_email'))
    else:
        tutor_name = canonical_staff_assignment_name('tutor', raw_tutor)
        tutor_email = resolve_staff_assignment_email('tutor', tutor_name) if tutor_name else ''
    session_week_day = payload.get('weekDays') or payload.get('sessionWeekDay') or payload.get('session_week_day') or payload.get('deliveryDays') or delivery_metadata.get('weekDays') or delivery_metadata.get('deliveryDays') or existing_module_row.get('session_week_day')
    session_start_time = payload.get('startTime') or payload.get('sessionStartTime') or payload.get('session_start_time') or delivery_metadata.get('startTime') or delivery_metadata.get('start_time') or existing_module_row.get('session_start_time')
    session_end_time = payload.get('endTime') or payload.get('sessionEndTime') or payload.get('session_end_time') or delivery_metadata.get('endTime') or delivery_metadata.get('end_time') or existing_module_row.get('session_end_time')
    has_programme_deleted_flag = 'isProgrammeDeleted' in payload or 'is_programme_deleted' in payload
    # An unsent flag is re-derived from the programme this save attaches the
    # module to, but only for a row that carries no delete stamp. Carrying the
    # flag over left a module flagged as programme-deleted with deleted_at null
    # after it had been re-attached to a live programme: the tree filtered it
    # out and the parent repair stripped it from groups.module_ids, so a cohort
    # with attached modules read as having none. A row that *is* stamped
    # deleted keeps its state — saving must never resurrect curriculum that was
    # withdrawn on purpose, so restoring stays an explicit operation.
    # Moving a withdrawn module onto a live programme restores it, whatever the
    # payload says: that move *is* the recovery, and the frontend echoes back
    # the stale `isProgrammeDeleted: true` it was given, which used to pin the
    # module hidden under its new, perfectly live programme.
    if module_recovered_by_move_to_live(existing_module_row, programme_id):
        is_programme_deleted = False
    elif has_programme_deleted_flag:
        is_programme_deleted = truthy(payload.get('isProgrammeDeleted') or payload.get('is_programme_deleted'))
    elif row_has_deleted_at(existing_module_row):
        is_programme_deleted = True
    else:
        is_programme_deleted = programme_archived_for_authoring(programme_id)
    # `sessions_number` is the calendar session count (weeks × delivery days per
    # week). `weeks` doubles as the legacy alias for the week LIST on this
    # endpoint, so an int under that name is a structure payload error; the
    # scalar is supplied as `weeksNumber` instead and used only to seed
    # `sessions_number` when no other count is available.
    authored_week_count = parse_int(payload.get('weeksNumber'), 0) or parse_int(payload.get('weeks_number'), 0)
    if authored_week_count <= 0:
        authored_week_count = len(weeks) or module_stored_week_count(existing_module_row)
    weekly_schedule = merged_weekly_schedule(payload, existing_module_row)
    schedule_mode = payload.get('scheduleMode', existing_module_row.get('schedule_mode') or 'group')
    try:
        week_boundary_mode = merged_week_boundary_mode(payload, existing_module_row)
    except ValueError as exc:
        raise ModuleAuthoringValidationError([{'path': 'weekBoundaryMode', 'message': str(exc)}]) from exc
    week_starts_on = merged_week_starts_on(payload, existing_module_row) if schedule_mode == 'custom' or week_boundary_mode else None
    if week_boundary_mode and not week_starts_on:
        raise ModuleAuthoringValidationError([{'path': 'weekStartsOn', 'message': 'Choose the first day of the study week.'}])
    if week_boundary_mode and authored_week_count > 104:
        raise ModuleAuthoringValidationError([{'path': 'weeksNumber', 'message': 'Choose between 1 and 104 study weeks.'}])
    if week_boundary_mode and authored_week_count:
        from curriculum_api.study_weeks import build_study_week_plan
        study_start = parse_date(payload.get('startDate', payload.get('start_date', existing_module_row.get('start_date'))))
        study_end = parse_date(payload.get('endDate', payload.get('end_date', existing_module_row.get('end_date'))))
        if study_start:
            try:
                build_study_week_plan(study_start, authored_week_count, set(), {}, week_starts_on, study_end)
            except ValueError as exc:
                raise ModuleAuthoringValidationError([{'path': 'endDate', 'message': str(exc)}]) from exc
    if week_boundary_mode and not has_column(AUTHORING_MODULES_TABLE, 'week_boundary_mode'):
        raise ModuleAuthoringValidationError([{'path': 'weekBoundaryMode', 'message': 'Apply curriculum migration 0091 before saving study weeks.'}])
    if not week_boundary_mode and schedule_mode == 'custom' and len(weekly_schedule) > 1 and (week_starts_on or not existing_module_row):
        week_starts_on = first_weekly_session_day(
            payload.get('startDate', payload.get('start_date', existing_module_row.get('start_date'))), weekly_schedule,
        )
    if week_starts_on and not has_column(AUTHORING_MODULES_TABLE, 'week_starts_on'):
        raise ModuleAuthoringValidationError([{'path': 'weekStartsOn', 'message': 'Apply curriculum migration 0089 before saving first-session weeks.'}])
    if weekly_schedule:
        if not has_column(AUTHORING_MODULES_TABLE, 'weekly_schedule'):
            raise ModuleAuthoringValidationError([{'path': 'weeklySchedule', 'message': 'Apply curriculum migration 0063 before saving per-day times.'}])
        session_week_day = ', '.join(slot['day'] for slot in weekly_schedule)
        session_start_time = weekly_schedule[0]['startTime']
        session_end_time = weekly_schedule[0]['endTime']
    delivery_day_count = delivery_days_per_week({'session_week_day': session_week_day})
    requested_sessions = parse_int(payload.get('sessionsNumber'), 0) or parse_int(payload.get('sessions_number'), 0)
    if requested_sessions > 0:
        stored_sessions_number = requested_sessions
    elif parse_int(existing_module_row.get('sessions_number'), 0) > 0:
        stored_sessions_number = parse_int(existing_module_row.get('sessions_number'), 0)
    elif authored_week_count > 0:
        stored_sessions_number = authored_week_count * delivery_day_count
    else:
        stored_sessions_number = parse_int(existing_module_row.get('sessions_number'), 0)
    # Imported/session-based structures can grow while carrying the original
    # allocation's stale count. Every authored live component needs a calendar
    # occurrence; a reading-only holiday row needs none. Keep the planned count
    # as a floor for week shells that have not had their live sessions authored.
    stored_sessions_number = max(stored_sessions_number, sum(module_structure_live_session_counts(weeks)))

    calendar_update = {}
    if 'calendarPolicy' in payload or 'calendar_policy' in payload:
        try:
            calendar_update = policy_write(payload, existing_module_row, AUTHORING_MODULES_TABLE)
        except ValueError as exc:
            raise ModuleAuthoringValidationError([{'path': 'calendarPolicy', 'message': str(exc)}]) from exc
    saved_module_row = None
    with transaction.atomic():
        saved_module_row = authoring_upsert(AUTHORING_MODULES_TABLE, ['module_catalogue_id'], {
            'module_catalogue_id': module_catalogue_id,
            'programme_id': programme_id,
            # One status. A module under an archived programme stays archived;
            # any other save leaves it live.
            'status': archive_state.INACTIVE if is_programme_deleted else archive_state.ACTIVE,
            'cohort_id': cohort_id,
            'group_id': group_id,
            'learner_roster_mode': learner_roster_mode,
            'teams_shared_source_module_id': teams_shared_source_module_id or None,
            'ksb_remap_report': json.dumps(ksb_remap_report or {}),
            'title': payload.get('title') or payload.get('name') or existing_module_row.get('title') or f'Module {module_catalogue_id}',
            'description': payload.get('description') if 'description' in payload else existing_module_row.get('description') or '',
            'color': payload.get('color') if 'color' in payload else delivery_metadata.get('color') or existing_module_row.get('color') or '',
            # Optional module artwork, stored exactly the way a free course
            # stores its cover: either a pasted URL or a data: URL read off the
            # picked file. An absent key keeps whatever is stored; an explicit
            # '' clears it, which is what the drawer's Remove sends.
            'cover_image_url': stored_module_cover_image(module_catalogue_id, clean_str(
                payload.get('coverImage') if 'coverImage' in payload
                else payload.get('cover_image_url') if 'cover_image_url' in payload
                else existing_module_row.get('cover_image_url')
            )),
            # No draft/published value: modules.status is the lifecycle only
            # (active/inactive, CHECK-constrained), set above.
            'sessions_number': stored_sessions_number,
            # parse_date, not the raw value: callers that merge a stored payload
            # send '' for a module that has no dates, and an empty string reaching
            # a date column is a DataError, not a null. '' means "no date".
            'start_date': parse_date(payload.get('startDate') if 'startDate' in payload else payload.get('start_date') if 'start_date' in payload else existing_module_row.get('start_date')),
            'end_date': parse_date(payload.get('endDate') if 'endDate' in payload else payload.get('end_date') if 'end_date' in payload else existing_module_row.get('end_date')),
            'quality_score': quality_score,
            'source_type': payload.get('sourceType') or payload.get('source_type') or existing_module_row.get('source_type') or None,
            'source_id': payload.get('sourceId') or payload.get('source_id') or existing_module_row.get('source_id') or None,
            'ksb_profile_source_id': normalise_ksb_profile_source_value(payload.get('ksbProfileSourceId') if 'ksbProfileSourceId' in payload else payload.get('ksb_profile_source_id') if 'ksb_profile_source_id' in payload else existing_module_row.get('ksb_profile_source_id')),
            'session_week_day': session_week_day or None,
            'session_start_time': session_start_time or None,
            'session_end_time': session_end_time or None,
            'weekly_schedule': json_db_value(weekly_schedule),
            'schedule_mode': schedule_mode,
            'week_starts_on': week_starts_on,
            'week_boundary_mode': week_boundary_mode,
            **calendar_update,
            'tutor_name': tutor_name or None,
            'tutor_email': tutor_email or None,
        }, allow_null_columns={'price', 'week_starts_on', 'week_boundary_mode', 'calendar_policy'})
        if is_free_course:
            # After the module write: on the old database that write is what
            # creates or refreshes the free course row the price is kept on.
            try:
                free_course_pricing.save(module_catalogue_id, course_pricing)
            except free_course_pricing.FreeCoursePricingUnavailable as error:
                raise ModuleAuthoringValidationError([{'path': error.args[0], 'message': error.args[1]}]) from error
        # Written only when the share itself changed. The `modules` column above
        # and this table say the same thing; rewriting the table on every save
        # meant every save could delete a share, which is how one went missing.
        if teams_share_changed and teams_shared_source_module_id:
            authoring_upsert(MODULE_TEAMS_SHARES_TABLE, ['module_catalogue_id'], {
                'module_catalogue_id': module_catalogue_id,
                'source_module_catalogue_id': teams_shared_source_module_id,
                'updated_at': datetime.utcnow(),
            })
        elif teams_share_changed:
            delete_rows(MODULE_TEAMS_SHARES_TABLE, 'module_catalogue_id = %s', [module_catalogue_id])
        # A shared-Teams duplicate is an alias, not a second owner.  Replaying
        # the source's delivery metadata through the normal linker would move
        # the live_sessions row away from its canonical module, breaking the
        # original's calendar, attendance and recordings.  The alias resolves
        # the source row on reads instead.
        if not teams_shared_source_module_id and not is_free_course:
            link_live_session_series_to_module(module_catalogue_id, {**payload, 'weekStructure': weeks})
        # Read before the withdraw-and-rewrite below, because the assurance
        # flags a payload does not mention must survive this save - see
        # component_assurance_flag(). Keyed by id; a component this payload is
        # creating simply is not in here.
        stored_components_by_id = {
            clean_str(row.get('id')): row
            for row in (
                stored_rows.get(AUTHORING_COMPONENTS_TABLE) or [] if light
                else authoring_fetch_all(AUTHORING_COMPONENTS_TABLE, 'module_catalogue_id = %s', [module_catalogue_id])
            )
        }
        if not write_changed_only:
            authoring_soft_delete(AUTHORING_WEEKS_TABLE, 'module_catalogue_id = %s', [module_catalogue_id], deleted_by='module-save')
            authoring_soft_delete(AUTHORING_COMPONENTS_TABLE, 'module_catalogue_id = %s', [module_catalogue_id], deleted_by='module-save')
            authoring_soft_delete(AUTHORING_KSB_MAPPINGS_TABLE, *ksb_mapping_placement.where(module_catalogue_id), deleted_by='module-save')

        mapping_source_cache = {}
        week_payloads = []
        component_payloads = []
        mapping_payloads = []
        for week_index, week in enumerate(weeks):
            week_id = canonical_authoring_id('WEEK', week.get('id'))
            week_payloads.append({
                'id': week_id,
                'module_catalogue_id': module_catalogue_id,
                'week_number': parse_int(week.get('weekNumber') or week.get('week_number'), week_index + 1),
                'title': week.get('title') or f'Week {week_index + 1}',
                'summary': week.get('summary') or '',
                'learning_outcomes': json_db_value(week.get('learningOutcomes') or []),
                'copied_from_id': clean_str(week.get('copiedFromId') or week.get('copied_from_id')) or None,
                # The hint the author wrote for a holiday week, and whether it is
                # published. The switch is what a learner read depends on, so an
                # absent key is OFF rather than "leave it as it was": this save
                # replaces the week row outright and there is nothing to leave.
                'holiday_note_enabled': bool_payload(week.get('holidayNoteEnabled') or week.get('holiday_note_enabled')),
                'holiday_note': clean_str(week.get('holidayNote') or week.get('holiday_note')),
                'display_order': week_index,
                'status': archive_state.ACTIVE,
            })
            for mapping in week.get('ksbMappings') or []:
                mapping_payloads.append(authoring_mapping_payload(
                    module_catalogue_id,
                    mapping,
                    week_id=week_id,
                    module_row=saved_module_row,
                    source_cache=mapping_source_cache,
                ))
            for component_index, component in enumerate(week.get('components') or []):
                component_id = canonical_authoring_id('COMP', component.get('id'))
                component_settings = component.get('settings') if isinstance(component.get('settings'), dict) else {}
                # Column first, legacy settings key kept in step with it - see
                # payload_reflection_question().
                component_reflection = payload_reflection_question(component, component_settings)
                component_settings = {**component_settings, LEGACY_REFLECTION_QUESTION_SETTING: component_reflection}
                # An additional week meeting is booked in Microsoft and belongs
                # to the STORED component, not to whatever this tab last read.
                # This save replaces settings_json outright, so a builder opened
                # before the meeting was booked -- or any client that simply does
                # not know these keys -- would otherwise wipe the only record of
                # a real meeting, taking its join link off the live session with
                # it. The stored values win; nothing in a payload can clear them.
                component_settings = preserve_additional_meeting_settings(
                    component_settings, stored_components_by_id.get(component_id),
                )
                if (not is_free_course and frontend_component_type(component.get('type')) == 'live-session'
                        and (not teams_shared_source_module_id
                             or clean_str(component_settings.get('liveSessionLinkOverride')))):
                    stored_row = stored_components_by_id.get(component_id)
                    component_settings = manual_link_settings(
                        component_settings, component_builder_settings(stored_row) if stored_row else {},
                    )
                if teams_shared_source_module_id:
                    component_settings = strip_shared_teams_delivery_settings(component_settings)
                component_ksb_items, component_mapping_payloads = normalise_component_ksb_mappings(
                    module_catalogue_id,
                    component.get('ksbMappings') or [],
                    week_id=week_id,
                    component_id=component_id,
                    module_row=saved_module_row,
                    source_cache=mapping_source_cache,
                    enforce_unique=False,
                )
                component_payloads.append({
                    'id': component_id,
                    'week_id': week_id,
                    'module_catalogue_id': module_catalogue_id,
                    'type': normalise_component_type(component.get('type')),
                    'title': component.get('title') or '',
                    'description': component.get('description') or '',
                    'expected_otjh': component_expected_otjh(component),
                    'points': parse_int(component.get('points'), 0),
                    'ksb_mappings': json_db_value(component_ksb_items),
                    'reflection_required': component_assurance_flag(
                        component, stored_components_by_id.get(component_id),
                        'reflectionRequired', 'reflection_required', False),
                    REFLECTION_QUESTION_COLUMN: component_reflection,
                    'workplace_evidence_required': False,
                    'tutor_validation_required': component_assurance_flag(
                        component, stored_components_by_id.get(component_id),
                        'tutorValidationRequired', 'tutor_validation_required', False),
                    'coach_validation_required': component_assurance_flag(
                        component, stored_components_by_id.get(component_id),
                        'coachValidationRequired', 'coach_validation_required', True),
                    'display_order': component_index,
                    'settings_json': json_db_value(component_settings),
                    # An alias has its meeting keys stripped above, so its own
                    # replaced link is the only one it can store here.
                    'live_sessions_link': clean_str(
                        component_settings.get('liveSessionUrl')
                        or component_settings.get('teamsMeetingUrl')
                        or component_settings.get('liveSessionLinkOverride')
                    ),
                    'copied_from_id': clean_str(component.get('copiedFromId') or component.get('copied_from_id')) or None,
                    'status': archive_state.ACTIVE,
                })
                mapping_payloads.extend(component_mapping_payloads)
        for mapping in payload.get('moduleKsbMappings') or []:
            mapping_payloads.append(authoring_mapping_payload(
                module_catalogue_id,
                mapping,
                module_row=saved_module_row,
                source_cache=mapping_source_cache,
            ))
        if write_changed_only:
            write_changed_authoring_rows(
                module_catalogue_id, week_payloads, component_payloads, mapping_payloads, stored_components_by_id,
                stored_rows=stored_rows if light else None,
            )
        else:
            authoring_bulk_upsert(AUTHORING_WEEKS_TABLE, ['id'], week_payloads)
            authoring_bulk_upsert(AUTHORING_COMPONENTS_TABLE, ['id'], component_payloads)
            authoring_bulk_upsert(AUTHORING_KSB_MAPPINGS_TABLE, ['id'], mapping_payloads)
        # Learner progress carries a snapshot of each component's KSBs. A light
        # save re-syncs only the components whose mappings it changed: the rest
        # already match, and each one costs a read of learner progress.
        sync_progress_ksbs({
            component['id']: as_json_value(component.get('ksb_mappings'), [])
            for component in component_payloads
            if not light or authoring_comparable('ksb_mappings', component.get('ksb_mappings')) != authoring_comparable(
                'ksb_mappings', (stored_components_by_id.get(component['id']) or {}).get('ksb_mappings'))
            or not authoring_row_is_active(stored_components_by_id.get(component['id']) or {})
        }, actor='curriculum-module-save')

        criteria = payload.get('completionCriteria') or {}
        defaults = default_completion_payload()
        completion_payload = {
            'module_catalogue_id': module_catalogue_id,
            'quizzes_completed_required': bool_payload(criteria.get('quizzesCompletedRequired')),
            'checkpoints_completed_required': bool_payload(criteria.get('checkpointsCompletedRequired')),
            'average_score_required_enabled': bool_payload(criteria.get('averageScoreRequiredEnabled')),
            'average_score_required': parse_int(criteria.get('averageScoreRequired'), defaults['averageScoreRequired']),
            'total_score_required_enabled': bool_payload(criteria.get('totalScoreRequiredEnabled')),
            'total_score_required': parse_int(criteria.get('totalScoreRequired'), defaults['totalScoreRequired']),
            'additional_notes': criteria.get('additionalNotes') or '',
        }
        stored_completion = (stored_rows.get(AUTHORING_COMPLETION_TABLE) or [None])[0] if light else None
        if not light or authoring_row_differs(completion_payload, stored_completion):
            authoring_upsert(AUTHORING_COMPLETION_TABLE, ['module_catalogue_id'], completion_payload)

        advanced = payload.get('advancedDetails') or {}
        advanced_payload = {
            'module_catalogue_id': module_catalogue_id,
            'background': payload.get('background') or '',
            'epa_requirements': json_db_value(payload.get('epaRequirements') or []),
            'professional_qualification_outcomes': json_db_value(payload.get('qualificationOutcomes') or []),
            'intent': advanced.get('intent') or '',
            'learner_benefit': advanced.get('learnerBenefit') or '',
            'employer_benefit': advanced.get('employerBenefit') or '',
            'sequence_purpose': advanced.get('sequencePurpose') or '',
        }
        stored_advanced = (stored_rows.get(AUTHORING_ADVANCED_TABLE) or [None])[0] if light else None
        if not light or authoring_row_differs(advanced_payload, stored_advanced):
            authoring_upsert(AUTHORING_ADVANCED_TABLE, ['module_catalogue_id'], advanced_payload)

    # What the group row and the parent-link repair maintain: the module's place
    # in the tree, its title (groups.module_names) and whether it is withdrawn.
    # A light save that moved none of them leaves both alone -- they are written
    # for every group and cohort of the programme, so running them for a
    # component edit is what made saves of unrelated modules queue.
    lineage_changed = (not light) or any(
        clean_str(before) != clean_str(after) for before, after in (
            (existing_module_row.get('programme_id'), programme_id),
            (existing_module_row.get('programme_name'), programme_name),
            (existing_module_row.get('cohort_id'), cohort_id),
            (existing_module_row.get('cohort_name'), cohort_name),
            (existing_module_row.get('group_id'), group_id),
            (existing_module_row.get('group_name'), group_name),
            (existing_module_row.get('title'), (saved_module_row or {}).get('title')),
        )
    ) or archive_state.row_inactive(existing_module_row) != bool(is_programme_deleted)
    if group_id and lineage_changed:
        # A module can override its group's timetable. Only a newly inferred
        # group inherits these defaults; saving a module must not rewrite an
        # existing group's days/times (and thereby affect its other modules).
        group_schedule = {} if fetch_group_row(group_id) else {
            'weekDays': session_week_day,
            'startTime': session_start_time,
            'endTime': session_end_time,
        }
        persist_group_authoring_detail({
            'id': group_id,
            'name': group_name,
            'cohortId': cohort_id,
            'cohort': cohort_name,
            'programmeId': programme_id,
            'programme': programme_name,
            **group_schedule,
            'modules': [payload.get('title') or payload.get('name') or f'Module {module_catalogue_id}'],
        }, [], [saved_module_row] if saved_module_row else [])

    if repair_links and programme_id and lineage_changed:
        # Scoped to the programme just saved. A module with none would pass ''
        # here, which is the unscoped whole-estate sweep -- that blanks
        # programme_id on groups whose cohort is missing and the foreign key
        # then rejects the write.
        repair_curriculum_parent_links(programme_id)
    if not is_free_course and (not light or module_live_sessions_affected(stored_structure, {**payload, 'weekStructure': weeks})):
        calendars = authoring_fetch_all(LIVE_SESSIONS_TABLE, "module_catalogue_id = %s and status = 'active'", [module_catalogue_id])
        if calendars and (stored_calendar_series(calendars[0]) or clean_str(calendars[0].get('meeting_type')) == 'linked-external'):
            calendar = calendars[0]
            occurrences = authoring_fetch_all(LIVE_SESSION_OCCURRENCES_TABLE, "live_session_id = %s and status not in ('cancelled', 'superseded')", [calendar['id']], 'session_number')
            attach_teams_meeting_to_module_weeks(module_catalogue_id, calendar, live_session_row_to_component_settings(calendar), occurrences)
    refresh_totals(module_catalogue_id)
    invalidate_curriculum_cache()
    if not build_result:
        return {'catalogueId': module_catalogue_id, 'qualityChecklist': checklist}
    result = get_authoring_structure_payload(module_catalogue_id)
    result['qualityChecklist'] = checklist
    return result
