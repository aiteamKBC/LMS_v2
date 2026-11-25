"""Concrete meetings / infrastructure / session runtime capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""
from curriculum_api.catalogue.domain.component_policy import component_builder_settings
from curriculum_api.catalogue.domain.component_types import normalise_component_type
from curriculum_api.catalogue.domain.content_validation import frontend_component_type
from curriculum_api.catalogue.domain.delivery_values import module_session_clock
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.domain.values import parse_int
from curriculum_api.catalogue.infrastructure.authoring_runtime import authoring_fetch_all
from curriculum_api.catalogue.infrastructure.database_reads import authoring_table_name
from curriculum_api.catalogue.infrastructure.runtime_config import logger
from curriculum_api.meetings.domain.read_contracts import LIVE_SESSIONS_TABLE
from curriculum_api.meetings.domain.read_contracts import LIVE_SESSION_ARTIFACTS_TABLE
from curriculum_api.meetings.domain.read_contracts import LIVE_SESSION_JOIN_LAUNCHES_TABLE
from curriculum_api.meetings.domain.read_contracts import LIVE_SESSION_MEETING_SCOPES
from curriculum_api.meetings.domain.read_contracts import LIVE_SESSION_MEETING_SCOPE_KEY
from curriculum_api.meetings.domain.read_contracts import LIVE_SESSION_OCCURRENCES_TABLE
from curriculum_api.meetings.domain.read_contracts import LIVE_SESSION_SCHEDULE_FIELDS
from curriculum_api.meetings.infrastructure.calendar_runtime import live_session_booked_on_module_calendar
from curriculum_api.meetings.infrastructure.calendar_runtime import teams_event_body_html
from curriculum_api.meetings.infrastructure.calendar_runtime import teams_meeting_base_path
from curriculum_api.meetings.infrastructure.calendar_runtime import teams_online_meeting_owner_id
from curriculum_api.session_overrides import override_clock
from curriculum_api.weekly_schedule import module_weekly_schedule
from django.views.decorators.csrf import csrf_exempt
from urllib import parse as urllib_parse


def saved_live_session_occurrences(live_session_id):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.infrastructure.session_reads import saved_live_session_occurrences as implementation
    return implementation(
        live_session_id,
        LIVE_SESSION_OCCURRENCES_TABLE=LIVE_SESSION_OCCURRENCES_TABLE,
        authoring_fetch_all=authoring_fetch_all,
    )


def teams_single_occurrence_payload(title, target, attendees, transaction_id=''):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.infrastructure.graph_payloads import teams_single_occurrence_payload as implementation
    return implementation(
        title, target, attendees, transaction_id, clean_str=clean_str,
        teams_event_body_html=teams_event_body_html,
    )


def flag_teams_occurrence_leftovers(deletions, *, live_session_id='', module_catalogue_id='', source='holiday_move_cleanup'):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.application.calendar_publication import flag_teams_occurrence_leftovers as implementation
    return implementation(
        deletions, live_session_id=live_session_id, module_catalogue_id=module_catalogue_id, source=source,
        clean_str=clean_str, logger=logger,
    )


def live_session_meeting_groups(series, occurrences):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.domain.module_delivery import live_session_meeting_groups as implementation
    return implementation(
        series, occurrences, clean_str=clean_str, teams_meeting_base_path=teams_meeting_base_path,
    )


def live_session_join_launches(occurrences):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.infrastructure.artifact_storage import live_session_join_launches as implementation
    return implementation(
        occurrences, LIVE_SESSION_JOIN_LAUNCHES_TABLE=LIVE_SESSION_JOIN_LAUNCHES_TABLE,
        authoring_fetch_all=authoring_fetch_all, clean_str=clean_str,
    )


def graph_item_with_occurrence_link(item, occurrence, launch=None):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.application.artifact_identity import graph_item_with_occurrence_link as implementation
    return implementation(
        item, occurrence, launch, clean_str=clean_str, parse_int=parse_int,
    )


def attendance_interval_seconds(intervals):
    from curriculum_api.session_results_policy import attendance_seconds
    return attendance_seconds(intervals)


def _same_artifact_under_new_graph_id(cursor, lock, payload):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.infrastructure.artifact_storage import _same_artifact_under_new_graph_id as implementation
    return implementation(
        cursor, lock, payload, LIVE_SESSION_ARTIFACTS_TABLE=LIVE_SESSION_ARTIFACTS_TABLE,
        authoring_table_name=authoring_table_name, clean_str=clean_str,
    )


@csrf_exempt
def live_session_recording_graph_base(occurrence_id):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.application.artifact_identity import live_session_recording_graph_base as implementation
    return implementation(
        occurrence_id, LIVE_SESSIONS_TABLE=LIVE_SESSIONS_TABLE,
        LIVE_SESSION_OCCURRENCES_TABLE=LIVE_SESSION_OCCURRENCES_TABLE, authoring_fetch_all=authoring_fetch_all,
        clean_str=clean_str, teams_online_meeting_owner_id=teams_online_meeting_owner_id,
        urllib_parse=urllib_parse,
    )


def module_live_session_clock(module_row, start_time='', duration_minutes=0, *, booked=False, group_row=None, session_date=None):
    from curriculum_api.catalogue.domain.delivery_pattern import module_live_session_clock as query
    return query(
        module_row,
        start_time,
        duration_minutes,
        booked=booked,
        group_row=group_row,
        session_date=session_date,
        module_session_clock=module_session_clock,
        override_clock=override_clock,
        module_weekly_schedule=module_weekly_schedule,
    )


def live_session_component_points(default=10):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.infrastructure.lifecycle_reads import live_session_component_points as implementation

    def load_PointsRule():
        from engagement_api.models import PointsRule
        return PointsRule,

    return implementation(
        default, load_PointsRule=load_PointsRule, logger=logger, parse_int=parse_int,
    )


def live_session_meeting_scope(settings, module_has_series=True):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.domain.calendar_policy import live_session_meeting_scope as implementation
    return implementation(
        settings,
        module_has_series,
        LIVE_SESSION_MEETING_SCOPES=LIVE_SESSION_MEETING_SCOPES,
        LIVE_SESSION_MEETING_SCOPE_KEY=LIVE_SESSION_MEETING_SCOPE_KEY,
        clean_str=clean_str,
        live_session_booked_on_module_calendar=live_session_booked_on_module_calendar,
    )


def replaceable_live_session(row, *, shared=False):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.domain.calendar_policy import replaceable_live_session as implementation
    return implementation(
        row,
        shared=shared,
        clean_str=clean_str,
        component_builder_settings=component_builder_settings,
        frontend_component_type=frontend_component_type,
    )


def module_structure_live_session_counts(weeks):
    """Count authored live sessions per row, excluding reading-only rows."""
    return [
        sum(
            normalise_component_type(component.get('type')) == 'live_session'
            for component in week.get('components') or []
        )
        for week in weeks or []
    ]


def module_live_sessions_affected(stored, merged):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.domain.module_delivery import module_live_sessions_affected as implementation

    def load_same():
        from curriculum_api.module_merge import same
        return same,

    return implementation(
        stored, merged, LIVE_SESSION_SCHEDULE_FIELDS=LIVE_SESSION_SCHEDULE_FIELDS, clean_str=clean_str,
        load_same=load_same, normalise_component_type=normalise_component_type,
    )
