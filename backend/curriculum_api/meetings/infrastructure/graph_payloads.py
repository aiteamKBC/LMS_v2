"""Meeting storage and Graph adapters; runtime dependencies are supplied by the facade."""


def teams_event_body_html(
    title, details='', *, escape,
):
    """Branded HTML body for a Module Builder Teams calendar invite.

    Calendar clients sanitize event descriptions inconsistently (Outlook keeps
    inline styles, Google Calendar's forwarded-mail rendering is pickier), so
    this leans on a small set of inline styles that degrade gracefully to
    plain, still-readable text if a client strips them.
    """
    parts = [
        '<p style="margin:0 0 6px;font-size:11px;font-weight:600;letter-spacing:0.4px;'
        'color:#616e7c;text-transform:uppercase;">KBC LearningOS &middot; Module Builder</p>',
        f'<p style="margin:0 0 16px;font-size:18px;font-weight:600;color:#0b3d6b;">{escape(title)}</p>',
    ]
    if details:
        parts.append(
            '<p style="margin:0 0 16px;font-size:14px;line-height:1.55;color:#1f2933;">'
            f'{escape(details).replace(chr(10), "<br>")}</p>'
        )
    parts.append('<hr style="border:none;border-top:1px solid #e4e7eb;margin:0;">')
    return ''.join(parts)


def teams_event_payload(
    payload, graph_settings, *, promote_presenters=True, TEAMS_REPEAT_VALUES, calendar_targets, calendar_zone,
    clean_str, datetime, graph_calendar_time, graph_timezone_iana, load_presenter_co_organizers,
    local_calendar_recurrence, teams_attendee_emails, teams_calendar_subject, teams_event_body_html,
    teams_meeting_default_organizer, timezone,
    max_sessions=52,
):
    title = teams_calendar_subject(payload)
    local_start_raw = clean_str(payload.get('localStartDateTime'))
    utc_start_raw = clean_str(payload.get('startDateTimeUtc'))
    try:
        local_start = datetime.fromisoformat(local_start_raw)
    except ValueError as exc:
        raise ValueError('A valid meeting start date and time is required.') from exc
    try:
        utc_start = datetime.fromisoformat(utc_start_raw.replace('Z', '+00:00'))
    except ValueError as exc:
        raise ValueError('A valid UTC meeting start date and time is required.') from exc

    duration = max(15, min(1440, int(payload.get('durationMinutes') or 60)))
    repeat = clean_str(payload.get('repeat')).lower() or 'none'
    if repeat not in TEAMS_REPEAT_VALUES:
        raise ValueError('Unsupported repeat option.')
    occurrences = max(1, min(max_sessions, int(payload.get('repeatOccurrences') or 12)))
    co_organizers = teams_attendee_emails(payload.get('coOrganizers'))
    # A co-organiser may also be listed as a presenter. Teams gives each person
    # one role (co-organiser wins), so keeping both only keeps the author's list.
    presenters = teams_attendee_emails(payload.get('presenters'))
    if promote_presenters:
        presenter_co_organizers, = load_presenter_co_organizers()
        co_organizers = presenter_co_organizers(
            presenters, co_organizers, payload.get('organizerEmail') or teams_meeting_default_organizer(),
        )
    co_organizer_set = set(co_organizers)
    elevated = co_organizer_set | set(presenters)
    attendees = [
        email for email in teams_attendee_emails(payload.get('attendees'))
        if email not in elevated
    ]
    invited_people = list(dict.fromkeys([*co_organizers, *presenters, *attendees]))
    details = clean_str(payload.get('details'))

    # Convert each instant in the business zone. A fixed UTC offset changes
    # midnight Thursday into two different weekdays across the autumn clock change.
    zone_name = graph_timezone_iana(graph_settings)
    if utc_start.tzinfo is None:
        raise ValueError('The meeting UTC start must include an offset.')
    expected_local = utc_start.astimezone(calendar_zone(zone_name))
    # Older clients used localStartDateTime for the browser's clock. Only the
    # explicit scheduleTimeZone contract names the calendar's civil clock.
    if payload.get('scheduleTimeZone') and (
            local_start.replace(tzinfo=None) != expected_local.replace(tzinfo=None)
            or (local_start.tzinfo is not None and local_start.astimezone(timezone.utc) != utc_start)):
        raise ValueError('The meeting local time and UTC time do not match the selected calendar time zone. Review the session time.')
    graph_zone = graph_settings.get('timezone') or 'GMT Standard Time'
    targets = calendar_targets(payload, utc_start, duration, repeat, occurrences, zone_name, max_sessions=max_sessions)
    event = {
        'subject': title,
        'body': {'contentType': 'HTML', 'content': teams_event_body_html(title, details)},
        'start': graph_calendar_time(targets[0]['start'], zone_name, graph_zone),
        'end': graph_calendar_time(targets[0]['end'], zone_name, graph_zone),
        'attendees': [
            {'emailAddress': {'address': email, 'name': email.split('@', 1)[0]}, 'type': 'required'}
            for email in invited_people
        ],
        'isOnlineMeeting': True,
        'onlineMeetingProvider': 'teamsForBusiness',
        'responseRequested': bool(payload.get('requestResponses', True)),
        'allowNewTimeProposals': bool(payload.get('allowNewTimeProposals', True)),
        'hideAttendees': True,
    }
    transaction_id = clean_str(payload.get('transactionId'))[:255]
    if transaction_id:
        event['transactionId'] = transaction_id
    # Holiday shifts stretch the calendar span past the Nth weekly slot, so size the
    # recurrence by the span the wizard actually needs. Sizing it by session count
    # leaves the trailing shifted dates with no instance to move onto.
    recurrence = local_calendar_recurrence(targets, repeat, zone_name, graph_zone, max_sessions=max_sessions)
    if recurrence:
        event['recurrence'] = recurrence
    # Return normalized timing too, for the component settings response.
    # Return both representations deliberately: Graph needs every invited
    # person, while the LMS attendees field must contain only people without an
    # elevated presenter/co-organiser role.
    return event, invited_people, presenters, co_organizers, attendees, utc_start, duration, repeat, occurrences


def teams_single_occurrence_payload(
    title, target, attendees, transaction_id='', *, clean_str, teams_event_body_html,
):
    payload = {
        'subject': title,
        'body': {'contentType': 'HTML', 'content': teams_event_body_html(title)},
        'start': {
            'dateTime': target['start'].replace(second=0, microsecond=0).isoformat(timespec='seconds'),
            'timeZone': 'UTC',
        },
        'end': {
            'dateTime': target['end'].replace(second=0, microsecond=0).isoformat(timespec='seconds'),
            'timeZone': 'UTC',
        },
        'attendees': [
            {'emailAddress': {'address': email, 'name': email.split('@', 1)[0]}, 'type': 'required'}
            for email in attendees
        ],
        'isOnlineMeeting': True,
        'onlineMeetingProvider': 'teamsForBusiness',
        'responseRequested': True,
        'allowNewTimeProposals': True,
        'hideAttendees': True,
    }
    transaction_id = clean_str(transaction_id)[:255]
    if transaction_id:
        payload['transactionId'] = transaction_id
    return payload
