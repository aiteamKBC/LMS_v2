"""Meeting read orchestration over explicit capabilities.

The existing facade composes dependencies; query and business semantics are preserved.
"""


def module_expected_teams_occurrence_keys(
    module_row,
    holidays=None,
    group_row=None,
    live_sessions=None,
    *,
    authoring_session_links_by_catalogue,
    calendar_clock_to_utc_iso,
    clean_str,
    format_date,
    module_live_session_clock,
    module_session_plan_for_count,
    teams_calendar_minute_key,
):
    """The UTC minutes the module's authored live sessions say Teams should hold.

    Read from the same place the session list is -- the module's live-session
    components, one per session, each on its own date -- so what this expects,
    what the calendar shows and what the push sends are one thing. Comparing a
    calendar built from the components against a plan generated from
    ``sessions_number`` would report every hand-dated session as a difference
    that pressing Update could never resolve.

    Only live sessions that carry a date of their own count. An undated one is
    an unfinished module, not a session Teams is expected to hold, and a module
    with none expects nothing -- the verdict then reads ``no-sessions``, which
    is the truth, rather than "out of sync" against a plan nobody authored.

    ``live_sessions`` is this module's entries from
    ``authoring_session_links_by_catalogue``. Pass them in from a caller that has
    already batched the read; leave it as ``None`` and this reads its own.

    Returns ``(keys, plan)``: the minute keys in course order, and the plan, so a
    caller can still see its warnings.
    """
    catalogue_id = clean_str((module_row or {}).get('module_catalogue_id'))
    if live_sessions is None and catalogue_id:
        live_sessions = authoring_session_links_by_catalogue(
            [catalogue_id], modules_by_catalogue={catalogue_id: module_row},
        ).get(catalogue_id) or []
    # A session delivered by its own additional meeting -- or not yet assigned
    # to either calendar -- is not part of this series: the module calendar
    # never books it, so judging the calendar against it would report a
    # difference that pressing Update could never resolve. See
    # `live_session_meeting_scope` and teams_week_meeting.py.
    dated = [link for link in (live_sessions or [])
             if format_date(link.get('date'))
             and not link.get('additionalMeeting')
             and link.get('meetingScope', 'main') == 'main']
    plan = module_session_plan_for_count(
        module_row,
        len(dated),
        holidays=holidays,
    )
    keys = []
    # The same walk `build_sessions_from_authoring_modules` makes, over the same
    # rows, with the same clock fallback. Any drift between the two reappears as
    # a permanent "Dates differ" on a calendar that is actually correct -- which
    # is why neither of them may invent a session the other does not have.
    for link in dated:
        session_date = format_date(link.get('date'))
        start_time, _end_time, _duration = module_live_session_clock(
            module_row, link.get('startTime'), link.get('durationMinutes'),
            booked=link.get('bookedAtMicrosoft', False), group_row=group_row, session_date=session_date,
        )
        key = teams_calendar_minute_key(calendar_clock_to_utc_iso(session_date, start_time, link.get('timeZone')))
        if key:
            keys.append(key)
    return keys, plan


def teams_calendar_sync_verdict(
    module_row,
    occurrence_rows,
    holidays=None,
    group_row=None,
    occurrences_readable=True,
    holidays_readable=True,
    live_sessions=None,
    *,
    Counter,
    TEAMS_OFF_CALENDAR_OCCURRENCE_STATUSES,
    TEAMS_SYNC_REPORTED_DATE_LIMIT,
    clean_str,
    module_expected_teams_occurrence_keys,
    teams_calendar_minute_key,
):
    """Whether the tracked Teams occurrences still match the module's own plan.

    Compared as multisets of UTC minutes, so the order the two sides arrive in
    never decides the answer and a duplicated occurrence is still an extra. That
    catches every way the two can drift -- a delivery day added or dropped, a
    date moved, a holiday newly ticked or untied, a start or end date changed,
    an occurrence Teams holds that the plan no longer has.

    The verdict is never optimistic. Anything that stops the comparison being
    real -- an unreadable occurrence read, a module row that is gone, a plan
    that cannot be dated, a series with nothing tracked against it -- returns
    ``unverified``, not ``in-sync``.
    """
    def verdict(state, reasons, **extra):
        return {
            'syncState': state,
            'syncReasons': reasons,
            'expectedOccurrenceCount': 0,
            'trackedOccurrenceCount': 0,
            'differingOccurrences': 0,
            'missingFromTeams': [],
            'extraInTeams': [],
            **extra,
        }

    if not occurrences_readable:
        return verdict('unverified', ['occurrences_unreadable'])
    if not holidays_readable:
        return verdict('unverified', ['cohort_holidays_unreadable'])
    if not module_row:
        # A live series whose module row has gone is an orphan: there is no plan
        # left to compare it against, so it cannot be called in sync.
        return verdict('unverified', ['module_missing'])

    active = [
        row for row in (occurrence_rows or [])
        if clean_str((row or {}).get('status')).lower() not in TEAMS_OFF_CALENDAR_OCCURRENCE_STATUSES
    ]
    actual_keys = []
    for row in active:
        key = teams_calendar_minute_key(row.get('scheduled_start'))
        if not key:
            # A tracked occurrence with no readable start cannot be matched, and
            # ignoring it would let a broken row pass as agreement.
            return verdict('unverified', ['occurrence_date_unreadable'])
        actual_keys.append(key)

    expected_keys, plan = module_expected_teams_occurrence_keys(module_row, holidays, group_row, live_sessions)
    if not expected_keys:
        if not active:
            return verdict('no-sessions', plan.get('warnings') or [])
        return verdict(
            'unverified',
            ['plan_unavailable', *(plan.get('warnings') or [])],
            trackedOccurrenceCount=len(active),
        )
    if not active:
        # The read succeeded and the series has nothing tracked against it, so
        # there is nothing to compare the plan with -- not an agreement.
        return verdict(
            'unverified',
            ['no_tracked_occurrences'],
            expectedOccurrenceCount=len(expected_keys),
        )

    expected_counts = Counter(expected_keys)
    actual_counts = Counter(actual_keys)
    missing = expected_counts - actual_counts
    extra = actual_counts - expected_counts
    missing_total = sum(missing.values())
    extra_total = sum(extra.values())

    reasons = []
    if missing_total:
        reasons.append('missing_from_teams')
    if extra_total:
        reasons.append('extra_in_teams')

    def as_instants(counts):
        # `teams_calendar_minute_key` already names a UTC minute
        # (`YYYY-MM-DDTHH:MM`); seconds and the offset are appended so a caller
        # can treat this the same as any other instant this endpoint returns.
        return [
            f'{key}:00Z'
            for key in sorted(counts.elements())
        ][:TEAMS_SYNC_REPORTED_DATE_LIMIT]

    return verdict(
        'out-of-sync' if reasons else 'in-sync',
        reasons,
        expectedOccurrenceCount=len(expected_keys),
        trackedOccurrenceCount=len(active),
        # The badge's caption counts sessions, not edits: a date that moved is
        # one session that differs, which is one missing key and one extra.
        differingOccurrences=max(missing_total, extra_total),
        missingFromTeams=as_instants(missing),
        extraInTeams=as_instants(extra),
    )


def teams_calendar_sync_verdicts(
    module_catalogue_ids,
    occurrences_by_module,
    occurrences_readable=True,
    *,
    AUTHORING_MODULES_TABLE,
    GROUPS_TABLE,
    authoring_fetch_all,
    authoring_session_links_by_catalogue,
    calendar_fallback,
    clean_str,
    cohort_selected_holidays_by_cohort,
    curriculum_in_clause,
    logger,
    teams_calendar_sync_verdict,
):
    """A sync verdict per module, in bulk reads rather than reads per module.

    Four reads for the whole page whatever its length: the module rows, their
    cohorts, the holiday table and the groups. Modules sharing a cohort share
    its holidays and modules sharing a group share its slot, so both are grouped
    once and reused -- the curriculum overview's own 13-second lesson.
    """
    wanted = list(dict.fromkeys(
        clean_str(value) for value in (module_catalogue_ids or []) if clean_str(value)
    ))
    if not wanted:
        return {}
    clause, params = curriculum_in_clause('module_catalogue_id', wanted)
    try:
        module_rows = authoring_fetch_all(AUTHORING_MODULES_TABLE, clause, params)
    except (Exception, AssertionError):
        logger.warning('Could not read modules for the Teams calendar sync verdict.', exc_info=True)
        # Fail closed: every module reports `unverified` rather than `in-sync`.
        return {
            module_id: teams_calendar_sync_verdict(None, [], occurrences_readable=occurrences_readable)
            for module_id in wanted
        }
    modules_by_id = {
        clean_str(row.get('module_catalogue_id')): row
        for row in module_rows
        if clean_str(row.get('module_catalogue_id'))
    }

    cohort_ids = list(dict.fromkeys(
        clean_str(row.get('cohort_id')) for row in module_rows if clean_str(row.get('cohort_id'))
    ))
    try:
        holidays_by_cohort = cohort_selected_holidays_by_cohort(cohort_ids)
    except ValueError as exc:
        CalendarUnavailable, display_cohort_holidays = calendar_fallback()
        if not isinstance(exc, CalendarUnavailable):
            raise
        holidays_by_cohort = display_cohort_holidays([clean_str(row.get('cohort_id')) for row in module_rows])
    # Holidays move a module's dates, so a cohort read that came back with
    # nothing at all cannot be told apart from one that failed -- and a plan
    # dated without the ticked closures is not a plan worth comparing.
    holidays_readable = bool(holidays_by_cohort) or not cohort_ids

    groups_by_id = {}
    group_ids = list(dict.fromkeys(
        clean_str(row.get('group_id')) for row in module_rows if clean_str(row.get('group_id'))
    ))
    if group_ids:
        group_clause, group_params = curriculum_in_clause('group_id', group_ids)
        try:
            groups_by_id = {
                clean_str(row.get('group_id')): row
                for row in authoring_fetch_all(GROUPS_TABLE, group_clause, group_params)
                if clean_str(row.get('group_id'))
            }
        except (Exception, AssertionError):
            # Only the slot-time fallback is lost, and the module row's own slot
            # is the authority anyway -- a group edit writes it into these rows.
            logger.debug('Could not read groups for the Teams calendar sync verdict.', exc_info=True)

    # The authored live sessions of every module on the page, in one read. The
    # verdict is decided against them, so reading them per module would be the
    # per-row round trip this function exists to avoid. The module, group and
    # holiday rows read above are handed over with them, so dating each week's
    # primary live session adds no round trip of its own.
    live_sessions_by_module = authoring_session_links_by_catalogue(
        list(modules_by_id.keys()),
        modules_by_catalogue=modules_by_id,
        groups_by_id=groups_by_id,
        holidays_by_cohort=holidays_by_cohort,
    )

    verdicts = {}
    for module_id in wanted:
        module_row = modules_by_id.get(module_id)
        cohort_id = clean_str((module_row or {}).get('cohort_id'))
        try:
            verdicts[module_id] = teams_calendar_sync_verdict(
                module_row,
                occurrences_by_module.get(module_id) or [],
                holidays=holidays_by_cohort.get(cohort_id) or [],
                group_row=groups_by_id.get(clean_str((module_row or {}).get('group_id'))),
                occurrences_readable=occurrences_readable,
                holidays_readable=holidays_readable or not cohort_id,
                live_sessions=live_sessions_by_module.get(module_id) or [],
            )
        except Exception:
            logger.exception('Unable to compare the Teams calendar for %s.', module_id)
            verdicts[module_id] = teams_calendar_sync_verdict(None, [], occurrences_readable=False)
    return verdicts
