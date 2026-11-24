"""Concrete meetings / infrastructure / session persistence capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.domain.values import parse_json_value
from curriculum_api.catalogue.infrastructure.authoring_runtime import authoring_fetch_all
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import ensure_module_authoring_tables
from curriculum_api.catalogue.infrastructure.authoring_storage import authoring_upsert
from curriculum_api.catalogue.infrastructure.authoring_storage import update_authoring_rows
from curriculum_api.catalogue.infrastructure.catalogue_resolution import authoring_module_exists
from curriculum_api.catalogue.infrastructure.database_reads import authoring_table_name
from curriculum_api.catalogue.infrastructure.row_queries import json_db_value
from curriculum_api.meetings.domain.calendar_policy import occurrence_session_number
from curriculum_api.meetings.domain.calendar_policy import pair_planned_occurrences
from curriculum_api.meetings.domain.calendar_policy import scheduled_live_session_occurrences
from curriculum_api.meetings.domain.instants import parse_graph_datetime
from curriculum_api.meetings.domain.read_contracts import LIVE_SESSIONS_TABLE
from curriculum_api.meetings.domain.read_contracts import LIVE_SESSION_ARTIFACTS_TABLE
from curriculum_api.meetings.domain.read_contracts import LIVE_SESSION_OCCURRENCES_TABLE
from curriculum_api.meetings.infrastructure.invitation_runtime import teams_calendar_subject
from curriculum_api.meetings.infrastructure.session_runtime import _same_artifact_under_new_graph_id
from curriculum_api.meetings.infrastructure.tracking_runtime import ensure_live_session_tracking_tables
from curriculum_api.meetings.infrastructure.tracking_runtime import ensure_live_sessions_table
from datetime import datetime
from django.db import connection
from django.db import transaction
import hashlib
import uuid


def persist_live_session_occurrences(live_session_id, payload, event, utc_start, duration, repeat, occurrences):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.infrastructure.session_writes import persist_live_session_occurrences as implementation
    return implementation(
        live_session_id,
        payload,
        event,
        utc_start,
        duration,
        repeat,
        occurrences,
        LIVE_SESSION_OCCURRENCES_TABLE=LIVE_SESSION_OCCURRENCES_TABLE,
        authoring_upsert=authoring_upsert,
        clean_str=clean_str,
        datetime=datetime,
        ensure_live_session_tracking_tables=ensure_live_session_tracking_tables,
        scheduled_live_session_occurrences=scheduled_live_session_occurrences,
        uuid=uuid,
    )


def replace_live_session_occurrences(live_session_id, payload, utc_start, duration, repeat, occurrences, event_id='', join_url=''):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.infrastructure.session_writes import replace_live_session_occurrences as implementation
    return implementation(
        live_session_id,
        payload,
        utc_start,
        duration,
        repeat,
        occurrences,
        event_id,
        join_url,
        LIVE_SESSION_OCCURRENCES_TABLE=LIVE_SESSION_OCCURRENCES_TABLE,
        authoring_fetch_all=authoring_fetch_all,
        authoring_upsert=authoring_upsert,
        clean_str=clean_str,
        datetime=datetime,
        ensure_live_session_tracking_tables=ensure_live_session_tracking_tables,
        occurrence_session_number=occurrence_session_number,
        pair_planned_occurrences=pair_planned_occurrences,
        scheduled_live_session_occurrences=scheduled_live_session_occurrences,
        transaction=transaction,
        update_authoring_rows=update_authoring_rows,
        uuid=uuid,
    )


def persist_live_session_series(payload, event, warnings, graph_settings, organizer, attendees, presenters, online_meeting_id='', co_organizers=(), *, persist_occurrences=True, max_sessions=52):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.infrastructure.session_writes import persist_live_session_series as implementation
    return implementation(
        payload,
        event,
        warnings,
        graph_settings,
        organizer,
        attendees,
        presenters,
        online_meeting_id,
        co_organizers,
        persist_occurrences=persist_occurrences,
        LIVE_SESSIONS_TABLE=LIVE_SESSIONS_TABLE,
        authoring_module_exists=authoring_module_exists,
        authoring_upsert=authoring_upsert,
        clean_str=clean_str,
        datetime=datetime,
        ensure_live_session_tracking_tables=ensure_live_session_tracking_tables,
        ensure_module_authoring_tables=ensure_module_authoring_tables,
        json_db_value=json_db_value,
        parse_graph_datetime=parse_graph_datetime,
        persist_live_session_occurrences=persist_live_session_occurrences,
        teams_calendar_subject=teams_calendar_subject,
        update_authoring_rows=update_authoring_rows,
        uuid=uuid,
        max_sessions=max_sessions,
    )


def link_live_session_series_to_module(module_catalogue_id, payload):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.infrastructure.session_writes import link_live_session_series_to_module as implementation
    return implementation(
        module_catalogue_id,
        payload,
        LIVE_SESSIONS_TABLE=LIVE_SESSIONS_TABLE,
        clean_str=clean_str,
        datetime=datetime,
        ensure_live_sessions_table=ensure_live_sessions_table,
        update_authoring_rows=update_authoring_rows,
    )


def persist_recreated_occurrence_details(live_session_id, recreated_details):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.infrastructure.artifact_storage import persist_recreated_occurrence_details as implementation
    return implementation(
        live_session_id, recreated_details, LIVE_SESSION_OCCURRENCES_TABLE=LIVE_SESSION_OCCURRENCES_TABLE,
        clean_str=clean_str, datetime=datetime, update_authoring_rows=update_authoring_rows,
    )


def upsert_live_session_artifact(occurrence, artifact_type, artifact):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.infrastructure.artifact_storage import upsert_live_session_artifact as implementation
    return implementation(
        occurrence, artifact_type, artifact, LIVE_SESSION_ARTIFACTS_TABLE=LIVE_SESSION_ARTIFACTS_TABLE,
        _same_artifact_under_new_graph_id=_same_artifact_under_new_graph_id,
        authoring_table_name=authoring_table_name, authoring_upsert=authoring_upsert, clean_str=clean_str,
        connection=connection, datetime=datetime, hashlib=hashlib, json_db_value=json_db_value,
        parse_graph_datetime=parse_graph_datetime, parse_json_value=parse_json_value, transaction=transaction,
    )
