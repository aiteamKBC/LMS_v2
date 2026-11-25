"""HTTP response and workflow boundary; URL/authentication decorators remain at the public facade.

Existing behavior is preserved; legacy capabilities are composed at the outer facade.
"""


def curriculum_teams_meeting_schedule(
    request,
    live_session_id,
    *,
    ALL_OPTION_GROUPS,
    AUTHORING_COMPONENTS_TABLE,
    CalendarMismatch,
    EVENT_SAVE,
    GRAPH_SILENT_INVITE_HEADERS,
    JsonResponse,
    LIVE_SESSIONS_TABLE,
    LIVE_SESSION_OCCURRENCES_TABLE,
    TEAMS_LOBBY_VALUES,
    TEAMS_REPEAT_VALUES,
    active_component_rows,
    apply_teams_meeting_options,
    apply_teams_occurrence_shifts,
    attach_teams_meeting_to_module_weeks,
    authoring_fetch_all,
    calendar_authorized,
    calendar_groups,
    calendar_occurrence_details,
    calendar_targets,
    claim_announcement,
    clean_str,
    component_builder_settings,
    datetime,
    dropped_sessions_sentence,
    ensure_live_session_tracking_tables,
    finish_announcement,
    flag_teams_occurrence_leftovers,
    forward_teams_invitation,
    frontend_component_type,
    get_graph_settings,
    graph_calendar_time,
    graph_failure_outcome,
    graph_timezone_iana,
    has_column,
    has_graph_credentials,
    held_schedule_snapshot,
    json_body,
    json_db_value,
    json_error,
    json_list,
    known_missing_numbers,
    live_session_row_to_component_settings,
    local_calendar_recurrence,
    logger,
    logical_change_id,
    microsoft_graph_request,
    module_has_external_teams_calendar,
    option_groups_to_apply,
    original_calendar_request,
    pending_option_groups,
    pending_warning,
    persist_recreated_occurrence_details,
    presenter_co_organizers,
    publish_teams_calendar_attendees,
    record_graph_failure,
    record_reconcile,
    refresh_standalone_occurrence_options,
    remaining_pending,
    replace_live_session_occurrences,
    reported_failure,
    roles_changed,
    same_schedule,
    save_weekday_calendar,
    saved_live_session_occurrences,
    saved_meeting_options,
    schedule_request,
    sessions_a_rewrite_would_drop,
    stored_calendar_series,
    targets_snapshot,
    teams_attendee_emails,
    teams_calendar_subject,
    teams_meeting_default_organizer,
    teams_newly_invited,
    teams_non_delivery_reason,
    teams_schedule_settings,
    teams_series_email_list,
    teams_shifted_occurrence_targets,
    teams_warning_sentence,
    unresolved_saved_bindings,
    update_authoring_rows,
    urllib_parse,
    verify_teams_calendar_with_standalones,
    with_schedule_change_notice,
    without_missing,
    prune_study_week_fillers,
    teams_module_session_limit,
):
    """Update the calendar-backed Teams event when the module schedule shifts."""

    ensure_live_session_tracking_tables()
    series_rows = authoring_fetch_all(LIVE_SESSIONS_TABLE, 'id = %s', [live_session_id])
    if not series_rows:
        return json_error('Live session series not found.', status=404)
    # An additional week meeting is not a module series and must never come
    # through here: this endpoint finishes by re-attaching its series across
    # every live-session component of the module, which would put one week's
    # private meeting link on all of them. It has its own endpoint --
    # teams_week_meeting.curriculum_week_teams_meeting_detail.
    if clean_str(series_rows[0].get('status')) == 'week-meeting':
        return json_error(
            'That is an additional week meeting, not this module’s Teams calendar. Edit it on the '
            'Additional week meeting tab.',
            status=404, code='not_a_module_calendar',
        )
    if request.method != 'PATCH':
        return json_error('Method not allowed.', status=405)
    if series_rows[0].get('meeting_type') == 'linked-external' and not calendar_authorized(live_session_id):
        return original_calendar_request(schedule_request)(request, live_session_id)
    if module_has_external_teams_calendar(clean_str(series_rows[0].get('module_catalogue_id')), series_rows[0]) and not calendar_authorized(live_session_id):
        return json_error(
            'This imported meeting is managed in its original Teams calendar. Update its dates and invitations '
            'there. Reattaching saved LMS data preserves the existing link but does not fetch new Teams dates.',
            status=409, code='external_calendar_read_only', calendarManagement='external',
        )
    if not has_graph_credentials():
        return json_error('Microsoft Graph credentials are not configured.', status=503)

    payload = json_body(request)
    if not isinstance(payload, dict):
        return json_error('A valid JSON body is required.')
    # The browser sends the author's announcement choice. People/settings-only
    # saves still stay quiet for everyone already invited; people such a save
    # adds are reached directly instead, by forwarding the meeting to them alone.
    people_only = bool(payload.get('peopleOnly'))
    # The browser sends the explicit choice on every update. Keep an omitted
    # value quiet for defensive API callers (and for legacy schedule-only
    # requests); people/settings-only saves remain quiet for everyone already
    # invited, while newly added people are forwarded separately after the
    # calendar is verified.
    notify_attendees = False if people_only else bool(payload.get('notifyAttendees'))
    # "Save invitations" only saves who is invited. It sends nothing to anybody:
    # no Microsoft invitation or forward, and no LMS email -- not even to the
    # people it adds. Only ever on a people-only save.
    invitations_only = people_only and bool(payload.get('invitationsOnly'))
    series = series_rows[0]
    schedule_before = held_schedule_snapshot(live_session_id)
    # Omitted options retain their saved values for schedule-only callers.
    option_fields = {'recording': 'recording', 'lobbyBypass': 'lobby_bypass', 'spokenLanguage': 'spoken_language'}
    option_updates = {column: clean_str(payload[key]) for key, column in option_fields.items() if key in payload}
    if ('recording' in option_updates and option_updates['recording'] not in ('none', 'record', 'record-transcribe')) or (
        'lobby_bypass' in option_updates and option_updates['lobby_bypass'] not in TEAMS_LOBBY_VALUES
    ) or ('spoken_language' in option_updates and option_updates['spoken_language'] not in ('en-GB', 'en-US', 'ar-EG', 'fr-FR')):
        return json_error('Choose valid recording, lobby and language options.', status=400)
    try:
        graph_settings = teams_schedule_settings(get_graph_settings(), series=series)
        weekday_groups = [] if payload.get('peopleOnly') else calendar_groups(payload, graph_settings)
    except (TypeError, ValueError) as exc:
        return json_error(str(exc), status=400)
    if not people_only and clean_str(series.get('module_catalogue_id')):
        components = authoring_fetch_all(AUTHORING_COMPONENTS_TABLE, 'module_catalogue_id = %s',
                                         [series['module_catalogue_id']])
        saved_rows = authoring_fetch_all(LIVE_SESSION_OCCURRENCES_TABLE, 'live_session_id = %s', [live_session_id])
        unresolved = unresolved_saved_bindings(live_session_id,
            [{'id': row['id'], 'settings': component_builder_settings(row)} for row in active_component_rows(components)
             if frontend_component_type(row.get('type')) == 'live-session'], saved_rows,
            join_url=clean_str(series.get('join_url')))
        if unresolved:
            return json_error('Some saved week links could not be matched to their original sessions. No Teams change was sent. Review Calendar health before updating these dates.',
                              status=409, code='teams_component_binding_unresolved')
    if stored_calendar_series(series) or weekday_groups:
        return with_schedule_change_notice(save_weekday_calendar(payload, graph_settings, series), live_session_id, schedule_before,
                                           request=None if invitations_only else request, notify=notify_attendees, series_before=series)

    # The stored organizer, never the caller's. This event already exists on one
    # mailbox, and asking Graph for it on another is a 404 that would strand a
    # live series -- so pinning an organizer changes where *new* meetings are
    # created and leaves every series already running on its own calendar.
    organizer = clean_str(series.get('organizer_email')) or teams_meeting_default_organizer()
    event_id = clean_str(series.get('graph_event_id'))
    if payload.get('eventId') and clean_str(payload['eventId']) != event_id:
        return json_error('The reviewed event does not belong to this calendar.', status=409)
    if not organizer or not event_id:
        return json_error('This Teams meeting is missing organizer or calendar event identifiers.', status=409)

    title = teams_calendar_subject(payload, series)
    local_start_raw = clean_str(payload.get('localStartDateTime'))
    utc_start_raw = clean_str(payload.get('startDateTimeUtc'))
    try:
        local_start = datetime.fromisoformat(local_start_raw)
        utc_start = datetime.fromisoformat(utc_start_raw.replace('Z', '+00:00'))
    except ValueError as exc:
        return json_error('A valid meeting start date and time is required.', status=400, detail=str(exc))

    # The invitation list is optional here: a caller that only shifts dates must
    # not have to resend it, and one that corrects who presents must not have to
    # recreate the meeting to do it. Absent keys keep the stored lists.
    stored_attendees = teams_series_email_list(series.get('attendees'))
    stored_presenters = teams_series_email_list(series.get('presenters'))
    stored_co_organizers = teams_series_email_list(series.get('co_organizers'))
    people_changed = any(key in payload for key in ('attendees', 'presenters', 'coOrganizers'))
    try:
        co_organizers = (
            teams_attendee_emails(payload['coOrganizers'])
            if 'coOrganizers' in payload else stored_co_organizers
        )
        presenters = (
            teams_attendee_emails(payload['presenters'])
            if 'presenters' in payload else stored_presenters
        )
        if roles_changed(presenters, co_organizers, stored_presenters, stored_co_organizers):
            co_organizers = presenter_co_organizers(presenters, co_organizers, organizer)
        co_organizer_set = set(co_organizers)
        elevated = co_organizer_set | set(presenters)
        attendees = [
            email for email in (
                teams_attendee_emails(payload['attendees'])
                if 'attendees' in payload else stored_attendees
            )
            if email not in elevated
        ]
    except (TypeError, ValueError) as exc:
        return json_error(str(exc), status=400)
    if co_organizers and not has_column(LIVE_SESSIONS_TABLE, 'co_organizers'):
        return json_error(
            'Co-organizers cannot be saved until the curriculum.live_sessions co_organizers column is added.',
            status=409,
            code='teams_co_organizers_schema_required',
        )
    invited_people = list(dict.fromkeys([*co_organizers, *presenters, *attendees]))
    # Read from the stored roster, not from the browser: the people a silent
    # save has to invite by hand are exactly those the calendar did not have.
    newly_invited = teams_newly_invited(
        [*stored_co_organizers, *stored_presenters, *stored_attendees, organizer], invited_people,
    )
    calendar_attendees = [
        {'emailAddress': {'address': email, 'name': email.split('@', 1)[0]}, 'type': 'required'}
        for email in invited_people
    ]

    duration = max(15, min(1440, int(payload.get('durationMinutes') or series.get('duration_minutes') or 60)))
    repeat = clean_str(payload.get('repeat') or series.get('repeat_pattern')).lower() or 'none'
    if repeat not in TEAMS_REPEAT_VALUES:
        return json_error('Unsupported repeat option.', status=400)
    max_sessions = teams_module_session_limit(series.get('module_catalogue_id'))
    occurrences = max(1, min(max_sessions, int(payload.get('repeatOccurrences') or series.get('repeat_occurrences') or 1)))
    try:
        targets = calendar_targets(payload, utc_start, duration, repeat, occurrences, graph_timezone_iana(graph_settings), max_sessions=max_sessions)
        if not payload.get('peopleOnly'):
            non_delivery_reason = teams_non_delivery_reason(targets, graph_timezone_iana(graph_settings), module_catalogue_id=series.get('module_catalogue_id'))
            if non_delivery_reason:
                return json_error(non_delivery_reason, status=400, code='non_delivery_date')
        recurrence = local_calendar_recurrence(targets, repeat, graph_timezone_iana(graph_settings),
                                               graph_settings.get('timezone') or 'GMT Standard Time', max_sessions=max_sessions)
    except (ValueError, TypeError, KeyError) as exc:
        return json_error(str(exc), status=400)
    payload = {**payload, 'scheduledOccurrences': [
        {'sessionNumber': item['session_number'], 'startDateTimeUtc': item['start'].isoformat(),
         'durationMinutes': int((item['end'] - item['start']).total_seconds() / 60)} for item in targets
    ]}
    # The logical change this request asks for, named by its content. A retry of
    # the same request after a timeout carries the same id until the LMS has
    # saved the result; see teams_update_guard.
    requested_schedule = targets_snapshot(targets)
    change_id = logical_change_id(live_session_id, schedule_before, requested_schedule, invited_people, title)
    event_patch = {
        'subject': title,
        'hideAttendees': True,
        'start': graph_calendar_time(targets[0]['start'], graph_timezone_iana(graph_settings), graph_settings.get('timezone') or series.get('timezone') or 'GMT Standard Time'),
        'end': graph_calendar_time(targets[0]['end'], graph_timezone_iana(graph_settings), graph_settings.get('timezone') or series.get('timezone') or 'GMT Standard Time'),
    }
    event_patch['recurrence'] = recurrence if repeat != 'none' else None

    owner_key = urllib_parse.quote(organizer, safe='')
    event_key = urllib_parse.quote(event_id, safe='')
    # Every row still holding a Teams slot, including "not in plan" ones: the
    # drop guard must see them all. The rest of the update works on the planned.
    slot_rows = authoring_fetch_all(
        LIVE_SESSION_OCCURRENCES_TABLE,
        'live_session_id = %s and status != %s',
        [live_session_id, 'cancelled'],
        'session_number asc',
    )
    current_occurrences = [row for row in slot_rows if clean_str(row.get('status')).lower() != 'superseded']
    current_occurrences = calendar_occurrence_details(series, current_occurrences)
    dates_already_verified = False
    # Sessions the last save already reported missing from the series. They are
    # under review in Calendar health, so their absence is not re-read as drift
    # here -- which would otherwise refuse every invitation save and rewrite the
    # series on every schedule save while the review is pending.
    known_missing = [{'sessionNumber': number} for number in known_missing_numbers(live_session_id)]
    missing_occurrences = []
    try:
        current = microsoft_graph_request('GET', f'users/{owner_key}/events/{event_key}')
        if current.get('isCancelled'):
            return json_error('This Microsoft calendar has been cancelled. Review it before continuing.', status=409)
        current_join = clean_str((current.get('onlineMeeting') or {}).get('joinUrl'))
        if series.get('join_url') and current_join != series['join_url']:
            return json_error('The Microsoft join link differs from the saved calendar. Review it before continuing.', status=409)
        try:
            current = verify_teams_calendar_with_standalones(
                microsoft_graph_request, owner_key, event_id, without_missing(targets, known_missing), current_join,
                repeat != 'none', current_occurrences,
            )
            dates_already_verified = True
        except CalendarMismatch as mismatch:
            # A known difference is the reason to update. Read failures still abort.
            if people_only:
                if mismatch.code == 'teams_attendee_privacy_unconfirmed':
                    return json_error(
                        'Attendee email privacy is not confirmed on the original Teams calendar. '
                        'The invitations were not saved and no invitation was sent. '
                        'Updating session dates does not resolve this privacy check.',
                        status=409, code=mismatch.code, detail=str(mismatch), liveSessionId=live_session_id,
                    )
                # Except on a people-only save, which must never touch a date.
                # Repairing the drift here would move, or re-create, sessions
                # as a side effect of saving who is invited. Nothing has been
                # written yet; the author updates the schedule on its own.
                return json_error(
                    'The Teams calendar dates no longer match the dates saved here, so the invitations were not '
                    'saved. Nothing was changed in Teams. Update the Teams calendar dates first, then save the '
                    'invitations again.',
                    status=409, code='teams_schedule_drift', detail=str(mismatch), liveSessionId=live_session_id,
                )
        if payload.get('peopleOnly'):
            # Saving people must not reapply a series pattern and revive cancelled slots.
            event = current
            if current.get('hideAttendees') is not True:
                microsoft_graph_request(
                    'PATCH', f'users/{owner_key}/events/{event_key}',
                    payload={'hideAttendees': True}, extra_headers=GRAPH_SILENT_INVITE_HEADERS,
                )
        elif dates_already_verified:
            event = current
            if current.get('subject') != title:
                event = microsoft_graph_request(
                    'PATCH', f'users/{owner_key}/events/{event_key}',
                    payload={'subject': title}, extra_headers=GRAPH_SILENT_INVITE_HEADERS,
                )
        else:
            # Rewriting the recurrence regenerates the series from its pattern,
            # so a future session outside the new range simply stops existing --
            # a cancellation Exchange emails to everyone, that nobody pressed
            # Cancel for. Refuse and name it instead.
            dropped = sessions_a_rewrite_would_drop(
                targets, repeat != 'none', slot_rows, graph_timezone_iana(graph_settings),
            )
            if dropped:
                return json_error(
                    dropped_sessions_sentence(dropped, graph_timezone_iana(graph_settings)),
                    status=409, code='teams_update_would_drop_sessions',
                    sessions=[row.get('session_number') for row in dropped],
                )
            event = microsoft_graph_request(
                'PATCH', f'users/{owner_key}/events/{event_key}', payload=event_patch,
                extra_headers=GRAPH_SILENT_INVITE_HEADERS,
            )
        if not isinstance(event, dict):
            event = microsoft_graph_request('GET', f'users/{owner_key}/events/{event_key}')
    except RuntimeError as exc:
        logger.warning('Unable to update Module Builder Teams event schedule: %s', exc)
        record_graph_failure(EVENT_SAVE, str(exc), live_session_id=live_session_id, organizer=organizer)
        return json_error('Microsoft Teams could not update the meeting schedule.', status=502, detail=str(exc))

    meeting_options = {
        'organizer': organizer,
        'recording': option_updates.get('recording', clean_str(series.get('recording')).lower() or 'none'),
        'lobby_bypass': option_updates.get('lobby_bypass', clean_str(series.get('lobby_bypass')).lower() or 'invited'),
        'spoken_language': option_updates.get('spoken_language', clean_str(series.get('spoken_language')) or 'en-GB'),
        'presenters': presenters,
        'co_organizers': co_organizers,
    }
    # Is there a date change to announce at all? Against both sides: the dates
    # the LMS last saved (what learners were told) and what Microsoft holds now.
    # A retry of an update that already landed finds both equal to the request
    # and announces nothing; a people-only save never announces.
    dates_changed = not people_only and (
        not dates_already_verified or not same_schedule(schedule_before, requested_schedule)
    )
    announce = notify_attendees and dates_changed
    # How the meeting runs is its own operation, sent only for what changed (or
    # a previous save could not apply). A save of who is invited sends none of
    # it: re-sending unchanged lobby/recording/roles there turned a missing
    # organiser permission into a failed invitation save.
    stored_options = saved_meeting_options(series)
    saved_warnings = json_list(series.get('warnings'))
    pending_options = pending_option_groups(saved_warnings)
    option_groups = option_groups_to_apply(
        stored_options, meeting_options, pending_options,
        new_meeting=not people_only and not clean_str(series.get('online_meeting_id')),
        retry_pending=not people_only,
    )
    warnings, recreated_details, stale_deletions, leftover_slots = [], [], [], []
    if repeat != 'none' and not people_only:
        # `current_occurrences` is what makes the cleanup provable: the LMS's own
        # occurrence rows, carrying each session's number and the date this
        # calendar last recorded for it. Nothing is deleted from the shape of the
        # target list alone.
        #
        # Never on a people-only save: this is the step that moves sessions and
        # re-creates a missing one, and saving who is invited must not do
        # either. Its dates were verified unchanged above.
        warnings, recreated_details, stale_deletions = apply_teams_occurrence_shifts(
            owner_key, event_key, title,
            teams_shifted_occurrence_targets(payload, duration), invited_people,
            meeting_options, current_occurrences, missing=missing_occurrences,
        )
    elif people_only:
        # The sessions already restored on events of their own keep the series'
        # roles and options -- options only, no date is read or written.
        warnings, recreated_details = refresh_standalone_occurrence_options(
            owner_key, event_id, current_occurrences, invited_people, meeting_options, groups=option_groups,
        )

    if repeat != 'none':
        pruned, holiday_warnings = prune_study_week_fillers(
            microsoft_graph_request, owner_key, event_id, clean_str(series.get('module_catalogue_id')),
            targets, graph_settings, current_occurrences, allow_delete=not people_only and notify_attendees,
            allow_uninvited_delete=not people_only,
        )
        stale_deletions = [item for item in stale_deletions if item.get('instance_id') not in pruned]
        warnings.extend(holiday_warnings)

    join_url = clean_str((event.get('onlineMeeting') or {}).get('joinUrl')) or clean_str(series.get('join_url'))
    # Only the changed (or still unapplied) option groups, and no call at all
    # when there are none. A meeting Microsoft hands out afresh -- a session
    # recreated on its own event -- is configured in full by
    # apply_teams_occurrence_shifts; the series meeting keeps its id.
    _applied, graph_meeting, option_warnings = True, {}, []
    if option_groups:
        _applied, graph_meeting, option_warnings = apply_teams_meeting_options(
            organizer,
            join_url,
            recording=meeting_options['recording'],
            lobby_bypass=meeting_options['lobby_bypass'],
            spoken_language=meeting_options['spoken_language'],
            attendees=invited_people,
            presenters=presenters,
            co_organizers=co_organizers,
            online_meeting_id=series.get('online_meeting_id'),
            groups=option_groups,
            live_session_id=live_session_id,
        )
        if not _applied and not option_warnings:
            option_warnings = [{'code': 'teams_meeting_options_not_applied', 'groups': sorted(option_groups),
                                'message': 'Microsoft did not apply this meeting\u2019s options.', 'detail': ''}]
    # A refused options PATCH on a meeting that already exists is reported, not
    # fatal: the invitation and the dates are separate operations and still go
    # ahead. A meeting this save created (a session recreated on its own event)
    # still stops the save, so nobody is invited to one still at the tenant
    # defaults -- the same rule as creating a calendar.
    option_failures = list(option_warnings)
    if people_only:
        # Standalone sessions refreshed here already existed.
        option_failures += [item for item in warnings
                            if isinstance(item, dict) and item.get('code') == 'teams_meeting_options_not_applied']
        warnings = [item for item in warnings if item not in option_failures]
    # What became of Microsoft's own announcement, for the result and the guard.
    claim = ''
    announcement = 'silent' if dates_changed else 'not_needed'
    announced_writes = {'count': 0}

    def announcing_request(method, path, *, payload=None, extra_headers=None):
        """Counts every announced write that reached -- or may have reached -- Microsoft."""
        announced = method == 'PATCH' and not extra_headers
        try:
            result = microsoft_graph_request(method, path, payload=payload, extra_headers=extra_headers)
        except RuntimeError as exc:
            if announced and graph_failure_outcome(exc) == 'unknown':
                announced_writes['count'] += 1
            raise
        if announced:
            announced_writes['count'] += 1
        return result

    try:
        if warnings:
            # Say what Microsoft actually refused. Every warning already carries
            # Graph's own message and detail; raising a generic sentence here
            # threw that away, so the dialog -- and the row this is recorded on
            # -- could only report that something was not accepted, never which
            # thing or why. The author is the person who has to act on it.
            raise RuntimeError(teams_warning_sentence(warnings)
                               or 'Microsoft did not accept every calendar or meeting option change.')
        # Nothing is retired. A slot this plan no longer wants -- weekly filler
        # in a gap, the date a session moved off -- stays on Teams and is
        # reported, because removing it is a cancellation Exchange emails to
        # everyone invited. Only the explicit Cancel on that slot may do that.
        leftover_slots = flag_teams_occurrence_leftovers(
            stale_deletions,
            live_session_id=live_session_id,
            module_catalogue_id=clean_str(series.get('module_catalogue_id')),
            source='update_reconcile',
        )
        occurrence_details = recreated_details or current_occurrences
        # A session missing from the series is reported, not verified: nothing
        # was created for it, so there is nothing of it on Teams to confirm.
        shifts_ran = repeat != 'none' and not people_only
        verifiable_targets = without_missing(targets, missing_occurrences if shifts_ran else known_missing)
        if announce:
            # Claimed durably BEFORE Microsoft is asked. An earlier attempt at
            # this same change -- one whose response was lost to a timeout --
            # already holds the claim, and its announcement is not repeated:
            # Graph cannot say whether that write reached anyone, so it is
            # reported, never sent twice.
            claim = claim_announcement(live_session_id, change_id)
            announcement = 'already_attempted' if claim == 'attempted' else 'sent'
        announce_now = announce and claim != 'attempted'
        if not announce_now:
            # An author who chose not to email still gets a structurally correct
            # calendar. The write is the narrow attendees-only patch under the
            # silent preference, and it is skipped outright when the list already
            # matches -- so a schedule-only save asks Microsoft for nothing at
            # all, while a session restored on its own event still ends up with
            # the people it is for on it.
            publish_teams_calendar_attendees(
                microsoft_graph_request, owner_key, event, calendar_attendees,
                occurrence_details, title=title, silent=True,
            )
        event = verify_teams_calendar_with_standalones(
            microsoft_graph_request, owner_key, event_id, verifiable_targets, join_url,
            repeat != 'none', occurrence_details,
            # The author who is emailing has not published the list yet; that
            # branch checks the people on its own final pass below.
            expected_attendees=None if announce_now else calendar_attendees,
        )
        # Keep the saved attendee/presenter/co-organizer roles in the online
        # meeting. The admin review flow opts in to email with notifyAttendees=true.
        if announce_now:
            # Only notify after the organizer's master and every exception have
            # been reconciled and verified. Updating the master then lets
            # Exchange send the final series/exception state to attendees; it
            # also avoids telling learners about a half-applied repair.
            publish_teams_calendar_attendees(
                announcing_request, owner_key, event, calendar_attendees,
                occurrence_details, force=True, title=title,
            )
            event = verify_teams_calendar_with_standalones(
                microsoft_graph_request, owner_key, event_id, verifiable_targets, join_url,
                repeat != 'none', occurrence_details,
                expected_attendees=calendar_attendees,
            )
        # The people this save adds are on the announced write when there is
        # one -- including an earlier attempt's, which carried this same list --
        # so only a save that announces nothing forwards the meeting to them.
        if not announce and newly_invited and not invitations_only:
            # After verification: nobody is invited to a calendar Microsoft has
            # not confirmed, and a half-applied repair is not what a learner
            # should be looking at in their first invitation.
            warnings.extend(forward_teams_invitation(
                microsoft_graph_request, owner_key,
                [event_id, *[clean_str(detail.get('graph_event_id')) for detail in (occurrence_details or [])]],
                newly_invited,
                comment=f'You have been added to {title}.',
            ))
    except RuntimeError as exc:
        if claim == 'claimed':
            # Never asked, or refused outright: a retry may announce. Anything
            # that may have reached Microsoft keeps the claim.
            finish_announcement(live_session_id, change_id,
                                outcome='unknown' if announced_writes['count'] else 'failed')
        # Keep the unapplied-options marker: this failed save wrote no options.
        unapplied = set(pending_options) | {group for item in option_failures for group in (item.get('groups') or option_groups)}
        saved_marker = next((item for item in saved_warnings if isinstance(item, dict)
                             and item.get('code') == 'teams_meeting_options_not_applied'), None) or {}
        requested_settings = ({key: meeting_options[key] for key in ('recording', 'lobby_bypass', 'spoken_language')}
                              if 'settings' in option_groups else saved_marker.get('requested'))
        update_authoring_rows(LIVE_SESSIONS_TABLE, 'id = %s', [live_session_id], {
            'warnings': json_db_value([*warnings, {'code': 'teams_calendar_unverified', 'message': str(exc)},
                                       *([pending_warning(unapplied, (option_failures or [{}])[0], requested_settings)]
                                         if unapplied else [])]),
            'updated_at': datetime.utcnow(),
        })
        # `errors` is the field the curriculum client already appends to the
        # sentence it shows, so the reason travels all the way to the dialog
        # instead of living only in this row's `warnings` column.
        verification_required = claim == 'attempted' or bool(announced_writes['count'])
        return json_error(
            ('Microsoft did not confirm the reviewed calendar. Requested dates have not been marked as synchronized. '
             'Microsoft may already have sent this update to the invitees, so it will not be announced again; '
             'check the calendar in Outlook before retrying.') if verification_required else
            'Microsoft did not confirm the reviewed calendar. Requested dates have not been marked as synchronized.',
            status=502, detail=str(exc), partial=True, liveSessionId=live_session_id,
            code='teams_update_verification_required' if verification_required else 'teams_calendar_unverified',
            verificationRequired=verification_required,
            errors=[warning for warning in [*warnings, *option_failures] if isinstance(warning, dict)] or [str(exc)])
    if claim == 'claimed':
        finish_announcement(live_session_id, change_id, outcome='accepted')
    occurrence_rows = authoring_fetch_all(LIVE_SESSION_OCCURRENCES_TABLE, 'live_session_id = %s', [live_session_id]) if payload.get('peopleOnly') else replace_live_session_occurrences(
        live_session_id,
        payload,
        utc_start,
        duration,
        repeat,
        occurrences,
        event_id=event_id,
        join_url=join_url,
    )
    persist_recreated_occurrence_details(live_session_id, recreated_details)
    if repeat != 'none' and not people_only:
        record_reconcile(live_session_id, missing_occurrences,
                         module_catalogue_id=clean_str(series.get('module_catalogue_id')), source='Teams calendar update')
    if recreated_details:
        occurrence_rows = authoring_fetch_all(
            LIVE_SESSION_OCCURRENCES_TABLE,
            "live_session_id = %s and status not in ('cancelled', 'superseded')",
            [live_session_id],
            'session_number asc',
        )
    failed_groups = {group for item in option_failures for group in (item.get('groups') or option_groups or ALL_OPTION_GROUPS)}
    still_pending = remaining_pending(pending_options, option_groups, failed_groups)
    previous_pending = next((item for item in saved_warnings if isinstance(item, dict)
                             and item.get('code') == 'teams_meeting_options_not_applied'), None)
    # A refused settings change keeps what the author asked for, so Retry can send it.
    requested_settings = ({key: meeting_options[key] for key in ('recording', 'lobby_bypass', 'spoken_language')}
                          if 'settings' in failed_groups else (previous_pending or {}).get('requested'))
    stored_option_warnings = ([pending_warning(still_pending, (option_failures or [previous_pending])[0], requested_settings)]
                              if still_pending else [])
    # The LMS keeps the settings Microsoft last accepted: a refused lobby or
    # recording change is not saved as if it had happened. Roles are also the
    # invitation list, which Microsoft did accept, so they are saved and the
    # unapplied role change stays marked for a retry.
    saved_option_updates = {} if 'settings' in failed_groups else option_updates
    series_update = {
        **saved_option_updates,
        'hide_attendees': True,
        'warnings': json_db_value(stored_option_warnings),
        'online_meeting_id': clean_str(graph_meeting.get('id')) or clean_str(series.get('online_meeting_id')),
        'module_title': title,
        'start_datetime': utc_start,
        'duration_minutes': duration,
        'repeat_pattern': repeat,
        'repeat_occurrences': occurrences if repeat != 'none' else 1,
        'join_url': join_url,
        'web_link': clean_str(event.get('webLink')) or clean_str(series.get('web_link')),
        'updated_at': datetime.utcnow(),
    }
    if payload.get('peopleOnly'):
        for field in ('module_title', 'start_datetime', 'duration_minutes', 'repeat_pattern', 'repeat_occurrences',
                      'join_url', 'online_meeting_id', 'web_link'):
            series_update.pop(field, None)
    if people_changed:
        series_update['attendees'] = json_db_value(attendees)
        series_update['presenters'] = json_db_value(presenters)
        series_update['co_organizers'] = json_db_value(co_organizers)
    update_authoring_rows(LIVE_SESSIONS_TABLE, 'id = %s', [live_session_id], series_update)
    module_id = clean_str(series.get('module_catalogue_id'))
    unresolved_components = []
    if module_id and not people_only:
        saved = {**series, **series_update}
        attach_teams_meeting_to_module_weeks(module_id, saved, live_session_row_to_component_settings(saved),
                                             saved_live_session_occurrences(live_session_id),
                                             unresolved_components=unresolved_components)
    if unresolved_components:
        warnings.append({'code': 'teams_component_binding_missing',
                         'message': f'{len(unresolved_components)} existing session link(s) were preserved because their calendar occurrence could not be matched. Review Calendar health before changing those sessions.'})
    # Keep actual permission/settings failures ahead of the informational mail policy notice.
    mail_notices = [item for item in warnings if item.get('code') == 'teams_calendar_mail_disabled']
    warnings = [item for item in warnings if item.get('code') != 'teams_calendar_mail_disabled']
    return with_schedule_change_notice(JsonResponse({
        'updated': True,
        'meeting': {
            'liveSessionId': live_session_id,
            'eventId': event_id,
            'joinUrl': join_url,
            'webLink': clean_str(event.get('webLink')) or clean_str(series.get('web_link')),
            'startDateTimeUtc': utc_start.isoformat(),
            'durationMinutes': duration,
            'repeat': repeat,
            'repeatOccurrences': occurrences if repeat != 'none' else 1,
            'trackedOccurrences': len(occurrence_rows),
            'attendees': attendees,
            'presenters': presenters,
            'coOrganizers': co_organizers,
        },
        'warnings': [*warnings, *[reported_failure(item) for item in option_failures], *mail_notices],
        # The onlineMeeting options, reported apart from the invitation: which
        # groups this save sent, whether Microsoft took them, and what is still
        # unapplied from this or an earlier save.
        'optionGroupsSent': sorted(option_groups),
        'optionsApplied': not option_failures,
        'optionsPending': sorted(still_pending),
        'partial': bool(option_failures),
        'leftoverSlots': (event.get('unplannedInstances') or []) or leftover_slots,
        # Whether this save carried a date change to announce, and what Microsoft
        # was asked: 'sent', 'already_attempted' (an earlier attempt at this same
        # change asked; not repeated), 'silent' (the author chose no notice) or
        # 'not_needed' (no date changed). A request, not proof of delivery.
        'announced': announce,
        'microsoftUpdate': announcement,
        'retryGuard': 'unavailable' if claim == 'unguarded' else 'on',
        'changeId': change_id,
        # Planned sessions missing from the recurring series: resolution
        # required in Calendar health. No separate meeting was created.
        'missingOccurrences': missing_occurrences,
    }), live_session_id, schedule_before, request=None if invitations_only else request, notify=notify_attendees,
        series_before=series)
