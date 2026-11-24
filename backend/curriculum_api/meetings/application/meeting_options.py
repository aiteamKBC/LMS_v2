"""Meeting use cases composed from explicit reads, policies and provider capabilities."""


def apply_teams_meeting_options(
    organizer, join_url, recording='none', lobby_bypass='invited', spoken_language='en-GB', attendees=(),
    presenters=(), co_organizers=(), online_meeting_id='', meeting=None, groups=None, live_session_id='', *,
    TEAMS_LOBBY_VALUES, clean_str, load_ALL_GROUPS, load_OPTIONS_PATCH, load_get_graph_settings,
    load_microsoft_graph_request, logger, teams_meeting_base_path, teams_online_meeting_from_join_url,
    teams_online_meeting_owner_id, teams_series_email_list,
):
    """Apply this deployment's meeting policy to the onlineMeeting behind an event.

    Every Teams meeting the LMS owns comes through here: a module's series, a
    rescheduled one, a holiday-shifted session recreated on its own event, and a
    coach's booking alike. A calendar event only ever creates the meeting at the
    tenant defaults, so recording, automatic recording, transcription, the lobby
    and who presents exist only once this has run against it -- a meeting that
    skips it opens with nothing recording, no transcript afterwards, and every
    guest a presenter.

    ``groups`` limits the PATCH to the option groups that need sending (see
    teams_meeting_options_policy); None sends all of them, as every caller
    creating a meeting does. An empty set sends nothing and reports applied.

    Returns ``(applied, meeting, warnings)`` and never raises. The calendar
    invitation is real work already done, and these options need
    OnlineMeetings.ReadWrite.All plus an application access policy on the
    organizer that a deployment may not have granted yet. Every refusal is
    kept by teams_graph_failure_log (``live_session_id`` names the series).
    """
    microsoft_graph_request, = load_microsoft_graph_request()
    OPTIONS_PATCH, OPTIONS_RESOLVE, record_graph_failure = load_OPTIONS_PATCH()
    ALL_GROUPS, graph_error_details, meeting_options_patch = load_ALL_GROUPS()

    groups = set(ALL_GROUPS) if groups is None else set(groups)
    resolved = meeting if isinstance(meeting, dict) else {}
    if not groups:
        # Nothing about how this meeting runs changed: no Graph call at all.
        return True, resolved, []
    meeting_id = clean_str(online_meeting_id) or clean_str(resolved.get('id'))
    if not meeting_id and join_url:
        try:
            resolved = teams_online_meeting_from_join_url(organizer, join_url) or {}
        except RuntimeError as exc:
            logger.warning('Unable to resolve the onlineMeeting behind a Teams event: %s', exc)
            record_graph_failure(OPTIONS_RESOLVE, str(exc), live_session_id=live_session_id, organizer=organizer,
                                 organizer_object_id=teams_online_meeting_owner_id(organizer, join_url),
                                 groups=groups)
            return False, resolved, [{
                'code': 'teams_meeting_options_not_applied',
                'message': (
                    'The Teams link was created and saved, but Microsoft has not exposed its meeting options yet. '
                    'Recording, transcription and lobby settings remain pending; open the calendar review to retry.'
                ),
                # The raw Graph refusal is kept in teams_graph_failures for
                # diagnosis. It is not shown as a permissions verdict here:
                # Graph can return the same 403 briefly after creating an event.
                'detail': '',
            }]
        meeting_id = clean_str(resolved.get('id'))
    if not meeting_id:
        return False, resolved, [{
            'code': 'teams_meeting_options_not_applied',
            'message': (
                'Microsoft Graph has not exposed this meeting: its online meeting ID is not available yet, so the '
                'recording, transcription and lobby options were not applied.'
            ),
            'detail': '',
        }]

    lobby_choice = clean_str(lobby_bypass).lower() or 'invited'
    if lobby_choice not in TEAMS_LOBBY_VALUES:
        lobby_choice = 'invited'
    # Never `list(...)` these: a caller that passes the stored JSON text instead
    # of a parsed list would have it split into characters here.
    patch = meeting_options_patch(
        groups, recording=recording, lobby_scope=TEAMS_LOBBY_VALUES[lobby_choice],
        spoken_language=spoken_language, attendees=teams_series_email_list(attendees),
        presenters=teams_series_email_list(presenters), co_organizers=teams_series_email_list(co_organizers),
    )
    if not patch:
        return True, resolved, []
    meeting_path = teams_meeting_base_path(organizer, meeting_id, join_url)
    organizer_object_id = teams_online_meeting_owner_id(organizer, join_url)
    try:
        microsoft_graph_request(
            'PATCH',
            meeting_path,
            payload=patch,
        )
    except RuntimeError as exc:
        get_graph_settings, = load_get_graph_settings()
        graph_settings = get_graph_settings()
        logger.warning(
            'Unable to apply Teams meeting options: organizer_upn=%s '
            'organizer_object_id=%s graph_client_id=%s method=PATCH path=%s '
            'online_meeting_id=%s error=%s',
            organizer,
            organizer_object_id,
            graph_settings.get('client_id', ''),
            meeting_path,
            meeting_id,
            exc,
        )
        record_graph_failure(OPTIONS_PATCH, str(exc), live_session_id=live_session_id, online_meeting_id=meeting_id,
                             organizer=organizer, organizer_object_id=organizer_object_id, groups=groups)
        return False, resolved, [{
            'code': 'teams_meeting_options_not_applied',
            'message': (
                'The Teams meeting exists, but Microsoft Graph did not apply its lobby, recording, transcription '
                'and presenter options. Check the Graph error detail for the exact cause.'
            ),
            'detail': str(exc),
            'groups': sorted(groups),
            'graphError': graph_error_details(str(exc)),
            'organizer': clean_str(organizer),
            'organizerObjectId': organizer_object_id,
            'failureLogged': True,
        }]
    return True, resolved, []


def teams_standalone_occurrence_meeting(
    owner_key, event, target, invited_people, meeting_options, groups=None, *, apply_teams_meeting_options,
    clean_str, load_microsoft_graph_request, logger, urllib_parse,
):
    """Give an occurrence recreated on its own event the options its series has.

    Graph builds a fresh onlineMeeting for a fresh event, at the tenant defaults,
    and the series own options never reach it. Left alone, the one session that
    had to move is the one that records nothing and produces no transcript.
    """
    microsoft_graph_request, = load_microsoft_graph_request()

    warnings = []
    event_id = clean_str((event or {}).get('id'))
    join_url = clean_str(((event or {}).get('onlineMeeting') or {}).get('joinUrl'))
    if event_id and not join_url:
        try:
            refreshed = microsoft_graph_request(
                'GET',
                f'users/{owner_key}/events/{urllib_parse.quote(event_id, safe="")}',
            )
            join_url = clean_str(((refreshed or {}).get('onlineMeeting') or {}).get('joinUrl'))
        except RuntimeError as exc:
            logger.warning('Unable to read the Teams link of a recreated occurrence: %s', exc)
    options = meeting_options or {}
    online_meeting_id = ''
    if join_url and options:
        _applied, meeting, option_warnings = apply_teams_meeting_options(
            options.get('organizer', ''),
            join_url,
            recording=options.get('recording', 'none'),
            lobby_bypass=options.get('lobby_bypass', 'invited'),
            spoken_language=options.get('spoken_language', 'en-GB'),
            attendees=invited_people,
            presenters=options.get('presenters') or [],
            co_organizers=options.get('co_organizers') or [],
            groups=groups,
        )
        warnings.extend(option_warnings)
        online_meeting_id = clean_str((meeting or {}).get('id'))
    return {
        'session_number': (target or {}).get('session_number'),
        'graph_event_id': event_id,
        'join_url': join_url,
        'online_meeting_id': online_meeting_id,
        'warnings': warnings,
    }


def refresh_standalone_occurrence_options(
    owner_key, series_event_id, occurrences, invited_people, meeting_options, groups=None, *, clean_str,
    teams_standalone_occurrence_meeting,
):
    """Re-apply roles and options to sessions restored on events of their own.

    The people-only counterpart of the standalone half of
    ``apply_teams_occurrence_shifts``: the same onlineMeeting options, and
    nothing else. It never reads or writes a date, never moves an event and
    never creates one -- a people-only save must leave the schedule exactly as
    Microsoft holds it. Returns ``(warnings, details)`` in that function's shape.
    ``groups`` is the option groups this save changed; empty sends nothing.
    """
    warnings, details = [], []
    if groups is not None and not groups:
        return warnings, details
    series_event_id = clean_str(series_event_id)
    for row in occurrences or []:
        standalone_id = clean_str(row.get('graph_event_id'))
        if not standalone_id or standalone_id == series_event_id:
            continue
        if clean_str(row.get('status')).lower() in ('cancelled', 'canceled', 'superseded'):
            continue
        event = {'id': standalone_id, 'onlineMeeting': {'joinUrl': clean_str(row.get('join_url'))}}
        detail = teams_standalone_occurrence_meeting(
            owner_key, event, {'session_number': row.get('session_number')}, invited_people, meeting_options,
            groups=groups,
        )
        warnings.extend(detail.pop('warnings'))
        if not detail.get('online_meeting_id'):
            detail['online_meeting_id'] = clean_str(row.get('online_meeting_id'))
        details.append(detail)
    return warnings, details
