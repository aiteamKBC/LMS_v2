"""Session and staffing HTTP contracts; persistence and validation capabilities are explicit.

No views, provider or Django imports.
"""
from ..application.staff_assignment_writes import save_staffing_assignment, StaffingSourceUnavailable
from curriculum_api.weekly_schedule import module_week_boundary_mode


def curriculum_session_detail(
    request, identifier, *, AUTHORING_MODULES_TABLE, JsonResponse, authoring_fetch_all,
    authoring_upsert, canonical_staff_assignment_name, clean_str, date_non_delivery_reason,
    invalidate_curriculum_cache, json_body, json_error, module_schedule_assignment_changed,
    module_schedule_view, re, tutor_assignment_delivery_day_error, tutor_conflict_error,
    tutor_conflict_override_requested, tutor_schedule_conflicts_created,
):
    if request.method not in {'PATCH', 'DELETE'}:
        return json_error('Method not allowed.', status=405)
    module_match = re.match(r'^module-(.+)-session-(\d+)$', clean_str(identifier))
    if module_match:
        module_catalogue_id, week_number = module_match.groups()
        rows = authoring_fetch_all(AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s', [module_catalogue_id])
        if not rows:
            return json_error('Session not found.', status=404)
        if request.method == 'DELETE':
            return json_error('Individual generated sessions cannot be safely cancelled without updating the parent module allocation.', status=409)
        payload = json_body(request)
        if payload is None:
            return json_error('Invalid JSON body.')
        current = rows[0]
        updates = {
            **current,
            'session_start_time': payload.get('startTime') if 'startTime' in payload else current.get('session_start_time'),
            'session_end_time': payload.get('endTime') if 'endTime' in payload else current.get('session_end_time'),
            'tutor_name': canonical_staff_assignment_name('tutor', payload.get('tutor')) if 'tutor' in payload else current.get('tutor_name'),
        }
        if payload.get('date'):
            non_delivery_reason = date_non_delivery_reason(payload.get('date'), current)
            if non_delivery_reason:
                return json_error(non_delivery_reason, status=400, code='non_delivery_date', fields=['date'])
            if int(week_number) != 1:
                return json_error('Only week 1 generated sessions can update start_date directly. Later session dates are calculated from the parent module start date.', status=409)
            updates['start_date'] = payload.get('date')
        # Editing a session from the calendar moves the whole module: `updates`
        # is the module row, and start_date/times/tutor here are the same fields
        # the module PATCH guards. Checked after the date is merged in, so a move
        # onto a taken day is caught as well as a change of tutor.
        candidate = module_schedule_view(updates)
        delivery_day_error = tutor_assignment_delivery_day_error(
            candidate, before=module_schedule_view(current),
        )
        if delivery_day_error:
            return delivery_day_error
        if not tutor_conflict_override_requested(payload) and module_schedule_assignment_changed(
            module_schedule_view(current), candidate
        ):
            conflicts = tutor_schedule_conflicts_created(module_schedule_view(current), candidate)
            if conflicts:
                return tutor_conflict_error(candidate, conflicts)
        authoring_upsert(AUTHORING_MODULES_TABLE, ['module_catalogue_id'], updates)
        invalidate_curriculum_cache()
        return JsonResponse({'updated': True, 'id': identifier})

    match = re.match(r'^training-(\d+)-session-(\d+)$', clean_str(identifier))
    if not match:
        return json_error('Session not found.', status=404)
    return json_error('Legacy training-plan sessions are no longer editable in the current curriculum schema.', status=409)


def curriculum_session_collection(request, *, curriculum_sessions, json_error):
    if request.method == 'GET':
        return curriculum_sessions(request)
    return json_error('Generated sessions are derived from normalized curriculum modules. Create a module/cohort/group allocation first.', status=409)


def curriculum_staffing_collection(
    request, *, JsonResponse, get_cached_payload, json_body, json_error, require_fields,
    update_staffing_assignment,
):
    if request.method == 'GET':
        payload = get_cached_payload(request)
        from ..application.staff_profiles import staffing_assignments
        assignments = staffing_assignments(payload['groups'])
        return JsonResponse({'schema': payload['schema'], 'count': len(assignments), 'results': assignments})
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)
    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')
    missing = require_fields(payload, ['groupId'])
    if missing:
        return json_error('Missing required fields.', fields=missing)
    return update_staffing_assignment(payload.get('groupId'), payload)


def curriculum_staffing_detail(request, identifier, *, json_body, json_error, update_staffing_assignment):
    if request.method not in {'PATCH', 'DELETE'}:
        return json_error('Method not allowed.', status=405)
    payload = {} if request.method == 'DELETE' else json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')
    if request.method == 'DELETE':
        payload = {'tutor': '', 'coach': ''}
    return update_staffing_assignment(identifier, payload)


def update_staffing_assignment(
    identifier, payload, *, AUTHORING_MODULES_TABLE, JsonResponse, canonical_group_coaches,
    canonical_staff_assignment_name, clean_str, datetime, group_tutor_assignment_conflict,
    group_tutor_assignment_delivery_day_error, invalidate_curriculum_cache, json_error,
    notify_staff_assignment_change, read_staffing_module_ids, resolve_group_row,
    resolve_staff_assignment_email, tutor_conflict_error, tutor_conflict_override_requested,
    update_authoring_rows, update_group_fields, with_group_coaches,
):
    payload = with_group_coaches(payload)
    group_row = resolve_group_row(identifier)
    if not group_row:
        return json_error('Group not found for staffing assignment.', status=404)
    group_id = clean_str(group_row.get('group_id'))

    # Same reasoning as the group PATCH: the coach write below lands before the
    # tutor is pushed onto the group's modules, so the refusal has to come first.
    if 'tutor' in payload:
        delivery_day_error = group_tutor_assignment_delivery_day_error(
            group_id,
            canonical_staff_assignment_name('tutor', payload.get('tutor')),
        )
        if delivery_day_error:
            return delivery_day_error
    if 'tutor' in payload and not tutor_conflict_override_requested(payload):
        candidate, conflicts = group_tutor_assignment_conflict(
            group_id,
            canonical_staff_assignment_name('tutor', payload.get('tutor')),
        )
        if conflicts:
            return tutor_conflict_error(candidate, conflicts)

    try:
        result = save_staffing_assignment(
            group_id, payload,
            AUTHORING_MODULES_TABLE=AUTHORING_MODULES_TABLE,
            canonical_group_coaches=canonical_group_coaches,
            canonical_staff_assignment_name=canonical_staff_assignment_name,
            datetime=datetime, invalidate_curriculum_cache=invalidate_curriculum_cache,
            notify_staff_assignment_change=notify_staff_assignment_change,
            read_staffing_module_ids=read_staffing_module_ids,
            resolve_staff_assignment_email=resolve_staff_assignment_email,
            update_authoring_rows=update_authoring_rows, update_group_fields=update_group_fields,
        )
    except StaffingSourceUnavailable:
        return json_error('Unable to read module assignments. Please try again.', status=503)
    return JsonResponse(result)


def curriculum_preview_module_session_plan(
    request, *, JsonResponse, build_module_session_plan, first_weekly_session_day, json_body,
    json_error, module_delivery_session_plan, module_schedule_view, module_session_clock,
    module_week_starts_on, module_weekly_schedule, parse_date, parse_int,
):
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)
    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')
    try:
        module_week_starts_on(payload)
        if module_week_boundary_mode(payload) and not module_week_starts_on(payload):
            raise ValueError("Choose the first day of the study week.")
    except ValueError as exc:
        return json_error(str(exc), fields=['weekStartsOn'])
    try:
        weekly = module_weekly_schedule(payload)
    except ValueError as exc:
        return json_error(str(exc), fields=['weeklySchedule'])
    from ..application.delivery_schedules import preview_module_session_plan
    try:
        return JsonResponse(preview_module_session_plan(
            payload, weekly,
            module_schedule_view=module_schedule_view,
            module_delivery_session_plan=module_delivery_session_plan,
            parse_date=parse_date,
            parse_int=parse_int,
            build_module_session_plan=build_module_session_plan,
            first_weekly_session_day=first_weekly_session_day,
            module_week_starts_on=module_week_starts_on,
            module_session_clock=module_session_clock,
        ))
    except ValueError as exc:
        if module_week_boundary_mode(payload) or (payload.get('endDate') and payload.get('weeksNumber')):
            return json_error(str(exc), fields=['weeksNumber', 'endDate'])
        raise


def curriculum_preview_tutor_availability(
    request, *, AUTHORING_MODULES_TABLE, DEFAULT_SESSION_END_TIME, DEFAULT_SESSION_START_TIME,
    GROUPS_TABLE, GROUP_ROWS_ORDER, JsonResponse, authoring_fetch_all, clean_str, connections,
    curriculum_read_scope, fetch_staff_users_by_access, find_tutor_schedule_conflicts, json_body,
    json_error, logger, module_schedule_view, module_session_dates, module_time_window,
    module_week_starts_on, module_weekly_schedule, resolve_stored_module_catalogue_id,
    staff_assignment_key, staff_profile_is_archived, staff_profile_name, staff_user_profile_source,
    surviving_authoring_module_rows, truthy, tutor_conflict_message, tutor_delivery_schedule,
    unique,
):
    """Which tutors are already teaching in a proposed slot.

    Discovering a double-booking by having a save refused is a poor trade: the
    person has already chosen a tutor, filled the rest of the form and pressed
    Save before anything tells them the choice was never going to work. This runs
    the *same* rule ahead of the write so a screen can say so while the tutor is
    still being picked.

    Send the slot -- `startDate`, `sessionsNumber`, `weekDays`, `startTime`,
    `endTime` -- plus:

    * `tutor` to ask about one person, or
    * nothing, to get every tutor's answer in one call, which is what lets a
      picker mark the busy names instead of letting the user find out later.

    `moduleCatalogueId` excludes the module being edited, so a module never
    reports itself as the thing blocking its own slot.
    """
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)
    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')
    try:
        module_week_starts_on(payload)
        module_week_boundary_mode(payload)
    except ValueError as exc:
        return json_error(str(exc), fields=['weekStartsOn'])
    try:
        module_weekly_schedule(payload)
    except ValueError as exc:
        return json_error(str(exc), fields=['weeklySchedule'])

    from functools import partial
    from ..application.tutor_availability import preview_tutor_availability, TutorAvailabilityUnavailable
    from ..infrastructure.tutor_reads import read_module_rows, read_group_rows, read_tutor_rows
    try:
        result = preview_tutor_availability(
            payload,
            module_schedule_view=module_schedule_view,
            clean_str=clean_str,
            curriculum_read_scope=curriculum_read_scope,
            resolve_stored_module_catalogue_id=resolve_stored_module_catalogue_id,
            read_module_rows=partial(read_module_rows, authoring_fetch_all=authoring_fetch_all, table=AUTHORING_MODULES_TABLE),
            read_group_rows=partial(read_group_rows, authoring_fetch_all=authoring_fetch_all, table=GROUPS_TABLE, order_sql=GROUP_ROWS_ORDER, clean_str=clean_str),
            read_tutor_rows=partial(read_tutor_rows, fetch_staff_users_by_access=fetch_staff_users_by_access, staff_user_profile_source=staff_user_profile_source, staff_profile_is_archived=staff_profile_is_archived, enrolment_available='enrolment' in connections),
            surviving_authoring_module_rows=surviving_authoring_module_rows,
            tutor_delivery_schedule=tutor_delivery_schedule,
            find_tutor_schedule_conflicts=find_tutor_schedule_conflicts,
            tutor_conflict_message=tutor_conflict_message,
            module_session_dates=module_session_dates,
            module_time_window=module_time_window,
            DEFAULT_SESSION_START_TIME=DEFAULT_SESSION_START_TIME,
            DEFAULT_SESSION_END_TIME=DEFAULT_SESSION_END_TIME,
            unique=unique,
            staff_profile_name=staff_profile_name,
            truthy=truthy,
            staff_assignment_key=staff_assignment_key,
        )
    except TutorAvailabilityUnavailable:
        logger.warning('Required tutor availability data could not be read.')
        return json_error('Unable to check tutor availability. Please try again.', status=503)
    if result is None:
        return json_error('Module not found.', status=404)
    return JsonResponse(result)
