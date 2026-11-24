"""Meeting storage and Graph adapters; runtime dependencies are supplied by the facade."""


def teams_meeting_default_organizer(
    *, clean_str, os,
):
    return clean_str(
        os.environ.get('MICROSOFT_TEAMS_ORGANIZER_EMAIL')
        or os.environ.get('MICROSOFT_ORGANIZER_EMAIL')
    )


def teams_online_meeting_owner_id(
    organizer, join_url='', *, clean_str, json, os, re, teams_meeting_default_organizer, urllib_parse,
    urlparse,
):
    """Return the organizer object ID required by onlineMeetings Graph routes."""
    configured_id = clean_str(os.environ.get('MICROSOFT_TEAMS_ORGANIZER_ID'))
    configured_organizer = teams_meeting_default_organizer()
    organizer_matches_default = (
        configured_organizer
        and clean_str(organizer).lower() == configured_organizer.lower()
    )
    if re.fullmatch(r'[0-9a-fA-F-]{36}', configured_id) and organizer_matches_default:
        return configured_id
    try:
        decoded_url = urllib_parse.unquote(clean_str(join_url))
        context_values = urllib_parse.parse_qs(urlparse(decoded_url).query).get('context') or []
        if context_values:
            context = json.loads(urllib_parse.unquote(context_values[0]))
            organizer_id = clean_str(context.get('Oid') or context.get('oid'))
            if re.fullmatch(r'[0-9a-fA-F-]{36}', organizer_id):
                return organizer_id
    except (TypeError, ValueError, json.JSONDecodeError):
        pass
    return clean_str(organizer)


def graph_timezone_iana(
    graph_settings, *, calendar_zone, clean_str, os,
):
    """IANA id for the calendar's timezone, for the wizard to schedule against."""
    if graph_settings.get('_schedule_timezone_iana'):
        return graph_settings['_schedule_timezone_iana']
    override = clean_str(os.environ.get('MICROSOFT_GRAPH_TIMEZONE_IANA'))
    if override:
        return override
    return calendar_zone(clean_str(graph_settings.get('timezone')) or 'Europe/London').key


def teams_meeting_base_path(
    organizer, meeting_id, join_url='', *, clean_str, teams_online_meeting_owner_id, urllib_parse,
):
    """Graph path of one onlineMeeting, resolved for the organizer that owns it."""
    owner_key = urllib_parse.quote(teams_online_meeting_owner_id(organizer, join_url), safe='')
    return f'users/{owner_key}/onlineMeetings/{urllib_parse.quote(clean_str(meeting_id), safe="")}'
