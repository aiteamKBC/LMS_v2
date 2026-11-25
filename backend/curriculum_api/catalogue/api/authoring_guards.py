"""HTTP authoring preconditions, revision inputs and date-validation responses."""


def archived_programme_module_edit_error(
    existing_module_row, *, title, programme_id, programme_name='', authoring_programme_config_for_save,
    clean_str, is_archived_program_config, json_error, programme_deleted_row,
):
    """The one archived-programme rule, shared by both module edit paths.

    Saving re-derives ``modules.is_programme_deleted`` from the programme the
    module is attached to, so a module sitting under an archived programme is
    flagged as deleted the moment anything about it is saved -- and it
    disappears from every list while the response still reads ``updated: True``.
    That is the "I edited it and it vanished" report. Refused outright rather
    than saved-and-warned: the edit is not what the person wanted if its effect
    is to withdraw the module.

    Applied identically by the drawer PATCH (``curriculum_module_detail``) and
    the Module Builder's structure PATCH (``curriculum_module_structure``), so
    the two cannot drift into two slightly different rules -- the Builder used
    to save happily and leave the module hidden.

    Only for a module that is still visible. One already withdrawn is left
    editable on purpose -- moving it onto a live programme is how it is brought
    back, and blocking that would strand it.

    Returns a ready-to-send 400 response, or ``None`` when the save may proceed.
    """
    if programme_deleted_row(existing_module_row):
        return None
    target_programme = authoring_programme_config_for_save(programme_id, programme_name)
    if not target_programme or not is_archived_program_config(target_programme):
        return None
    name = clean_str(title)
    label = f'"{name}"' if name else 'This module'
    return json_error(
        f'{label} belongs to an archived programme, so saving it '
        'would withdraw it from every list. Restore the programme, or move the module to a live '
        'one, before editing it.',
        fields=['programmeId'],
        status=400,
    )


def permanent_delete_reference_refusal(
    kind, identifier, *, clean_str, json_error, permanent_delete_reference_blockers,
):
    """409 naming the retained records that hold this row, or None."""
    blockers = permanent_delete_reference_blockers(kind, identifier)
    if not blockers:
        return None
    labels = {
        'tutorNotifications': 'tutor notification records',
        'learners': 'learner records', 'enrolmentAccounts': 'enrolment accounts',
        'progressEntries': 'learner progress entries', 'attendance': 'live-session attendance records',
        'attendanceAliases': 'attendance name links', 'attendanceIdentityRules': 'attendance identity rules',
        'teamsShares': 'modules sharing its Teams calendar', 'trainingPlanModules': 'training-plan modules',
        'trainingPlanWeeks': 'training-plan weeks', 'trainingPlanComponents': 'training-plan activities',
    }
    held = ', '.join(f'{count} {labels.get(key, key)}' for key, count in blockers.items())
    return json_error(
        f'This {kind} cannot be deleted permanently because {held} still reference it. '
        'Those records are kept as history, so it stays archived.',
        status=409, reason=f'{kind}-has-retained-records', deleted=False, permanent=False,
        id=clean_str(identifier), blockers=blockers,
    )


def tutor_assignment_delivery_day_error(
    candidate, before=None, groups=None, *, clean_str, json_error, module_delivery_day_gap,
    staff_assignment_key,
):
    """Refuse to put a tutor against a module whose group states no day.

    Only when the save actually assigns or changes the tutor. A module already
    carrying one is not frozen -- it can still be renamed, re-dated or authored
    -- for the same reason ``module_schedule_assignment_changed`` exists: the
    rule is that a booking may not be *made* here, not that the module is stuck.

    The day belongs to the group, not to this module, so the message says which
    group to go and set it on. Saying "set a delivery day" without naming where
    would send the author to the module drawer's own weekday control, which a
    grouped module does not save through.
    """
    next_key = staff_assignment_key((candidate or {}).get('tutor_name'))
    if not next_key or next_key == staff_assignment_key((before or {}).get('tutor_name')):
        return None
    schedule = candidate or {}
    if not clean_str(schedule.get('group_id')) and clean_str((before or {}).get('group_id')):
        schedule = {**schedule, 'group_id': clean_str(before.get('group_id'))}
    group = module_delivery_day_gap(schedule, groups)
    if not group:
        return None
    group_name = clean_str(group.get('group_name')) or 'this module’s group'
    subject = clean_str(schedule.get('title')) or 'this module'
    return json_error(
        f'"{group_name}" has no delivery day, so {subject} has no sessions to place a tutor on and '
        f'nobody can be checked for a clash. Choose the delivery day on "{group_name}", then assign the tutor.',
        status=409,
        code='missing_delivery_day',
        fields=['tutor'],
        groupId=clean_str(group.get('group_id')),
        groupName=group_name,
        moduleName=clean_str(schedule.get('title')),
        tutor=clean_str(schedule.get('tutor_name')),
    )


def group_tutor_assignment_delivery_day_error(
    group_id, tutor_name, module_rows=None, next_week_day=None, *, clean_str, module_delivery_day_gap,
    module_schedule_view, safe_authoring_module_rows, safe_group_delivery_rows, staff_assignment_key,
    surviving_authoring_module_rows, tutor_assignment_delivery_day_error,
):
    """``tutor_assignment_delivery_day_error`` for a whole group at once.

    The group PATCH and the staffing screen set one name against every module in
    the group, so the group's own missing delivery day refuses the assignment
    before any of them is written. Modules that already carry the name are not
    being assigned and do not refuse -- only a name that is actually changing.

    ``next_week_day`` is the day the same request is setting. One PATCH can give
    the group its delivery day *and* its tutor, and refusing that would be
    telling the author to do something the request is already doing.
    """
    group_key = clean_str(group_id)
    next_key = staff_assignment_key(tutor_name)
    if not group_key or not next_key or clean_str(next_week_day):
        return None
    groups = safe_group_delivery_rows()
    if not module_delivery_day_gap({'group_id': group_key}, groups):
        return None
    module_rows = safe_authoring_module_rows() if module_rows is None else module_rows
    for row in surviving_authoring_module_rows(module_rows):
        if clean_str(row.get('group_id')) != group_key:
            continue
        error = tutor_assignment_delivery_day_error(
            module_schedule_view(row, tutor_name=tutor_name),
            before=module_schedule_view(row),
            groups=groups,
        )
        if error:
            return error
    return None


def holiday_date_payload(
    payload, existing=None, *, format_date, json_error,
):
    """The start/end pair to store, or the 400 explaining why there is not one.

    An end date is optional -- most closures are a single day -- and an omitted
    one is stored as the start date rather than as null, so a holiday is always
    a period and never a special case. An end before the start is rejected here
    rather than silently swapped: a fortnight typed backwards is a typo, and
    quietly reinterpreting it would close the wrong fortnight.
    """
    existing = existing or {}
    start = format_date(payload.get('startDate')) or format_date(existing.get('start_date'))
    if not start:
        return json_error('Give the holiday a start date.')
    if 'endDate' in payload:
        end = format_date(payload.get('endDate')) or start
    else:
        end = format_date(existing.get('end_date')) or start
    if end < start:
        return json_error('The end date cannot be before the start date.')
    return {'start': start, 'end': end}


def requested_expected_revision(
    request, payload, *, clean_str,
):
    """The revision this caller is asking to be checked against, if any.

    Absent means "do not check me", which is what every unguarded caller sends:
    the Excel import, the structure wizard, the programme tree save, a record's
    first save. Only a caller that read a token and sent it back is refused on
    a mismatch -- the same opt-in the structure endpoint uses, and for the same
    reason: the callers that write here without ever having read a revision are
    legitimate and have to keep working.
    """
    payload = payload if isinstance(payload, dict) else {}
    return clean_str(
        payload.get('expectedRevision')
        or payload.get('expected_revision')
        or request.headers.get('If-Match')
    )
