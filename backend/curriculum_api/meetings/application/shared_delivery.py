"""Meeting read orchestration over explicit capabilities.

The existing facade composes dependencies; query and business semantics are preserved.
"""


def apply_shared_teams_settings_to_weeks(
    module,
    weeks,
    *,
    SHARED_TEAMS_DELIVERY_SETTING_KEYS,
    clean_str,
    manual_link_settings,
    normalise_component_type,
    shared_teams_component_settings,
    teams_module_owner_id,
):
    """Project the source meeting onto an alias for read-only display.

    The alias keeps its own component rows and stores no provider IDs.  The
    source settings are overlaid only in the response so the builder, calendar
    and Teams dialogs show the same meeting.  The save path strips these keys
    again before persisting an alias.
    """
    source_id = clean_str((module or {}).get('teams_shared_source_module_id'))
    if not source_id:
        return weeks
    source_id = teams_module_owner_id(source_id)
    source_settings = shared_teams_component_settings(source_id)
    source_settings = [settings for settings in source_settings
                       if not clean_str(settings.get('extraTeamsMeetingUrl'))
                       and clean_str(settings.get('teamsMeetingScope')).lower() != 'additional']
    index = 0
    for week in weeks or []:
        for component in week.get('components') or []:
            if normalise_component_type(component.get('type')) != 'live_session':
                continue
            current = component.get('settings') if isinstance(component.get('settings'), dict) else {}
            if (clean_str(current.get('extraTeamsMeetingUrl'))
                    or clean_str(current.get('teamsMeetingScope')).lower() == 'additional'):
                extra_link = clean_str(current.get('extraTeamsMeetingUrl') or current.get('liveSessionLinkOverride')
                                       or current.get('liveSessionUrl') or current.get('teamsMeetingUrl'))
                if extra_link:
                    component['settings'] = {**current, 'liveSessionUrl': extra_link, 'teamsMeetingUrl': extra_link}
                continue
            if index >= len(source_settings) and current.get('teamsCalendarBinding') != 'unverified':
                index += 1
                continue
            source = source_settings[index] if index < len(source_settings) else {}
            own_link = clean_str(current.get('liveSessionLinkOverride'))
            if current.get('teamsCalendarBinding') == 'unverified':
                planned_date = clean_str(current.get('sessionDate') or week.get('sessionDate'))[:10]
                matching = [item for item in source_settings
                            if planned_date and clean_str(item.get('sessionDate'))[:10] == planned_date
                            and (not clean_str(current.get('sessionTime'))
                                 or clean_str(item.get('sessionTime'))[:5] == clean_str(current.get('sessionTime'))[:5])
                            and clean_str(item.get('liveSessionUrl') or item.get('teamsMeetingUrl')) == own_link
                            and clean_str(item.get('teamsOccurrenceId'))
                            and clean_str(item.get('teamsLiveSessionId'))
                            and item.get('teamsCalendarBinding') not in ('unverified', 'missing', 'ambiguous')]
                if len(matching) != 1:
                    # No positional guess for a newly pasted link. Legacy
                    # shared copies keep their established projection below.
                    if own_link:
                        component['settings'] = manual_link_settings(
                            {**current, 'liveSessionUrl': own_link, 'teamsMeetingUrl': own_link}, current,
                        )
                    index += 1
                    continue
                source = matching[0]
            source_link = clean_str(source.get('liveSessionUrl') or source.get('teamsMeetingUrl'))
            if own_link and own_link != source_link:
                component['settings'] = manual_link_settings(
                    {**current, 'liveSessionUrl': own_link, 'teamsMeetingUrl': own_link},
                    {'liveSessionUrl': source_link},
                )
                index += 1
                continue
            merged = {
                **current,
                **{
                    key: value for key, value in source.items()
                    if key in SHARED_TEAMS_DELIVERY_SETTING_KEYS and value not in (None, '')
                },
            }
            # A shared card opens the source's meeting. Its displayed clock
            # must travel with that identity even when reading weeks differ.
            for key in ('sessionDate', 'sessionTime', 'durationMinutes'):
                if source.get(key) not in (None, ''):
                    merged[key] = source[key]
            own_link = clean_str(current.get('liveSessionLinkOverride'))
            if own_link:
                merged['liveSessionUrl'] = own_link
                merged['teamsMeetingUrl'] = own_link
            if current.get('teamsCalendarBinding') == 'unverified':
                merged['teamsCalendarBinding'] = 'matched'
            component['settings'] = merged
            index += 1
        # Projection happens after the alias's own plan was stamped. Its heading
        # must describe the confirmed main meeting it now opens, without moving
        # the alias's week/component rows or changing the source booking.
        main = next((item for item in week.get('components') or []
                     if normalise_component_type(item.get('type')) == 'live_session'
                     and not (item.get('settings') or {}).get('extraTeamsMeetingUrl')
                     and clean_str((item.get('settings') or {}).get('teamsMeetingScope')).lower() != 'additional'), None)
        settings = (main or {}).get('settings') or {}
        confirmed = clean_str(settings.get('sessionDate'))[:10]
        start = clean_str(module.get('start_date') or module.get('startDate'))[:10]
        end = clean_str(module.get('end_date') or module.get('endDate'))[:10]
        if (settings.get('teamsOccurrenceId') and settings.get('teamsLiveSessionId')
                and settings.get('teamsCalendarBinding') not in ('unverified', 'missing', 'ambiguous')
                and confirmed and (not start or confirmed >= start) and (not end or confirmed <= end)):
            from datetime import date as calendar_date
            try:
                day = calendar_date.fromisoformat(confirmed)
            except ValueError:
                continue
            week['sessionDate'] = confirmed
            week['sessionDay'] = day.strftime('%A')
            if settings.get('sessionTime'):
                week['sessionStartTime'] = settings['sessionTime']
            if settings.get('durationMinutes'):
                week['sessionDurationMinutes'] = settings['durationMinutes']
    return weeks


def teams_delivery_metadata_from_live_session(
    module_catalogue_id,
    *,
    LIVE_SESSIONS_TABLE,
    authoring_fetch_all,
    clean_str,
    ensure_live_session_tracking_tables,
    teams_delivery_metadata_from_live_session_row,
    teams_module_owner_id,
):
    ensure_live_session_tracking_tables()
    owner_resolver = teams_module_owner_id
    owner_id = owner_resolver(module_catalogue_id) if callable(owner_resolver) else clean_str(module_catalogue_id)
    sessions = authoring_fetch_all(
        LIVE_SESSIONS_TABLE,
        "module_catalogue_id = %s and status = 'active'",
        [owner_id],
        'updated_at desc, created_at desc',
    )
    return teams_delivery_metadata_from_live_session_row(sessions[0] if sessions else None)
