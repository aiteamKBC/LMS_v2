"""Pure calendar ownership, occurrence identity and scheduling decisions.

The existing facade composes dependencies; query and business semantics are preserved.
"""

from datetime import timedelta
from ...catalogue.domain.values import clean_str
from .instants import parse_graph_datetime
from .recurrence_policy import teams_calendar_minute_key


def scheduled_live_session_occurrences(payload, utc_start, duration, repeat, occurrences):
    supplied = payload.get('scheduledOccurrences')
    normalized = []
    if isinstance(supplied, list):
        for index, item in enumerate(supplied):
            if not isinstance(item, dict):
                continue
            start = parse_graph_datetime(item.get('startDateTimeUtc'))
            if not start:
                continue
            item_duration = max(15, min(1440, int(item.get('durationMinutes') or duration)))
            normalized.append({
                'session_number': max(1, int(item.get('sessionNumber') or index + 1)),
                'start': start,
                'end': start + timedelta(minutes=item_duration),
            })
    if normalized:
        return sorted(normalized, key=lambda item: (item['session_number'], item['start']))
    count = occurrences if repeat != 'none' else 1
    current = utc_start
    for index in range(count):
        normalized.append({'session_number': index + 1, 'start': current, 'end': current + timedelta(minutes=duration)})
        if repeat == 'daily':
            current += timedelta(days=1)
        elif repeat == 'weekdays':
            current += timedelta(days=1)
            while current.weekday() >= 5:
                current += timedelta(days=1)
        else:
            current += timedelta(days=7)
    return normalized


def occurrence_session_number(row):
    try:
        return int((row or {}).get('session_number') or 0)
    except (TypeError, ValueError):
        return 0


def pair_planned_occurrences(planned, existing_rows):
    """Which stored session row each planned session is, paired by DATE first.

    A stored row is a session people were invited to, and its id is what
    attendance, recordings and join launches point at. So a planned session on
    the minute a row already runs keeps that row, whatever number either side
    carries -- adding a session in front of others renumbers them, it does not
    move them. Only a planned session no row runs on takes the row that shares
    its number (a genuine move), and failing that it is new.

    Returns ``(pairs, unclaimed)``: ``pairs`` is ``[(item, row or None)]`` in
    planned order, ``unclaimed`` the stored rows no planned session kept.
    """
    remaining = [row for row in existing_rows if clean_str(row.get('id'))]
    pairs = [None] * len(planned)
    # Cancelled rows are audit history, not reusable meeting identity. Keeping
    # them out of both matching passes lets the replacement writer park any
    # positive historical number before a new active row claims it.
    active_remaining = [
        row for row in remaining
        if clean_str(row.get('status')).lower() not in {'cancelled', 'canceled', 'declined', 'deleted', 'removed'}
    ]
    by_minute = active_remaining
    for index, item in enumerate(planned):
        key = teams_calendar_minute_key(item['start'])
        match = next((row for row in by_minute if row in remaining
                      and teams_calendar_minute_key(row.get('scheduled_start')) == key), None)
        if match is not None:
            remaining.remove(match)
            pairs[index] = (item, match)
    for index, item in enumerate(planned):
        if pairs[index] is not None:
            continue
        match = next((row for row in active_remaining if row in remaining
                      and occurrence_session_number(row) == item['session_number']), None)
        if match is not None:
            remaining.remove(match)
        pairs[index] = (item, match)
    return pairs, remaining


def live_session_booked_on_module_calendar(
    settings,
    *,
    clean_str,
    parse_int,
):
    """Whether the module series already holds a booked occurrence for this live session.

    ``teamsOccurrenceId``/``teamsSessionNumber`` are written only when a real
    Graph occurrence is paired to the component, unlike ``liveSessionUrl``,
    which the series can stamp on a live session without a confirmed booking.
    """
    settings = settings if isinstance(settings, dict) else {}
    return bool(clean_str(settings.get('teamsOccurrenceId')) or parse_int(settings.get('teamsSessionNumber'), 0) > 0)


def module_has_booked_series(
    settings_list,
    *,
    LIVE_SESSION_MEETING_SCOPE_KEY,
    clean_str,
    live_session_booked_on_module_calendar,
):
    """Whether new sessions must choose a calendar instead of defaulting to main.

    A pasted main link establishes that context without proving any occurrence
    is booked. Keep the strict booking check separate for booking permissions.
    """
    for settings in settings_list or []:
        settings = settings if isinstance(settings, dict) else {}
        if clean_str(settings.get('extraTeamsMeetingUrl')):
            continue
        if live_session_booked_on_module_calendar(settings):
            return True
        if clean_str(settings.get(LIVE_SESSION_MEETING_SCOPE_KEY)).lower() == 'additional':
            continue
        if any(clean_str(settings.get(key)) for key in ('liveSessionUrl', 'teamsMeetingUrl', 'liveSessionLinkOverride')):
            return True
    return False


def live_session_meeting_scope(
    settings,
    module_has_series=True,
    *,
    LIVE_SESSION_MEETING_SCOPES,
    LIVE_SESSION_MEETING_SCOPE_KEY,
    clean_str,
    live_session_booked_on_module_calendar,
):
    """Which calendar delivers this live session: 'main', 'additional' or 'pending'.

    A confirmed booking outranks the stored choice: a live session that holds
    an additional meeting is 'additional', one the module series has booked is
    'main'. Otherwise the author's stored choice decides, and a legacy normal
    meeting link fills in the display when no choice was stored.

    With neither, it depends on whether the module already has a calendar.
    Before it has one every live session is the module's -- there is nothing to
    overwrite. After, a live session nobody has assigned (a week added later)
    is 'pending': the module calendar must not book it until someone decides,
    because the series and an additional meeting on the same week would deliver
    it twice, and the next Update would put the series' link over the other's.

    The frontend reads the same rule in `liveSessionMeetingScope`.
    """
    settings = settings if isinstance(settings, dict) else {}
    if clean_str(settings.get('extraTeamsMeetingUrl')):
        return 'additional'
    if live_session_booked_on_module_calendar(settings):
        return 'main'
    chosen = clean_str(settings.get(LIVE_SESSION_MEETING_SCOPE_KEY)).lower()
    if chosen in LIVE_SESSION_MEETING_SCOPES:
        return chosen
    # Legacy rows can retain a normal join link without occurrence metadata.
    # The link settles what the dialog displays; it is not treated as a
    # confirmed booking by `live_session_booked_on_module_calendar`.
    if any(clean_str(settings.get(key)) for key in ('liveSessionUrl', 'teamsMeetingUrl', 'liveSessionLinkOverride')):
        return 'main'
    return 'pending' if module_has_series else 'main'


def preserve_additional_meeting_settings(
    payload_settings,
    stored_row,
    *,
    ADDITIONAL_MEETING_SETTING_KEYS,
    LIVE_SESSION_MEETING_SCOPE_KEY,
    clean_str,
    component_builder_settings,
):
    """Keep a component's booked additional meeting across a full structure save.

    Returns the settings to store: the payload's, with the stored additional
    meeting put back on top when there is one. A component that has never had
    one is returned untouched, so this costs nothing for every other component.

    The author's main/additional choice is the stored row's too: it is set from
    the Teams dialog and by booking, never by the builder, so a builder tab
    opened before it was made can neither erase it nor put an old one back, and
    a copied component starts undecided rather than inheriting its source's.
    """
    payload_settings = {key: value for key, value in (payload_settings or {}).items()
                        if key not in {LIVE_SESSION_MEETING_SCOPE_KEY, 'teamsMainLinkInherited'}}
    if not stored_row:
        return payload_settings
    stored = component_builder_settings(stored_row)
    if not isinstance(stored, dict):
        return payload_settings
    stored_scope = clean_str(stored.get(LIVE_SESSION_MEETING_SCOPE_KEY))
    if stored_scope:
        payload_settings[LIVE_SESSION_MEETING_SCOPE_KEY] = stored_scope
    if 'teamsMainLinkInherited' in stored:
        for key in ('teamsMainLinkInherited', 'teamsCalendarBinding', 'liveSessionUrl', 'teamsMeetingUrl', 'liveSessionLinkOverride'):
            if key in stored:
                payload_settings[key] = stored[key]
            else:
                payload_settings.pop(key, None)
    if not clean_str(stored.get('extraTeamsMeetingUrl')):
        return payload_settings
    kept = {key: stored[key] for key in ADDITIONAL_MEETING_SETTING_KEYS if key in stored}
    join_url = clean_str(stored.get('extraTeamsMeetingUrl'))
    return {**payload_settings, **kept, 'liveSessionUrl': join_url, 'teamsMeetingUrl': join_url}


def replaceable_live_session(
    row,
    *,
    shared=False,
    clean_str,
    component_builder_settings,
    frontend_component_type,
):
    """May a bulk replacement overwrite this component's join link?

    The same rule the Module Builder's Replace Teams links dialog counts by: a
    live session (with or without a link), and is not an additional one-off meeting
    -- that one is booked separately and keeps its own link. A module sharing
    another module's meeting stores no link on its rows (it is read from the
    source), so for it every such live session carries one.
    """
    if frontend_component_type(row.get('type')) != 'live-session':
        return False
    settings = component_builder_settings(row)
    if (clean_str(settings.get('extraTeamsMeetingUrl'))
            or clean_str(settings.get('teamsMeetingScope')).lower() == 'additional'):
        return False
    # A newly authored live session has no link yet.  It is still a legitimate
    # target for Replace Teams links; requiring an old link here made the
    # dialog unable to attach a copied meeting to a new module at all.
    return True
