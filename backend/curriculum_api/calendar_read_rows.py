"""Read-only calendar projections, without content or meeting participant lists.

The existing session planner remains the authority. These are its input rows,
not another implementation of dates, booking state or meeting scope.
"""
from . import views


# Keep legacySettings verbatim: meeting_settings merges it underneath current
# settings, including explicit nulls. Filtering its contents could change that
# precedence for older imported components.
CALENDAR_SETTINGS = (
    'legacySettings', 'sessionDate', 'sessionTime', 'sessionTimeZone',
    'durationMinutes', 'teamsDurationMinutes', 'extraTeamsMeetingUrl',
    'teamsLiveSessionId', 'teamsSessionNumber', 'teamsOccurrenceId',
    'teamsMeetingScope', 'liveSessionUrl', 'teamsMeetingUrl', 'liveSessionLinkOverride',
)
COMPONENT_COLUMNS = (
    'id', 'module_catalogue_id', 'week_id', 'type', 'title', 'display_order',
    'live_sessions_link', 'deleted_at', 'is_programme_deleted', 'is_deleted',
    'library_state',
)


def live_rows(module_ids):
    if not module_ids:
        return [], []
    slots = ','.join(['%s'] * len(module_ids))
    where = f'module_catalogue_id in ({slots})'
    weeks = views.authoring_fetch_all(
        views.AUTHORING_WEEKS_TABLE, where, module_ids,
        'module_catalogue_id, display_order, week_number, id',
        ensure_tables=False, columns=views.WEEK_INDEX_COLUMNS,
    )
    columns = [column for column in COMPONENT_COLUMNS
               if views.has_column(views.AUTHORING_COMPONENTS_TABLE, column)]
    if views.connection.vendor == 'postgresql':
        # jsonb_each preserves a present JSON null (unlike ->> / strip_nulls),
        # so legacy fallback and explicit clearing retain their existing meaning.
        # The projection runs in SQL: large attendees/options/content settings
        # never cross the database connection just to draw a calendar.
        fields = ', '.join(views.quote_ident(column) for column in columns)
        settings = """coalesce((
            select jsonb_object_agg(setting.key, setting.value)
            from jsonb_each(case when jsonb_typeof(settings_json::jsonb) = 'object'
                then settings_json::jsonb else '{}'::jsonb end) setting
            where setting.key = ANY(%s)
        ), '{}'::jsonb) as settings_json"""
        components = views.fetch_all(f'''
            select {fields}, {settings}
            from {views.learning_read_table(views.AUTHORING_COMPONENTS_TABLE)}
            where {where} and {views.LIVE_SESSION_TYPE_SQL}
            order by module_catalogue_id, week_id, display_order, id
        ''', [list(CALENDAR_SETTINGS), *module_ids])
    else:
        components = views.authoring_fetch_all(
            views.AUTHORING_COMPONENTS_TABLE,
            f'{where} and {views.LIVE_SESSION_TYPE_SQL}', module_ids,
            'module_catalogue_id, week_id, display_order, id',
            ensure_tables=False, columns=[*columns, 'settings_json'],
        )
    return weeks, components
