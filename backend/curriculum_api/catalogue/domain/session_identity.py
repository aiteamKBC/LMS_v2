"""Pure authored session labels and explicit date rules."""
import re

from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str
from curriculum_api.catalogue.domain.values import format_date as _default_format_date
from curriculum_api.catalogue.domain.values import parse_int as _default_parse_int


def meaningful_session_names(names, *, clean_str=_default_clean_str):
    clean_names = [clean_str(name) for name in (names or []) if clean_str(name)]
    if not clean_names:
        return []
    if all(re.match(r'^week\s*\d+$', name, re.I) for name in clean_names):
        return []
    return clean_names


def resolved_live_session_date(
    settings,
    offset,
    week_slots,
    session_plan,
    *,
    stored_date='',
    booked_at_microsoft=False,
    clean_str=_default_clean_str,
    format_date=_default_format_date,
    parse_int=_default_parse_int,
):
    """The date one live-session component of a week actually runs on.

    ``offset`` is its position among the week's live sessions in
    ``(display_order, id)`` order, and ``week_slots`` the week's planned
    delivery slots in delivery order, so the Nth live session takes the Nth
    slot.

    * A live session with a planned slot runs on it and follows it. Its stored
      date is a copy of that plan, not a second opinion, so a stale copy may
      not outvote the delivery pattern -- that is what let a week header and
      the session inside it name different days. A Mon+Fri week moves BOTH of
      its planned sessions when the week moves, each to its own new day.
    * A live session beyond the week's slots is an ADDITIONAL one: it runs on
      its own ``sessionDate`` and nothing else. It never borrows another
      session's day, and without a date it stays undated, which keeps it out of
      the calendar and out of Teams.
    * A session Microsoft has confirmed keeps its own date either way. That is
      where a meeting real people were invited to sits, and it moves through
      the reschedule flow -- unless a saved override already rescheduled it,
      which is that flow's own record of the move.

    The twin of the branch inside ``apply_module_session_plan_to_weeks``; the
    two must agree, because one serves the Module Builder and the other serves
    the session list, the Teams calendar and its sync verdict.
    """
    # A booked additional meeting owns its date even in the primary slot.
    # Main-calendar overrides cannot reschedule that separate event.
    if clean_str(settings.get('extraTeamsMeetingUrl')):
        return stored_date
    slots = week_slots if isinstance(week_slots, list) else []
    planned = slots[offset] if offset < len(slots) else {}
    planned = planned if isinstance(planned, dict) else {}
    # A component that already names a session number is matched to THAT
    # session rather than to its position in the week, so a booked session
    # keeps hold of its own plan entry when the weeks around it move.
    explicit_number = parse_int(settings.get('teamsSessionNumber'), 0)
    if explicit_number:
        planned = next(
            (item for item in (session_plan or []) if item.get('sessionNumber') == explicit_number),
            planned,
        )
    if booked_at_microsoft and not planned.get('rescheduled'):
        return stored_date
    # A week the plan gives no date leaves the session on whatever it has
    # rather than clearing a date somebody chose.
    return format_date(planned.get('date')) or stored_date
