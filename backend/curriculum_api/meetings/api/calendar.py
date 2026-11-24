"""Meeting response mapping and HTTP workflows; public decorators remain at the facade.

The existing facade composes dependencies; query and business semantics are preserved.
"""


def curriculum_teams_meeting_off_schedule_runs(
    request,
    live_session_id,
    *,
    JsonResponse,
    LIVE_SESSIONS_TABLE,
    LIVE_SESSION_OCCURRENCES_TABLE,
    authoring_fetch_all,
    clean_str,
    graph_timezone_iana,
    json_error,
    off_schedule_runs,
    read_events,
    teams_schedule_settings,
):
    """The calls on this calendar's link that were not one of its sessions, per session. Read-only.

    Light enough for the Module Builder to read for each of a module's
    calendars: the stored sessions and the integrity log, nothing from Microsoft.
    """

    if request.method != 'GET':
        return json_error('Method not allowed.', status=405)
    series_rows = authoring_fetch_all(LIVE_SESSIONS_TABLE, 'id = %s', [live_session_id])
    if not series_rows:
        return json_error('Live session series not found.', status=404)
    logged = read_events([live_session_id])
    occurrences = authoring_fetch_all(LIVE_SESSION_OCCURRENCES_TABLE, 'live_session_id = %s', [live_session_id],
                                      'session_number asc') if logged else []
    runs = {clean_str(row.get('id')): off_schedule_runs(row, logged) for row in occurrences}
    return JsonResponse({
        'liveSessionId': clean_str(live_session_id),
        'timeZoneIana': graph_timezone_iana(teams_schedule_settings({}, series=series_rows[0])),
        'occurrences': {key: value for key, value in runs.items() if value},
    })


def curriculum_teams_meeting_summary(
    request,
    *,
    LIVE_SESSIONS_TABLE,
    LIVE_SESSION_OCCURRENCES_TABLE,
    TEAMS_OFF_CALENDAR_OCCURRENCE_STATUSES,
    authoring_fetch_all,
    clean_str,
    curriculum_in_clause,
    curriculum_results_response,
    datetime,
    defaultdict,
    ensure_live_session_tracking_tables,
    graph_timezone_iana,
    logger,
    microsoft_update_summary,
    parse_graph_datetime,
    parse_int,
    parse_json_value,
    stored_calendar_series,
    teams_calendar_sync_verdict,
    teams_calendar_sync_verdicts,
    teams_schedule_settings,
    teams_series_email_list,
    utc_iso_value,
):
    """One row per module that has a tracked Teams meeting.

    The Teams record lives in ``curriculum.live_sessions``, keyed by module —
    never on the module row itself. A list that wants to show "does this module
    have a meeting, how many occurrences, when is the next one" would otherwise
    have to pull every module's full week structure and read the live-session
    component's settings, which is the single heaviest part of the module
    payload. This is one grouped read instead, and it changes nothing: it is
    additive and read-only.

    ``?module_catalogue_ids=A,B`` narrows it to the modules a page is showing, and
    ``?occurrence_dates=1`` adds each meeting's occurrence dates *and the sync
    verdict for them*: whether the tracked Teams occurrences still match the
    module's own plan, decided here against the authoring rows rather than in the
    browser against a cached session list (see the sync-state section above).
    """
    try:
        ensure_live_session_tracking_tables()
    except (Exception, AssertionError):
        return curriculum_results_response([], request=request)

    requested = [
        clean_str(item)
        for item in clean_str(
            request.GET.get('module_catalogue_ids') or request.GET.get('moduleCatalogueIds')
        ).split(',')
        if clean_str(item)
    ]
    want_occurrence_dates = clean_str(
        request.GET.get('occurrence_dates') or request.GET.get('occurrenceDates')
    ).lower() in {'1', 'true', 'yes'}
    where = "status = 'active' and module_catalogue_id is not null and module_catalogue_id <> ''"
    params = []
    if requested:
        clause, values = curriculum_in_clause('module_catalogue_id', requested)
        if clause:
            where += f' and {clause}'
            params.extend(values)

    try:
        sessions = authoring_fetch_all(
            LIVE_SESSIONS_TABLE, where, params, 'updated_at desc, created_at desc'
        )
    except (Exception, AssertionError):
        logger.warning('Could not read Teams meeting summaries.', exc_info=True)
        return curriculum_results_response([], request=request)

    occurrences_by_session = defaultdict(list)
    occurrences_readable = True
    session_ids = [clean_str(row.get('id')) for row in sessions if clean_str(row.get('id'))]
    if session_ids:
        clause, values = curriculum_in_clause('live_session_id', session_ids)
        try:
            # Session number first: every caller compares this list against the
            # module's own plan session by session, and that plan is in session
            # order. Ordered by date alone, a series whose tracked rows and
            # plan had drifted in *count* paired each row with its neighbour's
            # date, and every row after the first difference read as wrong.
            for row in authoring_fetch_all(
                LIVE_SESSION_OCCURRENCES_TABLE, clause, values, 'session_number, scheduled_start'
            ):
                occurrences_by_session[clean_str(row.get('live_session_id'))].append(row)
        except (Exception, AssertionError):
            logger.warning('Could not read Teams occurrences.', exc_info=True)
            # Remembered rather than swallowed: an empty read must report
            # `unverified`, never agreement with the plan.
            occurrences_readable = False

    now = datetime.utcnow()

    def occurrence_start(item):
        value = item.get('scheduled_start')
        if isinstance(value, datetime):
            return value.replace(tzinfo=None)
        parsed = parse_graph_datetime(value)
        return parsed.replace(tzinfo=None) if parsed else None

    iso_value = utc_iso_value

    results = []
    seen_modules = set()
    occurrences_by_module = {}
    for row in sessions:
        module_id = clean_str(row.get('module_catalogue_id'))
        # Ordered newest-first above, so the first row for a module is the live one.
        if not module_id or module_id in seen_modules:
            continue
        seen_modules.add(module_id)
        session_id = clean_str(row.get('id'))
        # A cancelled row is what the calendar *used* to hold. Shrinking a
        # series marks its leftover rows cancelled rather than deleting them
        # (see `replace_live_session_occurrences`), and the sync verdict has
        # always excluded them for exactly that reason -- but nothing reported
        # here excluded them anywhere. So one leftover row stayed in
        # `occurrenceDates` for ever, shifting the caller's session-by-session
        # comparison by a slot: the drawer said "Teams still holds <the
        # previous session's date>" on every row after it, and pressing Update
        # could never clear it, however correctly the push itself had run.
        occurrences = [
            item for item in occurrences_by_session.get(session_id, [])
            if clean_str(item.get('status')).lower() not in TEAMS_OFF_CALENDAR_OCCURRENCE_STATUSES
        ]
        occurrences_by_module[module_id] = occurrences
        # Sorted by date in its own right, now that the read above is in
        # session order: the next meeting is the soonest one, not the
        # lowest-numbered one.
        upcoming = sorted(
            (
                item for item in occurrences
                if occurrence_start(item) and occurrence_start(item) >= now
            ),
            key=occurrence_start,
        )
        synced = [item for item in occurrences if item.get('artifacts_synced_at')]
        entry = {
            'moduleCatalogueId': module_id,
            'liveSessionId': session_id,
            'status': clean_str(row.get('status')) or 'active',
            'moduleTitle': clean_str(row.get('module_title')),
            'meetingType': clean_str(row.get('meeting_type')),
            'calendarManagement': 'external' if clean_str(row.get('meeting_type')) == 'linked-external' else 'lms',
            'calendarSeries': stored_calendar_series(row),
            'verificationPending': bool(parse_json_value(row.get('warnings'), [])),
            # Saved / pending / failed for the meeting options, from the saved
            # marker; read only, no Graph call (see teams_options_retry).
            'microsoftUpdate': microsoft_update_summary(row.get('warnings')),
            'joinUrl': clean_str(row.get('join_url')),
            'webLink': clean_str(row.get('web_link')),
            'meetingOptionsUrl': clean_str(row.get('meeting_options_url')),
            'eventId': clean_str(row.get('graph_event_id')),
            'onlineMeetingId': clean_str(row.get('online_meeting_id')),
            'organizerEmail': clean_str(row.get('organizer_email')),
            'timeZone': graph_timezone_iana(teams_schedule_settings({}, series=row)),
            'presenters': teams_series_email_list(row.get('presenters')),
            'coOrganizers': teams_series_email_list(row.get('co_organizers')),
            'attendees': teams_series_email_list(row.get('attendees')),
            'repeatPattern': clean_str(row.get('repeat_pattern')) or 'none',
            'startDateTime': iso_value(row.get('start_datetime')),
            'durationMinutes': parse_int(row.get('duration_minutes'), 0),
            'occurrenceCount': len(occurrences),
            'upcomingCount': len(upcoming),
            'syncedCount': len(synced),
            'nextOccurrence': iso_value(upcoming[0].get('scheduled_start')) if upcoming else '',
            'updatedAt': iso_value(row.get('updated_at')),
        }
        # The dates themselves are what a caller needs to say whether the Teams
        # calendar still agrees with the module's own session plan. They cost this
        # endpoint nothing -- the occurrence rows are already read to count them --
        # but they are opt-in so the list pages that only want the counts keep the
        # small payload they have today.
        if want_occurrence_dates:
            entry['occurrenceDates'] = [iso_value(item.get('scheduled_start')) for item in occurrences]
        results.append(entry)

    if want_occurrence_dates and results:
        # One grouped comparison for every module in the page rather than one
        # per row: see `teams_calendar_sync_verdicts` for the reads it groups.
        verdicts = teams_calendar_sync_verdicts(
            (entry['moduleCatalogueId'] for entry in results),
            occurrences_by_module,
            occurrences_readable=occurrences_readable,
        )
        for entry in results:
            verdict = verdicts.get(entry['moduleCatalogueId']) or teams_calendar_sync_verdict(
                None, [], occurrences_readable=False,
            )
            entry['syncState'] = verdict['syncState']
            entry['syncReasons'] = verdict['syncReasons']
            entry['expectedOccurrenceCount'] = verdict['expectedOccurrenceCount']
            entry['differingOccurrenceCount'] = verdict['differingOccurrences']
            entry['missingFromTeams'] = verdict['missingFromTeams']
            entry['extraInTeams'] = verdict['extraInTeams']
            if any(item.get('verified') is False for item in entry.get('calendarSeries') or []):
                entry['syncState'] = 'unverified'
                entry['syncReasons'] = [*entry['syncReasons'], 'weekday_series_unverified']
            if entry.get('verificationPending'):
                entry['syncState'] = 'unverified'
                entry['syncReasons'] = [*entry['syncReasons'], 'calendar_verification_pending']

    return curriculum_results_response(results, request=request)


def curriculum_live_session_occurrences(
    request,
    *,
    JsonResponse,
    LIVE_SESSIONS_TABLE,
    LIVE_SESSION_OCCURRENCES_TABLE,
    authoring_fetch_all,
    clean_str,
    curriculum_in_clause,
    ensure_live_session_tracking_tables,
    logger,
    parse_int,
    utc_iso_value,
):
    """Real per-occurrence state for a set of modules or live-session series.

    The Sessions tab lists a whole programme's live sessions and must show each
    one's true status (``scheduled`` / ``completed`` / ``cancelled``), which lives
    only on ``curriculum.live_session_occurrences`` and is written by the Graph
    artifact-sync -- never derived from a date here. The programme-detail payload
    carries the components (with their ``teamsLiveSessionId``/``teamsOccurrenceId``)
    but no occurrence status, so this is the one extra read that turns the tab from
    a date guess into the sync service's actual record.

    Narrow it with ``?module_catalogue_ids=A,B`` and/or ``?live_session_ids=X,Y``
    (the caller already holds both from the components it rendered). Read-only,
    additive, and deliberately light: attendance/transcripts/recordings are NOT
    included -- those load lazily per series from the artifacts endpoint only when
    a completed row is expanded.
    """
    try:
        ensure_live_session_tracking_tables()
    except (Exception, AssertionError):
        return JsonResponse({'series': [], 'occurrences': []})

    module_ids = [
        clean_str(item)
        for item in clean_str(
            request.GET.get('module_catalogue_ids') or request.GET.get('moduleCatalogueIds')
        ).split(',')
        if clean_str(item)
    ]
    requested_session_ids = [
        clean_str(item)
        for item in clean_str(
            request.GET.get('live_session_ids') or request.GET.get('liveSessionIds')
        ).split(',')
        if clean_str(item)
    ]
    if not module_ids and not requested_session_ids:
        return JsonResponse({'series': [], 'occurrences': []})

    where = "status = 'active'"
    params = []
    id_clauses = []
    if module_ids:
        clause, values = curriculum_in_clause('module_catalogue_id', module_ids)
        if clause:
            id_clauses.append(clause)
            params.extend(values)
    if requested_session_ids:
        clause, values = curriculum_in_clause('id', requested_session_ids)
        if clause:
            id_clauses.append(clause)
            params.extend(values)
    if not id_clauses:
        return JsonResponse({'series': [], 'occurrences': []})
    where += ' and (' + ' or '.join(id_clauses) + ')'

    try:
        series_rows = authoring_fetch_all(
            LIVE_SESSIONS_TABLE, where, params, 'updated_at desc, created_at desc'
        )
    except (Exception, AssertionError):
        logger.warning('Could not read live-session series.', exc_info=True)
        return JsonResponse({'series': [], 'occurrences': []})

    module_by_session = {}
    series_payload = []
    for row in series_rows:
        session_id = clean_str(row.get('id'))
        if not session_id:
            continue
        module_by_session[session_id] = clean_str(row.get('module_catalogue_id'))
        series_payload.append({
            'liveSessionId': session_id,
            'moduleCatalogueId': clean_str(row.get('module_catalogue_id')),
            'moduleTitle': clean_str(row.get('module_title')),
            'status': clean_str(row.get('status')) or 'active',
            'joinUrl': clean_str(row.get('join_url')),
            'provider': clean_str(row.get('provider')),
        })

    occurrences_payload = []
    session_ids = list(module_by_session.keys())
    if session_ids:
        clause, values = curriculum_in_clause('live_session_id', session_ids)
        try:
            occurrence_rows = authoring_fetch_all(
                LIVE_SESSION_OCCURRENCES_TABLE, clause, values, 'live_session_id, session_number'
            )
        except (Exception, AssertionError):
            logger.warning('Could not read live-session occurrences.', exc_info=True)
            occurrence_rows = []
        iso_value = utc_iso_value
        for row in occurrence_rows:
            live_session_id = clean_str(row.get('live_session_id'))
            occurrences_payload.append({
                'occurrenceId': clean_str(row.get('id')),
                'liveSessionId': live_session_id,
                'moduleCatalogueId': module_by_session.get(live_session_id, ''),
                'sessionNumber': parse_int(row.get('session_number'), 0),
                'status': clean_str(row.get('status')) or 'scheduled',
                'scheduledStart': iso_value(row.get('scheduled_start')),
                'scheduledEnd': iso_value(row.get('scheduled_end')),
                'actualStart': iso_value(row.get('actual_start')),
                'actualEnd': iso_value(row.get('actual_end')),
                'participantCount': parse_int(row.get('participant_count'), 0),
                'joinUrl': clean_str(row.get('join_url')),
                'attendanceReportId': clean_str(row.get('attendance_report_id')),
                'artifactsSyncedAt': iso_value(row.get('artifacts_synced_at')),
            })

    return JsonResponse({'series': series_payload, 'occurrences': occurrences_payload})
