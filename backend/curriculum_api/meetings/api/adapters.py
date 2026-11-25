"""Concrete meetings / api / adapters capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""
from curriculum_api.catalogue.api.responses import json_error
from curriculum_api.catalogue.domain.read_contracts import MODULE_TEAMS_CALENDAR_BLOCKS_ARCHIVE
from curriculum_api.catalogue.domain.values import as_json_value
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.domain.values import parse_int
from curriculum_api.catalogue.infrastructure.authoring_runtime import authoring_fetch_all
from curriculum_api.catalogue.infrastructure.runtime_config import logger
from curriculum_api.meetings.api.time_serialization import utc_iso_value
from curriculum_api.meetings.domain.instants import parse_graph_datetime
from curriculum_api.meetings.domain.read_contracts import LIVE_SESSIONS_TABLE
from curriculum_api.meetings.domain.read_contracts import LIVE_SESSION_OCCURRENCES_TABLE
from curriculum_api.meetings.infrastructure.calendar_runtime import graph_timezone_iana
from curriculum_api.meetings.infrastructure.calendar_runtime import teams_schedule_settings
from curriculum_api.teams_calendar_checks import utc_datetime
from datetime import datetime
from datetime import timedelta
from datetime import timezone
from django.db import DatabaseError
from django.views.decorators.csrf import csrf_exempt
from zoneinfo import ZoneInfo


def external_teams_calendar_refusal(series=None):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.api.lifecycle import external_teams_calendar_refusal as implementation
    return implementation(
        series, clean_str=clean_str, json_error=json_error,
    )


@csrf_exempt
def curriculum_teams_meeting_occurrence_schedule(request, live_session_id, session_number):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.api.lifecycle import curriculum_teams_meeting_occurrence_schedule as implementation
    return implementation(
        request, live_session_id, session_number, clean_str=clean_str, json_error=json_error,
    )


def parse_client_event_time(value):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.api.recording_tracking import parse_client_event_time as implementation
    return implementation(
        value, datetime=datetime, parse_graph_datetime=parse_graph_datetime, timezone=timezone,
    )


def teams_delivery_metadata_from_weeks(weeks):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.api.serialization import teams_delivery_metadata_from_weeks as implementation
    return implementation(
        weeks,
        clean_str=clean_str,
    )


def teams_delivery_metadata_from_live_session_row(session_row):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.api.serialization import teams_delivery_metadata_from_live_session_row as implementation
    return implementation(
        session_row,
        live_session_row_to_component_settings=live_session_row_to_component_settings,
    )


def live_session_row_to_component_settings(row):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.api.serialization import live_session_row_to_component_settings as implementation
    return implementation(
        row,
        as_json_value=as_json_value,
        clean_str=clean_str,
        graph_timezone_iana=graph_timezone_iana,
        parse_int=parse_int,
        teams_schedule_settings=teams_schedule_settings,
        utc_iso_value=utc_iso_value,
    )


def occurrence_local_start(occurrence, series_settings):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.api.serialization import occurrence_local_start as implementation
    return implementation(
        occurrence,
        series_settings,
        ZoneInfo=ZoneInfo,
        clean_str=clean_str,
        graph_timezone_iana=graph_timezone_iana,
        parse_graph_datetime=parse_graph_datetime,
        timezone=timezone,
    )


def occurrence_local_date(occurrence, series_settings):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.api.serialization import occurrence_local_date as implementation
    return implementation(
        occurrence,
        series_settings,
        occurrence_local_start=occurrence_local_start,
    )


def live_occurrence_component_settings(occurrence, series_settings):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.api.serialization import live_occurrence_component_settings as implementation
    return implementation(
        occurrence,
        series_settings,
        clean_str=clean_str,
        occurrence_local_start=occurrence_local_start,
        parse_graph_datetime=parse_graph_datetime,
        parse_int=parse_int,
        utc_iso_value=utc_iso_value,
    )


def module_future_teams_sessions(module_catalogue_id, now=None):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.infrastructure.lifecycle_reads import module_future_teams_sessions as implementation
    return implementation(
        module_catalogue_id, now, LIVE_SESSIONS_TABLE=LIVE_SESSIONS_TABLE,
        LIVE_SESSION_OCCURRENCES_TABLE=LIVE_SESSION_OCCURRENCES_TABLE, authoring_fetch_all=authoring_fetch_all,
        clean_str=clean_str, datetime=datetime, parse_graph_datetime=parse_graph_datetime, parse_int=parse_int,
        timedelta=timedelta, utc_datetime=utc_datetime, utc_iso_value=utc_iso_value,
    )


def module_teams_calendar_block_response(module_catalogue_id):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.api.lifecycle import module_teams_calendar_block_response as implementation
    return implementation(
        module_catalogue_id, DatabaseError=DatabaseError,
        MODULE_TEAMS_CALENDAR_BLOCKS_ARCHIVE=MODULE_TEAMS_CALENDAR_BLOCKS_ARCHIVE, json_error=json_error,
        logger=logger, module_future_teams_sessions=module_future_teams_sessions,
    )

from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.domain.values import parse_int
from curriculum_api.catalogue.infrastructure.authoring_runtime import authoring_fetch_all
from curriculum_api.catalogue.infrastructure.database_reads import curriculum_in_clause
from curriculum_api.catalogue.infrastructure.runtime_config import logger
from curriculum_api.meetings.api.adapters import teams_delivery_metadata_from_live_session_row
from curriculum_api.meetings.api.time_serialization import utc_iso_value
from curriculum_api.meetings.domain.read_contracts import LIVE_SESSIONS_TABLE
from curriculum_api.meetings.domain.read_contracts import LIVE_SESSION_OCCURRENCES_TABLE
from curriculum_api.meetings.infrastructure.calendar_runtime import teams_module_owner_id
from curriculum_api.meetings.infrastructure.tracking_runtime import ensure_live_session_tracking_tables
from django.http import JsonResponse
from django.views.decorators.http import require_GET

def teams_delivery_metadata_from_live_session(module_catalogue_id):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.application.shared_delivery import teams_delivery_metadata_from_live_session as implementation
    return implementation(
        module_catalogue_id,
        LIVE_SESSIONS_TABLE=LIVE_SESSIONS_TABLE,
        authoring_fetch_all=authoring_fetch_all,
        clean_str=clean_str,
        ensure_live_session_tracking_tables=ensure_live_session_tracking_tables,
        teams_delivery_metadata_from_live_session_row=teams_delivery_metadata_from_live_session_row,
        teams_module_owner_id=teams_module_owner_id,
    )


@require_GET
def curriculum_live_session_occurrences(request):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.api.calendar import curriculum_live_session_occurrences as implementation
    return implementation(
        request,
        JsonResponse=JsonResponse,
        LIVE_SESSIONS_TABLE=LIVE_SESSIONS_TABLE,
        LIVE_SESSION_OCCURRENCES_TABLE=LIVE_SESSION_OCCURRENCES_TABLE,
        authoring_fetch_all=authoring_fetch_all,
        clean_str=clean_str,
        curriculum_in_clause=curriculum_in_clause,
        ensure_live_session_tracking_tables=ensure_live_session_tracking_tables,
        logger=logger,
        parse_int=parse_int,
        utc_iso_value=utc_iso_value,
    )
