"""Meeting response mapping and HTTP workflows; public decorators remain at the facade.

The existing facade composes dependencies; query and business semantics are preserved.
"""


def teams_delivery_metadata_from_weeks(
    weeks,
    *,
    clean_str,
):
    for week in weeks or []:
        for component in week.get('components') or []:
            if clean_str(component.get('type')).lower().replace('_', '-') != 'live-session':
                continue
            settings = component.get('settings') if isinstance(component.get('settings'), dict) else {}
            live_session_id = clean_str(settings.get('teamsLiveSessionId'))
            event_id = clean_str(settings.get('teamsEventId'))
            join_url = clean_str(settings.get('teamsMeetingUrl') or settings.get('liveSessionUrl'))
            if not (live_session_id or event_id or join_url):
                continue
            return {
                'teamsMeetingUrl': join_url,
                'liveSessionUrl': join_url,
                'teamsLiveSessionId': live_session_id,
                'teamsOnlineMeetingId': clean_str(settings.get('teamsOnlineMeetingId')),
                'teamsEventId': event_id,
                'teamsWebLink': clean_str(settings.get('teamsWebLink')),
                'teamsMeetingOptionsUrl': clean_str(settings.get('teamsMeetingOptionsUrl')),
                'teamsOrganizerEmail': clean_str(settings.get('teamsOrganizerEmail')),
                'teamsAttendees': settings.get('teamsAttendees') or [],
                'teamsPresenters': settings.get('teamsPresenters') or [],
                'teamsCoOrganizers': settings.get('teamsCoOrganizers') or [],
                'teamsStartDateTimeUtc': clean_str(settings.get('teamsStartDateTimeUtc') or settings.get('sessionDateTimeUtc')),
                'teamsDurationMinutes': clean_str(settings.get('teamsDurationMinutes') or settings.get('durationMinutes')),
                'teamsRepeat': clean_str(settings.get('teamsRepeat')),
                'teamsRepeatOccurrences': clean_str(settings.get('teamsRepeatOccurrences')),
                'teamsLobbyBypass': clean_str(settings.get('teamsLobbyBypass')),
                'teamsRecording': clean_str(settings.get('teamsRecording')),
                'teamsSpokenLanguage': clean_str(settings.get('teamsSpokenLanguage')),
                'teamsMeetingType': clean_str(settings.get('teamsMeetingType')),
                'teamsRequestResponses': settings.get('teamsRequestResponses'),
                'teamsAllowTimeProposals': settings.get('teamsAllowTimeProposals'),
                'teamsHideAttendees': settings.get('teamsHideAttendees'),
            }
    return {}


def teams_delivery_metadata_from_live_session_row(
    session_row,
    *,
    live_session_row_to_component_settings,
):
    """Teams metadata for one live_sessions row, or {} when there is none.

    Split out from the single-module reader below so a caller that has already
    batch-read the table for many modules maps the row exactly the same way,
    rather than growing a second copy of this field list that can drift.
    """
    if not session_row:
        return {}
    settings = live_session_row_to_component_settings(session_row)
    return {
        'teamsMeetingUrl': settings.get('teamsMeetingUrl') or '',
        'liveSessionUrl': settings.get('liveSessionUrl') or '',
        'teamsLiveSessionId': settings.get('teamsLiveSessionId') or '',
        'teamsOnlineMeetingId': settings.get('teamsOnlineMeetingId') or '',
        'teamsEventId': settings.get('teamsEventId') or '',
        'teamsWebLink': settings.get('teamsWebLink') or '',
        'teamsMeetingOptionsUrl': settings.get('teamsMeetingOptionsUrl') or '',
        'teamsOrganizerEmail': settings.get('teamsOrganizerEmail') or '',
        'teamsAttendees': settings.get('teamsAttendees') or [],
        'teamsPresenters': settings.get('teamsPresenters') or [],
        'teamsCoOrganizers': settings.get('teamsCoOrganizers') or [],
        'teamsStartDateTimeUtc': settings.get('teamsStartDateTimeUtc') or '',
        'teamsDurationMinutes': settings.get('teamsDurationMinutes') or '',
        'teamsRepeat': settings.get('teamsRepeat') or '',
        'teamsRepeatOccurrences': settings.get('teamsRepeatOccurrences') or '',
        'teamsLobbyBypass': settings.get('teamsLobbyBypass') or '',
        'teamsRecording': settings.get('teamsRecording') or '',
        'teamsSpokenLanguage': settings.get('teamsSpokenLanguage') or '',
        'teamsMeetingType': settings.get('teamsMeetingType') or '',
        'teamsRequestResponses': settings.get('teamsRequestResponses'),
        'teamsAllowTimeProposals': settings.get('teamsAllowTimeProposals'),
        'teamsHideAttendees': settings.get('teamsHideAttendees'),
    }


def live_session_row_to_component_settings(
    row,
    *,
    as_json_value,
    clean_str,
    graph_timezone_iana,
    parse_int,
    teams_schedule_settings,
    utc_iso_value,
):
    start_value = utc_iso_value(row.get('start_datetime'))
    join_url = clean_str(row.get('join_url'))
    return {
        'teamsMeetingUrl': join_url,
        'liveSessionUrl': join_url,
        'teamsLiveSessionId': clean_str(row.get('id')),
        'teamsOnlineMeetingId': clean_str(row.get('online_meeting_id')),
        'teamsEventId': clean_str(row.get('graph_event_id')),
        'teamsWebLink': clean_str(row.get('web_link')),
        'teamsMeetingOptionsUrl': clean_str(row.get('meeting_options_url')),
        'teamsOrganizerEmail': clean_str(row.get('organizer_email')),
        'teamsAttendees': as_json_value(row.get('attendees'), []),
        'teamsPresenters': as_json_value(row.get('presenters'), []),
        'teamsCoOrganizers': as_json_value(row.get('co_organizers'), []),
        'teamsStartDateTimeUtc': start_value,
        'sessionDateTimeUtc': start_value,
        'teamsDurationMinutes': parse_int(row.get('duration_minutes'), 60),
        'durationMinutes': parse_int(row.get('duration_minutes'), 60),
        'teamsProvider': clean_str(row.get('provider')) or 'Microsoft Teams',
        'sessionTimeZone': graph_timezone_iana(teams_schedule_settings({}, series=row)),
        'teamsRepeat': clean_str(row.get('repeat_pattern')) or 'none',
        'teamsRepeatOccurrences': parse_int(row.get('repeat_occurrences'), 1),
        'teamsLobbyBypass': clean_str(row.get('lobby_bypass')) or 'invited',
        'teamsRecording': clean_str(row.get('recording')) or 'none',
        'teamsSpokenLanguage': clean_str(row.get('spoken_language')) or 'en-GB',
        'teamsMeetingType': clean_str(row.get('meeting_type')) or 'live-session',
        'teamsRequestResponses': bool(row.get('request_responses')),
        'teamsAllowTimeProposals': bool(row.get('allow_time_proposals')),
        'teamsHideAttendees': bool(row.get('hide_attendees')),
    }


def occurrence_local_start(
    occurrence,
    series_settings,
    *,
    ZoneInfo,
    clean_str,
    graph_timezone_iana,
    parse_graph_datetime,
    timezone,
):
    """When one booked session starts, read in its own time zone."""
    start_at = parse_graph_datetime((occurrence or {}).get('scheduled_start'))
    if not start_at:
        return None
    zone = ZoneInfo(clean_str((series_settings or {}).get('sessionTimeZone')) or graph_timezone_iana({}))
    return start_at.replace(tzinfo=start_at.tzinfo or timezone.utc).astimezone(zone)


def occurrence_local_date(
    occurrence,
    series_settings,
    *,
    occurrence_local_start,
):
    """The calendar date one booked session runs on, in its own time zone.

    The pairing key between a module's live-session components and the sessions
    Microsoft holds. A date survives what a number does not: cancelling a
    session leaves its number behind, a week with no live session still consumes
    a delivery slot number, and the two numbering schemes that produced a series
    over its lifetime need not agree. The day a session runs on is the same fact
    on both sides, and it is the one the author reads off the screen.
    """
    local_start = occurrence_local_start(occurrence, series_settings)
    return local_start.date().isoformat() if local_start else ''


def live_occurrence_component_settings(
    occurrence,
    series_settings,
    *,
    clean_str,
    occurrence_local_start,
    parse_graph_datetime,
    parse_int,
    utc_iso_value,
):
    """The settings that belong to one session rather than to the whole series.

    A plain recurring series shares one join link, event series and online meeting,
    while every LMS session keeps its own occurrence id and date. This lets the
    sync attach each report/artifact to the correct session without changing the
    learner's join URL.
    """
    if not occurrence:
        return {}
    start_value = utc_iso_value(occurrence.get('scheduled_start'))
    end_value = occurrence.get('scheduled_end')
    settings = {
        'teamsOccurrenceId': clean_str(occurrence.get('id')),
        'teamsSessionNumber': parse_int(occurrence.get('session_number'), 0),
    }
    join_url = clean_str(occurrence.get('join_url')) or clean_str(series_settings.get('liveSessionUrl'))
    if join_url:
        settings['teamsMeetingUrl'] = join_url
        settings['liveSessionUrl'] = join_url
    for column, key in (('graph_event_id', 'teamsEventId'), ('online_meeting_id', 'teamsOnlineMeetingId')):
        value = clean_str(occurrence.get(column))
        if value:
            settings[key] = value
    if start_value:
        settings['teamsStartDateTimeUtc'] = start_value
        settings['sessionDateTimeUtc'] = start_value
    start_at = parse_graph_datetime(occurrence.get('scheduled_start'))
    # The calendar DATE that confirmed instant falls on, in the session's own
    # time zone -- written here because the instant above is.
    #
    # Moving a series through the schedule endpoint rewrites the occurrence, so
    # `sessionDateTimeUtc` followed Microsoft to the new day while `sessionDate`
    # stayed on the day the session was first booked on. The two then disagreed
    # permanently: the component read as still running on its old date, the
    # Course structure compared that date against the week's plan and reported a
    # drift that no update could ever clear, because every update moved the
    # instant and left the date behind. One occurrence, one date.
    local_start = occurrence_local_start(occurrence, series_settings)
    if local_start:
        settings['sessionDate'] = local_start.date().isoformat()
        settings['sessionDay'] = local_start.strftime('%A')
        settings['sessionTime'] = local_start.strftime('%H:%M')
    end_at = parse_graph_datetime(end_value)
    if start_at and end_at and end_at > start_at:
        minutes = int((end_at - start_at).total_seconds() // 60)
        if minutes:
            settings['teamsDurationMinutes'] = minutes
            settings['durationMinutes'] = minutes
    return settings
