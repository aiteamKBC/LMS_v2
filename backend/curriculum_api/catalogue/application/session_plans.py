"""Module plan assembly, calendar reads and caller-owned date memoization.

Dependencies are explicit capabilities supplied by the compatibility adapters.
Calendar selection, clock and override contracts remain owned by their helpers.
"""
import json
from datetime import timedelta

from curriculum_api.catalogue.application.cohort_calendar import serialize_holiday_row as _default_serialize_holiday_row
from curriculum_api.catalogue.domain.session_plan import holiday_date_set as _default_holiday_date_set
from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str
from curriculum_api.catalogue.domain.values import parse_date as _default_parse_date
from curriculum_api.catalogue.domain.values import parse_int as _default_parse_int
from curriculum_api.catalogue.domain.values import parse_json_value as _default_parse_json_value
from curriculum_api.weekly_schedule import module_week_boundary_mode


def holiday_details_by_date(
    holidays,
    *,
    serialize_holiday_row=_default_serialize_holiday_row,
    holiday_date_set=_default_holiday_date_set,
):
    """Every closed calendar date mapped to the holidays that close it.

    The values are the holidays exactly as ``serialize_holiday_row`` already
    presents them -- id, label, start/end, type and any notes -- so a closed
    delivery slot can name the holiday that took it without a second store of
    holiday data to keep in step. A date closed by two overlapping holidays
    carries both, in the order they were given.
    """
    by_date = {}
    for item in holidays or []:
        entry = serialize_holiday_row(item) if isinstance(item, dict) else serialize_holiday_row({'date': item})
        for day in sorted(holiday_date_set([item])):
            by_date.setdefault(day, []).append(entry)
    return by_date


def module_delivery_session_plan(
    module,
    session_count,
    start,
    holidays=None,
    week_count=0,
    *,
    clean_str=_default_clean_str,
    parse_int=_default_parse_int,
    module_weekly_schedule,
    parse_json_value=_default_parse_json_value,
    build_module_session_plan,
    first_weekly_session_day,
    module_week_starts_on,
    parse_date=_default_parse_date,
    module_session_clock,
    apply_session_overrides,
    read_module_holidays,
    raise_calendar_unavailable,
    holiday_details_by_date,
    parse_delivery_days,
):
    """The module's dated plan, clocks, closures and explicit exceptions.

    Holidays flag existing delivery slots without shifting or reclassifying
    them. Custom weekly patterns retain their anchor and authored end limit;
    explicit session overrides are applied after the ordinary plan.

    When the existing planner produces no sessions, retain its weekly-from-start
    compatibility path and any warnings. A missing country calendar remains an
    error rather than becoming an invented weekly schedule."""
    if any(item.get('_calendarError') for item in (holidays or [])):
        raise_calendar_unavailable(next(item['_calendarError'] for item in holidays if item.get('_calendarError')))
    calendar_weeks = module_week_boundary_mode(module) == 'calendar'
    if not week_count and (calendar_weeks or clean_str(module.get('schedule_mode') or module.get('scheduleMode')) == 'custom'):
        week_count = parse_int(module.get('weeks_number') or module.get('weeksNumber'), 0)
    weekly = module_weekly_schedule(module)
    delivery_days = ', '.join(slot['day'] for slot in weekly) or module.get('session_week_day') or module.get('week_days') or module.get('delivery_days') or ''
    # A module-specific closure must not change other modules in its cohort.
    own_holidays = parse_json_value(module.get('session_holidays') or module.get('sessionHolidays'), [])
    if module.get('calendar_policy') or module.get('calendarPolicy'):
        holidays = read_module_holidays(module, holidays)
    applied_holidays = [*(holidays or []), *(own_holidays if isinstance(own_holidays, list) else [])]
    if calendar_weeks:
        from curriculum_api.study_weeks import build_study_week_plan
        if not start or week_count <= 0:
            return {'sessions': [], 'slots': [], 'weeks': [], 'skippedHolidays': [], 'finalEndDate': '', 'warnings': ['Set the module start date and study weeks.']}
        plan = build_study_week_plan(start, week_count, parse_delivery_days(delivery_days),
                                     holiday_details_by_date(applied_holidays), module_week_starts_on(module),
                                     parse_date(module.get('end_date') or module.get('endDate')))
        for session in plan['sessions']:
            clock, end, duration = module_session_clock({**module, 'session_overrides': {}}, session_date=session['date'])
            session.update(startTime=clock, endTime=end, durationMinutes=duration)
        return apply_session_overrides(plan, module)
    plan = build_module_session_plan(
        start, session_count, delivery_days, applied_holidays, week_count=week_count,
        week_starts_on=first_weekly_session_day(start, weekly)
        if clean_str(module.get('schedule_mode') or module.get('scheduleMode')) == 'custom'
        and len(weekly) > 1 and module_week_starts_on(module) else None,
    ) if delivery_days else {}
    custom_end = parse_date(module.get('end_date') or module.get('endDate')) if clean_str(module.get('schedule_mode') or module.get('scheduleMode')) == 'custom' else None
    if custom_end and plan.get('sessions'):
        plan['sessions'] = [session for session in plan['sessions'] if parse_date(session['date']) <= custom_end]
        plan['slots'] = [slot for slot in plan.get('slots') or [] if parse_date(slot['date']) <= custom_end]
        plan['finalEndDate'] = max((session['date'] for session in plan['sessions']), default='')
        if not plan['sessions']:
            return plan
    if plan.get('sessions'):
        for session in plan['sessions']:
            clock, end, duration = module_session_clock({**module, 'session_overrides': {}}, session_date=session.get('date'))
            session.update(startTime=clock, endTime=end, durationMinutes=duration)
        return apply_session_overrides(plan, module)
    warnings = plan.get('warnings') or []
    if not start:
        return {'sessions': [], 'slots': [], 'skippedHolidays': [], 'finalEndDate': '', 'originalEndDate': '', 'warnings': warnings}
    # One session a week from the start date, so session N is week N -- asking
    # by weeks and asking by sessions are the same request on this path.
    fallback_count = max(0, parse_int(session_count, 0)) or max(0, parse_int(week_count, 0))
    sessions = [
        {
            'sessionNumber': index + 1,
            'weekNumber': index + 1,
            'date': (start + timedelta(days=index * 7)).isoformat(),
            'day': (start + timedelta(days=index * 7)).strftime('%A'),
            # No weekday to skip onto, so nothing is ever displaced: the week's
            # slot and the session it holds are the same date.
            'slotDate': (start + timedelta(days=index * 7)).isoformat(),
            'slotDay': (start + timedelta(days=index * 7)).strftime('%A'),
            'skippedHolidays': [],
            'startTime': module_session_clock(module)[0],
            'endTime': module_session_clock(module)[1],
            'durationMinutes': module_session_clock(module)[2],
        }
        for index in range(fallback_count)
    ]
    return apply_session_overrides({
        'sessions': sessions,
        # No weekday to skip onto means no slot can ever be closed, so the
        # curriculum spine is the session list: one open slot each, no reading
        # weeks, and an end date that never moves.
        'slots': [
            {
                'slotNumber': index + 1,
                'weekNumber': session['weekNumber'],
                'date': session['date'],
                'day': session['day'],
                'type': 'live-session',
                'cause': '',
                'sessionNumber': session['sessionNumber'],
                'holidays': [],
            }
            for index, session in enumerate(sessions)
        ],
        'skippedHolidays': [],
        'finalEndDate': sessions[-1]['date'] if sessions else '',
        'originalEndDate': sessions[-1]['date'] if sessions else '',
        'warnings': warnings,
    }, module)


def module_delivery_plan(module, session_count, start, holidays=None, *,
    module_delivery_session_plan,
):
    return module_delivery_session_plan(module, session_count, start, holidays).get('sessions') or []


def module_session_dates(
    module,
    holiday_cache=None,
    *,
    parse_int=_default_parse_int,
    parse_date=_default_parse_date,
    clean_str=_default_clean_str,
    module_week_starts_on,
    session_overrides,
    module_schedule_holidays,
    module_delivery_plan,
):
    """The module's planned delivery dates, including explicit session overrides.

    Holidays annotate delivery slots; they do not move dates by themselves.
    The caller-owned module dict memoizes the date set using the existing
    signature fields. A matching signature returns the same set object."""
    session_count = parse_int(module.get('sessions_number'), 0)
    start = parse_date(module.get('start_date'))
    if session_count <= 0 or not start:
        return set()
    signature = (
        session_count,
        start,
        clean_str(module.get('schedule_mode')),
        module_week_starts_on(module),
        module_week_boundary_mode(module),
        parse_int(module.get('weeks_number'), 0),
        clean_str(module.get('end_date')),
        clean_str(module.get('session_week_day')),
        clean_str(module.get('cohort_id')),
        json.dumps(module.get('holidays') or [], sort_keys=True, default=str),
        json.dumps(module.get('calendar_policy') or module.get('calendarPolicy'), sort_keys=True, default=str),
        json.dumps(session_overrides(module), sort_keys=True),
    )
    cached = module.get('_session_dates')
    if cached and cached[0] == signature:
        return cached[1]
    dates = set()
    holidays = module_schedule_holidays(module, holiday_cache)
    for planned in module_delivery_plan(module, session_count, start, holidays):
        planned_date = parse_date(planned.get('date'))
        if planned_date:
            dates.add(planned_date)
    if isinstance(module, dict):
        module['_session_dates'] = (signature, dates)
    return dates


def module_session_plan_for_count(
    module_row,
    session_count,
    holidays=None,
    *,
    parse_int=_default_parse_int,
    parse_date=_default_parse_date,
    module_cohort_selected_holidays,
    module_delivery_session_plan,
):
    """Read a module plan using the caller's requested session count.

    Custom schedules retain their authored-week and end-date constraints.
    An omitted calendar inherits the cohort selection; an explicitly supplied
    calendar, including an empty list, avoids that read. Return the existing
    session/slot, holiday annotation, end-date and warning contract."""
    count = max(0, parse_int(session_count, 0))
    start = parse_date((module_row or {}).get('start_date'))
    if count <= 0 or not start:
        return {'sessions': [], 'slots': [], 'skippedHolidays': [], 'finalEndDate': '', 'originalEndDate': '', 'warnings': []}
    applied_holidays = (
        module_cohort_selected_holidays(module_row) if holidays is None else (holidays or [])
    )
    return module_delivery_session_plan(module_row, count, start, applied_holidays)


def module_session_plan_for_weeks(
    module_row,
    week_count,
    holidays=None,
    *,
    parse_int=_default_parse_int,
    parse_date=_default_parse_date,
    module_cohort_selected_holidays,
    module_delivery_session_plan,
):
    """Read a module plan across its configured seven-day week windows.

    Monday-to-Sunday remains the default; Custom patterns retain their existing
    anchor rule. Count delivery days within those windows rather than dividing
    session totals by week totals. An explicit calendar avoids a cohort read."""
    weeks = max(0, parse_int(week_count, 0))
    start = parse_date((module_row or {}).get('start_date'))
    if weeks <= 0 or not start:
        return {'sessions': [], 'slots': [], 'skippedHolidays': [], 'finalEndDate': '', 'originalEndDate': '', 'warnings': []}
    applied_holidays = (
        module_cohort_selected_holidays(module_row) if holidays is None else (holidays or [])
    )
    return module_delivery_session_plan(module_row, 0, start, applied_holidays, week_count=weeks)
