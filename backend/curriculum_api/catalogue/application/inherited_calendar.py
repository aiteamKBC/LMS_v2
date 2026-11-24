"""Inherited cohort calendars for module reads and scheduling inputs.

Concrete read capabilities are supplied by the legacy composition boundary.
The caller-specific country-calendar error contracts and tolerant database
reads are retained; an empty result is not proof that the calendar was readable.
No writer, provider refresh or schema provisioning belongs here.
"""

from curriculum_api.catalogue.application.cohort_calendar import serialize_holiday_row as _default_serialize_holiday_row
from curriculum_api.catalogue.application.cohort_calendar import sorted_holidays as _default_sorted_holidays
from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str
from curriculum_api.catalogue.domain.values import parse_date as _default_parse_date
from curriculum_api.catalogue.domain.values import parse_json_value as _default_parse_json_value


def scheduling_holidays_from(
    holiday_rows,
    start_value,
    excluded_ids=None,
    *,
    serialize_holiday_row=_default_serialize_holiday_row,
    parse_date=_default_parse_date,
    clean_str=_default_clean_str,
    sorted_holidays=_default_sorted_holidays,
):
    """The bank holidays a session plan starting on ``start_value`` must skip.

    Open at the far end, deliberately. Every holiday a plan steps over pushes it
    a delivery slot later, so a plan routinely finishes after the cohort's
    practical end date -- and a set bounded at that date would then let the very
    last sessions land on Good Friday or Easter Monday, which is the bug this
    exists to prevent. A holiday after the plan's final session is inert: the
    set is only ever tested for membership against a session date.

    Bounded below by the cohort start because nothing delivers before it. A
    cohort with no usable start date gets the whole calendar rather than none of
    it: a session must never be planned onto a bank holiday, and an imported
    cohort missing its dates is not a reason to schedule one on Christmas Day.

    ``excluded_ids`` is the cohort's own deny-list -- the holidays a human
    unticked in the cohort drawer -- so a plan stops skipping exactly those
    dates. It is applied after the start-date bound, not instead of it: a
    holiday outside the cohort's own period was never offered as a checkbox in
    the first place, so it cannot be named here, and stays skipped either way.
    """
    serialized = [serialize_holiday_row(row) for row in (holiday_rows or [])]
    start = parse_date(start_value)
    if start:
        serialized = [
            item for item in serialized
            if (parse_date(item.get('endDate') or item.get('startDate')) or start) >= start
        ]
    excluded_set = {clean_str(value) for value in (excluded_ids or []) if clean_str(value)}
    if excluded_set:
        serialized = [item for item in serialized if clean_str(item.get('id')) not in excluded_set]
    return sorted_holidays(serialized)


def cohort_selected_holidays_by_id(
    cohorts,
    holiday_rows,
    *,
    clean_str=_default_clean_str,
    scheduling_holidays_from=scheduling_holidays_from,
    read_overview_calendar,
):
    """Each cohort's holidays, keyed by cohort id.

    The authoring module rows carry a ``cohort_id`` and nothing about holidays,
    so this is the lookup that lets their session dates skip the same days the
    cohort does. Built once per payload: the alternative is a holiday read per
    module.

    A cohort's holidays are England's bank holidays from its own start date
    onwards -- see ``scheduling_holidays_from``: these dates are what a session
    plan steps over, and a plan that steps over enough of them finishes after
    the cohort's practical end date. ``excludedHolidayIds`` narrows that set to
    the ones the cohort has not unticked.
    """
    holidays_by_cohort = {}
    for cohort in cohorts or []:
        cohort_id = clean_str(cohort.get('id'))
        if not cohort_id:
            continue
        calendar_rows = holiday_rows
        if cohort.get('calendarPolicy') or cohort.get('calendar_policy'):
            calendar_rows, calendar_error = read_overview_calendar(cohort, holiday_rows)
            if calendar_error is not None:
                cohort['calendarError'] = calendar_error
        holidays_by_cohort[cohort_id] = scheduling_holidays_from(
            calendar_rows,
            cohort.get('startDate') or cohort.get('start_date'),
            cohort.get('excludedHolidayIds') or cohort.get('excluded_holiday_ids'),
        )
    return holidays_by_cohort


def module_schedule_holidays(
    schedule,
    cache=None,
    *,
    clean_str=_default_clean_str,
    module_cohort_selected_holidays,
):
    """The ticked holidays that move one schedule's sessions.

    A caller that already holds the list (a form previewing a cohort selection
    that is not stored yet) wins; otherwise the parent cohort's ticked selection
    is read, which is the same set every other dated view of the module skips.

    ``cache`` is a plain dict keyed by cohort id. A tutor roster asks about one
    slot once per name, so without it the same cohort's holidays were re-read
    from the database once per tutor per module.
    """
    explicit = (schedule or {}).get('holidays')
    if isinstance(explicit, list) and explicit:
        return explicit
    cohort_id = clean_str((schedule or {}).get('cohort_id'))
    if not cohort_id:
        return []
    if cache is None:
        return module_cohort_selected_holidays({'cohort_id': cohort_id})
    if cohort_id not in cache:
        cache[cohort_id] = module_cohort_selected_holidays({'cohort_id': cohort_id})
    return cache[cohort_id]


def cohort_selected_holidays_by_cohort(
    cohort_ids,
    *,
    clean_str=_default_clean_str,
    authoring_rows_by_id,
    COHORT_AUTHORING_DETAILS_TABLE,
    COHORT_ROWS_ORDER,
    logger,
    get_holiday_rows,
    scheduling_holidays_from=scheduling_holidays_from,
    parse_json_value=_default_parse_json_value,
    read_cohort_calendar,
):
    """The holidays of many cohorts at once, keyed by cohort id.

    These are the dates a session plan skips, so they are resolved from the
    cohort's start date with no end bound (``scheduling_holidays_from``): a plan
    pushed later by the holidays it stepped over has to keep skipping them after
    the cohort's practical end date, not stop at it. The cohort's *own* holidays
    -- what the drawer lists and the row records -- are the narrower in-period
    set, and ``cohort_holiday_details`` answers for those.

    The stored ``holiday_ids`` and ``selected_holidays`` columns are
    deliberately not read: both were written against the authored holiday table
    that is no longer a source, and ``selected_holidays`` went stale besides --
    a cohort with eight holidays has been seen carrying one there, which left a
    module's sessions running straight through a closed Christmas.
    ``excluded_holiday_ids`` is different: it is the human's own deny-list, not
    a derived cache, so it is read and honoured.

    Two reads for any number of cohorts -- the cohort rows in one ``in (...)``
    and the holiday table once -- because every module in a cohort shares that
    cohort's holidays. A caller planning a page of modules groups the ids first
    and reads here once, instead of paying a cohort read and a holiday read per
    module. ``module_cohort_selected_holidays`` is this same function for one
    cohort, so the resolution rule above lives in exactly one place.
    """
    wanted = list(dict.fromkeys(
        clean_str(value) for value in (cohort_ids or []) if clean_str(value)
    ))
    if not wanted:
        return {}
    try:
        # Keyed by cohort id (the primary key) below, so inside a programme
        # build this filters the cohorts read the cohort list already made.
        rows = authoring_rows_by_id(
            COHORT_AUTHORING_DETAILS_TABLE, 'cohort_id', wanted, COHORT_ROWS_ORDER, ensure_tables=False,
        )
    except (Exception, AssertionError):
        logger.debug('Unable to read cohort holidays for %s.', ', '.join(wanted), exc_info=True)
        return {}
    if not rows:
        return {}
    try:
        holiday_rows = get_holiday_rows()
    except (Exception, AssertionError):
        logger.debug('Unable to read holidays for %s.', ', '.join(wanted), exc_info=True)
        holiday_rows = []

    grouped = {}
    for cohort in rows:
        cohort_id = clean_str(cohort.get('cohort_id'))
        if not cohort_id:
            continue
        calendar_rows = holiday_rows
        if cohort.get('calendar_policy'):
            calendar_rows = read_cohort_calendar(cohort, holiday_rows)
        grouped[cohort_id] = scheduling_holidays_from(
            calendar_rows,
            cohort.get('start_date'),
            parse_json_value(cohort.get('excluded_holiday_ids'), []),
        )
    return grouped


def module_cohort_selected_holidays(
    module_row,
    *,
    clean_str=_default_clean_str,
    cohort_selected_holidays_by_cohort,
):
    """The parent cohort's ticked holidays for one module.

    One cohort's slice of ``cohort_selected_holidays_by_cohort``, which owns the
    rule; this is the single-module door onto it.
    """
    cohort_id = clean_str((module_row or {}).get('cohort_id'))
    if not cohort_id:
        return []
    return cohort_selected_holidays_by_cohort([cohort_id]).get(cohort_id) or []
