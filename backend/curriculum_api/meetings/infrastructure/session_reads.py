"""Existing meeting persistence operations over explicit database capabilities.

The existing facade composes dependencies; query and business semantics are preserved.
"""


def saved_live_session_occurrences(
    live_session_id,
    *,
    LIVE_SESSION_OCCURRENCES_TABLE,
    authoring_fetch_all,
):
    """The series' live session rows as stored, in session order.

    What the component walk pairs by date and stamps with occurrence ids. The
    planned items ``replace_live_session_occurrences`` returns carry neither an
    id nor a stored start, so handing those to the walk matched no component.
    """
    return authoring_fetch_all(LIVE_SESSION_OCCURRENCES_TABLE, "live_session_id = %s and status not in ('cancelled', 'superseded')",
                               [live_session_id], 'session_number')


def teams_module_owner_id(
    module_catalogue_id,
    *,
    AUTHORING_MODULES_TABLE,
    authoring_fetch_all,
    clean_str,
):
    """Resolve a shared-Teams module alias to its canonical module owner.

    A duplicate that shares a meeting deliberately has no ``live_sessions`` row
    of its own.  Following this small, bounded chain keeps all Teams reads and
    writes on the original record without copying its provider identifiers or
    allowing an alias to take ownership of the calendar.
    """
    current = clean_str(module_catalogue_id)
    seen = set()
    while current and current not in seen:
        seen.add(current)
        row = (authoring_fetch_all(
            AUTHORING_MODULES_TABLE,
            'module_catalogue_id = %s',
            [current],
        ) or [{}])[0]
        source = clean_str(row.get('teams_shared_source_module_id'))
        if not source or source in seen:
            break
        current = source
    return current


def shared_teams_component_settings(
    module_catalogue_id,
    *,
    AUTHORING_COMPONENTS_TABLE,
    AUTHORING_WEEKS_TABLE,
    LIVE_SESSION_TYPE_SQL,
    active_component_rows,
    active_week_rows,
    authoring_fetch_all,
    clean_str,
    component_builder_settings,
    normalise_component_type,
    parse_int,
):
    """Return booked live-session settings in authored component order."""
    module_catalogue_id = clean_str(module_catalogue_id)
    if not module_catalogue_id:
        return []
    week_rows = active_week_rows(authoring_fetch_all(
        AUTHORING_WEEKS_TABLE,
        'module_catalogue_id = %s',
        [module_catalogue_id],
        'display_order, week_number, id',
    ))
    week_order = {
        clean_str(row.get('id')): index
        for index, row in enumerate(week_rows)
    }
    rows = authoring_fetch_all(
        AUTHORING_COMPONENTS_TABLE,
        f'module_catalogue_id = %s and {LIVE_SESSION_TYPE_SQL}',
        [module_catalogue_id],
        'display_order, id',
    )
    rows = sorted(
        active_component_rows(rows),
        key=lambda row: (
            week_order.get(clean_str(row.get('week_id')), 999999),
            parse_int(row.get('display_order'), 999999),
            clean_str(row.get('id')),
        ),
    )
    return [
        component_builder_settings(row)
        for row in rows
        if normalise_component_type(row.get('type')) == 'live_session'
    ]


def active_teams_series_for_join_link(
    link,
    *,
    excluding_module_id='',
    LIVE_SESSIONS_TABLE,
    LIVE_SESSION_OCCURRENCES_TABLE,
    authoring_fetch_all,
    clean_str,
    unique,
):
    """The unambiguous module that already owns a saved Teams link, if any.

    A recording belongs to ``live_sessions`` / its occurrences, never to the
    text URL stored on a component.  When an author pastes that URL into a new
    module we can safely expose the existing evidence there only if exactly one
    active module owns it.  Do not guess when a tenant has reused a link.
    """
    link = clean_str(link)
    excluded = clean_str(excluding_module_id)
    if not link:
        return ''
    series = [
        row for row in authoring_fetch_all(LIVE_SESSIONS_TABLE, 'join_url = %s', [link])
        if clean_str(row.get('module_catalogue_id')) != excluded
        and clean_str(row.get('status')).lower() not in {'cancelled', 'canceled', 'deleted', 'failed', 'superseded'}
    ]
    # A recreated occurrence can own a distinct Teams URL from its series.
    # Include it, because its recordings are still held by the parent series.
    occurrences = authoring_fetch_all(LIVE_SESSION_OCCURRENCES_TABLE, 'join_url = %s', [link])
    series_ids = unique([clean_str(row.get('live_session_id')) for row in occurrences if clean_str(row.get('live_session_id'))])
    if series_ids:
        placeholders = ', '.join(['%s'] * len(series_ids))
        series.extend(authoring_fetch_all(LIVE_SESSIONS_TABLE, f'id in ({placeholders})', series_ids))
    owners = {
        clean_str(row.get('module_catalogue_id'))
        for row in series
        if clean_str(row.get('module_catalogue_id')) != excluded
        and clean_str(row.get('status')).lower() not in {'cancelled', 'canceled', 'deleted', 'failed', 'superseded'}
    }
    return next(iter(owners)) if len(owners) == 1 else ''


def module_has_active_teams_series(
    module_catalogue_id,
    *,
    LIVE_SESSIONS_TABLE,
    authoring_fetch_all,
    clean_str,
):
    """Whether a module already owns a calendar rather than sharing one."""
    return any(
        clean_str(row.get('status')).lower() not in {'cancelled', 'canceled', 'deleted', 'failed', 'superseded'}
        for row in authoring_fetch_all(LIVE_SESSIONS_TABLE, 'module_catalogue_id = %s', [module_catalogue_id])
    )
