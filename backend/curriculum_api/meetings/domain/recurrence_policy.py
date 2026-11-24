"""Deterministic meeting decisions over Python values and explicit pure helpers."""

from datetime import datetime, timedelta, timezone
from ...catalogue.domain.values import parse_int
from ...catalogue.domain.read_contracts import WEEKDAY_INDEX
from .instants import parse_graph_datetime


def teams_recurrence_weekdays(payload, local_start):
    """The weekdays a weekly Graph recurrence has to fire on.

    A group can deliver the same module on more than one day, so the anchor's own
    weekday is not the pattern -- it is one day of it. Building the series from
    that day alone lays a one-a-week grid under a twice-a-week plan: every
    Thursday session lands on a Monday slot a week too late, and the shift pass
    then has to drag each instance backwards across its neighbours, which Graph
    refuses. Read the days off the plan the caller sent instead.

    The sent dates are UTC while ``local_start`` is whatever frame the caller
    builds its recurrence in, so they are re-based on the anchor -- the first
    planned session by definition -- before their weekday is taken.
    """
    default = [local_start.strftime('%A').lower()]
    starts = teams_scheduled_occurrence_starts(payload)
    if not starts:
        return default
    offset = local_start - min(starts)
    days = []
    for start in sorted(starts):
        name = (start + offset).strftime('%A').lower()
        if name not in days:
            days.append(name)
    return days or default


def teams_event_recurrence(repeat, local_start, occurrences, days_of_week=None):
    if repeat == 'none':
        return None
    start_date = local_start.date().isoformat()
    day_name = local_start.strftime('%A').lower()
    if repeat == 'daily':
        pattern = {'type': 'daily', 'interval': 1}
    elif repeat == 'weekdays':
        pattern = {
            'type': 'weekly',
            'interval': 1,
            'daysOfWeek': ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
        }
    else:
        pattern = {'type': 'weekly', 'interval': 1, 'daysOfWeek': list(days_of_week or [day_name])}
    return {
        'pattern': pattern,
        'range': {
            'type': 'numbered',
            'startDate': start_date,
            'numberOfOccurrences': occurrences,
        },
    }


def teams_scheduled_occurrence_starts(payload):
    """The planned session instants a caller sent, as naive UTC datetimes."""
    supplied = (payload or {}).get('scheduledOccurrences')
    if not isinstance(supplied, list):
        return []
    starts = []
    for item in supplied:
        if not isinstance(item, dict):
            continue
        parsed = parse_graph_datetime(item.get('startDateTimeUtc'))
        if not parsed:
            continue
        if parsed.tzinfo is not None:
            parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
        starts.append(parsed)
    return starts


def teams_recurrence_slot_count(payload, local_start, repeat, occurrences, days_of_week=None):
    """Occurrences the recurrence must hold to reach the last planned session.

    Graph counts a numbered range in occurrences, not weeks, so the answer is how
    many times the pattern fires between the first planned session and the last --
    for a Mon+Thu group that is about twice the number of weeks, not once.

    Two things stretch that span past a plain session count: a holiday-shifted
    plan keeps the sessions but moves the later ones outwards, and a multi-day
    pattern also fires on days no session was planned for. Either one leaves
    trailing dates with no instance to move onto unless the range is sized off
    the dates, so the count is taken from them and the session count is only the
    floor. Instances the plan does not want are removed by the reconciliation
    that follows.
    """
    if repeat == 'none':
        return occurrences
    starts = teams_scheduled_occurrence_starts(payload)
    if len(starts) < 2:
        return occurrences
    offset = local_start - min(starts)
    first = (min(starts) + offset).date()
    last = (max(starts) + offset).date()
    span_days = (last - first).days
    if span_days <= 0:
        return occurrences
    if repeat in ('daily', 'weekdays'):
        spanned = span_days + 1
    else:
        names = days_of_week or teams_recurrence_weekdays(payload, local_start)
        indexes = {WEEKDAY_INDEX[name] for name in names if name in WEEKDAY_INDEX} or {first.weekday()}
        spanned = sum(
            1 for step in range(span_days + 1)
            if (first + timedelta(days=step)).weekday() in indexes
        )
    return max(occurrences, min(52, spanned))


def teams_calendar_minute_key(value):
    parsed = value if isinstance(value, datetime) else parse_graph_datetime(value)
    if not parsed:
        return ''
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed.replace(second=0, microsecond=0).isoformat(timespec='minutes')


def teams_shifted_occurrence_targets(payload, default_duration):
    """Wizard dates the calendar occurrences must land on, holiday shifts included."""
    supplied = payload.get('scheduledOccurrences')
    if not isinstance(supplied, list) or len(supplied) <= 1:
        return []
    targets = []
    for index, item in enumerate(supplied):
        if not isinstance(item, dict):
            continue
        start = parse_graph_datetime(item.get('startDateTimeUtc'))
        if not start:
            continue
        try:
            item_duration = max(15, min(1440, int(item.get('durationMinutes') or default_duration)))
        except (TypeError, ValueError):
            item_duration = default_duration
        try:
            session_number = max(1, int(item.get('sessionNumber') or index + 1))
        except (TypeError, ValueError):
            session_number = index + 1
        targets.append({
            'session_number': session_number,
            'start': start,
            'end': start + timedelta(minutes=item_duration),
        })
    return targets


def vacated_occurrence_keys(targets, existing_occurrences):
    """The dates sessions in THIS operation have just moved off.

    Keyed by the minute key of the old date, holding the identity that proves
    it: the LMS session number, where that session was, and where it is going.
    One entry per session whose stored date differs from the date it is being
    given now -- that old slot is the stale twin of a session still on this
    calendar, and the only occurrence a shift is ever allowed to retire.

    A session absent from ``targets`` contributes nothing. Its date has not been
    vacated; it is simply not part of this send. That distinction is the whole
    point: ``scheduledOccurrences`` is a positive update list, not a desired
    state, so "this Microsoft date is not in the array" says nothing about
    whether anybody wanted it cancelled -- and a week routed to its own
    additional meeting, or a weekly slot Graph materialised from the unbroken
    recurrence, is absent for reasons that have nothing to do with intent.
    """
    stored = {}
    for row in existing_occurrences or ():
        number = parse_int((row or {}).get('session_number'))
        key = teams_calendar_minute_key((row or {}).get('scheduled_start'))
        if number and key:
            stored[number] = key
    vacated = {}
    for target in targets or ():
        number = parse_int((target or {}).get('session_number'))
        previous = stored.get(number)
        current = teams_calendar_minute_key((target or {}).get('start'))
        if number and previous and current and previous != current:
            vacated[previous] = {
                'session_number': number,
                'previous_start': previous,
                'new_start': current,
                'reason': 'stale_twin_of_moved_session',
            }
    return vacated


def tracked_occurrence_keys(existing_occurrences):
    """Every date this calendar still owns a live session on.

    A Graph weekly recurrence materialises an instance in EVERY weekly slot of
    its range, so most of what Microsoft lists was never a session anybody
    planned -- it is filler the pattern generated, and clearing it is the only
    way a holiday-shifted plan can match at all.

    These keys are what tells the two apart. A date with an LMS occurrence row
    behind it is a real session, and a real session is never retired because it
    is absent from a send list: that is how a week routed to its own additional
    meeting came to be cancelled. A date with no row behind it never was one.
    """
    return {
        key for key in (
            teams_calendar_minute_key((row or {}).get('scheduled_start'))
            for row in existing_occurrences or ()
        ) if key
    }
