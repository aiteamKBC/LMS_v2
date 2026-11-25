"""Concrete meetings / api / tracking adapters capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""
from curriculum_api.catalogue.api.responses import json_body
from curriculum_api.catalogue.api.responses import json_error
from curriculum_api.catalogue.domain.values import bool_payload
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.domain.values import parse_int
from curriculum_api.catalogue.infrastructure.authoring_runtime import authoring_fetch_all
from curriculum_api.catalogue.infrastructure.authoring_storage import authoring_upsert
from curriculum_api.catalogue.infrastructure.authoring_storage import insert_row
from curriculum_api.catalogue.infrastructure.row_queries import json_db_value
from curriculum_api.meetings.api.adapters import parse_client_event_time
from curriculum_api.meetings.domain.attendance_policy import safe_float
from curriculum_api.meetings.domain.read_contracts import LIVE_SESSIONS_TABLE
from curriculum_api.meetings.domain.read_contracts import LIVE_SESSION_ARTIFACTS_TABLE
from curriculum_api.meetings.domain.read_contracts import LIVE_SESSION_JOIN_LAUNCHES_TABLE
from curriculum_api.meetings.domain.read_contracts import LIVE_SESSION_OCCURRENCES_TABLE
from curriculum_api.meetings.infrastructure.tracking_runtime import LIVE_SESSION_RECORDING_EVENTS_TABLE
from curriculum_api.meetings.infrastructure.tracking_runtime import ensure_live_session_tracking_tables
from datetime import datetime
from django.http import HttpResponse
from django.http import JsonResponse
from django.views.decorators.http import require_GET
from urllib.parse import urlparse
import json
import uuid


def curriculum_teams_recording_events(request, live_session_id, artifact_id):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.api.recording_tracking import curriculum_teams_recording_events as implementation
    return implementation(
        request, live_session_id, artifact_id, JsonResponse=JsonResponse,
        LIVE_SESSIONS_TABLE=LIVE_SESSIONS_TABLE, LIVE_SESSION_ARTIFACTS_TABLE=LIVE_SESSION_ARTIFACTS_TABLE,
        LIVE_SESSION_OCCURRENCES_TABLE=LIVE_SESSION_OCCURRENCES_TABLE,
        LIVE_SESSION_RECORDING_EVENTS_TABLE=LIVE_SESSION_RECORDING_EVENTS_TABLE,
        authoring_fetch_all=authoring_fetch_all, bool_payload=bool_payload, clean_str=clean_str,
        datetime=datetime, ensure_live_session_tracking_tables=ensure_live_session_tracking_tables,
        insert_row=insert_row, json=json, json_body=json_body, json_error=json_error,
        parse_client_event_time=parse_client_event_time, parse_int=parse_int, safe_float=safe_float, uuid=uuid,
    )


@require_GET
def curriculum_teams_meeting_join(request, live_session_id, occurrence_id):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.api.content_delivery import curriculum_teams_meeting_join as implementation
    return implementation(
        request, live_session_id, occurrence_id, HttpResponse=HttpResponse,
        LIVE_SESSIONS_TABLE=LIVE_SESSIONS_TABLE,
        LIVE_SESSION_JOIN_LAUNCHES_TABLE=LIVE_SESSION_JOIN_LAUNCHES_TABLE,
        LIVE_SESSION_OCCURRENCES_TABLE=LIVE_SESSION_OCCURRENCES_TABLE, authoring_fetch_all=authoring_fetch_all,
        authoring_upsert=authoring_upsert, clean_str=clean_str, datetime=datetime,
        ensure_live_session_tracking_tables=ensure_live_session_tracking_tables, json_db_value=json_db_value,
        json_error=json_error, parse_int=parse_int, urlparse=urlparse, uuid=uuid,
    )
