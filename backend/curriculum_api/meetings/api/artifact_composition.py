"""Concrete meetings artifact composition bindings.

Owns HTTP/decorator and runtime capability composition. Application operations,
domain policies, SQL and transaction behavior remain in their existing owners.
Public signatures and response contracts are unchanged."""
from collections import defaultdict
from curriculum_api import schema_gate
from curriculum_api.attendance_identity import keep_directory_lookup
from curriculum_api.attendance_identity import resolve_directory_accounts
from curriculum_api.catalogue.api.responses import json_error
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.domain.values import parse_int
from curriculum_api.catalogue.domain.values import parse_json_value
from curriculum_api.catalogue.infrastructure.authoring_runtime import authoring_fetch_all
from curriculum_api.catalogue.infrastructure.authoring_storage import authoring_upsert
from curriculum_api.catalogue.infrastructure.authoring_storage import update_authoring_rows
from curriculum_api.catalogue.infrastructure.row_queries import json_db_value
from curriculum_api.catalogue.infrastructure.runtime_config import logger
from curriculum_api.catalogue.infrastructure.write_composition import authoring_delete
from curriculum_api.meetings.api.meeting_option_composition import apply_teams_meeting_options
from curriculum_api.meetings.api.meeting_option_composition import teams_online_meeting_from_join_url
from curriculum_api.meetings.api.time_serialization import stamp_live_session_instants
from curriculum_api.meetings.domain.attendance_policy import attendance_display_name
from curriculum_api.meetings.domain.attendance_policy import attendance_identity
from curriculum_api.meetings.domain.attendance_policy import attendance_report_rosters
from curriculum_api.meetings.domain.attendance_policy import launch_linked_live_occurrence
from curriculum_api.meetings.domain.attendance_policy import merge_attendance_intervals
from curriculum_api.meetings.domain.instants import parse_graph_datetime
from curriculum_api.meetings.domain.invitation_policy import teams_series_email_list
from curriculum_api.meetings.domain.read_contracts import LIVE_SESSIONS_TABLE
from curriculum_api.meetings.domain.read_contracts import LIVE_SESSION_ARTIFACTS_TABLE
from curriculum_api.meetings.domain.read_contracts import LIVE_SESSION_JOIN_LAUNCHES_TABLE
from curriculum_api.meetings.domain.read_contracts import LIVE_SESSION_OCCURRENCES_TABLE
from curriculum_api.meetings.infrastructure.calendar_runtime import graph_timezone_iana
from curriculum_api.meetings.infrastructure.calendar_runtime import stored_leftover_slots
from curriculum_api.meetings.infrastructure.calendar_runtime import teams_online_meeting_owner_id
from curriculum_api.meetings.infrastructure.calendar_runtime import teams_schedule_settings
from curriculum_api.meetings.infrastructure.session_persistence import upsert_live_session_artifact
from curriculum_api.meetings.infrastructure.session_runtime import attendance_interval_seconds
from curriculum_api.meetings.infrastructure.session_runtime import graph_item_with_occurrence_link
from curriculum_api.meetings.infrastructure.session_runtime import live_session_join_launches
from curriculum_api.meetings.infrastructure.session_runtime import live_session_meeting_groups
from curriculum_api.meetings.infrastructure.tracking_queries import remove_artifact_from_wrong_occurrences
from curriculum_api.meetings.infrastructure.tracking_runtime import LIVE_SESSION_ATTENDANCE_TABLE
from curriculum_api.meetings.infrastructure.tracking_runtime import ensure_live_session_tracking_tables
from curriculum_api.session_artifact_placement import recording_matches_occurrence
from datetime import datetime
from django.db import transaction
from django.http import HttpResponse
from django.http import HttpResponseRedirect
from django.http import JsonResponse
from django.http import StreamingHttpResponse
from django.views.decorators.http import require_GET
from urllib import error as urllib_error
from urllib import parse as urllib_parse
from urllib import request as urllib_request
import uuid
from curriculum_api.meetings.infrastructure.invitation_runtime import teams_module_session_limit


def curriculum_teams_meeting_artifacts(request, live_session_id):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.api.results import curriculum_teams_meeting_artifacts as implementation
    from coach_api.views import has_graph_credentials, microsoft_graph_request, get_graph_settings
    from curriculum_api.session_graph import collection
    from curriculum_api.teams_dial_in import remember_teams_dial_in
    from curriculum_api.teams_calendar_integrity import completion_to_reopen, note_completion, note_premature_run, note_reopened_by_sync, run_not_delivery, run_replaces_stored, stored_run_is_delivery
    from curriculum_api.session_results import queue_sync
    from curriculum_api.teams_calendar_integrity import off_schedule_runs, read_events
    from learner_api.teams_attendance import sync_verified_teams_attendance_reporting
    return implementation(
        request,
        live_session_id,
        JsonResponse=JsonResponse,
        LIVE_SESSIONS_TABLE=LIVE_SESSIONS_TABLE,
        LIVE_SESSION_ARTIFACTS_TABLE=LIVE_SESSION_ARTIFACTS_TABLE,
        LIVE_SESSION_ATTENDANCE_TABLE=LIVE_SESSION_ATTENDANCE_TABLE,
        LIVE_SESSION_JOIN_LAUNCHES_TABLE=LIVE_SESSION_JOIN_LAUNCHES_TABLE,
        LIVE_SESSION_OCCURRENCES_TABLE=LIVE_SESSION_OCCURRENCES_TABLE,
        apply_teams_meeting_options=apply_teams_meeting_options,
        attendance_display_name=attendance_display_name,
        attendance_identity=attendance_identity,
        attendance_interval_seconds=attendance_interval_seconds,
        attendance_report_rosters=attendance_report_rosters,
        authoring_delete=authoring_delete,
        authoring_fetch_all=authoring_fetch_all,
        authoring_upsert=authoring_upsert,
        clean_str=clean_str,
        collection=collection,
        completion_to_reopen=completion_to_reopen,
        datetime=datetime,
        defaultdict=defaultdict,
        get_graph_settings=get_graph_settings,
        graph_item_with_occurrence_link=graph_item_with_occurrence_link,
        graph_timezone_iana=graph_timezone_iana,
        has_graph_credentials=has_graph_credentials,
        json_db_value=json_db_value,
        json_error=json_error,
        keep_directory_lookup=keep_directory_lookup,
        launch_linked_live_occurrence=launch_linked_live_occurrence,
        live_session_join_launches=live_session_join_launches,
        live_session_meeting_groups=live_session_meeting_groups,
        logger=logger,
        merge_attendance_intervals=merge_attendance_intervals,
        microsoft_graph_request=microsoft_graph_request,
        note_completion=note_completion,
        note_premature_run=note_premature_run,
        note_reopened_by_sync=note_reopened_by_sync,
        off_schedule_runs=off_schedule_runs,
        parse_graph_datetime=parse_graph_datetime,
        parse_int=parse_int,
        parse_json_value=parse_json_value,
        queue_sync=queue_sync,
        read_events=read_events,
        recording_matches_occurrence=recording_matches_occurrence,
        remember_teams_dial_in=remember_teams_dial_in,
        remove_artifact_from_wrong_occurrences=remove_artifact_from_wrong_occurrences,
        resolve_directory_accounts=resolve_directory_accounts,
        run_not_delivery=run_not_delivery,
        run_replaces_stored=run_replaces_stored,
        schema_gate=schema_gate,
        stamp_live_session_instants=stamp_live_session_instants,
        stored_leftover_slots=stored_leftover_slots,
        stored_run_is_delivery=stored_run_is_delivery,
        sync_verified_teams_attendance_reporting=sync_verified_teams_attendance_reporting,
        teams_online_meeting_from_join_url=teams_online_meeting_from_join_url,
        teams_schedule_settings=teams_schedule_settings,
        teams_series_email_list=teams_series_email_list,
        transaction=transaction,
        update_authoring_rows=update_authoring_rows,
        upsert_live_session_artifact=upsert_live_session_artifact,
        urllib_parse=urllib_parse,
        uuid=uuid,
        teams_module_session_limit=teams_module_session_limit,
    )


@require_GET
def curriculum_teams_meeting_artifact_content(request, live_session_id, artifact_id):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.api.content_delivery import curriculum_teams_meeting_artifact_content as implementation

    def load_get_graph_settings():
        from coach_api.views import get_graph_settings, microsoft_graph_token
        return get_graph_settings, microsoft_graph_token

    def load_bunny_recording():
        from curriculum_api.session_bunny_policy import bunny_recording, recording_uses_bunny
        return bunny_recording, recording_uses_bunny

    def load_archived_live_session_recording_url():
        from coach_api.recording_archive import archived_live_session_recording_url
        return archived_live_session_recording_url,

    def load_open_transcript():
        from curriculum_api.transcript_transport import open_transcript
        return open_transcript,

    def load_VideoImportError():
        from curriculum_api.bunny_stream import VideoImportError
        return VideoImportError,

    def load_recording_player():
        from curriculum_api.session_bunny import recording_player
        return recording_player,

    def load_copy():
        from copy import copy
        return copy,

    def load_admin_content():
        from curriculum_api.session_results import admin_content
        return admin_content,

    return implementation(
        request, live_session_id, artifact_id, HttpResponse=HttpResponse,
        HttpResponseRedirect=HttpResponseRedirect, LIVE_SESSIONS_TABLE=LIVE_SESSIONS_TABLE,
        LIVE_SESSION_ARTIFACTS_TABLE=LIVE_SESSION_ARTIFACTS_TABLE,
        LIVE_SESSION_OCCURRENCES_TABLE=LIVE_SESSION_OCCURRENCES_TABLE,
        StreamingHttpResponse=StreamingHttpResponse, authoring_fetch_all=authoring_fetch_all,
        clean_str=clean_str, ensure_live_session_tracking_tables=ensure_live_session_tracking_tables,
        json_error=json_error, load_VideoImportError=load_VideoImportError,
        load_admin_content=load_admin_content,
        load_archived_live_session_recording_url=load_archived_live_session_recording_url,
        load_bunny_recording=load_bunny_recording, load_copy=load_copy,
        load_get_graph_settings=load_get_graph_settings, load_open_transcript=load_open_transcript,
        load_recording_player=load_recording_player, logger=logger,
        teams_online_meeting_owner_id=teams_online_meeting_owner_id, urllib_error=urllib_error,
        urllib_parse=urllib_parse, urllib_request=urllib_request,
    )
