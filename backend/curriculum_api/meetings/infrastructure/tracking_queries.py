"""Concrete meetings / infrastructure / tracking queries capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.infrastructure.authoring_runtime import authoring_fetch_all
from curriculum_api.catalogue.infrastructure.database_reads import authoring_table_name
from curriculum_api.catalogue.infrastructure.database_reads import curriculum_in_clause
from curriculum_api.catalogue.infrastructure.database_reads import rows_as_dicts
from curriculum_api.catalogue.infrastructure.placement_runtime import tutor_workspace_session_payload
from curriculum_api.catalogue.infrastructure.runtime_config import logger
from curriculum_api.catalogue.infrastructure.write_composition import authoring_delete
from curriculum_api.meetings.domain.read_contracts import LIVE_SESSIONS_TABLE
from curriculum_api.meetings.domain.read_contracts import LIVE_SESSION_ARTIFACTS_TABLE
from curriculum_api.meetings.domain.read_contracts import LIVE_SESSION_OCCURRENCES_TABLE
from curriculum_api.meetings.infrastructure.tracking_runtime import ensure_live_session_tracking_tables
from datetime import datetime
from datetime import timedelta
from django.db import connection


def remove_artifact_from_wrong_occurrences(occurrences, target_occurrence, artifact_type, artifact):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.infrastructure.artifact_storage import remove_artifact_from_wrong_occurrences as implementation
    return implementation(
        occurrences, target_occurrence, artifact_type, artifact,
        LIVE_SESSION_ARTIFACTS_TABLE=LIVE_SESSION_ARTIFACTS_TABLE, authoring_delete=authoring_delete,
        authoring_fetch_all=authoring_fetch_all, clean_str=clean_str,
    )


def stale_teams_calendar_modules(catalogue_ids):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.infrastructure.lifecycle_reads import stale_teams_calendar_modules as implementation
    return implementation(
        catalogue_ids, LIVE_SESSIONS_TABLE=LIVE_SESSIONS_TABLE, authoring_fetch_all=authoring_fetch_all,
        clean_str=clean_str, curriculum_in_clause=curriculum_in_clause,
        ensure_live_session_tracking_tables=ensure_live_session_tracking_tables, logger=logger,
    )


def tutor_workspace_next_session_by_module(module_ids):
    """``{module_catalogue_id: next session}``, earliest current/upcoming one per module.

    Superseded series are excluded: rescheduling writes a new series row and
    marks the old one superseded, so including them would offer a meeting whose
    invitation no longer exists. Cancelled occurrences go for the same reason.

    Every upcoming occurrence is fetched in one query and reduced per module in
    Python rather than with ``distinct on``, which is PostgreSQL-only — this
    module also runs against SQLite under test. The volume is a handful of rows
    per module, so the difference is not worth the portability.
    """
    if not module_ids:
        return {}
    ensure_live_session_tracking_tables()

    sessions_table = authoring_table_name(LIVE_SESSIONS_TABLE)
    occurrences_table = authoring_table_name(LIVE_SESSION_OCCURRENCES_TABLE)
    placeholders = ', '.join(['%s'] * len(module_ids))
    query = f"""
        select
            occurrence.scheduled_start,
            occurrence.scheduled_end,
            occurrence.session_number,
            occurrence.status as occurrence_status,
            coalesce(nullif(occurrence.join_url, ''), session.join_url) as join_url,
            session.id as live_session_id,
            session.module_catalogue_id,
            session.module_title,
            session.timezone,
            session.duration_minutes,
            session.repeat_pattern,
            session.repeat_occurrences
        from {occurrences_table} as occurrence
        join {sessions_table} as session
          on session.id = occurrence.live_session_id
        where session.module_catalogue_id in ({placeholders})
          and coalesce(session.status, '') <> 'superseded'
          and coalesce(occurrence.status, '') not in ('cancelled', 'superseded')
          and occurrence.scheduled_end >= %s
        order by occurrence.scheduled_start
    """
    with connection.cursor() as cursor:
        cursor.execute(query, [*module_ids, datetime.utcnow() - timedelta(minutes=30)])
        rows = rows_as_dicts(cursor)

    # Ordered by start, so the first row seen for a module is its current or next
    # session.
    earliest = {}
    for row in rows:
        module_id = clean_str(row.get('module_catalogue_id'))
        if module_id and module_id not in earliest:
            earliest[module_id] = tutor_workspace_session_payload(row)
    return earliest
