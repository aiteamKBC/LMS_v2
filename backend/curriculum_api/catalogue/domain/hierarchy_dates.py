"""Contracted delivery, EPA and holiday date calculations over supplied values."""

from curriculum_api.catalogue.domain.session_plan import holiday_date_set as _default_holiday_date_set
from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str
from curriculum_api.catalogue.domain.values import format_date as _default_format_date
from curriculum_api.catalogue.domain.values import parse_date as _default_parse_date
from curriculum_api.catalogue.domain.values import parse_int as _default_parse_int
from datetime import date as _default_date
from datetime import datetime as _default_datetime
from datetime import timedelta as _default_timedelta
import calendar as _default_calendar
import re as _default_re
from curriculum_api.weekly_schedule import module_week_boundary_mode
from curriculum_api.weekly_schedule import module_week_starts_on


def format_created_at(
    value,
    *,
    clean_str=_default_clean_str,
    datetime=_default_datetime,
    format_date=_default_format_date,
    re=_default_re,
):
    """A created-at stamp as a sortable ISO string, keeping the time of day.

    `format_date` would do for a display date, but "recently added" is read on a
    day when several records were added: dropping the time makes every one of
    them a tie, and the list stops answering the question it was sorted for.
    Non-datetime values fall through to the date-only answer, and anything
    unreadable to '' -- which sorts last, never first.
    """
    if isinstance(value, datetime):
        return value.isoformat()
    text = clean_str(value)
    if not text:
        return ''
    # Already an ISO-ish timestamp from the driver: kept as it is, since it
    # compares correctly as text.
    if re.match(r'^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}', text):
        return text.replace(' ', 'T', 1)
    return format_date(text)


def calculate_cohort_end_date(
    start_value,
    duration_months,
    *,
    calendar=_default_calendar,
    date=_default_date,
    parse_date=_default_parse_date,
    parse_int=_default_parse_int,
    timedelta=_default_timedelta,
):
    start = parse_date(start_value)
    months = parse_int(duration_months, 0)
    if not start or months <= 0:
        return None

    # Curriculum convention: a 24 month cohort starting 2026-09-01 ends 2028-08-31.
    month_index = start.month - 1 + months
    year = start.year + month_index // 12
    month = month_index % 12 + 1
    day = min(start.day, calendar.monthrange(year, month)[1])
    return date(year, month, day) - timedelta(days=1)


def holiday_extension_days(
    holidays,
    period_start,
    period_end,
    *,
    holiday_date_set=_default_holiday_date_set,
    parse_date=_default_parse_date,
):
    """Count the selected holiday days inside a delivery period.

    Only the part of a holiday that falls inside ``period_start``..``period_end``
    counts. Weekends are counted too because module session plans work in
    calendar dates: a two week holiday blocks fourteen possible calendar days,
    even if only some of those dates are normal delivery days.
    """
    start = parse_date(period_start)
    end = parse_date(period_end)
    if not start or not end:
        return 0

    days = {day for day in holiday_date_set(holidays) if start <= day <= end}
    return len(days)


def holiday_extension_breakdown(
    holidays,
    period_start,
    period_end,
    *,
    clean_str=_default_clean_str,
    format_date=_default_format_date,
    holiday_date_set=_default_holiday_date_set,
    parse_date=_default_parse_date,
):
    """Per-holiday account of what each one takes out of a delivery period.

    The total on its own ("+37 days") is not something a human can check. This
    names each holiday and the days of it that actually landed inside the
    period, so a schedule preview can explain exactly what was skipped.

    Days are attributed to the first holiday that claims them, so overlapping
    holidays add up to the same total the date arithmetic uses rather than
    double-counting the shared days.
    """
    start = parse_date(period_start)
    end = parse_date(period_end)
    if not start or not end:
        return []

    claimed = set()
    breakdown = []
    for item in holidays or []:
        days = sorted(
            day for day in holiday_date_set([item])
            if start <= day <= end and day not in claimed
        )
        if not days:
            continue
        claimed.update(days)
        label = ''
        if isinstance(item, dict):
            label = clean_str(item.get('label') or item.get('name') or item.get('title'))
        breakdown.append({
            'label': label,
            'startDate': format_date(days[0]),
            'endDate': format_date(days[-1]),
            'days': len(days),
        })
    return breakdown


def cohort_practical_end_date(
    start_value,
    duration_months,
    holiday_ids=None,
    holiday_rows=None,
    *,
    calculate_cohort_end_date=calculate_cohort_end_date,
):
    """A cohort's contracted practical end date.

    Cohort dates are signed contract dates, so selected holidays do not move
    them. Holiday ids are still stored on the cohort because module schedules use
    that selection to skip clashing sessions and extend the affected module plan.
    ``holiday_ids`` and ``holiday_rows`` stay in the signature for older callers.
    """
    return calculate_cohort_end_date(start_value, duration_months)


def parse_epa_months(value, *, parse_int=_default_parse_int):
    """Read an End Point Assessment period in whole months.

    None means "no EPA period recorded", which is not the same as zero: a
    cohort with no EPA period has no apprenticeship end date to show, whereas
    an explicit 0 means the apprenticeship ends when the practical period does.
    """
    if value in (None, ''):
        return None
    months = parse_int(value, -1)
    return months if months >= 0 else None


def payload_epa_months(payload, existing=None, *, parse_epa_months=parse_epa_months):
    """Resolve the EPA period for a write, leaving it untouched when unsent.

    An explicit blank clears the period; an absent key keeps whatever the stored
    row already has, so a partial save cannot drop an authored period.
    """
    for key in ('epaMonths', 'epa_months'):
        if key in (payload or {}):
            return parse_epa_months((payload or {}).get(key))
    return parse_epa_months((existing or {}).get('epa_months'))


def parse_apprenticeship_end_override(value, *, parse_date=_default_parse_date):
    """Read a manually authored apprenticeship end date.

    None means "no override": the calculated date stands. An unparseable value
    is treated the same way rather than raising, so a bad string cannot wedge a
    save — the cohort simply keeps its calculated date.
    """
    if value in (None, ''):
        return None
    return parse_date(value)


def payload_apprenticeship_end_override(
    payload,
    existing=None,
    *,
    parse_apprenticeship_end_override=parse_apprenticeship_end_override,
):
    """Resolve the override for a write, leaving it untouched when unsent.

    Mirrors ``payload_epa_months``: an explicit blank clears the override and
    hands the date back to the EPA calculation, while an absent key keeps
    whatever the stored row already has so a partial save cannot drop an
    authored date.
    """
    # The explicit override keys are read first so a payload that round-trips a
    # serialized cohort -- which carries the *effective* apprenticeshipEndDate
    # alongside the authored apprenticeshipEndOverride -- cannot promote a
    # calculated date into an authored one.
    for key in ('apprenticeshipEndOverride', 'apprenticeship_end_override', 'apprenticeshipEndDate', 'apprenticeship_end_date'):
        if key in (payload or {}):
            return parse_apprenticeship_end_override((payload or {}).get(key))
    return parse_apprenticeship_end_override((existing or {}).get('apprenticeship_end_override'))


def apprenticeship_end_override_sent(payload, meta=None):
    """Whether this write carries an apprenticeship end date at all."""
    keys = ('apprenticeshipEndDate', 'apprenticeship_end_date', 'apprenticeshipEndOverride', 'apprenticeship_end_override')
    return any(key in (payload or {}) for key in keys) or 'apprenticeship_end_override' in (meta or {})


def calculate_apprenticeship_end_date(
    practical_end_value,
    epa_months,
    *,
    calendar=_default_calendar,
    date=_default_date,
    parse_date=_default_parse_date,
    parse_epa_months=parse_epa_months,
):
    """The apprenticeship end date: the practical end date plus the EPA period.

    Unlike ``calculate_cohort_end_date`` this keeps the same day of the month
    and does not subtract a day — the practical period already ended, and the
    EPA window is counted forward from that date. A practical period ending
    2027-03-04 with a 5 month EPA period ends 2027-08-04.
    """
    practical_end = parse_date(practical_end_value)
    months = parse_epa_months(epa_months)
    if not practical_end or not months:
        return None

    month_index = practical_end.month - 1 + months
    year = practical_end.year + month_index // 12
    month = month_index % 12 + 1
    day = min(practical_end.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def cohort_apprenticeship_end_date(
    practical_end_value,
    epa_months,
    override=None,
    *,
    calculate_apprenticeship_end_date=calculate_apprenticeship_end_date,
    parse_apprenticeship_end_override=parse_apprenticeship_end_override,
):
    """The date a cohort's apprenticeship actually ends.

    An authored override wins outright — it is the date the delivery team was
    given, and no whole number of EPA months need land on it. With no override
    the date is calculated from the practical end date plus the EPA period.
    """
    manual = parse_apprenticeship_end_override(override)
    if manual:
        return manual
    return calculate_apprenticeship_end_date(practical_end_value, epa_months)


def cohort_epa_dates(
    practical_end_value,
    epa_months,
    override=None,
    *,
    cohort_apprenticeship_end_date=cohort_apprenticeship_end_date,
    format_date=_default_format_date,
):
    """Resolve the pair of end dates a cohort exposes, as ISO strings.

    The apprenticeship end date is always resolved here rather than read back
    from its ``apprenticeship_end_date`` column: that column is a cache for SQL
    consumers (the enrolment backfill joins on it), and serving the cache would
    surface a stale date whenever the practical end date moved without the EPA
    period being resent. The override column is the authored input and *is* read
    back, which is exactly why the two are kept apart.
    """
    practical_end = format_date(practical_end_value)
    return practical_end, format_date(cohort_apprenticeship_end_date(practical_end, epa_months, override))


def module_calendar_end_date(
    start_value,
    week_count,
    module=None,
    *,
    parse_date=_default_parse_date,
    parse_int=_default_parse_int,
    timedelta=_default_timedelta,
):
    """The module's End Date field: the calendar span of its authored weeks,
    counted from the start date.

    Deliberately independent of delivery days, holidays and the generated
    session plan -- a module authored for N weeks always finishes N weeks
    after it starts, even when its only live session lands on day one.
    ``build_module_session_plan``'s ``finalEndDate`` answers a different
    question (where does the last session land) and must not be read as this
    field; this is the one server-side callers use whenever a module payload
    arrives with no explicit ``endDate`` to fall back on.
    """
    if module_week_boundary_mode(module):
        from curriculum_api.study_weeks import study_week_end_date
        return study_week_end_date(start_value, week_count, module_week_starts_on(module))
    start = parse_date(start_value)
    weeks = max(0, parse_int(week_count, 0))
    if not start or weeks <= 0:
        return ''
    return (start + timedelta(days=weeks * 7 - 1)).isoformat()


def cohort_delivery_window(cohort, *, parse_date=_default_parse_date):
    """The dates a module placed in ``cohort`` has to fit inside.

    The practical end date is the boundary, not the apprenticeship end: the EPA
    period that follows it carries no delivery. It already has any ticked
    holidays folded in, so a plan that skips them still lands inside the window.
    """
    cohort = cohort or {}
    start = parse_date(cohort.get('startDate') or cohort.get('start_date'))
    end = parse_date(
        cohort.get('practicalEndDate')
        or cohort.get('practical_end_date')
        or cohort.get('endDate')
        or cohort.get('end_date')
    )
    return start, end


def shift_date_by_months(
    value,
    delta_months,
    *,
    calendar=_default_calendar,
    date=_default_date,
    parse_date=_default_parse_date,
):
    parsed = parse_date(value)
    if not parsed:
        return None
    month_index = parsed.month - 1 + delta_months
    year = parsed.year + month_index // 12
    month = month_index % 12 + 1
    day = min(parsed.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def infer_duration_months(
    start_value,
    end_value,
    fallback=0,
    *,
    calendar=_default_calendar,
    parse_date=_default_parse_date,
    parse_int=_default_parse_int,
    timedelta=_default_timedelta,
):
    """Read a contracted duration back off a start/end pair.

    The exact inverse of ``calculate_cohort_end_date``: that rule stores the end
    date as the day *before* the corresponding date, so the month count is taken
    against ``end + 1 day`` rather than against the end date itself. Counting off
    the end date only works for cohorts starting on the 1st -- there the end
    lands in the previous month, so it needs a month adding back, while a cohort
    starting mid-month ends in the same month as its corresponding date and does
    not. Anchoring removes that split.

    Authored end dates that do not follow the rule are counted down to whole
    months: an anchor short of the corresponding day has not completed its final
    month, unless it is the last day of its month and the day was clamped there.
    """
    explicit = parse_int(fallback, 0)
    if explicit > 0:
        return explicit
    start = parse_date(start_value)
    end = parse_date(end_value)
    if not start or not end or end < start:
        return 0
    anchor = end + timedelta(days=1)
    months = (anchor.year - start.year) * 12 + (anchor.month - start.month)
    clamped = anchor.day == calendar.monthrange(anchor.year, anchor.month)[1]
    if anchor.day < start.day and not clamped:
        months -= 1
    return max(1, months)


def module_soft_start_date(cohort_start):
    return shift_date_by_months(cohort_start, -1)
