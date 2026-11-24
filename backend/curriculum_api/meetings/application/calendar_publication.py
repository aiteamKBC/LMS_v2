"""Meeting use cases composed from explicit reads, policies and provider capabilities."""


def flag_teams_occurrence_leftovers(
    deletions, *, live_session_id='', module_catalogue_id='', source='holiday_move_cleanup', clean_str, logger,
):
    """Report the Teams slots a save no longer wants. Never removes them.

    These used to be deleted here: the weekly filler a recurrence generates in a
    gap, and the slot a session moved off. Exchange answers every organizer
    delete with a "Canceled: <module>" email to everyone invited, so a week
    handed to its own additional meeting, or a session added after a gap, had the
    whole cohort told a session was cancelled that nobody had cancelled.

    No save, sync or background job cancels anything now. A slot that is no
    longer part of the plan is left exactly where it is on Teams and returned
    here, so the screen can say so; the only way it leaves Microsoft is the
    explicit Cancel on that slot (``teams_calendar_actions`` scope 'leftover').
    """
    leftovers = []
    for deletion in deletions or ():
        instance_id = clean_str((deletion or {}).get('instance_id'))
        if not instance_id:
            continue
        logger.info(
            'Teams occurrence left for manual review: live_session_id=%s module_catalogue_id=%s graph_event_id=%s '
            'session_number=%s previous_start=%s new_start=%s reason=%s source=%s',
            live_session_id, module_catalogue_id, instance_id,
            deletion.get('session_number'), deletion.get('previous_start'),
            deletion.get('new_start'), deletion.get('reason'), source,
        )
        leftovers.append({
            'eventId': instance_id,
            'startDateTimeUtc': f"{clean_str(deletion.get('previous_start'))}:00Z" if clean_str(deletion.get('previous_start')) else '',
            'sessionNumber': deletion.get('session_number') or None,
            'reason': clean_str(deletion.get('reason')),
        })
    return leftovers


def verify_teams_calendar_with_standalones(
    request, owner_key, event_id, targets, expected_join_url='', recurring=True, occurrence_details=None,
    expected_attendees=None, *, CalendarMismatch, attendee_differences, clean_str, event_organizer_address,
    unconfirmed_attendee_detail, verify_calendar,
):
    """Verify the master series and any deleted occurrences restored separately.

    ``expected_attendees`` is checked against each separately restored session.
    Dates alone used to be the whole of "verified", so a session rebuilt on its
    own event with an empty invitation list passed every check and the update
    reported success -- while nobody but the organizer had that session. An
    occurrence is only really restored once the people it is for are on it.
    """
    details_by_number = {
        int(detail.get('session_number') or 0): detail
        for detail in (occurrence_details or [])
        if clean_str(detail.get('graph_event_id'))
        and clean_str(detail.get('graph_event_id')) != clean_str(event_id)
    }
    master_targets = [
        target for target in targets
        if int(target['session_number']) not in details_by_number
    ]
    if not master_targets:
        raise CalendarMismatch('The recurring Teams calendar has no verified series occurrences.')
    event = verify_calendar(
        request, owner_key, event_id, master_targets, expected_join_url, recurring,
    )
    for target in targets:
        detail = details_by_number.get(int(target['session_number']))
        if not detail:
            continue
        standalone = verify_calendar(
            request,
            owner_key,
            clean_str(detail.get('graph_event_id')),
            [target],
            clean_str(detail.get('join_url')),
            False,
        )
        if expected_attendees is None:
            continue
        # The same comparison ``publish_attendees`` confirms a published list
        # with: a session carrying someone the series does not invite is as wrong
        # as one missing a learner, and neither is left standing as "verified" --
        # while an alias Microsoft stored under its primary address, and the
        # organizer of the session itself, are the same people either way.
        missing, extra = attendee_differences(
            expected_attendees, standalone.get('attendees'), event_organizer_address(standalone),
        )
        if missing or extra:
            raise CalendarMismatch(
                f"Session {target['session_number']} was restored on its own Teams event "
                f'without its invited people ({unconfirmed_attendee_detail(missing, extra)}). '
                'The calendar was not confirmed.'
            )
    return event


def publish_teams_calendar_attendees(
    request, owner_key, event, attendees, occurrence_details=None, *, force=False, title='', silent=False,
    dates_unchanged=False, GRAPH_SILENT_INVITE_HEADERS, attendees_already_match, clean_str,
    event_organizer_address, publish_attendees, remove_attendees_silently, urllib_parse,
):
    """Publish the final invitation list to the master and restored sessions.

    ``silent`` decides only whether Microsoft is asked to announce the write, not
    who is on the meeting. Who belongs to a calendar event and whether an email
    goes out are separate questions, and an author who chose not to email must
    still end up with every intended learner invited -- the alternative, a
    session nobody is on, is a silence bought by breaking the meeting.

    A silent publish also keeps to the narrower ``attendees``-only patch, which
    is the shape Microsoft documents as touching only the people who changed,
    and it is skipped when the list already matches -- nothing to write is
    nothing for Microsoft to send. A publish that is meant to be heard writes
    either way: a session restored silently already carries its people, and
    Microsoft puts a meeting on their calendars only when something is sent.
    """
    headers = GRAPH_SILENT_INVITE_HEADERS if silent else None
    announce = not silent
    def needs_force_patch(current):
        return (
            not dates_unchanged
            or not attendees_already_match(attendees, current.get('attendees'), event_organizer_address(current))
            or clean_str(title) and clean_str(title) != clean_str(current.get('subject'))
            or current.get('hideAttendees') is not True
        )

    if force:
        if announce:
            # Whoever this announced write drops is taken off silently first, so
            # Exchange sends them no cancellation; the people who stay still hear.
            event, _removed = remove_attendees_silently(request, owner_key, event, attendees)
        if needs_force_patch(event):
            request(
                'PATCH',
                f'users/{owner_key}/events/{urllib_parse.quote(clean_str(event.get("id")), safe="")}',
                payload={
                    'subject': clean_str(title) or clean_str(event.get('subject')),
                    'hideAttendees': True,
                    'attendees': attendees,
                },
                extra_headers=headers,
            )
    else:
        publish_attendees(request, owner_key, event, attendees, extra_headers=headers, always=announce)
    for detail in occurrence_details or []:
        event_id = clean_str(detail.get('graph_event_id'))
        if not event_id or event_id == clean_str(event.get('id')):
            continue
        standalone = request(
            'GET', f'users/{owner_key}/events/{urllib_parse.quote(event_id, safe="")}',
        )
        if force:
            if announce:
                standalone, _removed = remove_attendees_silently(request, owner_key, standalone, attendees)
            if needs_force_patch(standalone):
                request(
                    'PATCH',
                    f'users/{owner_key}/events/{urllib_parse.quote(event_id, safe="")}',
                    payload={
                        'subject': clean_str(title) or clean_str(standalone.get('subject')),
                        'hideAttendees': True,
                        'attendees': attendees,
                    },
                    extra_headers=headers,
                )
        else:
            publish_attendees(request, owner_key, standalone, attendees, extra_headers=headers, always=announce)


def reschedule_single_live_session_occurrence(
    series, occurrence, new_start_utc, duration, *, notify_attendees=False, GRAPH_SILENT_INVITE_HEADERS,
    clean_str, load_microsoft_graph_request, logger, parse_graph_datetime, safe_teams_join_url,
    teams_calendar_minute_key, teams_meeting_default_organizer, timedelta, urllib_parse, utc_datetime,
    verify_calendar,
):
    """Move one session of a live-session series to a new instant via Graph.

    The module schedule sets every session's time; this is the escape hatch for
    the single session that has to differ. A plain recurring series shares one
    event, so the session is one of its instances and Graph is asked to move that
    instance -- it becomes an exception, leaving every other session, and the
    module's default time, exactly where they were. A session that already had to
    be recreated on its own event (a holiday shift) is moved directly. Mirrors
    ``apply_teams_occurrence_shifts`` for the one-instance case, including its
    fall back to recreating the occurrence when Graph refuses to move it across
    the recurrence boundary. The module always keeps its shared join URL; if
    Graph refuses the move, the occurrence is left unchanged and a warning is
    returned. Returns ``(join_url, online_meeting_id, event_id, warnings)``.
    """
    microsoft_graph_request, = load_microsoft_graph_request()

    warnings = []
    organizer = clean_str(series.get('organizer_email')) or teams_meeting_default_organizer()
    owner_key = urllib_parse.quote(organizer, safe='')
    series_event_id = clean_str(series.get('graph_event_id'))
    occ_event_id = clean_str(occurrence.get('graph_event_id'))
    new_end_utc = new_start_utc + timedelta(minutes=duration)
    title = clean_str(series.get('module_title') or 'Live session')
    join_url = clean_str(occurrence.get('join_url')) or clean_str(series.get('join_url'))
    online_meeting_id = clean_str(occurrence.get('online_meeting_id'))
    result_event_id = occ_event_id or series_event_id
    patch_body = {
        'start': {'dateTime': new_start_utc.replace(second=0, microsecond=0).isoformat(timespec='seconds'), 'timeZone': 'UTC'},
        'end': {'dateTime': new_end_utc.replace(second=0, microsecond=0).isoformat(timespec='seconds'), 'timeZone': 'UTC'},
        'hideAttendees': True,
    }

    def move_verified(instance_id):
        path = f'users/{owner_key}/events/{urllib_parse.quote(instance_id, safe="")}'
        current = microsoft_graph_request('GET', path)
        actual_link = clean_str((current.get('onlineMeeting') or {}).get('joinUrl'))
        if current.get('isCancelled') or actual_link != join_url or not safe_teams_join_url(actual_link):
            raise RuntimeError('The session join link or calendar identity could not be verified.')
        microsoft_graph_request(
            'PATCH', path, payload=patch_body,
            extra_headers=None if notify_attendees else GRAPH_SILENT_INVITE_HEADERS,
        )
        verify_calendar(microsoft_graph_request, owner_key, instance_id, [
            {'session_number': occurrence.get('session_number') or 1,
             'start': utc_datetime(new_start_utc), 'end': utc_datetime(new_end_utc)},
        ], join_url, False)

    # Already its own event: move it directly, no series instance to resolve.
    if occ_event_id and occ_event_id != series_event_id:
        try:
            move_verified(occ_event_id)
        except RuntimeError as exc:
            logger.warning('Unable to reschedule a standalone Teams occurrence: %s', exc)
            warnings.append({'code': 'teams_occurrence_not_moved', 'message': 'Microsoft Teams could not move this session.', 'detail': str(exc)})
        return join_url, online_meeting_id, result_event_id, warnings

    if not series_event_id:
        warnings.append({'code': 'teams_occurrence_missing_event', 'message': 'This session has no calendar event to move.', 'detail': ''})
        return join_url, online_meeting_id, result_event_id, warnings

    # One of the recurring series' instances: find the one sitting on the current
    # start and move it. Widen the window enough to survive a DST shift of the
    # stored instant either side of the day.
    current_start = parse_graph_datetime(occurrence.get('scheduled_start'))
    pivot = current_start or new_start_utc
    instance_query = urllib_parse.urlencode({
        'startDateTime': (pivot - timedelta(days=2)).isoformat(),
        'endDateTime': (pivot + timedelta(days=2)).isoformat(),
        '$top': 50,
    })
    event_key = urllib_parse.quote(series_event_id, safe='')
    try:
        response = microsoft_graph_request('GET', f'users/{owner_key}/events/{event_key}/instances?{instance_query}')
        instances = response.get('value') if isinstance(response, dict) else []
    except RuntimeError as exc:
        logger.warning('Unable to list Teams series instances to reschedule one session: %s', exc)
        warnings.append({'code': 'teams_occurrence_not_moved', 'message': 'Microsoft Teams could not find this session to move.', 'detail': str(exc)})
        return join_url, online_meeting_id, result_event_id, warnings

    current_key = teams_calendar_minute_key(current_start) if current_start else ''
    instance = next(
        (item for item in instances if current_key and teams_calendar_minute_key((item.get('start') or {}).get('dateTime')) == current_key),
        None,
    )
    # A single-instance window that returned exactly one candidate is that
    # session even when the stored minute drifted (DST); anything ambiguous is
    # left untouched rather than guessed.
    if instance is None and len(instances) == 1:
        instance = instances[0]
    instance_id = clean_str((instance or {}).get('id'))
    if not instance_id:
        warnings.append({'code': 'teams_occurrence_not_found', 'message': 'Microsoft Teams did not list this session, so it was not moved.', 'detail': ''})
        return join_url, online_meeting_id, result_event_id, warnings

    try:
        move_verified(instance_id)
    except RuntimeError as exc:
        warnings.append({
            'code': 'teams_occurrence_not_moved',
            'message': 'Microsoft Teams could not move this occurrence, so it was left in the recurring series to preserve the module\'s fixed join URL.',
            'detail': str(exc),
        })
    return join_url, online_meeting_id, instance_id, warnings
