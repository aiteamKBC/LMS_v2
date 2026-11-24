"""Pure delivery precedence and clock decisions over plain values."""
import re

from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str
from curriculum_api.catalogue.domain.values import parse_date as _default_parse_date
from curriculum_api.catalogue.domain.values import parse_int as _default_parse_int
from curriculum_api.weekly_schedule import module_week_boundary_mode


def schedule_time_parts(value, *, clean_str=_default_clean_str):
    text = clean_str(value)
    match = re.search(r'(\d{1,2}:?\d{2}\s*(?:AM|PM)?)\s*[-–]\s*(\d{1,2}:?\d{2}\s*(?:AM|PM)?)', text, re.I)
    if not match:
        return '', ''
    return clean_str(match.group(1)), clean_str(match.group(2))


def schedule_day_part(value, *, clean_str=_default_clean_str, schedule_time_parts=schedule_time_parts):
    text = clean_str(value)
    if not text:
        return ''
    start, _ = schedule_time_parts(text)
    if start:
        text = text.split(start, 1)[0]
    return clean_str(re.sub(r'[-â€“]+$', '', text).strip(' ,|-'))


def module_delivery_row(
    module_row,
    group_row=None,
    *,
    clean_str=_default_clean_str,
    schedule_day_part=schedule_day_part,
    schedule_time_parts=schedule_time_parts,
    module_weekly_schedule,
):
    """Use the Group pattern unless this delivery explicitly chose Custom.

    The group states when its learners meet, so its delivery days and clock
    govern every module delivered to it -- changing the group moves its modules
    with it, instead of each module running to a copy of the pattern taken when
    it was authored. A module's own day, clock and per-weekday slots answer
    where its group states none: an ungrouped module, or a group that has never
    been given a slot.

    "The group states none" is about the group's *slot*, not about each field of
    it. Once a group has been given a slot at all -- a day, a clock, or both --
    the days on that slot are the module's days, including when the slot names
    no day: a group that delivers on no weekday delivers on no weekday, and the
    module's own stored day is then a copy left by whatever created it rather
    than a second opinion to fall back on. A module duplicated into a group that
    was never given a delivery day otherwise kept teaching on the day it was
    copied from, on a timetable the group's own screens said was empty -- and
    booked its tutor there, so assigning that tutor elsewhere was refused over a
    session nobody could see.

    Returns a copy; nothing is written. Per-date exceptions
    (``session_overrides``) are untouched -- a session moved to its own date is
    a decision about that date, not a pattern the group can take back.
    """
    module_row = dict(module_row or {})
    if clean_str(module_row.get('schedule_mode') or module_row.get('scheduleMode')) == 'custom':
        return module_row
    group_row = group_row or {}
    day = clean_str(group_row.get('session_week_day')) or schedule_day_part(group_row.get('schedule'))
    start = clean_str(group_row.get('session_start_time')) or schedule_time_parts(group_row.get('schedule'))[0]
    end = clean_str(group_row.get('session_end_time')) or schedule_time_parts(group_row.get('schedule'))[1]
    if not (day or start or end):
        return module_row
    resolved = {
        **module_row,
        'session_week_day': day,
        'session_start_time': start or clean_str(module_row.get('session_start_time')),
        'session_end_time': end or clean_str(module_row.get('session_end_time')),
    }
    if module_weekly_schedule(module_row):
        # A per-weekday table is the module's own refinement of its pattern, and
        # the group's days replace it outright -- kept, it would quietly add back
        # days the group no longer delivers on, which is the same fallback the
        # day above no longer takes.
        resolved['weekly_schedule'] = None
        resolved['weeklySchedule'] = None
    return resolved


def parse_clock_minutes(value, *, clean_str=_default_clean_str):
    """Minutes past midnight for a stored time, or None when it is unreadable.

    Times reach the module row from several screens and are only ever varchar,
    so '10:00', '1000', '10.00' and '9:30 AM' all occur.
    """
    text = clean_str(value).upper().replace('.', ':')
    match = re.match(r'^(\d{1,2}):?(\d{2})?\s*(AM|PM)?$', text)
    if not match:
        return None
    hours = int(match.group(1))
    minutes = int(match.group(2) or 0)
    meridiem = match.group(3)
    if meridiem == 'PM' and hours < 12:
        hours += 12
    elif meridiem == 'AM' and hours == 12:
        hours = 0
    if hours > 23 or minutes > 59:
        return None
    return hours * 60 + minutes


def clock_time_plus_minutes(
    time_value,
    minutes,
    *,
    parse_clock_minutes=parse_clock_minutes,
    parse_int=_default_parse_int,
):
    """``('09:30', 120)`` -> ``'11:30'``. Empty when either side is unreadable.

    Used to close a live session that carries its own start and duration -- a
    component stores those two, never an end time -- so the calendar can state
    the window the session really occupies rather than the module's default one.
    """
    start = parse_clock_minutes(time_value)
    length = parse_int(minutes, 0)
    if start is None or length <= 0:
        return ''
    total = (start + length) % (24 * 60)
    return f'{total // 60:02d}:{total % 60:02d}'


def module_session_clock(
    module_row,
    group_row=None,
    session_date=None,
    *,
    override_clock,
    clean_str=_default_clean_str,
    DEFAULT_SESSION_START_TIME,
    DEFAULT_SESSION_END_TIME,
    parse_date=_default_parse_date,
    module_weekly_schedule,
    parse_clock_minutes=parse_clock_minutes,
):
    """The wall clock a module's sessions occupy, with the calendar's fallbacks.

    Returns ``(start_time, end_time, duration_minutes)``. The fallbacks are the
    ones ``build_sessions_from_authoring_modules`` draws with, so a module with
    no authored time is timed here exactly as it is on the calendar.
    """
    exception = override_clock(module_row, session_date)
    if exception:
        return exception
    # Explicit Custom deliveries keep their per-day clocks. Otherwise the
    # group is where its learners are told when they meet, so the clock it
    # states governs every module delivered to it: move the group and its
    # modules move with it, rather than each one running to a copy of the clock
    # taken when it was authored. A module's own clock -- and its per-weekday
    # table, which is a refinement of that clock -- answers where its group
    # states none: an ungrouped module, or a group never given a slot.
    custom = clean_str((module_row or {}).get('schedule_mode') or (module_row or {}).get('scheduleMode')) == 'custom'
    group_start = '' if custom else clean_str((group_row or {}).get('session_start_time'))
    group_end = '' if custom else clean_str((group_row or {}).get('session_end_time'))
    start_time = group_start or clean_str((module_row or {}).get('session_start_time')) or DEFAULT_SESSION_START_TIME
    end_time = group_end or clean_str((module_row or {}).get('session_end_time')) or DEFAULT_SESSION_END_TIME
    day = parse_date(session_date)
    if not (group_start or group_end):
        for slot in module_weekly_schedule(module_row):
            if day and slot['day'].lower() == day.strftime('%A').lower():
                start_time, end_time = slot['startTime'], slot['endTime']
                break
    start_minutes = parse_clock_minutes(start_time)
    end_minutes = parse_clock_minutes(end_time)
    duration = 0
    if start_minutes is not None and end_minutes is not None:
        duration = end_minutes - start_minutes
    return start_time, end_time, duration if duration > 0 else 60


def module_live_session_clock(
    module_row,
    start_time='',
    duration_minutes=0,
    *,
    booked=False,
    group_row=None,
    session_date=None,
    module_session_clock,
    override_clock,
    module_weekly_schedule,
    clean_str=_default_clean_str,
    parse_int=_default_parse_int,
    clock_time_plus_minutes=clock_time_plus_minutes,
):
    """Unbooked sessions inherit delivery times; confirmed bookings keep theirs.

    Component settings from imports and old defaults are not schedule overrides.
    Explicit per-session reschedules and per-weekday slots still take precedence.
    This only resolves values for readers; it performs no storage or Graph writes.
    Explicit study weeks stamp their automatic slots before calling readers;
    a manually dated component without such a slot keeps its authored clock.
    """
    slot_start, slot_end, slot_duration = module_session_clock(module_row, group_row, session_date)
    if override_clock(module_row, session_date):
        return slot_start, slot_end, slot_duration
    has_schedule = bool(module_weekly_schedule(module_row)) or any(
        clean_str((row or {}).get(key))
        for row in (module_row, group_row)
        for key in ('session_start_time', 'session_end_time')
    )
    manual_study_clock = module_week_boundary_mode(module_row) == 'calendar' and bool(clean_str(start_time))
    if has_schedule and not booked and not manual_study_clock:
        return slot_start, slot_end, slot_duration
    start = clean_str(start_time) or slot_start
    duration = parse_int(duration_minutes, 0) or slot_duration
    return start, clock_time_plus_minutes(start, duration), duration


def tutor_delivery_schedule(
    schedule,
    groups,
    *,
    clean_str=_default_clean_str,
    schedule_day_part=schedule_day_part,
    schedule_time_parts=schedule_time_parts,
):
    """One schedule with the days its group has taken away already gone.

    A module inside a group may run to a slot of its own -- the module drawer
    offers taking the group's pattern as an action precisely because it is not
    automatic -- so this deliberately is NOT the full ``module_delivery_row``
    resolution. It applies one part of it: a group that has been given a slot
    naming no delivery day delivers on no delivery day, and the module's own
    stored day cannot fill that in.

    That day is the one nobody can see. A module created into such a group keeps
    a copy of whatever day it was built from, every screen that reads the group
    shows the delivery as empty, and the check was booking its tutor on the copy
    -- so assigning that tutor elsewhere was refused over sessions the group's
    own timetable does not contain.
    """
    if clean_str((schedule or {}).get('schedule_mode') or (schedule or {}).get('scheduleMode')) == 'custom':
        return schedule
    group = (groups or {}).get(clean_str((schedule or {}).get('group_id')))
    if not group:
        return schedule
    day = clean_str(group.get('session_week_day')) or schedule_day_part(group.get('schedule'))
    stated_clock = (
        clean_str(group.get('session_start_time'))
        or clean_str(group.get('session_end_time'))
        or any(schedule_time_parts(group.get('schedule')))
    )
    # No slot at all is a group that has never said when it meets, and there the
    # module's own pattern still answers -- the same line ``module_delivery_row``
    # draws.
    if day or not stated_clock:
        return schedule
    # ``module_schedule_view`` has already folded any per-weekday table into
    # ``session_week_day``, so both have to go for the schedule to date empty.
    return {**schedule, 'session_week_day': '', 'weekly_schedule': [], 'weeklySchedule': []}
