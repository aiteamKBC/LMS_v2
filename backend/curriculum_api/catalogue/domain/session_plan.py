"""Pure delivery-week, date-expansion and session-slot rules; no I/O."""
import re
from datetime import timedelta

from curriculum_api.catalogue.domain.read_contracts import WEEKDAY_INDEX as _default_WEEKDAY_INDEX
from curriculum_api.catalogue.domain.values import parse_date as _default_parse_date
from curriculum_api.catalogue.domain.values import parse_int as _default_parse_int


def parse_delivery_days(value, *, WEEKDAY_INDEX=_default_WEEKDAY_INDEX):
    if isinstance(value, list):
        tokens = value
    else:
        tokens = re.split(r'[,/|+&\s]+', str(value or '').lower())
    days = []
    for token in tokens:
        key = str(token).strip().lower()
        if key in WEEKDAY_INDEX and WEEKDAY_INDEX[key] not in days:
            days.append(WEEKDAY_INDEX[key])
    return days


def holiday_date_set(holidays, *, parse_date=_default_parse_date):
    dates = set()
    for item in holidays or []:
        if isinstance(item, dict):
            start = parse_date(item.get('startDate') or item.get('start_date') or item.get('date'))
            end = parse_date(item.get('endDate') or item.get('end_date') or item.get('date')) or start
        else:
            start = parse_date(item)
            end = start
        if not start:
            continue
        cursor = start
        while cursor <= end:
            dates.add(cursor)
            cursor += timedelta(days=1)
    return dates


def build_module_session_plan(
    start_value,
    number_of_sessions,
    delivery_days,
    holidays=None,
    week_count=0,
    week_starts_on=None,
    *,
    parse_date=_default_parse_date,
    parse_int=_default_parse_int,
    parse_delivery_days=parse_delivery_days,
    holiday_date_set=holiday_date_set,
    holiday_details_by_date,
    WEEKDAY_INDEX,
):
    """The module's delivery days, numbered into seven-day week windows.

    The default remains Monday-to-Sunday. New Custom schedules pass the first
    live session's weekday so every following seven-day window starts there.

    A week here is a CALENDAR week, not a slice of the session list. Week 1 is
    the Monday-to-Sunday window the module starts in, week 2 the one after it,
    and every delivery day the group runs is stamped with the window it falls
    in. So "which dates does authored week 4 own" is answered by the calendar --
    the group's delivery days inside week 4's Mon-Sun window -- and never by
    dividing a session count by a week count.

    A module starting mid-week owns only the delivery days from its start date
    on: the Monday and Tuesday before a Wednesday start are inside week 1's
    window but before the module began, so they belong to nobody and week 1 is
    simply shorter than the weeks after it. A start date with no delivery day
    left in its own week does not spend a week on nothing: week 1 is the week
    of the first delivery day after it, so N weeks are N delivery weeks.

    ``week_count`` asks for whole weeks: the plan runs to the end of that many
    Mon-Sun windows, however many delivery days that turns out to be. Callers
    that still want a fixed number of dates pass ``number_of_sessions`` as
    before; one of the two must be positive.
    """
    start = parse_date(start_value)
    session_count = parse_int(number_of_sessions, 0)
    week_target = max(0, parse_int(week_count, 0))
    days = parse_delivery_days(delivery_days)
    warnings = []

    if not start:
        warnings.append('Set module start date before calculating module end date.')
    if session_count <= 0 and week_target <= 0:
        warnings.append('Set a positive number of sessions before calculating module end date.')
    if not days:
        warnings.append('Set group delivery day/time before calculating module end date.')
    if warnings:
        return {
            'sessions': [],
            'slots': [],
            'skippedHolidays': [],
            'finalEndDate': '',
            'originalEndDate': '',
            'warnings': warnings,
        }

    selected_holidays = holiday_date_set(holidays)
    holidays_by_date = holiday_details_by_date(holidays)
    guard_days = max(3650, max(session_count, week_target * 7) * 21)

    # Monday of the week the module first DELIVERS in. Every week number below
    # is measured from here, which is what makes an authored week a calendar
    # week rather than a run of dates that can straddle two of them. Measured
    # from the first delivery day on or after the start date, not from the
    # start date itself: a module starting on the Sunday of a Wednesday group
    # has no delivery day left in its opening week, and counting that empty
    # week as week 1 gave five authored weeks four sessions (agreed 2026-10-26:
    # N weeks means N delivery weeks). A start date with a delivery day still
    # ahead of it in its own week anchors exactly as before.
    first_delivery = next(
        (start + timedelta(days=offset) for offset in range(7) if (start + timedelta(days=offset)).weekday() in days),
        start,
    )
    # Existing modules retain Monday. Custom modules can anchor their seven-day
    # windows to the first live session, including patterns crossing Sunday.
    first_weekday = WEEKDAY_INDEX[str(week_starts_on).lower()] if week_starts_on else 0
    week_anchor = first_delivery - timedelta(days=(first_delivery.weekday() - first_weekday) % 7)
    # The first day past the last week asked for, when asking by weeks.
    week_limit = week_anchor + timedelta(days=week_target * 7) if week_target else None

    # The curriculum spine: every delivery day the module passes through, in
    # calendar order, one per authored delivery slot.
    #
    # Nothing here decides what the week becomes. A holiday on a delivery day is
    # stated, not acted on: the slot stays a live-session slot carrying the
    # holidays that fall on it, and the author is the one who turns that week
    # into a reading week, drops its live session or leaves it exactly as it is.
    #
    # `skippedHolidays` on a session names the holidays landing on THAT session's
    # own day, so a screen can state the clash on the week it belongs to.
    curriculum_slots = []
    sessions = []
    skipped = []
    cursor = start
    while guard_days > 0:
        if week_limit is not None:
            if cursor >= week_limit:
                break
        elif len(curriculum_slots) >= session_count:
            break
        if cursor.weekday() in days:
            closed_by = holidays_by_date.get(cursor) or []
            closed = cursor in selected_holidays
            if closed:
                skipped.append(cursor.isoformat())
            # Which seven-day window this delivery day falls in, counting the
            # module's own starting week as week 1.
            week_number = (cursor - week_anchor).days // 7 + 1
            sessions.append({
                'sessionNumber': len(sessions) + 1,
                'weekNumber': week_number,
                'date': cursor.isoformat(),
                'day': cursor.strftime('%A'),
                'slotDate': cursor.isoformat(),
                'slotDay': cursor.strftime('%A'),
                'skippedHolidays': [cursor.isoformat()] if closed else [],
            })
            curriculum_slots.append({
                'slotNumber': len(curriculum_slots) + 1,
                'weekNumber': week_number,
                'date': cursor.isoformat(),
                'day': cursor.strftime('%A'),
                # Still a live-session slot: a holiday marks the day, it does
                # not reclassify the week. `cause` and `holidays` are what a
                # screen reads to warn the author that this one needs a look.
                'type': 'live-session',
                'cause': 'holiday' if closed else '',
                'sessionNumber': len(sessions),
                'holidays': closed_by if closed else [],
            })
        cursor += timedelta(days=1)
        guard_days -= 1

    if week_limit is None and len(sessions) < session_count:
        warnings.append('Could not generate the full session plan from the supplied delivery pattern.')

    from curriculum_api.live_holiday_policy import with_closed_weeks
    return with_closed_weeks({
        'sessions': sessions,
        'slots': curriculum_slots,
        'skippedHolidays': skipped,
        'finalEndDate': sessions[-1]['date'] if sessions else '',
        # The same day: nothing moves the run any more, so the end date a
        # closure-free plan would have had IS the end date this plan has.
        # Stated rather than dropped, because callers render the pair.
        'originalEndDate': sessions[-1]['date'] if sessions else '',
        'warnings': warnings,
    }, holidays_by_date, start, first_weekday=first_weekday)
