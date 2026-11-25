"""Meeting use cases composed from explicit reads, policies and provider capabilities."""


def teams_new_meeting_organizer(
    requested='', *, clean_str, teams_meeting_default_organizer,
):
    """The mailbox a *new* Teams meeting is created on.

    The configured organizer is a convenience default, not a lock. Deployments
    that grant the Graph application access policy to multiple Microsoft 365
    users can therefore choose the mailbox that should own each new meeting.
    Existing meetings continue to use their persisted organizer.
    """
    return clean_str(requested) or teams_meeting_default_organizer()


def teams_calendar_subject(
    payload, series=None, *, AUTHORING_MODULES_TABLE, authoring_fetch_all, clean_str,
    resolve_authoring_catalogue_id, table_exists,
):
    """Return the module title that owns a Teams calendar series.

    A live-session component may be called "Live Teams Session 1", but the
    Outlook event represents the module-wide delivery calendar. Prefer the
    authoritative saved module title, then explicit/stored module labels, and
    only use the generic title for legacy unlinked meetings.
    """
    series = series if isinstance(series, dict) else {}
    requested_id = clean_str(
        payload.get('moduleCatalogueId')
        or series.get('module_catalogue_id')
    )
    module_id = resolve_authoring_catalogue_id(requested_id) or requested_id
    if module_id and table_exists(AUTHORING_MODULES_TABLE):
        rows = authoring_fetch_all(
            AUTHORING_MODULES_TABLE,
            'module_catalogue_id = %s',
            [module_id],
        )
        saved_title = clean_str(rows[0].get('title')) if rows else ''
        if saved_title:
            return saved_title
    return clean_str(
        payload.get('moduleTitle')
        or series.get('module_title')
        or payload.get('title')
        or 'Live session'
    )


def teams_schedule_settings(
    graph_settings, payload=None, series=None, *, GRAPH_WINDOWS_TO_IANA, calendar_zone, clean_str,
):
    """A new calendar's chosen clock, or an existing calendar's saved clock."""
    selected = clean_str((payload or {}).get('scheduleTimeZone'))
    if selected and selected not in ('Africa/Cairo', 'Europe/London'):
        raise ValueError('Choose Egypt or England as the schedule time zone.')
    stored = clean_str((series or {}).get('timezone'))
    zone = calendar_zone(stored).key if stored else selected
    if not zone:
        return graph_settings
    windows = next((key for key, value in GRAPH_WINDOWS_TO_IANA.items() if value == zone), zone)
    return {**graph_settings, 'timezone': windows, '_schedule_timezone_iana': zone}


def teams_module_session_limit(module_catalogue_id, *, authoring_module_exists,
                               module_week_boundary_mode, module_stored_week_count,
                               authored_week_count):
    """Only a saved calendar-week layout can authorize a longer meeting series."""
    module = authoring_module_exists(module_catalogue_id) if module_catalogue_id else None
    if module and module_week_boundary_mode(module) == 'calendar':
        weeks = module_stored_week_count(module, authored_week_count(module_catalogue_id))
        return max(52, min(104, weeks) * 7)
    return 52
