"""Meeting use cases composed from explicit reads, policies and provider capabilities."""


def graph_item_with_occurrence_link(
    item, occurrence, launch=None, *, clean_str, parse_int,
):
    """Persist the calendar/LMS occurrence chosen for a Graph report or artifact."""
    linked = dict(item) if isinstance(item, dict) else {}
    linked['lmsOccurrenceId'] = clean_str(occurrence.get('id'))
    linked['lmsSessionNumber'] = parse_int(occurrence.get('session_number'), 0)
    linked['calendarEventId'] = clean_str(occurrence.get('graph_event_id'))
    linked['joinLaunchId'] = clean_str((launch or {}).get('id'))
    return linked


def live_session_recording_graph_base(
    occurrence_id, *, LIVE_SESSIONS_TABLE, LIVE_SESSION_OCCURRENCES_TABLE, authoring_fetch_all, clean_str,
    teams_online_meeting_owner_id, urllib_parse,
):
    """Graph path prefix for one live-session occurrence's online meeting.

    Returns ``(base, error)``. Used by the archive command, which works from an
    occurrence id alone and has no request or series context to hand.
    A recreated session carries its own meeting, so the occurrence's own
    identifiers win and the series is only a fallback.
    """
    occurrences = authoring_fetch_all(LIVE_SESSION_OCCURRENCES_TABLE, 'id = %s', [occurrence_id])
    if not occurrences:
        return '', 'Occurrence not found.'
    occurrence = occurrences[0]

    series_rows = authoring_fetch_all(
        LIVE_SESSIONS_TABLE, 'id = %s', [clean_str(occurrence.get('live_session_id'))]
    )
    series = series_rows[0] if series_rows else {}

    occurrence_meeting_id = clean_str(occurrence.get('online_meeting_id'))
    meeting_id = occurrence_meeting_id or clean_str(series.get('online_meeting_id'))
    join_url = (
        (clean_str(occurrence.get('join_url')) if occurrence_meeting_id else '')
        or clean_str(series.get('join_url'))
    )
    organizer = clean_str(series.get('organizer_email'))
    owner_id = teams_online_meeting_owner_id(organizer, join_url)
    if not owner_id or not meeting_id:
        return '', 'The occurrence is missing its Graph identifiers.'

    return (
        f'users/{urllib_parse.quote(owner_id, safe="")}/onlineMeetings/'
        f'{urllib_parse.quote(meeting_id, safe="")}'
    ), ''
