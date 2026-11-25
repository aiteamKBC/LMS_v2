"""Concrete meetings / infrastructure / invitation runtime capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""
from config.time_zones import calendar_zone
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.domain.archive_policy import active_week_rows
from curriculum_api.catalogue.infrastructure.authoring_runtime import authoring_fetch_all
from curriculum_api.catalogue.infrastructure.catalogue_resolution import resolve_authoring_catalogue_id
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_MODULES_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_WEEKS_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import table_exists
from curriculum_api.meetings.domain.invitation_policy import teams_attendee_emails
from curriculum_api.meetings.domain.read_contracts import TEAMS_REPEAT_VALUES
from curriculum_api.meetings.infrastructure.calendar_runtime import graph_timezone_iana
from curriculum_api.meetings.infrastructure.calendar_runtime import teams_event_body_html
from curriculum_api.meetings.infrastructure.calendar_runtime import teams_meeting_default_organizer
from curriculum_api.teams_calendar_checks import calendar_targets
from curriculum_api.teams_calendar_checks import graph_calendar_time
from curriculum_api.teams_calendar_checks import local_calendar_recurrence
from datetime import datetime
from datetime import timezone
from curriculum_api.catalogue.infrastructure.catalogue_resolution import authoring_module_exists
from curriculum_api.catalogue.domain.delivery_values import module_stored_week_count
from curriculum_api.weekly_schedule import module_week_boundary_mode


def teams_calendar_subject(payload, series=None):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.application.invitation_preparation import teams_calendar_subject as implementation
    return implementation(
        payload, series, AUTHORING_MODULES_TABLE=AUTHORING_MODULES_TABLE,
        authoring_fetch_all=authoring_fetch_all, clean_str=clean_str,
        resolve_authoring_catalogue_id=resolve_authoring_catalogue_id, table_exists=table_exists,
    )


def teams_event_payload(payload, graph_settings, *, promote_presenters=True, max_sessions=52):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.infrastructure.graph_payloads import teams_event_payload as implementation

    def load_presenter_co_organizers():
        from curriculum_api.teams_presenter_roles import presenter_co_organizers
        return presenter_co_organizers,

    return implementation(
        payload, graph_settings, promote_presenters=promote_presenters,
        TEAMS_REPEAT_VALUES=TEAMS_REPEAT_VALUES, calendar_targets=calendar_targets,
        calendar_zone=calendar_zone, clean_str=clean_str, datetime=datetime,
        graph_calendar_time=graph_calendar_time, graph_timezone_iana=graph_timezone_iana,
        load_presenter_co_organizers=load_presenter_co_organizers,
        local_calendar_recurrence=local_calendar_recurrence, teams_attendee_emails=teams_attendee_emails,
        teams_calendar_subject=teams_calendar_subject, teams_event_body_html=teams_event_body_html,
        teams_meeting_default_organizer=teams_meeting_default_organizer, timezone=timezone,
        max_sessions=max_sessions,
    )


def _authored_week_count(module_catalogue_id):
    """Count the same live week rows the catalogue owns, without provisioning."""
    rows = authoring_fetch_all(
        AUTHORING_WEEKS_TABLE, 'module_catalogue_id = %s', [module_catalogue_id],
        columns=('id', 'status'), ensure_tables=False,
    )
    return len(active_week_rows(rows))


def teams_module_session_limit(module_catalogue_id):
    """Bind the stored-module reader to the bounded series-limit query."""
    from curriculum_api.meetings.application.invitation_preparation import teams_module_session_limit as implementation
    return implementation(
        module_catalogue_id, authoring_module_exists=authoring_module_exists,
        module_week_boundary_mode=module_week_boundary_mode,
        module_stored_week_count=module_stored_week_count,
        authored_week_count=_authored_week_count,
    )
