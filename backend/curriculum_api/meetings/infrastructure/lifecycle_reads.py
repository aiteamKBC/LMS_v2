"""Meeting storage and Graph adapters; runtime dependencies are supplied by the facade."""


def module_has_external_teams_calendar(
    module_catalogue_id, series=None, *, AUTHORING_COMPONENTS_TABLE, active_component_rows,
    authoring_fetch_all, component_builder_settings, frontend_component_type, load_external_main_calendar,
):
    """Read saved main links on every mutation; browser state is not authority."""
    external_main_calendar, = load_external_main_calendar()
    if external_main_calendar(series=series):
        return True
    settings = []
    if module_catalogue_id:
        settings = [
            component_builder_settings(row)
            for row in active_component_rows(authoring_fetch_all(
                AUTHORING_COMPONENTS_TABLE, 'module_catalogue_id = %s', [module_catalogue_id],
            ))
            if frontend_component_type(row.get('type')) == 'live-session'
        ]
    return external_main_calendar(settings, series)


def held_schedule_snapshot(
    live_session_id, *, LIVE_SESSION_OCCURRENCES_TABLE, authoring_fetch_all, load_schedule_snapshot,
):
    """The series' live sessions as they are stored right now, for a change notice."""
    schedule_snapshot, = load_schedule_snapshot()
    return schedule_snapshot(authoring_fetch_all(
        LIVE_SESSION_OCCURRENCES_TABLE, "live_session_id = %s and status not in ('cancelled', 'superseded')", [live_session_id],
    ))


def live_session_component_points(
    default=10, *, load_PointsRule, logger, parse_int,
):
    """What a live-session component is worth, from the Engagement points rule.

    The component editor tells the author points are fixed by the
    ``live_session_attended`` rule and refuses to let them be typed, so a
    component created on their behalf has to be worth what that rule says. The
    fallback is only for a deployment that has not configured the rule.
    """
    try:
        PointsRule, = load_PointsRule()
        rule = PointsRule.objects.filter(key='live_session_attended', active=True).only('points').first()
    except Exception:
        logger.debug('Unable to read the live-session points rule.', exc_info=True)
        return default
    return parse_int(getattr(rule, 'points', None), default) if rule else default


def stale_teams_calendar_modules(
    catalogue_ids, *, LIVE_SESSIONS_TABLE, authoring_fetch_all, clean_str, curriculum_in_clause,
    ensure_live_session_tracking_tables, logger,
):
    """Modules whose Teams calendar has been left behind by a schedule edit.

    Moving a module's dates -- or a group's delivery days, which moves every
    module under it -- changes the plan this system generates. It does not touch
    the Teams series that plan was sent to: that calendar lives in the
    organizer's mailbox, and only the Teams Meetings page writes to it. So a save
    that looks complete quietly leaves learners holding invitations for the old
    days, and nothing says so until somebody opens the Teams tab.

    Returned so the screen that made the change can say it at the moment it
    happens. Only modules that actually have a calendar are named: most have
    none, and warning about a calendar nobody created is noise.
    """
    ids = [clean_str(value) for value in (catalogue_ids or []) if clean_str(value)]
    if not ids:
        return []
    try:
        ensure_live_session_tracking_tables()
    except (Exception, AssertionError):
        return []
    clause, values = curriculum_in_clause('module_catalogue_id', ids)
    if not clause:
        return []
    try:
        rows = authoring_fetch_all(LIVE_SESSIONS_TABLE, f"status = 'active' and {clause}", values)
    except (Exception, AssertionError):
        logger.warning('Could not check Teams calendars after a schedule change.', exc_info=True)
        return []
    seen = set()
    results = []
    for row in rows:
        catalogue_id = clean_str(row.get('module_catalogue_id'))
        if not catalogue_id or catalogue_id in seen:
            continue
        seen.add(catalogue_id)
        results.append({
            'moduleCatalogueId': catalogue_id,
            'moduleName': clean_str(row.get('module_title')),
        })
    return results


def module_future_teams_sessions(
    module_catalogue_id, now=None, *, LIVE_SESSIONS_TABLE, LIVE_SESSION_OCCURRENCES_TABLE, authoring_fetch_all,
    clean_str, datetime, parse_graph_datetime, parse_int, timedelta, utc_datetime, utc_iso_value,
):
    """Future Teams sessions still standing on this module's calendars.

    Every calendar the module owns -- its module series and its additional week
    meetings -- that has not been cancelled, and every session on it that has
    not been cancelled and has not ended yet. A session marked "not in plan"
    ('superseded') counts: its Teams slot is still in everyone's calendar, which
    is exactly what an archive must not leave running unseen. Past sessions
    never block: their attendance and history stay where they are.

    Read-only. Archiving never cancels anything; the author does, with Cancel.
    """
    now = utc_datetime(now or datetime.utcnow())
    series_rows = authoring_fetch_all(
        LIVE_SESSIONS_TABLE, "module_catalogue_id = %s and coalesce(status, '') not in ('cancelled', 'canceled')",
        [clean_str(module_catalogue_id)],
    )
    standing = []
    for series in series_rows:
        rows = authoring_fetch_all(
            LIVE_SESSION_OCCURRENCES_TABLE, "live_session_id = %s and coalesce(status, '') not in ('cancelled', 'canceled')",
            [clean_str(series.get('id'))],
        )
        if not rows and series.get('start_datetime'):
            # A calendar with no occurrence rows still has its own start.
            start = parse_graph_datetime(series.get('start_datetime'))
            minutes = parse_int(series.get('duration_minutes'), 60) or 60
            rows = [{'session_number': 1, 'scheduled_start': start,
                     'scheduled_end': start + timedelta(minutes=minutes) if start else None}]
        for row in rows:
            ends = row.get('scheduled_end') or row.get('scheduled_start')
            if ends and utc_datetime(ends) > now:
                standing.append({'liveSessionId': clean_str(series.get('id')),
                                 'sessionNumber': row.get('session_number'),
                                 'startDateTimeUtc': utc_iso_value(parse_graph_datetime(row.get('scheduled_start')))})
    return standing
