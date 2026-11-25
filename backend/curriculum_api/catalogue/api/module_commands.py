"""Module collection, detail and artwork HTTP contracts. Authentication and URLs remain at the public seam.

Named capabilities are supplied by the existing composition seam during migration.
No application settings, legacy views or provider runtime is imported here.
"""
from curriculum_api.weekly_schedule import module_week_boundary_mode
from curriculum_api.weekly_schedule import merged_week_boundary_mode


def curriculum_module_collection(
    request,
    *,
    COURSE_PRICING_FIELDS,
    JsonResponse,
    ModuleAuthoringValidationError,
    authoring_module_exists,
    clean_str,
    creation_unavailable_response,
    curriculum_modules,
    default_completion_payload,
    find_existing_authoring_catalogue_id_for_payload,
    first_clean_payload_value,
    get_authoring_structure_payload,
    identity_values_match_context,
    is_free_course_payload,
    json_body,
    json_error,
    log_curriculum_decision,
    module_week_starts_on,
    module_weekly_schedule,
    module_withdrawn_on_its_own,
    normalise,
    normalise_ksb_profile_source_value,
    require_fields,
    safe_authoring_module_rows,
    save_module_authoring_structure,
    stamp_revision_after_write,
    truthy,
    unique_module_catalogue_id,
    with_item_fingerprints,
):
    if request.method == 'GET':
        return curriculum_modules(request)
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)

    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')
    storage_error = creation_unavailable_response(payload)
    if storage_error is not None:
        return storage_error
    is_free_course = is_free_course_payload(payload)
    if is_free_course:
        payload = {**payload, 'isFreeCourse': True}
    try:
        module_week_starts_on(payload)
        module_week_boundary_mode(payload)
    except ValueError as exc:
        return json_error(str(exc), fields=['weekStartsOn'])
    try:
        module_weekly_schedule(payload)
    except ValueError as exc:
        return json_error(str(exc), fields=['weeklySchedule'])
    module_type = clean_str(payload.get('moduleType') or payload.get('module_type') or payload.get('sourceType') or payload.get('source_type')).lower()
    has_authoring_shape = bool(payload.get('weekStructure') is not None or payload.get('completionCriteria') is not None or payload.get('advancedDetails') is not None)
    is_authoring_request = is_free_course or module_type in {'authoring', 'module_builder', 'builder'} or (payload.get('title') and (not payload.get('name') or has_authoring_shape))
    if is_authoring_request:
        requested_catalogue_id = first_clean_payload_value(payload, 'catalogueId', 'moduleCatalogueId', 'module_catalogue_id')
        module_catalogue_id = find_existing_authoring_catalogue_id_for_payload(payload) or unique_module_catalogue_id(requested_catalogue_id)
        if module_withdrawn_on_its_own(authoring_module_exists(module_catalogue_id)):
            # A create never lands on an archived module; see
            # find_existing_authoring_catalogue_id_for_payload. Restoring one
            # is the archive's Restore, which brings its weeks back with it.
            module_catalogue_id = unique_module_catalogue_id()
        existing_live_module = authoring_module_exists(module_catalogue_id)
        if existing_live_module and (existing_live_module.get('source_type') == 'free_course') != is_free_course:
            return json_error('This identifier belongs to a different course type. Create a new course instead.', status=400)
        if existing_live_module and truthy(payload.get('duplicateDestination') or payload.get('duplicate_destination')):
            # A duplicate is its own module. Matching it to a same-titled module
            # already in the destination group used to replace that module's
            # weeks, components and Teams share with the copy.
            module_catalogue_id = unique_module_catalogue_id()
        elif existing_live_module:
            # A create that matched a module already there -- the same title in
            # the same programme, cohort and group, or a retry of a create that
            # did land. Writing this payload over it would blank every field the
            # create form does not send (its Teams share among them) and replace
            # its weeks, with no version check at all. It is answered with the
            # module as stored, unchanged; editing it is the Builder's job.
            log_curriculum_decision(
                'module.create', outcome='matched_existing_unchanged', entity_id=module_catalogue_id,
            )
            existing_structure = get_authoring_structure_payload(module_catalogue_id) or {}
            return JsonResponse({
                'created': False,
                'existing': True,
                'moduleCatalogueId': module_catalogue_id,
                'module': with_item_fingerprints(stamp_revision_after_write(existing_structure, module_catalogue_id)),
            }, status=200)
        module_payload = {
            'catalogueId': module_catalogue_id,
            'isFreeCourse': is_free_course,
            **{key: payload[key] for key in COURSE_PRICING_FIELDS if key in payload},
            'programmeId': payload.get('programmeId') or payload.get('programme') or payload.get('programmeName'),
            'programmeName': payload.get('programmeName') or payload.get('programme') or 'Unassigned programme',
            'programmeStatus': payload.get('programmeStatus') or payload.get('programme_status') or '',
            'title': payload.get('title') or payload.get('name'),
            'description': payload.get('description') or '',
            'color': payload.get('color') or '',
            'coverImage': payload.get('coverImage') or payload.get('cover_image_url') or '',
            'status': payload.get('status') or 'draft',
            'sessionsNumber': payload.get('sessionsNumber') or payload.get('sessions_number') or 0,
            'weeksNumber': payload.get('weeks') or payload.get('weeksNumber') or 0,
            'weeklySchedule': payload.get('weeklySchedule'),
            'scheduleMode': payload.get('scheduleMode') or 'group',
            'weekStartsOn': module_week_starts_on(payload),
            'weekBoundaryMode': module_week_boundary_mode(payload),
            'weekDays': payload.get('weekDays'),
            'startTime': payload.get('startTime'),
            'endTime': payload.get('endTime'),
            'deliveryMetadata': payload.get('deliveryMetadata'),
            'startDate': payload.get('startDate') or payload.get('start_date') or '',
            'endDate': payload.get('endDate') or payload.get('end_date') or '',
            'tutor': payload.get('tutor') or payload.get('tutorName') or payload.get('tutor_name') or '',
            'coach': payload.get('coach') or payload.get('coachName') or payload.get('coach_name') or '',
            'cohortId': payload.get('cohortId') or payload.get('cohort_id') or '',
            'cohortName': payload.get('cohortName') or payload.get('cohort') or payload.get('cohort_name') or '',
            'groupId': payload.get('groupId') or payload.get('group_id') or '',
            'groupName': payload.get('groupName') or payload.get('group') or payload.get('group_name') or '',
            'learnerRosterMode': payload.get('learnerRosterMode') or payload.get('learner_roster_mode') or 'inherited',
            'teamsSharedSourceModuleId': payload.get('teamsSharedSourceModuleId') or payload.get('teams_shared_source_module_id') or '',
            'ksbRemapReport': payload.get('ksbRemapReport') or payload.get('ksb_remap_report') or {},
            'duplicateDestination': truthy(payload.get('duplicateDestination') or payload.get('duplicate_destination')),
            'declaredTotalOtjh': payload.get('totalOtjh') or 0,
            'moduleKsbMappings': payload.get('moduleKsbMappings') or [],
            'completionCriteria': payload.get('completionCriteria') or default_completion_payload(),
            'advancedDetails': payload.get('advancedDetails') or {},
            'background': payload.get('background') or '',
            'epaRequirements': payload.get('epaRequirements') or [],
            'qualificationOutcomes': payload.get('qualificationOutcomes') or [],
            'ksbProfileSourceId': normalise_ksb_profile_source_value(payload.get('ksbProfileSourceId') or payload.get('ksb_profile_source_id') or ''),
        }
        if 'weekStructure' in payload:
            module_payload['weekStructure'] = payload.get('weekStructure') or []
        elif isinstance(payload.get('weeks'), list):
            # Only a list is a week structure. A scalar `weeks` is the authored
            # week count, already read into `weeksNumber` above -- forwarding it
            # here made a plain `{"weeks": 5}` create fail as "Week structure
            # must be a list."
            module_payload['weeks'] = payload.get('weeks') or []
        try:
            result = save_module_authoring_structure(module_catalogue_id, module_payload)
        except ModuleAuthoringValidationError as exc:
            return json_error('Module authoring validation failed.', status=400, validationErrors=exc.errors)
        return JsonResponse({'created': True, 'moduleCatalogueId': result.get('catalogueId') or module_catalogue_id, 'module': result}, status=201)

    missing = require_fields(payload, ['name'])
    if missing:
        return json_error('Missing required fields.', fields=missing)

    name = clean_str(payload.get('name'))
    programme_values = [
        payload.get('programmeId'),
        payload.get('programme_id'),
        payload.get('programmeName'),
        payload.get('programme'),
    ]
    cohort_values = [
        payload.get('cohortId'),
        payload.get('cohort_id'),
        payload.get('cohortName'),
        payload.get('cohort'),
    ]
    group_values = [
        payload.get('groupId'),
        payload.get('group_id'),
        payload.get('groupName'),
        payload.get('group'),
    ]
    duplicate = next((
        row for row in safe_authoring_module_rows()
        if normalise(row.get('title')) == normalise(name)
        and identity_values_match_context([row.get('programme_id'), row.get('programme_name')], programme_values)
        and identity_values_match_context([row.get('cohort_id'), row.get('cohort_name')], cohort_values)
        and identity_values_match_context([row.get('group_id'), row.get('group_name')], group_values)
    ), None)
    if duplicate:
        return json_error('Module already exists.', status=409)

    module_catalogue_id = unique_module_catalogue_id(payload.get('moduleCatalogueId') or payload.get('catalogueId') or name)
    result = save_module_authoring_structure(module_catalogue_id, {
        'catalogueId': module_catalogue_id,
        'programmeId': payload.get('programmeId') or payload.get('programme_id') or payload.get('programme') or payload.get('programmeName'),
        'programmeName': payload.get('programmeName') or payload.get('programme') or 'Unassigned programme',
        'programmeStatus': payload.get('programmeStatus') or payload.get('programme_status') or '',
        'cohortId': payload.get('cohortId') or payload.get('cohort_id') or '',
        'cohortName': payload.get('cohortName') or payload.get('cohort') or payload.get('cohort_name') or '',
        'groupId': payload.get('groupId') or payload.get('group_id') or '',
        'groupName': payload.get('groupName') or payload.get('group') or payload.get('group_name') or '',
        'learnerRosterMode': payload.get('learnerRosterMode') or payload.get('learner_roster_mode') or 'inherited',
        'teamsSharedSourceModuleId': payload.get('teamsSharedSourceModuleId') or payload.get('teams_shared_source_module_id') or '',
        'ksbRemapReport': payload.get('ksbRemapReport') or payload.get('ksb_remap_report') or {},
        'duplicateDestination': truthy(payload.get('duplicateDestination') or payload.get('duplicate_destination')),
        'title': name,
        'description': payload.get('notes') or payload.get('description') or '',
        'color': payload.get('color') or '',
        'status': payload.get('status') or 'draft',
        'sessionsNumber': payload.get('sessionsNumber') or payload.get('weeks') or 1,
        'weeksNumber': payload.get('weeks') or payload.get('weeksNumber') or 0,
        'weeklySchedule': payload.get('weeklySchedule'),
        'scheduleMode': payload.get('scheduleMode') or 'group',
        'weekStartsOn': module_week_starts_on(payload),
        'weekBoundaryMode': module_week_boundary_mode(payload),
        'weekDays': payload.get('weekDays'),
        'startTime': payload.get('startTime'),
        'endTime': payload.get('endTime'),
        'deliveryMetadata': payload.get('deliveryMetadata'),
        'startDate': payload.get('startDate') or payload.get('start_date') or '',
        'endDate': payload.get('endDate') or payload.get('end_date') or '',
        'tutor': payload.get('tutor') or payload.get('tutorName') or payload.get('tutor_name') or '',
        'coach': payload.get('coach') or payload.get('coachName') or payload.get('coach_name') or '',
        'weekStructure': payload.get('weekStructure') or [],
        'moduleKsbMappings': payload.get('ksbMappings') or payload.get('moduleKsbMappings') or [],
        'completionCriteria': payload.get('completionCriteria') or default_completion_payload(),
        'advancedDetails': payload.get('advancedDetails') or {},
        'sourceType': payload.get('sourceType') or 'authoring',
        'ksbProfileSourceId': normalise_ksb_profile_source_value(payload.get('ksbProfileSourceId') or payload.get('ksb_profile_source_id') or ''),
    })
    return JsonResponse({'created': True, 'moduleCatalogueId': result.get('catalogueId') or module_catalogue_id, 'module': result}, status=201)


def curriculum_module_detail(
    request,
    identifier,
    *,
    AUTHORING_MODULES_TABLE,
    COURSE_PRICING_FIELDS,
    JsonResponse,
    ModuleAuthoringValidationError,
    _update_module_cover,
    announce_saved,
    archived_programme_module_edit_error,
    authoring_module_exists,
    check_removal,
    check_structure_save,
    clean_str,
    collaboration_enabled,
    curriculum_module_from_authoring_payload,
    curriculum_name_only_patch,
    datetime,
    default_completion_payload,
    delete_module_authoring_structure,
    free_course_errors,
    free_course_sale_values,
    get_authoring_structure_payload,
    invalidate_curriculum_cache,
    json_body,
    json_error,
    lock_module_structure_row,
    log_curriculum_decision,
    merged_week_starts_on,
    merged_weekly_schedule,
    module_authoring_quality_check,
    module_cohort_date_error,
    module_parent_cohort,
    module_schedule_assignment_changed,
    module_schedule_view,
    module_structure_revision,
    module_teams_calendar_block_response,
    module_week_starts_on,
    module_weekly_schedule,
    normalise_ksb_profile_source_value,
    notify_staff_assignment_change,
    parse_int,
    permanent_module_delete_response,
    pricing_values,
    record_conflict_response,
    repair_curriculum_parent_links,
    request_wants_permanent_delete,
    requested_expected_revision,
    resize_authoring_week_structure_preserving_content,
    resolve_stored_module_catalogue_id,
    save_module_authoring_structure,
    stale_teams_calendar_modules,
    transaction,
    tutor_assignment_delivery_day_error,
    tutor_conflict_error,
    tutor_conflict_override_requested,
    tutor_schedule_conflicts_created,
    update_authoring_rows,
    parse_date,
):
    if request.method not in {'PATCH', 'DELETE'}:
        return json_error('Method not allowed.', status=405)

    if request.method == 'PATCH':
        cover_payload = json_body(request)
        if isinstance(cover_payload, dict) and set(cover_payload) == {'coverImage'}:
            return _update_module_cover(request, identifier, cover_payload)

    ident = clean_str(identifier)
    if ident.startswith('training-module-'):
        return json_error('Delivery module rows are not available. Use the module catalogue record instead.', status=404)

    module_catalogue_id = resolve_stored_module_catalogue_id(ident)
    existing_authoring = authoring_module_exists(module_catalogue_id) if module_catalogue_id else None
    if existing_authoring:
        if request.method == 'DELETE':
            from contextlib import nullcontext
            with transaction.atomic() if collaboration_enabled(module_catalogue_id) else nullcontext():
                if collaboration_enabled(module_catalogue_id):
                    lock_module_structure_row(module_catalogue_id)
                    refused = check_removal(request, module_catalogue_id, 'module', module_catalogue_id, {})
                    if refused is not None:
                        return refused
                # Opt-in per request, exactly as the programme, cohort and group
                # deletes read it: a bare DELETE still archives.
                if request_wants_permanent_delete(request):
                    return permanent_module_delete_response(existing_authoring)
                # Never archive past a running Teams calendar, and never cancel it
                # on the author's behalf: they cancel it, then archive.
                blocked = module_teams_calendar_block_response(module_catalogue_id)
                if blocked is not None:
                    return blocked
                delete_module_authoring_structure(module_catalogue_id)
                log_curriculum_decision(
                    'module.archive', outcome='soft_deleted', entity_id=module_catalogue_id,
                    parent_id=clean_str(existing_authoring.get('group_id')),
                )
                repair_curriculum_parent_links(clean_str(existing_authoring.get('programme_id')))
                invalidate_curriculum_cache()
                return JsonResponse({'deleted': True, 'deletedAuthoring': True, 'id': identifier})
        payload = json_body(request)
        if payload is None:
            return json_error('Invalid JSON body.')
        rename_only = curriculum_name_only_patch(payload, allow_title=True)
        try:
            module_week_starts_on(payload)
            merged_week_boundary_mode(payload, existing_authoring)
        except ValueError as exc:
            return json_error(str(exc), fields=['weekStartsOn'])
        try:
            free_course_sale_values(payload, existing_authoring, (
                existing_authoring.get('source_type') == 'free_course'
                or payload.get('isFreeCourse') is True
                or payload.get('sourceType', payload.get('source_type')) == 'free_course'))
        except ModuleAuthoringValidationError as error:
            first = error.errors[0]
            return json_error(first['message'], status=400, fields=[first['path']], validationErrors=error.errors)
        try:
            pricing_values(payload, existing_authoring)
        except ValueError as error:
            return json_error(error.args[1], status=400, fields=[error.args[0]],
                              validationErrors=[{'path': error.args[0], 'message': error.args[1]}])
        if (existing_authoring.get('source_type') == 'free_course'
                or payload.get('isFreeCourse') is True
                or payload.get('sourceType', payload.get('source_type')) == 'free_course'):
            errors = free_course_errors(payload, existing_authoring)
            if errors:
                return json_error('Free course validation failed.', status=400, validationErrors=errors)
        try:
            module_weekly_schedule(payload)
        except ValueError as exc:
            return json_error(str(exc), fields=['weeklySchedule'])
        # A caller that sends no revision still writes back the whole structure
        # read just below. Pin the version that read describes -- read first, so
        # it can only be older than the payload, never newer -- and refuse under
        # the lock if a save landed in between, rather than write its weeks back.
        implicit_revision = '' if requested_expected_revision(request, payload) else module_structure_revision(module_catalogue_id)
        current = get_authoring_structure_payload(module_catalogue_id)
        current_delivery_metadata = current.get('deliveryMetadata') if isinstance(current.get('deliveryMetadata'), dict) else {}
        current_week_structure = current.get('weekStructure') or []
        # This PATCH only ever carries the scalar counts, never a new week list
        # (that is the structure-save endpoint's job) -- so a `weeks` edit here
        # has to resize the stored weeks itself, or the count changes while the
        # actual week rows silently stay whatever they were. Growing appends
        # empty weeks after the last one; shrinking only ever drops trailing
        # week shells that hold nothing, so no scalar sent from a form can
        # delete authored weeks and the components inside them.
        requested_weeks_number = parse_int(
            payload.get('weeks') or payload.get('weeksNumber') or current.get('weeksNumber') or current.get('weeks'),
            len(current_week_structure),
        )
        if payload.get('weekStructure') is not None:
            resolved_week_structure = payload.get('weekStructure')
            resolved_weeks_number = requested_weeks_number
        else:
            resolved_week_structure = resize_authoring_week_structure_preserving_content(
                current_week_structure, requested_weeks_number,
            )
            # Re-derived from what survived: storing the requested number while
            # keeping more week rows than that is what left `weeks_number` at 1
            # on a twelve-week module, and every later save then tried to shrink
            # to it again.
            resolved_weeks_number = len(resolved_week_structure) or requested_weeks_number
        structure_payload = {
            **current,
            **{key: payload[key] for key in COURSE_PRICING_FIELDS if key in payload},
            'catalogueId': module_catalogue_id,
            'programmeId': payload.get('programmeId') or current.get('programmeId'),
            'programmeName': payload.get('programmeName') or payload.get('programme') or current.get('programmeName') or current.get('programme'),
            'title': payload.get('title') or payload.get('name') or current.get('title') or current.get('name'),
            'description': payload.get('description') if 'description' in payload else payload.get('notes') if 'notes' in payload else current.get('description'),
            'color': payload.get('color') or current.get('color') or '',
            'coverImage': payload.get('coverImage') if 'coverImage' in payload else current.get('coverImage') or '',
            'status': payload.get('status') or current.get('status') or 'draft',
            # Kept apart: `weeks` is the authored week count the week builder
            # owns, `sessionsNumber` is the calendar/Teams session count. Folding
            # `weeks` into `sessionsNumber` here is what made the drawer read back
            # a weeks value multiplied by the group's delivery days per week.
            'sessionsNumber': payload.get('sessionsNumber') or current.get('sessionsNumber') or len(current_week_structure),
            'weeksNumber': resolved_weeks_number,
            'startDate': payload.get('startDate') or payload.get('start_date') or current.get('startDate') or '',
            'endDate': payload.get('endDate') or payload.get('end_date') or current.get('endDate') or '',
            # An explicitly blank tutor clears the assignment. Passing '' straight
            # through would not: save_module_authoring_structure resolves the
            # tutor with an `or` chain that falls back to the stored name, so a
            # blank read as "unsent". 'Unassigned' is the sentinel that chain
            # already understands, and is what the tree save sends for the same
            # intent. An absent key still keeps whatever is stored.
            'tutor': (payload.get('tutor') or 'Unassigned') if 'tutor' in payload else current.get('tutor') or '',
            'coach': payload.get('coach') if 'coach' in payload else current.get('coach') or '',
            'cohortId': payload.get('cohortId') or current.get('cohortId') or '',
            'cohortName': payload.get('cohortName') or payload.get('cohort') or current.get('cohortName') or current.get('cohort') or '',
            'groupId': payload.get('groupId') or current.get('groupId') or '',
            'groupName': payload.get('groupName') or payload.get('group') or current.get('groupName') or current.get('group') or '',
            'weeklySchedule': merged_weekly_schedule(payload, current),
            'scheduleMode': payload.get('scheduleMode', current.get('scheduleMode') or 'group'),
            'weekStartsOn': merged_week_starts_on(payload, current),
            'weekBoundaryMode': merged_week_boundary_mode(payload, current),
            **({'calendarPolicy': payload['calendarPolicy']} if 'calendarPolicy' in payload else {'calendarPolicy': current.get('calendarPolicy')}),
            'weekDays': payload.get('weekDays') or current.get('weekDays') or current_delivery_metadata.get('weekDays') or '',
            'startTime': payload.get('startTime') or current.get('startTime') or current_delivery_metadata.get('startTime') or '',
            'endTime': payload.get('endTime') or current.get('endTime') or current_delivery_metadata.get('endTime') or '',
            'sourceType': payload.get('sourceType') or payload.get('source_type') or current.get('sourceType') or '',
            'sourceId': payload.get('sourceId') or payload.get('source_id') or current.get('sourceId') or '',
            'moduleKsbMappings': payload.get('ksbMappings') if 'ksbMappings' in payload else payload.get('moduleKsbMappings') or current.get('moduleKsbMappings') or [],
            'ksbProfileSourceId': normalise_ksb_profile_source_value(payload.get('ksbProfileSourceId') if 'ksbProfileSourceId' in payload else payload.get('ksb_profile_source_id') if 'ksb_profile_source_id' in payload else current.get('ksbProfileSourceId') or ''),
            'completionCriteria': payload.get('completionCriteria') or current.get('completionCriteria') or default_completion_payload(),
            'advancedDetails': payload.get('advancedDetails') or current.get('advancedDetails') or {},
            'weekStructure': resolved_week_structure,
        }
        # One authoritative rule, shared with the Builder's structure PATCH.
        archived_error = archived_programme_module_edit_error(
            existing_authoring,
            title=structure_payload.get('title'),
            programme_id=structure_payload.get('programmeId'),
            programme_name=structure_payload.get('programmeName'),
        )
        if archived_error:
            return archived_error
        # The cohort window is only re-checked when the request actually touches
        # the dates or the placement: a PATCH that just cascades a KSB profile or
        # renames the module must not fail on a stored date it never sent.
        if any(key in payload for key in (
            'startDate', 'start_date', 'endDate', 'end_date', 'cohortId', 'cohort_id', 'groupId', 'group_id',
        )):
            parent_cohort = module_parent_cohort(structure_payload.get('cohortId'), structure_payload.get('groupId'))
            if parent_cohort:
                date_error = module_cohort_date_error(
                    structure_payload.get('title'),
                    structure_payload.get('startDate'),
                    structure_payload.get('endDate'),
                    parent_cohort,
                )
                if date_error:
                    return json_error(date_error[0], fields=[date_error[1]], status=400)
        # Validated against the merged result rather than the payload: a request
        # that only moves the start date still has to be checked against the
        # tutor the module already carries, and one that only changes the tutor
        # against the schedule it already has.
        candidate = {**module_schedule_view(structure_payload), 'module_catalogue_id': module_catalogue_id}
        # The clash planner dates this candidate before the structure-save
        # validator runs. Refuse an inconsistent study-week window here so an
        # old drawer's end date cannot raise an uncaught ValueError (HTTP 500).
        if not rename_only and module_week_boundary_mode(candidate) == 'calendar':
            study_start = parse_date(candidate.get('start_date'))
            if study_start and resolved_weeks_number:
                from curriculum_api.study_weeks import build_study_week_plan
                try:
                    build_study_week_plan(study_start, resolved_weeks_number, set(), {},
                                          module_week_starts_on(candidate), parse_date(candidate.get('end_date')))
                except ValueError as exc:
                    field = 'weeksNumber' if resolved_weeks_number > 104 else 'endDate'
                    return json_error(str(exc), fields=[field], status=400,
                                      validationErrors=[{'path': field, 'message': str(exc)}])
        delivery_day_error = None if rename_only else tutor_assignment_delivery_day_error(
            candidate, before=module_schedule_view(existing_authoring),
        )
        if delivery_day_error:
            return delivery_day_error
        if (
            not rename_only
            and not tutor_conflict_override_requested(payload)
            and module_schedule_assignment_changed(module_schedule_view(existing_authoring), candidate)
        ):
            conflicts = tutor_schedule_conflicts_created(module_schedule_view(existing_authoring), candidate)
            if conflicts:
                return tutor_conflict_error(candidate, conflicts)
        # Optimistic concurrency, opt-in, and deliberately the SAME token the
        # Module Builder's structure PATCH uses: this drawer writes through
        # save_module_authoring_structure too, so one fingerprint covers both
        # and either one refuses a stale copy of the other's work.
        #
        # `current` above was read before this lock. That is safe in the only
        # direction that matters: a write landing between that read and the lock
        # moves the revision, so the save is refused rather than performed on a
        # structure it no longer matches.
        expected_revision = requested_expected_revision(request, payload)
        with transaction.atomic():
            if expected_revision or implicit_revision:
                lock_module_structure_row(module_catalogue_id)
                current_revision = module_structure_revision(module_catalogue_id)
                if current_revision != (expected_revision or implicit_revision):
                    return record_conflict_response(
                        expected_revision or implicit_revision,
                        current_revision,
                        module=curriculum_module_from_authoring_payload(
                            get_authoring_structure_payload(module_catalogue_id)
                        ),
                    )
            lease_error = check_structure_save(request, module_catalogue_id, current, structure_payload, payload)
            if lease_error is not None:
                return lease_error
            if rename_only:
                # Do not re-save weeks/components or reconcile their dates for
                # a display-name edit. The canonical id and all links stand.
                update_authoring_rows(
                    AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s', [module_catalogue_id],
                    {'title': structure_payload['title'], 'updated_at': datetime.utcnow()},
                )
                invalidate_curriculum_cache()
                result = get_authoring_structure_payload(module_catalogue_id)
                result['qualityChecklist'] = module_authoring_quality_check(result)[0]
            else:
                try:
                    result = save_module_authoring_structure(module_catalogue_id, structure_payload)
                except ModuleAuthoringValidationError as exc:
                    return json_error(str(exc), fields=list(dict.fromkeys(error['path'] for error in exc.errors)), validationErrors=exc.errors)
            announce_saved(module_catalogue_id)
        # A tutor change made straight against one module has to mirror onto the
        # raise the assignment notification, exactly as the tree save and the
        # group-modules endpoint do. Without this the module row carried the new
        # tutor_name while the notification queue never moved.
        if 'tutor' in payload or 'tutorName' in payload or 'tutor_name' in payload:
            notify_staff_assignment_change()
        # Same as the group PATCH: a date, week-count or delivery-day edit moves
        # the generated plan out from under the Teams series it was sent to, and
        # the drawer needs to be able to say so while the reader is still there.
        schedule_changed = any(key in payload for key in (
            'startDate', 'start_date', 'endDate', 'end_date',
            'weeks', 'weeksNumber', 'weeks_number',
            'sessionsNumber', 'sessions_number',
            'weekDays', 'week_days', 'deliveryDays', 'sessionWeekDay', 'session_week_day',
            'startTime', 'start_time', 'endTime', 'end_time',
        ))
        return JsonResponse({
            'updated': True,
            'module': result,
            # Read after the commit, so the token handed back is the one a
            # reader would fingerprint now.
            'revision': module_structure_revision(module_catalogue_id),
            'teamsCalendarsToUpdate': (
                stale_teams_calendar_modules([module_catalogue_id]) if schedule_changed else []
            ),
        })

    if request.method == 'DELETE' and module_catalogue_id and delete_module_authoring_structure(module_catalogue_id):
        return JsonResponse({'deleted': True, 'deletedAuthoring': True, 'id': identifier})
    return json_error('Module not found.', status=404)


def _update_module_cover(
    request,
    identifier,
    payload,
    *,
    AUTHORING_MODULES_TABLE,
    CoverImageError,
    DatabaseError,
    JsonResponse,
    _builder_cover_url,
    archive_state,
    connection,
    invalidate_curriculum_cache,
    json_error,
    note_live_rows,
    stored_module_cover_image,
):
    """Update artwork without resaving weeks, delivery dates or components."""
    image = payload.get('coverImage')
    if not isinstance(image, str) or len(image) > 4 * 1024 * 1024 + 256:
        return json_error('Choose an image up to 3 MB.', status=400)
    image = image.strip()
    if image and not _builder_cover_url(image):
        return json_error('Choose a valid module image.', status=400)
    # Validated as an image first, then stored: the column keeps a URL, never
    # the picture. See stored_module_cover_image().
    try:
        image = stored_module_cover_image(identifier, image)
    except CoverImageError as error:
        return json_error(str(error), status=400)
    try:
        from ..infrastructure.module_cover import update_module_cover_row
        updated_row = update_module_cover_row(identifier, image, connection=connection, archive_state=archive_state)
        if not updated_row:
            return json_error('Module not found.', status=404)
        note_live_rows(AUTHORING_MODULES_TABLE, [{'module_catalogue_id': updated_row[0]}])
    except DatabaseError:
        return json_error('Could not save the module image. Please try again.', status=503)
    invalidate_curriculum_cache()
    return JsonResponse({'updated': True, 'coverImage': image})
