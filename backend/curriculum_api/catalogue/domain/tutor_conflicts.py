"""Pure tutor booking change and clock-window rules."""

from curriculum_api.catalogue.domain.delivery_pattern import parse_clock_minutes as _default_parse_clock_minutes
from curriculum_api.catalogue.domain.read_contracts import DEFAULT_SESSION_START_TIME as _default_DEFAULT_SESSION_START_TIME
from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str
from curriculum_api.catalogue.domain.values import truthy as _default_truthy


def module_time_window(
    module,
    *,
    parse_clock_minutes=_default_parse_clock_minutes,
    DEFAULT_SESSION_START_TIME=_default_DEFAULT_SESSION_START_TIME,
):
    """The clock window one module occupies on each of its session dates."""
    start = parse_clock_minutes(module.get('session_start_time'))
    if start is None:
        start = parse_clock_minutes(DEFAULT_SESSION_START_TIME)
    end = parse_clock_minutes(module.get('session_end_time'))
    if end is None or end <= start:
        # An unreadable or inverted end time still occupies the slot it starts
        # in. Treating it as zero-length would hide a real double-booking, so it
        # falls back to the one-hour block the calendar would draw.
        end = start + 60
    return start, end


def module_schedule_assignment_changed(before, after, *, clean_str=_default_clean_str):
    """Whether a save actually moves a tutor or a slot.

    Deployments already contain clashes this check would have prevented, and a
    module's content is authored through the same PATCH that carries its
    schedule. Guarding every save would make those modules impossible to rename
    or author until the clash was fixed -- so the rule is that a save may not
    *create or move* a booking into a clash, not that a clashing module is
    frozen. An edit that leaves the tutor and the slot exactly as they were is
    left alone.
    """
    keys = (
        'tutor_name',
        'sessions_number',
        'start_date',
        'session_week_day',
        'session_start_time',
        'session_end_time',
        'weekly_schedule',
        'schedule_mode',
        'calendar_policy',
    )
    if before.get('schedule_mode') == 'custom' or after.get('schedule_mode') == 'custom':
        keys += ('weeks_number', 'end_date', 'week_starts_on')
    if before.get('week_boundary_mode') or after.get('week_boundary_mode'):
        keys += ('weeks_number', 'end_date', 'week_starts_on', 'week_boundary_mode')
    return any(clean_str(before.get(key)) != clean_str(after.get(key)) for key in keys)


def tutor_conflict_override_requested(payload, *, truthy=_default_truthy):
    """Let a caller book the clash deliberately.

    Two modules really can need the same name against them -- a co-taught slot,
    or a correction being made in two steps. The flag has to be sent explicitly,
    so the default stays "refuse".
    """
    if not isinstance(payload, dict):
        return False
    return truthy(payload.get('allowTutorConflict') or payload.get('allow_tutor_conflict'))
