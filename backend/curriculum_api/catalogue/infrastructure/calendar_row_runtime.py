"""Read-only calendar projections, without content or meeting participant lists.

The existing session planner remains the authority. These are its input rows,
not another implementation of dates, booking state or meeting scope.
"""

from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_COMPONENTS_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_WEEKS_TABLE
from curriculum_api.meetings.domain.read_contracts import LIVE_SESSION_TYPE_SQL
from curriculum_api.catalogue.domain.read_contracts import WEEK_INDEX_COLUMNS
from curriculum_api.catalogue.infrastructure.authoring_runtime import authoring_fetch_all
from django.db import connection
from curriculum_api.catalogue.infrastructure.database_reads import fetch_all
from curriculum_api.catalogue.infrastructure.database_reads import has_column
from curriculum_api.catalogue.infrastructure.authoring_runtime import learning_read_table
from curriculum_api.catalogue.infrastructure.database_reads import quote_ident


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
    'live_sessions_link', 'status', 'deleted_at', 'is_programme_deleted', 'is_deleted',
    'library_state',
)


def live_rows(module_ids):
    from curriculum_api.catalogue.infrastructure.calendar_rows import live_rows as read
    return read(
        module_ids,
        AUTHORING_COMPONENTS_TABLE=AUTHORING_COMPONENTS_TABLE,
        AUTHORING_WEEKS_TABLE=AUTHORING_WEEKS_TABLE,
        CALENDAR_SETTINGS=CALENDAR_SETTINGS,
        COMPONENT_COLUMNS=COMPONENT_COLUMNS,
        LIVE_SESSION_TYPE_SQL=LIVE_SESSION_TYPE_SQL,
        WEEK_INDEX_COLUMNS=WEEK_INDEX_COLUMNS,
        authoring_fetch_all=authoring_fetch_all,
        connection=connection,
        fetch_all=fetch_all,
        has_column=has_column,
        learning_read_table=learning_read_table,
        quote_ident=quote_ident,
    )
