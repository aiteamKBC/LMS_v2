"""Schedule projections and read/preview orchestration; no HTTP dependencies."""

from curriculum_api.catalogue.domain.delivery_pattern import schedule_day_part as _default_schedule_day_part
from curriculum_api.catalogue.domain.delivery_pattern import schedule_time_parts as _default_schedule_time_parts
from curriculum_api.catalogue.domain.staff_identity import staff_assignment_key as _default_staff_assignment_key
from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str
from curriculum_api.catalogue.domain.values import parse_int as _default_parse_int
from curriculum_api.catalogue.domain.values import parse_json_value as _default_parse_json_value
from curriculum_api.weekly_schedule import module_week_boundary_mode


def build_group_schedule(week_days='', start_time='', end_time='', fallback='', *, clean_str=_default_clean_str):
    """Format group delivery day and time for API display."""
    days = ', '.join(clean_str(day) for day in week_days if clean_str(day)) if isinstance(week_days, list) else clean_str(week_days)
    start = clean_str(start_time)
    end = clean_str(end_time)
    if days and start and end:
        return f'{days} {start}-{end}'
    if days and start:
        return f'{days} {start}'
    return days or clean_str(fallback)


def group_schedule_value(
    group,
    *,
    build_group_schedule=build_group_schedule,
    schedule_day_part=_default_schedule_day_part,
    schedule_time_parts=_default_schedule_time_parts,
):
    group = group or {}
    return build_group_schedule(
        group.get('session_week_day') or schedule_day_part(group.get('schedule')),
        group.get('session_start_time') or schedule_time_parts(group.get('schedule'))[0],
        group.get('session_end_time') or schedule_time_parts(group.get('schedule'))[1],
        group.get('schedule'),
    )


def module_schedule_view(
    module,
    tutor_name=None,
    *,
    clean_str=_default_clean_str,
    module_weekly_schedule,
    staff_assignment_key=_default_staff_assignment_key,
    parse_int=_default_parse_int,
    module_week_starts_on,
    parse_json_value=_default_parse_json_value,
    session_overrides,
):
    """Schedule fields of a module, from either vocabulary it is written in.

    A module reaches storage as a snake_case authoring row or as the camelCase
    structure payload the save builds, and the conflict check has to run *before*
    the write. Both shapes are normalised into the row shape the schedule helpers
    above read, so neither the check nor the calendar learns a second vocabulary.

    Pass `tutor_name` to ask "what if this tutor took it" without mutating the
    module -- the group and staffing screens assign one tutor across a whole
    group that way.
    """
    module = module or {}

    def first(*keys):
        for key in keys:
            value = clean_str(module.get(key))
            if value:
                return value
        return ''

    tutor = clean_str(tutor_name) if tutor_name is not None else first('tutor_name', 'tutor', 'tutorName')
    sessions_number = module.get('sessions_number') if 'sessions_number' in module else module.get('sessionsNumber')
    # `holidays` is only ever what a caller sent. A screen previewing a cohort
    # selection that is not saved yet is the one place the ticked set cannot be
    # read back from `cohort_id`, so it may hand the list over directly.
    holidays = module.get('holidays') or module.get('linkedHolidays') or module.get('selectedHolidays') or []
    weekly = module_weekly_schedule(module)
    return {
        'module_catalogue_id': first('module_catalogue_id', 'moduleCatalogueId', 'catalogueId', 'catalogue_id'),
        'title': first('title', 'name', 'moduleName'),
        'programme_name': first('programme_name', 'programmeName', 'programme'),
        # Carried so the schedule can be dated the way the calendar dates it:
        # the parent cohort's ticked holidays flag a module's sessions, and a
        # clash is about the day a session actually runs on.
        'cohort_id': first('cohort_id', 'cohortId'),
        'cohort_name': first('cohort_name', 'cohortName', 'cohort'),
        # The group owns the delivery pattern (``module_delivery_row``), so the
        # conflict check has to be able to find it from a schedule alone -- it is
        # handed payload-shaped candidates that never reach the modules table.
        'group_id': first('group_id', 'groupId'),
        'group_name': first('group_name', 'groupName', 'group'),
        'holidays': holidays if isinstance(holidays, list) else [],
        # 'Unassigned' is a real stored value, not a name. Normalising it away
        # here is what makes an unassigned module skip the check entirely.
        'tutor_name': tutor if staff_assignment_key(tutor) else '',
        'sessions_number': parse_int(sessions_number, 0),
        'weeks_number': parse_int(first('weeks_number', 'weeksNumber'), 0),
        'start_date': first('start_date', 'startDate'),
        'end_date': first('end_date', 'endDate'),
        'session_week_day': ', '.join(slot['day'] for slot in weekly) or first('session_week_day', 'weekDays', 'week_days', 'delivery_days', 'deliveryDays'),
        'weekly_schedule': weekly,
        'schedule_mode': first('schedule_mode', 'scheduleMode') or 'group',
        'week_starts_on': module_week_starts_on(module),
        'week_boundary_mode': module_week_boundary_mode(module),
        'session_holidays': parse_json_value(module.get('session_holidays') or module.get('sessionHolidays'), []),
        'calendar_policy': module.get('calendarPolicy') if 'calendarPolicy' in module else module.get('calendar_policy'),
        'session_overrides': session_overrides(module),
        'session_start_time': first('session_start_time', 'startTime', 'start_time'),
        'session_end_time': first('session_end_time', 'endTime', 'end_time'),
    }


def safe_group_delivery_rows(
    *,
    authoring_fetch_all,
    GROUPS_TABLE,
    GROUP_ROWS_ORDER,
    logger,
    clean_str=_default_clean_str,
):
    """Every group row, keyed by id, for resolving delivery patterns.

    Read once per conflict check rather than per module: a group states the
    pattern for every module delivered to it, so the same handful of rows would
    otherwise be fetched hundreds of times over.
    """
    try:
        # GROUP_ROWS_ORDER: shares the other whole-table group readers' read.
        rows = authoring_fetch_all(GROUPS_TABLE, order_sql=GROUP_ROWS_ORDER)
    except (Exception, AssertionError):
        logger.debug('Unable to read group rows for the tutor conflict check.', exc_info=True)
        return {}
    return {
        clean_str(row.get('group_id')): row
        for row in rows or []
        if clean_str(row.get('group_id'))
    }


def module_delivery_day_gap(
    schedule,
    groups=None,
    *,
    clean_str=_default_clean_str,
    safe_group_delivery_rows,
    schedule_day_part=_default_schedule_day_part,
    schedule_time_parts=_default_schedule_time_parts,
):
    """The group that gives this module no delivery day, or None.

    The counterpart to ``tutor_delivery_schedule``: that one stops a module's
    stale day standing in for a day its group does not have, and this one says
    so out loud. A group holding a clock and no weekday has a slot nobody can
    date -- the session plan falls back to counting weeks off the start date and
    the delivery reads as empty on every screen -- so there is nothing to check a
    tutor against.

    Returns the group row, so a caller can name it.
    """
    if clean_str((schedule or {}).get('schedule_mode') or (schedule or {}).get('scheduleMode')) == 'custom' and clean_str((schedule or {}).get('session_week_day')):
        return None
    group = (groups if groups is not None else safe_group_delivery_rows()).get(
        clean_str((schedule or {}).get('group_id'))
    )
    if not group:
        return None
    if clean_str(group.get('session_week_day')) or schedule_day_part(group.get('schedule')):
        return None
    stated_clock = (
        clean_str(group.get('session_start_time'))
        or clean_str(group.get('session_end_time'))
        or any(schedule_time_parts(group.get('schedule')))
    )
    # A group that has never been given a slot at all is a different situation --
    # the module's own pattern still answers there, so it has a day to be checked
    # on and nothing is missing.
    return group if stated_clock else None


def preview_module_session_plan(
    payload, weekly, *,
    module_schedule_view,
    module_delivery_session_plan,
    parse_date,
    parse_int,
    build_module_session_plan,
    first_weekly_session_day,
    module_week_starts_on,
    module_session_clock,
):
    """Build a preview from validated input without HTTP or persistence."""
    if module_week_boundary_mode(payload) or (payload.get('endDate') and payload.get('weeksNumber')):
        slot = {**module_schedule_view(payload), 'schedule_mode': payload.get('scheduleMode') or 'custom'}
        return module_delivery_session_plan(slot, 0, parse_date(payload.get('startDate')), payload.get('holidays') or [], week_count=parse_int(payload.get('weeksNumber'), 0))
    plan = build_module_session_plan(
        payload.get('startDate') or payload.get('start_date'),
        payload.get('numberOfSessions') or payload.get('sessionsNumber') or payload.get('weeks'),
        ', '.join(slot['day'] for slot in weekly) or payload.get('deliveryDays') or payload.get('weekDays') or payload.get('delivery_day'),
        payload.get('holidays') or payload.get('linkedHolidays') or [],
        week_count=parse_int(payload.get('weeksNumber'), 0),
        week_starts_on=first_weekly_session_day(payload.get('startDate'), weekly)
        if payload.get('scheduleMode') == 'custom' and len(weekly) > 1 and module_week_starts_on(payload) else None,
    )
    slot = module_schedule_view(payload)
    for session in plan.get('sessions') or []:
        clock, end, duration = module_session_clock(slot, session_date=session.get('date'))
        session.update(startTime=clock, endTime=end, durationMinutes=duration)
    return plan


def load_module_session_plan(
    module_catalogue_id, query_params, *,
    resolve_stored_module_catalogue_id,
    authoring_fetch_all,
    AUTHORING_MODULES_TABLE,
    module_delivery_row,
    fetch_group_row,
    parse_int,
    module_session_plan_for_count,
    module_session_plan_for_weeks,
    module_stored_week_count,
):
    """Read the stored schedule and return planning inputs/result, or None if absent."""
    catalogue_id = resolve_stored_module_catalogue_id(module_catalogue_id)
    module_rows = authoring_fetch_all(
        AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s', [catalogue_id],
    ) if catalogue_id else []
    if not module_rows:
        # An unsaved draft has no stored schedule to plan from, and answering
        # with an empty plan would read as "these weeks have no dates".
        return None
    module_row = module_rows[0]
    if module_row.get('group_id'):
        # The group's day and clock, which govern every module delivered to
        # it; the module's own answer only where the group states none.
        module_row = module_delivery_row(module_row, fetch_group_row(module_row['group_id']) or {})
    requested_sessions = max(0, parse_int(query_params.get('sessions'), 0))
    requested_weeks = max(0, parse_int(query_params.get('weeks'), 0))
    if module_week_boundary_mode(module_row) and requested_weeks > 104:
        raise ModuleSessionPlanValidationError('Choose between 1 and 104 study weeks.')
    if requested_sessions:
        plan = module_session_plan_for_count(module_row, requested_sessions)
    else:
        plan = module_session_plan_for_weeks(
            module_row,
            requested_weeks or module_stored_week_count(module_row),
        )
    return plan, catalogue_id, module_row, requested_weeks


class ModuleSessionPlanValidationError(ValueError):
    """The requested study-week count exceeds the stored module policy."""
