"""Attachment selection and payload construction through explicit existing capabilities.

Legacy setup/read callbacks retain their existing timing and exception scope.
No persistence workflow or transaction is owned by this module."""

from curriculum_api.catalogue.application.authoring_metadata import default_completion_payload as _default_default_completion_payload
from curriculum_api.catalogue.domain.attachment_content import empty_authoring_week as _default_empty_authoring_week
from curriculum_api.catalogue.domain.attachment_content import first_clean_payload_value as _default_first_clean_payload_value
from curriculum_api.catalogue.domain.attachment_content import identity_ids_conflict as _default_identity_ids_conflict
from curriculum_api.catalogue.domain.attachment_content import identity_values_match_context as _default_identity_values_match_context
from curriculum_api.catalogue.domain.attachment_content import module_structure_component_count as _default_module_structure_component_count
from curriculum_api.catalogue.domain.attachment_content import payload_week_list as _default_payload_week_list
from curriculum_api.catalogue.domain.hierarchy_values import visible_notes as _default_visible_notes
from curriculum_api.catalogue.domain.staff_identity import is_blank_staff_assignment as _default_is_blank_staff_assignment
from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str
from curriculum_api.catalogue.domain.values import normalise as _default_normalise
from curriculum_api.catalogue.domain.values import parse_date as _default_parse_date
from curriculum_api.catalogue.domain.values import parse_int as _default_parse_int
from curriculum_api.weekly_schedule import module_week_boundary_mode
from curriculum_api.weekly_schedule import merged_week_boundary_mode


def find_existing_authoring_catalogue_id_for_payload(
    payload,
    *,
    AUTHORING_MODULES_TABLE,
    authoring_component_counts_by_catalogue,
    authoring_fetch_all,
    clean_str=_default_clean_str,
    ensure_module_authoring_tables,
    first_clean_payload_value=_default_first_clean_payload_value,
    identity_values_match_context=_default_identity_values_match_context,
    logger,
    module_withdrawn_on_its_own,
    normalise=_default_normalise,
    resolve_authoring_catalogue_id,
):
    requested_catalogue_id = first_clean_payload_value(payload, 'catalogueId', 'moduleCatalogueId', 'module_catalogue_id')
    if requested_catalogue_id:
        resolved = resolve_authoring_catalogue_id(requested_catalogue_id)
        if resolved:
            return resolved

    # Standalone courses have no placement to disambiguate a shared title.
    # Only an explicit existing id can identify an existing free course.
    if payload.get('isFreeCourse') is True:
        return ''

    try:
        ensure_module_authoring_tables()
        title = first_clean_payload_value(payload, 'title', 'name')
        if not title:
            return ''

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
        component_counts = authoring_component_counts_by_catalogue()
        rows = sorted(
            authoring_fetch_all(AUTHORING_MODULES_TABLE, order_sql='updated_at desc, module_catalogue_id'),
            key=lambda row: (component_counts.get(clean_str(row.get('module_catalogue_id')), 0), row.get('updated_at') or ''),
            reverse=True,
        )
        for row in rows:
            if normalise(row.get('title')) != normalise(title):
                continue
            # A standalone course and an unplaced module may share a title.
            # Creation must never adopt the other kind's content or identity.
            if (row.get('source_type') == 'free_course') != (payload.get('isFreeCourse') is True):
                continue
            # An archived module is not "the same module" a create is asking
            # for. Adopting it handed a fresh copy the archived row's id, the
            # next save cleared the archive on the module row alone, and the
            # weeks archived with it stayed stamped with that id -- so the
            # module then ran with two sets of weeks.
            if module_withdrawn_on_its_own(row):
                continue
            if not identity_values_match_context([row.get('programme_id'), row.get('programme_name')], programme_values):
                continue
            if not identity_values_match_context([row.get('cohort_id'), row.get('cohort_name')], cohort_values):
                continue
            if not identity_values_match_context([row.get('group_id'), row.get('group_name')], group_values):
                continue
            return clean_str(row.get('module_catalogue_id'))
    except Exception:
        logger.debug('Unable to find existing authoring module for payload.', exc_info=True)
    return ''


def contentful_catalogue_id_for_attachment(
    item,
    group,
    cohort,
    module_name,
    current_catalogue_id='',
    *,
    AUTHORING_MODULES_TABLE,
    authoring_component_counts_by_catalogue,
    authoring_fetch_all,
    authoring_module_exists,
    clean_str=_default_clean_str,
    get_authoring_structure_payload,
    identity_ids_conflict=_default_identity_ids_conflict,
    identity_values_match_context=_default_identity_values_match_context,
    logger,
    module_structure_component_count=_default_module_structure_component_count,
    normalise=_default_normalise,
):
    title_key = normalise(module_name)
    candidate_id = ''
    try:
        component_counts = authoring_component_counts_by_catalogue()
        programme_values = [
            item.get('programmeId'),
            item.get('programme_id'),
            item.get('programme'),
            group.get('programmeId'),
            group.get('programme_id'),
            group.get('programme'),
            cohort.get('programmeId') if cohort else '',
            cohort.get('programme_id') if cohort else '',
            cohort.get('programme') if cohort else '',
        ]
        cohort_values = [
            item.get('cohortId'),
            item.get('cohort_id'),
            item.get('cohort'),
            group.get('cohortId'),
            group.get('cohort_id'),
            cohort.get('id') if cohort else '',
            cohort.get('cohortId') if cohort else '',
            cohort.get('name') if cohort else '',
        ]
        group_values = [
            item.get('groupId'),
            item.get('group_id'),
            item.get('group'),
            group.get('id'),
            group.get('groupId'),
            group.get('name'),
        ]
        # Canonical-id-only views of the context. A group name is not unique
        # across cohorts (each cohort may hold its own "G1-Wed"), so matching on
        # the pooled id+name sets alone would reuse a different cohort's module
        # row and strand the target group with no modules, no tutor and no
        # delivery window. When both sides carry an id, it has to agree.
        cohort_context_ids = [item.get('cohortId'), item.get('cohort_id'), group.get('cohortId'), group.get('cohort_id')]
        if cohort:
            cohort_context_ids += [cohort.get('id'), cohort.get('cohortId')]
        group_context_ids = [item.get('groupId'), item.get('group_id'), group.get('id'), group.get('groupId')]
        candidates = [
            row for row in authoring_fetch_all(AUTHORING_MODULES_TABLE)
            if normalise(row.get('title')) == title_key
            and identity_values_match_context([row.get('programme_id'), row.get('programme_name')], programme_values)
            and identity_values_match_context([row.get('cohort_id'), row.get('cohort_name')], cohort_values)
            and identity_values_match_context([row.get('group_id'), row.get('group_name')], group_values)
            and not identity_ids_conflict(row.get('cohort_id'), cohort_context_ids)
            and not identity_ids_conflict(row.get('group_id'), group_context_ids)
        ]
        candidates.sort(
            key=lambda row: (component_counts.get(clean_str(row.get('module_catalogue_id')), 0), row.get('updated_at') or ''),
            reverse=True,
        )
        if candidates:
            candidate_id = clean_str(candidates[0].get('module_catalogue_id'))
    except Exception:
        logger.debug('Unable to resolve contentful catalogue attachment for %s.', module_name, exc_info=True)
    if not candidate_id or candidate_id == current_catalogue_id:
        return current_catalogue_id
    if not current_catalogue_id:
        return candidate_id
    current_structure = get_authoring_structure_payload(current_catalogue_id) if authoring_module_exists(current_catalogue_id) else None
    candidate_structure = get_authoring_structure_payload(candidate_id) if authoring_module_exists(candidate_id) else None
    if module_structure_component_count(candidate_structure) > module_structure_component_count(current_structure):
        return candidate_id
    return current_catalogue_id


def module_attachment_authoring_payload(
    item,
    group,
    cohort,
    catalogue_id,
    module_name,
    session_count,
    start_date,
    end_date,
    current_structure=None,
    source_type='module_authoring',
    source_id='',
    *,
    attachment_week_count,
    attachment_week_structure,
    clean_str=_default_clean_str,
    default_completion_payload=_default_default_completion_payload,
    first_weekly_session_day,
    is_blank_staff_assignment=_default_is_blank_staff_assignment,
    merged_week_starts_on,
    merged_weekly_schedule,
    normalise_ksb_profile_source_value,
    visible_notes=_default_visible_notes,
    ModuleAuthoringValidationError,
    cohort_selected_holidays_by_cohort,
):
    current_structure = current_structure or {}
    weekly = merged_weekly_schedule(item, current_structure)
    try:
        week_boundary_mode = merged_week_boundary_mode(item, current_structure)
    except ValueError as exc:
        raise ModuleAuthoringValidationError([{'path': 'weekBoundaryMode', 'message': str(exc)}]) from exc
    if week_boundary_mode and not merged_week_starts_on(item, current_structure):
        raise ModuleAuthoringValidationError([{'path': 'weekStartsOn', 'message': 'Choose the first day of the study week.'}])
    week_starts_on = merged_week_starts_on(item, current_structure)
    if not week_boundary_mode and item.get('scheduleMode', current_structure.get('scheduleMode')) == 'custom' and len(weekly) > 1 and (week_starts_on or not current_structure):
        week_starts_on = first_weekly_session_day(start_date, weekly)
    item = {**item, 'weekStartsOn': week_starts_on, 'weekBoundaryMode': week_boundary_mode, 'startDate': start_date, 'endDate': end_date}
    if week_boundary_mode:
        item = {**item, 'cohortId': cohort['id'],
                'holidays': cohort_selected_holidays_by_cohort([cohort['id']]).get(cohort['id'], []),
                'weekDays': item.get('weekDays') or group.get('weekDays') or group.get('schedule'),
                'startTime': item.get('startTime') or group.get('startTime'), 'endTime': item.get('endTime') or group.get('endTime')}
    schedule = ', '.join(slot['day'] for slot in weekly) or clean_str(item.get('weekDays') or item.get('deliveryDays') or group.get('weekDays') or group.get('schedule'))
    has_explicit_tutor = 'tutor' in item or 'tutorName' in item or 'tutor_name' in item
    explicit_tutor = clean_str(item.get('tutor') or item.get('tutorName') or item.get('tutor_name'))
    group_tutor = '' if is_blank_staff_assignment(group.get('tutor')) else clean_str(group.get('tutor'))
    tutor = ''
    if has_explicit_tutor:
        tutor = '' if is_blank_staff_assignment(explicit_tutor) else explicit_tutor
    else:
        tutor = group_tutor
    return {
        **current_structure,
        'catalogueId': catalogue_id,
        'programmeId': clean_str(item.get('programmeId') or item.get('programme_id') or cohort.get('programmeId') or group.get('programmeId') or ''),
        'programmeName': cohort.get('programme') or group.get('programme') or 'Unassigned programme',
        'cohortId': cohort['id'],
        'cohortName': cohort.get('name') or '',
        'groupId': group['id'],
        'groupName': group.get('name') or '',
        'tutor': tutor,
        'title': module_name,
        'description': visible_notes(item.get('notes') or current_structure.get('description') or ''),
        'color': item.get('color') or current_structure.get('color') or '',
        'coverImage': item.get('coverImage') if 'coverImage' in item else current_structure.get('coverImage') or '',
        'status': item.get('status') or current_structure.get('status') or 'draft',
        'sessionsNumber': session_count,
        # The authored week count travels apart from the calendar session count:
        # a group delivering twice a week runs `session_count` sessions across
        # half that many weeks.
        'weeksNumber': attachment_week_count(item, session_count, schedule),
        'startDate': start_date,
        'endDate': end_date,
        'weeklySchedule': merged_weekly_schedule(item, current_structure),
        'scheduleMode': item.get('scheduleMode', current_structure.get('scheduleMode') or 'group'),
        'weekStartsOn': merged_week_starts_on(item, current_structure),
        'weekBoundaryMode': merged_week_boundary_mode(item, current_structure),
        'calendarPolicy': item['calendarPolicy'] if 'calendarPolicy' in item else current_structure.get('calendarPolicy'),
        'weekDays': schedule,
        'startTime': item.get('startTime') or group.get('startTime') or '',
        'endTime': item.get('endTime') or group.get('endTime') or '',
        # Prefer a structure the caller authored; fall back to what is stored, or
        # pre-create the resolved week count so a metadata-only reattachment
        # never blanks existing weeks/components and a fresh attachment holds
        # the weeks it was asked for rather than none.
        'weekStructure': attachment_week_structure(item, current_structure, session_count=session_count, schedule=schedule),
        'moduleKsbMappings': item.get('moduleKsbMappings') or item.get('ksbMappings') or current_structure.get('moduleKsbMappings') or [],
        'completionCriteria': current_structure.get('completionCriteria') or default_completion_payload(),
        'advancedDetails': current_structure.get('advancedDetails') or {},
        'background': current_structure.get('background') or '',
        'epaRequirements': current_structure.get('epaRequirements') or [],
        'qualificationOutcomes': current_structure.get('qualificationOutcomes') or [],
        'sourceType': source_type,
        'sourceId': clean_str(source_id or item.get('sourceId') or catalogue_id),
        'ksbProfileSourceId': normalise_ksb_profile_source_value(item.get('ksbProfileSourceId') if 'ksbProfileSourceId' in item else item.get('ksb_profile_source_id') if 'ksb_profile_source_id' in item else current_structure.get('ksbProfileSourceId') or ''),
    }


def attachment_week_structure(
    item,
    current_structure=None,
    week_count=None,
    session_count=0,
    schedule='',
    *,
    attachment_week_count,
    empty_authoring_week=_default_empty_authoring_week,
    first_weekly_session_day,
    module_delivery_session_plan,
    module_week_starts_on,
    module_weekly_schedule,
    parse_date=_default_parse_date,
    parse_int=_default_parse_int,
    payload_week_list=_default_payload_week_list,
    ModuleAuthoringValidationError,
):
    """Pick the authored week structure for a module attachment.

    Prefers an explicitly supplied structure, then the legacy `weeks` list form,
    then whatever is already stored. Only once none of those exist does it
    pre-create weeks (with dated live slots for Custom), to the resolved count: a module attached with
    "10 weeks" has to actually hold 10 week rows, or a page that reads the
    structure straight from storage (rather than going through a client-side
    "fill in a default structure" fallback) sees none of them.
    """
    for candidate in (
        (item or {}).get('weekStructure'),
        (item or {}).get('weeks'),
        (current_structure or {}).get('weekStructure'),
    ):
        weeks = payload_week_list(candidate)
        if weeks:
            return weeks
    target = week_count if week_count is not None else attachment_week_count(item, session_count, schedule)
    weeks = [empty_authoring_week(index + 1) for index in range(max(0, target))]
    weekly = module_weekly_schedule(item)
    # A fresh custom delivery authors actual sessions inside each calendar week.
    # Existing structures above, including reading weeks and bookings, stay intact.
    calendar_weeks = module_week_boundary_mode(item) == 'calendar'
    if calendar_weeks or (item.get('scheduleMode') == 'custom' and len(weekly) > 1):
        row = {
            'schedule_mode': item.get('scheduleMode') or 'group',
            'week_boundary_mode': module_week_boundary_mode(item),
            'week_starts_on': module_week_starts_on(item)
            or (first_weekly_session_day(item.get('startDate'), weekly) if not current_structure else None),
            'calendar_policy': item.get('calendarPolicy'),
            'cohort_id': item.get('cohortId'),
            'end_date': item.get('endDate'),
            'weekly_schedule': weekly,
            'session_week_day': ', '.join(slot['day'] for slot in weekly) or schedule,
            'session_start_time': weekly[0]['startTime'] if weekly else item.get('startTime'),
            'session_end_time': weekly[0]['endTime'] if weekly else item.get('endTime'),
        }
        try:
            plan = module_delivery_session_plan(row, 0, parse_date(item.get('startDate')), item.get('holidays') or [], week_count=target)
        except ValueError as exc:
            raise ModuleAuthoringValidationError([{'path': 'endDate', 'message': str(exc)}]) from exc
        for session in plan.get('sessions') or []:
            week_index = parse_int(session.get('weekNumber'), 1) - 1
            if not 0 <= week_index < len(weeks):
                continue
            weeks[week_index]['components'].append({
                'type': 'live-session',
                'title': f"Live session {len(weeks[week_index]['components']) + 1}",
                'expectedOtjh': (session.get('durationMinutes') or 60) / 60,
                'settings': {
                    'sessionDate': session['date'],
                    'sessionTime': session.get('startTime') or '',
                    'durationMinutes': session.get('durationMinutes') or 60,
                    'completionRule': 'Attend or watch recording',
                },
            })
    return weeks
