"""HTTP response and workflow boundary; URL/authentication decorators remain at the public facade.

Existing behavior is preserved; legacy capabilities are composed at the outer facade.
"""


def curriculum_teams_meeting(
    request,
    *,
    EVENT_SAVE,
    JsonResponse,
    LIVE_SESSIONS_TABLE,
    LIVE_SESSION_OCCURRENCES_TABLE,
    TEAMS_LOBBY_VALUES,
    apply_teams_meeting_options,
    apply_teams_occurrence_shifts,
    attach_teams_meeting_to_module_weeks,
    authoring_fetch_all,
    authoring_module_exists,
    calendar_groups,
    calendar_targets,
    clean_str,
    datetime,
    ensure_live_sessions_table,
    external_teams_calendar_refusal,
    flag_teams_occurrence_leftovers,
    get_graph_settings,
    graph_timezone_iana,
    has_column,
    has_graph_credentials,
    json_body,
    json_db_value,
    json_error,
    live_session_row_to_component_settings,
    logger,
    microsoft_graph_request,
    module_has_external_teams_calendar,
    persist_live_session_series,
    persist_recreated_occurrence_details,
    publish_teams_calendar_attendees,
    record_graph_failure,
    record_reconcile,
    remember_teams_dial_in,
    replace_live_session_occurrences,
    resolve_stored_module_catalogue_id,
    save_weekday_calendar,
    saved_live_session_occurrences,
    teams_calendar_subject,
    teams_event_payload,
    teams_meeting_default_organizer,
    teams_module_owner_id,
    teams_new_meeting_organizer,
    teams_non_delivery_reason,
    teams_schedule_settings,
    teams_shifted_occurrence_targets,
    update_authoring_rows,
    urllib_parse,
    verify_teams_calendar_with_standalones,
    without_missing,
    prune_study_week_fillers,
    teams_module_session_limit,
):
    """
    Create a calendar-backed Teams meeting for a Module Builder live session.

    The event endpoint sends real calendar invitations. Meeting-policy options
    that Graph cannot set on a calendar event are returned as a warning and are
    still persisted by the frontend for visibility.
    """

    graph_settings = get_graph_settings()
    default_organizer = teams_meeting_default_organizer()
    if request.method == 'GET':
        return JsonResponse({
            'configured': has_graph_credentials(),
            'defaultOrganizer': default_organizer,
            # Kept in the response for older frontends. A configured mailbox now
            # supplies the initial value only; the organizer of a new meeting is
            # always selectable by the caller.
            'organizerLocked': False,
            'timeZone': graph_settings.get('timezone') or 'GMT Standard Time',
            'timeZoneIana': graph_timezone_iana(graph_settings),
        })
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)
    if not has_graph_credentials():
        return json_error('Microsoft Graph credentials are not configured.', status=503)

    payload = json_body(request)
    if not isinstance(payload, dict):
        return json_error('A valid JSON body is required.')
    # One module delivery owns one active Teams calendar. Creating from a
    # second live-session component used to POST another real Outlook event
    # first and only then mark the previous LMS row as superseded, leaving
    # duplicate invitations on different organizer calendars. Refuse before
    # touching Graph; callers should re-attach or update the active series.
    ensure_live_sessions_table()
    requested_catalogue_id = clean_str(payload.get('moduleCatalogueId'))
    # The cheap resolver, as the restore endpoint uses: a stored module id is its
    # own answer in one indexed read, where the general resolver summarises
    # every module in the database before Microsoft is even called.
    resolved_catalogue_id = (
        resolve_stored_module_catalogue_id(requested_catalogue_id) or requested_catalogue_id
        if requested_catalogue_id
        else ''
    )
    if resolved_catalogue_id and (authoring_module_exists(resolved_catalogue_id) or {}).get('source_type') == 'free_course':
        return json_error('Free courses contain self-study content only.', status=400)
    # A shared duplicate points at the source calendar. Treat the source as
    # the owner before checking for an active series so this path cannot create
    # a second Graph event for the alias.
    owner_resolver = teams_module_owner_id
    if resolved_catalogue_id and callable(owner_resolver):
        resolved_catalogue_id = owner_resolver(resolved_catalogue_id)
        if resolved_catalogue_id and resolved_catalogue_id != requested_catalogue_id:
            # A shared alias must never create or persist a calendar under its
            # own id. From this point the source id is the Teams owner for both
            # the weekday-series path and the normal Graph create path.
            payload = {**payload, 'moduleCatalogueId': resolved_catalogue_id}
    module_draft_id = clean_str(payload.get('moduleDraftId'))
    existing_series = []
    if resolved_catalogue_id and authoring_module_exists(resolved_catalogue_id):
        existing_series = authoring_fetch_all(
            LIVE_SESSIONS_TABLE,
            "module_catalogue_id = %s and status = 'active'",
            [resolved_catalogue_id],
            'updated_at desc, created_at desc',
        )
    elif module_draft_id:
        existing_series = authoring_fetch_all(
            LIVE_SESSIONS_TABLE,
            "module_draft_id = %s and status = 'active'",
            [module_draft_id],
            'updated_at desc, created_at desc',
        )
    if module_has_external_teams_calendar(resolved_catalogue_id, existing_series[0] if existing_series else None):
        return external_teams_calendar_refusal(existing_series[0] if existing_series else None)
    if existing_series:
        existing = existing_series[0]
        return json_error(
            'This module already has an active Teams calendar. Use Restore Teams sessions & links or update its dates instead of creating another meeting.',
            status=409,
            code='teams_calendar_already_exists',
            existingMeeting={
                'liveSessionId': clean_str(existing.get('id')),
                'organizerEmail': clean_str(existing.get('organizer_email')),
                'joinUrl': clean_str(existing.get('join_url')),
            },
        )

    try:
        graph_settings = teams_schedule_settings(graph_settings, payload)
        weekday_groups = calendar_groups(payload, graph_settings)
    except (TypeError, ValueError) as exc:
        return json_error(str(exc), status=400)
    if weekday_groups:
        return save_weekday_calendar(payload, graph_settings)

    organizer = teams_new_meeting_organizer(payload.get('organizerEmail'))
    if not organizer:
        return json_error(
            'Organizer email is required. Add it here or configure MICROSOFT_TEAMS_ORGANIZER_EMAIL.',
            status=400,
        )

    try:
        max_sessions = teams_module_session_limit(resolved_catalogue_id)
        event_payload, invited_people, presenters, co_organizers, attendees, utc_start, duration, repeat, occurrences = teams_event_payload(payload, graph_settings, max_sessions=max_sessions)
        targets = calendar_targets(payload, utc_start, duration, repeat, occurrences, graph_timezone_iana(graph_settings), max_sessions=max_sessions)
        non_delivery_reason = teams_non_delivery_reason(targets, graph_timezone_iana(graph_settings), module_catalogue_id=resolved_catalogue_id)
        if non_delivery_reason:
            return json_error(non_delivery_reason, status=400, code='non_delivery_date')
        payload = {**payload, 'hideAttendees': True, 'scheduledOccurrences': [
            {'sessionNumber': item['session_number'], 'startDateTimeUtc': item['start'].isoformat(),
             'durationMinutes': int((item['end'] - item['start']).total_seconds() / 60)} for item in targets
        ]}
    except (TypeError, ValueError, KeyError) as exc:
        return json_error(str(exc), status=400)
    if co_organizers and not has_column(LIVE_SESSIONS_TABLE, 'co_organizers'):
        return json_error(
            'Co-organizers cannot be saved until the curriculum.live_sessions co_organizers column is added.',
            status=409,
            code='teams_co_organizers_schema_required',
        )

    owner_key = urllib_parse.quote(organizer, safe='')
    try:
        # Prepare the calendar without recipients. Holiday cleanup must not send
        # provisional invitations or cancellation emails to the class.
        event = microsoft_graph_request('POST', f'users/{owner_key}/events', payload={**event_payload, 'attendees': []})
    except RuntimeError as exc:
        logger.warning('Unable to create Module Builder Teams event: %s', exc)
        record_graph_failure(EVENT_SAVE, str(exc), organizer=organizer)
        if getattr(exc, 'uncertain', False):
            return json_error(
                'Microsoft could not confirm the creation request. Check its status and the organizer calendar before creating again.',
                status=502, code='teams_calendar_create_uncertain', verificationRequired=True,
                graphStatus=getattr(exc, 'status_code', None), retryAfterSeconds=getattr(exc, 'retry_after', None),
                requestId=getattr(exc, 'request_id', ''),
            )
        return json_error('Microsoft Teams could not create the meeting.', status=502, detail=str(exc))

    event_id = clean_str(event.get('id'))
    if not event_id:
        return json_error('Microsoft did not return a calendar identifier. No invitations were sent.', status=502)
    online_meeting = event.get('onlineMeeting') or {}
    join_url = clean_str(online_meeting.get('joinUrl'))
    if event_id and not join_url:
        try:
            event_key = urllib_parse.quote(event_id, safe='')
            event = microsoft_graph_request('GET', f'users/{owner_key}/events/{event_key}')
            online_meeting = event.get('onlineMeeting') or {}
            join_url = clean_str(online_meeting.get('joinUrl'))
        except RuntimeError:
            pass

    # Checkpoint the event before further Graph calls. A partial failure can be
    # resumed through this calendar's update action without creating another one.
    try:
        live_session_id, _ = persist_live_session_series(
            payload, event, ['Invitations pending calendar verification.'], graph_settings,
            organizer, attendees, presenters, co_organizers=co_organizers, persist_occurrences=False,
            max_sessions=max_sessions,
        )
    except Exception:
        logger.exception('The prepared Teams calendar could not be saved.')
        return json_error('The calendar was prepared but could not be saved. No invitations were sent.',
                          status=500, meetingCreated=True, eventId=event_id)

    warnings = []
    lobby_choice = clean_str(payload.get('lobbyBypass')).lower() or 'invited'
    if lobby_choice not in TEAMS_LOBBY_VALUES:
        lobby_choice = 'invited'
    recording = clean_str(payload.get('recording')).lower() or 'none'
    spoken_language = clean_str(payload.get('spokenLanguage')) or 'en-GB'
    meeting_options = {
        'organizer': organizer,
        'recording': recording,
        'lobby_bypass': lobby_choice,
        'spoken_language': spoken_language,
        'presenters': presenters,
        'co_organizers': co_organizers,
    }
    recreated_details = []
    leftover_slots = []
    # Planned sessions the new series does not hold. Reported, never re-created
    # on events of their own -- see apply_teams_occurrence_shifts.
    missing_occurrences = []
    # Graph has just built a plain weekly series. Move its occurrences onto the
    # wizard's holiday-shifted dates now, otherwise the calendar keeps sessions on
    # holidays the wizard already moved them off and the two disagree from day one.
    if repeat != 'none':
        # No `existing_occurrences`: this calendar is being created, so the LMS
        # owns no session on any date yet and `tracked_occurrence_keys` is empty.
        # Every slot left over is therefore the recurrence's own weekly filler,
        # which is exactly what has to go for a holiday-shifted plan to match.
        # There is no previously-routed week here for an omission to harm.
        shift_warnings, recreated_details, stale_deletions = apply_teams_occurrence_shifts(
            owner_key,
            urllib_parse.quote(event_id, safe=''),
            clean_str(event_payload.get('subject')) or teams_calendar_subject(payload),
            teams_shifted_occurrence_targets(payload, duration),
            invited_people,
            meeting_options,
            missing=missing_occurrences,
        )
        pruned, holiday_warnings = prune_study_week_fillers(
            microsoft_graph_request, owner_key, event_id, clean_str(payload.get('moduleCatalogueId')),
            targets, graph_settings,
        )
        stale_deletions = [item for item in stale_deletions if item.get('instance_id') not in pruned]
        shift_warnings.extend(holiday_warnings)
        # Legacy/unproven leftovers stay reported on Teams. Only the opted-in,
        # verified holiday padding above may be removed.
        leftover_slots = flag_teams_occurrence_leftovers(
            stale_deletions,
            live_session_id=clean_str(payload.get('liveSessionId')),
            module_catalogue_id=clean_str(payload.get('moduleCatalogueId')),
            source='series_creation_cleanup',
        )
        for shift_warning in shift_warnings:
            message = clean_str(shift_warning.get('message'))
            detail = clean_str(shift_warning.get('detail'))
            warnings.append(f'{message} ({detail})' if detail else message)
    # Calendar event creation reliably creates the Teams link and invitations, at
    # the tenant's default options. Recording, transcription, the lobby and who
    # presents are set on the onlineMeeting behind it, which needs
    # OnlineMeetings.ReadWrite.All and an application access policy on top.
    settings_applied, graph_meeting, option_warnings = apply_teams_meeting_options(
        organizer,
        join_url,
        recording=recording,
        lobby_bypass=lobby_choice,
        spoken_language=spoken_language,
        attendees=invited_people,
        presenters=presenters,
        co_organizers=co_organizers,
        live_session_id=live_session_id,
    )
    for option_warning in option_warnings:
        message = clean_str(option_warning.get('message'))
        detail = clean_str(option_warning.get('detail'))
        warnings.append(f'{message} ({detail})' if detail else message)
    meeting_options_url = clean_str(graph_meeting.get('meetingOptionsWebUrl'))
    meeting_id = clean_str(graph_meeting.get('id'))
    if not join_url:
        warnings.append('Microsoft Graph created the calendar event but has not returned the Teams join URL yet.')

    event['_meetingOptionsUrl'] = meeting_options_url
    try:
        if warnings or not settings_applied:
            raise RuntimeError('The calendar or meeting options could not be verified. Invitations remain pending.')
        event = verify_teams_calendar_with_standalones(
            microsoft_graph_request, owner_key, event_id, without_missing(targets, missing_occurrences), join_url,
            repeat != 'none', recreated_details,
        )
        publish_teams_calendar_attendees(
            microsoft_graph_request, owner_key, event, event_payload['attendees'],
            recreated_details,
        )
        # Publishing must not resurrect deleted slots or change the shared link.
        event = verify_teams_calendar_with_standalones(
            microsoft_graph_request, owner_key, event_id, without_missing(targets, missing_occurrences), join_url,
            repeat != 'none', recreated_details,
            expected_attendees=event_payload['attendees'],
        )
        occurrence_rows = replace_live_session_occurrences(
            live_session_id, payload, utc_start, duration, repeat, occurrences,
            event_id=event_id, join_url=join_url,
        )
        persist_recreated_occurrence_details(live_session_id, recreated_details)
        record_reconcile(live_session_id, missing_occurrences, module_catalogue_id=resolved_catalogue_id or '',
                         source='Teams calendar created')
        occurrence_rows = authoring_fetch_all(
            LIVE_SESSION_OCCURRENCES_TABLE,
            "live_session_id = %s and status not in ('cancelled', 'superseded')",
            [live_session_id],
            'session_number asc',
        )
        tracked_occurrences = len(occurrence_rows)
        update_authoring_rows(LIVE_SESSIONS_TABLE, 'id = %s', [live_session_id], {
            'warnings': json_db_value([]), 'online_meeting_id': meeting_id,
            'meeting_options_url': meeting_options_url, 'join_url': join_url, 'updated_at': datetime.utcnow(),
        })
        remember_teams_dial_in({'id': live_session_id, 'join_url': join_url, 'online_meeting_id': meeting_id,
                                'organizer_email': organizer}, graph_meeting)
        # Persist component links before returning, even if the browser has
        # stopped waiting. Only verified occurrences may be attached.
        if resolved_catalogue_id:
            try:
                saved = authoring_fetch_all(LIVE_SESSIONS_TABLE, 'id = %s', [live_session_id])[0]
                # Attach the verified meeting only to live-session components
                # the author already placed. Creating a Teams calendar must not
                # author new components in otherwise content-only weeks; the
                # explicit Restore/Re-attach action is the opt-in path for that.
                attach_teams_meeting_to_module_weeks(
                    resolved_catalogue_id, saved, live_session_row_to_component_settings(saved),
                    saved_live_session_occurrences(live_session_id), create_missing=False,
                )
            except Exception:
                logger.exception('The Teams calendar was saved but its component links could not be attached.')
                return json_error('The calendar is saved, but its component links could not be saved. Use Restore Teams sessions & links.',
                                  status=502, meetingCreated=True, liveSessionId=live_session_id)
    except RuntimeError as exc:
        update_authoring_rows(LIVE_SESSIONS_TABLE, 'id = %s', [live_session_id], {
            'warnings': json_db_value([*warnings, str(exc)]), 'updated_at': datetime.utcnow(),
        })
        return json_error('The calendar is saved, but verification or invitation delivery is incomplete. Open its review to retry.',
                          status=502, detail=str(exc), meetingCreated=True, liveSessionId=live_session_id)
    except Exception:
        logger.exception('Teams meeting was created, but its live_sessions record could not be saved.')
        return json_error(
            'The Teams meeting was created, but the LMS could not save its live-session record.',
            status=500,
            meetingCreated=True,
            eventId=event_id,
            joinUrl=join_url,
        )

    return JsonResponse({
        'created': True,
        'meeting': {
            'liveSessionId': live_session_id,
            'eventId': event_id,
            'onlineMeetingId': clean_str(graph_meeting.get('id')),
            'joinUrl': join_url,
            'webLink': clean_str(event.get('webLink')),
            'meetingOptionsUrl': meeting_options_url,
            'organizerEmail': organizer,
            'attendees': attendees,
            'presenters': presenters,
            'coOrganizers': co_organizers,
            'startDateTimeUtc': utc_start.isoformat(),
            'durationMinutes': duration,
            'repeat': repeat,
            'repeatOccurrences': occurrences if repeat != 'none' else 1,
            'trackedOccurrences': tracked_occurrences,
            'provider': 'Microsoft Teams',
            'trackingReady': bool(meeting_id),
            'settingsApplied': settings_applied,
        },
        'warnings': warnings,
        # Slots on Teams that are not module sessions. Kept apart from
        # `warnings`, which hold back the creation emails: nothing failed.
        'leftoverSlots': (event.get('unplannedInstances') or []) or leftover_slots,
        # Planned sessions the series does not hold: resolution required in
        # Calendar health. No separate meeting was created for any of them.
        'missingOccurrences': missing_occurrences,
    }, status=201)
