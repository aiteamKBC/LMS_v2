"""Concrete meetings meeting command composition bindings.

Owns HTTP/decorator and runtime capability composition. Application operations,
domain policies, SQL and transaction behavior remain in their existing owners.
Public signatures and response contracts are unchanged."""
from collections import defaultdict
from curriculum_api.catalogue.api.adapters import curriculum_results_response
from curriculum_api.catalogue.api.responses import json_body
from curriculum_api.catalogue.api.responses import json_error
from curriculum_api.catalogue.domain.component_policy import component_builder_settings
from curriculum_api.catalogue.domain.content_validation import frontend_component_type
from curriculum_api.catalogue.domain.content_values import active_component_rows
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.domain.values import parse_int
from curriculum_api.catalogue.domain.values import parse_json_value
from curriculum_api.catalogue.infrastructure.authoring_runtime import authoring_fetch_all
from curriculum_api.catalogue.infrastructure.authoring_storage import update_authoring_rows
from curriculum_api.catalogue.infrastructure.catalogue_resolution import authoring_module_exists
from curriculum_api.catalogue.infrastructure.catalogue_resolution import resolve_stored_module_catalogue_id
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_COMPONENTS_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import curriculum_in_clause
from curriculum_api.catalogue.infrastructure.database_reads import has_column
from curriculum_api.catalogue.infrastructure.row_queries import json_db_value
from curriculum_api.catalogue.infrastructure.runtime_config import logger
from curriculum_api.meetings.api.adapters import external_teams_calendar_refusal
from curriculum_api.meetings.api.adapters import live_session_row_to_component_settings
from curriculum_api.meetings.api.meeting_option_composition import TEAMS_LOBBY_VALUES
from curriculum_api.meetings.api.meeting_option_composition import apply_teams_meeting_options
from curriculum_api.meetings.api.meeting_option_composition import apply_teams_occurrence_shifts
from curriculum_api.meetings.api.meeting_option_composition import refresh_standalone_occurrence_options
from curriculum_api.meetings.api.module_link_composition import attach_teams_meeting_to_module_weeks
from curriculum_api.meetings.api.time_serialization import utc_iso_value
from curriculum_api.meetings.domain.instants import parse_graph_datetime
from curriculum_api.meetings.domain.invitation_policy import forward_teams_invitation
from curriculum_api.meetings.domain.invitation_policy import teams_attendee_emails
from curriculum_api.meetings.domain.invitation_policy import teams_newly_invited
from curriculum_api.meetings.domain.invitation_policy import teams_series_email_list
from curriculum_api.meetings.domain.invitation_policy import teams_warning_sentence
from curriculum_api.meetings.domain.read_contracts import GRAPH_SILENT_INVITE_HEADERS
from curriculum_api.meetings.domain.read_contracts import LIVE_SESSIONS_TABLE
from curriculum_api.meetings.domain.read_contracts import LIVE_SESSION_OCCURRENCES_TABLE
from curriculum_api.meetings.domain.read_contracts import TEAMS_OFF_CALENDAR_OCCURRENCE_STATUSES
from curriculum_api.meetings.domain.read_contracts import TEAMS_REPEAT_VALUES
from curriculum_api.meetings.domain.recurrence_policy import teams_shifted_occurrence_targets
from curriculum_api.meetings.infrastructure.calendar_runtime import graph_timezone_iana
from curriculum_api.meetings.infrastructure.calendar_runtime import held_schedule_snapshot
from curriculum_api.meetings.infrastructure.calendar_runtime import module_has_external_teams_calendar
from curriculum_api.meetings.infrastructure.calendar_runtime import publish_teams_calendar_attendees
from curriculum_api.meetings.infrastructure.calendar_runtime import teams_meeting_default_organizer
from curriculum_api.meetings.infrastructure.calendar_runtime import teams_new_meeting_organizer
from curriculum_api.meetings.infrastructure.calendar_runtime import teams_schedule_settings
from curriculum_api.meetings.infrastructure.calendar_runtime import teams_series_invited
from curriculum_api.meetings.infrastructure.calendar_runtime import verify_teams_calendar_with_standalones
from curriculum_api.meetings.infrastructure.calendar_verification import teams_calendar_sync_verdict
from curriculum_api.meetings.infrastructure.calendar_verification import teams_calendar_sync_verdicts
from curriculum_api.meetings.infrastructure.calendar_verification import teams_non_delivery_reason
from curriculum_api.meetings.infrastructure.invitation_runtime import teams_calendar_subject
from curriculum_api.meetings.infrastructure.invitation_runtime import teams_event_payload
from curriculum_api.meetings.infrastructure.session_persistence import persist_live_session_series
from curriculum_api.meetings.infrastructure.session_persistence import persist_recreated_occurrence_details
from curriculum_api.meetings.infrastructure.session_persistence import replace_live_session_occurrences
from curriculum_api.meetings.infrastructure.session_runtime import flag_teams_occurrence_leftovers
from curriculum_api.meetings.infrastructure.session_runtime import saved_live_session_occurrences
from curriculum_api.meetings.infrastructure.tracking_runtime import ensure_live_session_tracking_tables
from curriculum_api.meetings.infrastructure.tracking_runtime import ensure_live_sessions_table
from curriculum_api.teams_calendar_checks import CalendarMismatch
from curriculum_api.teams_calendar_checks import calendar_targets
from curriculum_api.teams_calendar_checks import dropped_sessions_sentence
from curriculum_api.teams_calendar_checks import graph_calendar_time
from curriculum_api.teams_calendar_checks import local_calendar_recurrence
from curriculum_api.teams_calendar_checks import sessions_a_rewrite_would_drop
from curriculum_api.teams_options_retry import microsoft_update_summary
from curriculum_api.teams_weekly_calendar import calendar_groups
from curriculum_api.teams_weekly_calendar import save_weekday_calendar
from curriculum_api.teams_weekly_calendar import stored_calendar_series
from datetime import datetime
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET
from urllib import parse as urllib_parse
import json
import uuid
from curriculum_api.study_week_teams import prune_study_week_fillers
from curriculum_api.meetings.infrastructure.invitation_runtime import teams_module_session_limit


@csrf_exempt
def curriculum_teams_meeting(request):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.api.creation import curriculum_teams_meeting as implementation
    from coach_api.views import get_graph_settings, has_graph_credentials, microsoft_graph_request
    from curriculum_api.teams_calendar_integrity import without_missing
    from curriculum_api.teams_calendar_integrity import record_reconcile
    from curriculum_api.teams_dial_in import remember_teams_dial_in
    from curriculum_api.teams_graph_failure_log import EVENT_SAVE, record_graph_failure
    return implementation(
        request,
        EVENT_SAVE=EVENT_SAVE,
        JsonResponse=JsonResponse,
        LIVE_SESSIONS_TABLE=LIVE_SESSIONS_TABLE,
        LIVE_SESSION_OCCURRENCES_TABLE=LIVE_SESSION_OCCURRENCES_TABLE,
        TEAMS_LOBBY_VALUES=TEAMS_LOBBY_VALUES,
        apply_teams_meeting_options=apply_teams_meeting_options,
        apply_teams_occurrence_shifts=apply_teams_occurrence_shifts,
        attach_teams_meeting_to_module_weeks=attach_teams_meeting_to_module_weeks,
        authoring_fetch_all=authoring_fetch_all,
        authoring_module_exists=authoring_module_exists,
        calendar_groups=calendar_groups,
        calendar_targets=calendar_targets,
        clean_str=clean_str,
        datetime=datetime,
        ensure_live_sessions_table=ensure_live_sessions_table,
        external_teams_calendar_refusal=external_teams_calendar_refusal,
        flag_teams_occurrence_leftovers=flag_teams_occurrence_leftovers,
        get_graph_settings=get_graph_settings,
        graph_timezone_iana=graph_timezone_iana,
        has_column=has_column,
        has_graph_credentials=has_graph_credentials,
        json_body=json_body,
        json_db_value=json_db_value,
        json_error=json_error,
        live_session_row_to_component_settings=live_session_row_to_component_settings,
        logger=logger,
        microsoft_graph_request=microsoft_graph_request,
        module_has_external_teams_calendar=module_has_external_teams_calendar,
        persist_live_session_series=persist_live_session_series,
        persist_recreated_occurrence_details=persist_recreated_occurrence_details,
        publish_teams_calendar_attendees=publish_teams_calendar_attendees,
        record_graph_failure=record_graph_failure,
        record_reconcile=record_reconcile,
        remember_teams_dial_in=remember_teams_dial_in,
        replace_live_session_occurrences=replace_live_session_occurrences,
        resolve_stored_module_catalogue_id=resolve_stored_module_catalogue_id,
        save_weekday_calendar=save_weekday_calendar,
        saved_live_session_occurrences=saved_live_session_occurrences,
        teams_calendar_subject=teams_calendar_subject,
        teams_event_payload=teams_event_payload,
        teams_meeting_default_organizer=teams_meeting_default_organizer,
        teams_module_owner_id=globals().get('teams_module_owner_id'),
        teams_new_meeting_organizer=teams_new_meeting_organizer,
        teams_non_delivery_reason=teams_non_delivery_reason,
        teams_schedule_settings=teams_schedule_settings,
        teams_shifted_occurrence_targets=teams_shifted_occurrence_targets,
        update_authoring_rows=update_authoring_rows,
        urllib_parse=urllib_parse,
        verify_teams_calendar_with_standalones=verify_teams_calendar_with_standalones,
        without_missing=without_missing,
        prune_study_week_fillers=prune_study_week_fillers,
        teams_module_session_limit=teams_module_session_limit,
    )


def with_schedule_change_notice(response, live_session_id, before, request=None, notify=False, series_before=None):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.api.change_notifications import with_schedule_change_notice as implementation

    def load_issue_change_notice():
        from curriculum_api.teams_schedule_notice import issue_change_notice
        return issue_change_notice,

    def load_may_send_schedule_email():
        from curriculum_api.teams_week_meeting import may_send_schedule_email
        return may_send_schedule_email,

    def load_lms_email_requested():
        from curriculum_api.teams_notification_preferences import lms_email_requested
        return lms_email_requested,

    def load_send_change_emails():
        from curriculum_api.teams_schedule_delivery import send_change_emails, send_creation_emails
        return send_change_emails, send_creation_emails

    return implementation(
        response, live_session_id, before, request, notify, series_before, JsonResponse=JsonResponse,
        LIVE_SESSIONS_TABLE=LIVE_SESSIONS_TABLE, authoring_fetch_all=authoring_fetch_all, clean_str=clean_str,
        held_schedule_snapshot=held_schedule_snapshot, json=json,
        load_issue_change_notice=load_issue_change_notice, load_lms_email_requested=load_lms_email_requested,
        load_may_send_schedule_email=load_may_send_schedule_email,
        load_send_change_emails=load_send_change_emails, teams_series_invited=teams_series_invited, uuid=uuid,
    )


@csrf_exempt
def curriculum_teams_meeting_schedule(request, live_session_id):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.api.scheduling import curriculum_teams_meeting_schedule as implementation
    from coach_api.views import get_graph_settings, has_graph_credentials, microsoft_graph_request
    from curriculum_api.teams_original_calendar import calendar_authorized, original_calendar_request
    from curriculum_api.teams_schedule_notice import same_schedule
    from curriculum_api.teams_update_guard import claim_announcement, finish_announcement, graph_failure_outcome, logical_change_id, targets_snapshot
    from curriculum_api.teams_update_preservation import calendar_occurrence_details
    from curriculum_api.teams_calendar_integrity import known_missing_numbers, record_reconcile, without_missing
    from curriculum_api.teams_meeting_options_policy import ALL_GROUPS as ALL_OPTION_GROUPS, json_list, option_groups_to_apply, pending_option_groups, pending_warning, remaining_pending, reported_failure, stored_options as saved_meeting_options
    from curriculum_api.teams_update_preservation import unresolved_saved_bindings
    from curriculum_api.teams_presenter_roles import presenter_co_organizers, roles_changed
    from curriculum_api.teams_graph_failure_log import EVENT_SAVE, record_graph_failure
    return implementation(
        request,
        live_session_id,
        ALL_OPTION_GROUPS=ALL_OPTION_GROUPS,
        AUTHORING_COMPONENTS_TABLE=AUTHORING_COMPONENTS_TABLE,
        CalendarMismatch=CalendarMismatch,
        EVENT_SAVE=EVENT_SAVE,
        GRAPH_SILENT_INVITE_HEADERS=GRAPH_SILENT_INVITE_HEADERS,
        JsonResponse=JsonResponse,
        LIVE_SESSIONS_TABLE=LIVE_SESSIONS_TABLE,
        LIVE_SESSION_OCCURRENCES_TABLE=LIVE_SESSION_OCCURRENCES_TABLE,
        TEAMS_LOBBY_VALUES=TEAMS_LOBBY_VALUES,
        TEAMS_REPEAT_VALUES=TEAMS_REPEAT_VALUES,
        active_component_rows=active_component_rows,
        apply_teams_meeting_options=apply_teams_meeting_options,
        apply_teams_occurrence_shifts=apply_teams_occurrence_shifts,
        attach_teams_meeting_to_module_weeks=attach_teams_meeting_to_module_weeks,
        authoring_fetch_all=authoring_fetch_all,
        calendar_authorized=calendar_authorized,
        calendar_groups=calendar_groups,
        calendar_occurrence_details=calendar_occurrence_details,
        calendar_targets=calendar_targets,
        claim_announcement=claim_announcement,
        clean_str=clean_str,
        component_builder_settings=component_builder_settings,
        datetime=datetime,
        dropped_sessions_sentence=dropped_sessions_sentence,
        ensure_live_session_tracking_tables=ensure_live_session_tracking_tables,
        finish_announcement=finish_announcement,
        flag_teams_occurrence_leftovers=flag_teams_occurrence_leftovers,
        forward_teams_invitation=forward_teams_invitation,
        frontend_component_type=frontend_component_type,
        get_graph_settings=get_graph_settings,
        graph_calendar_time=graph_calendar_time,
        graph_failure_outcome=graph_failure_outcome,
        graph_timezone_iana=graph_timezone_iana,
        has_column=has_column,
        has_graph_credentials=has_graph_credentials,
        held_schedule_snapshot=held_schedule_snapshot,
        json_body=json_body,
        json_db_value=json_db_value,
        json_error=json_error,
        json_list=json_list,
        known_missing_numbers=known_missing_numbers,
        live_session_row_to_component_settings=live_session_row_to_component_settings,
        local_calendar_recurrence=local_calendar_recurrence,
        logger=logger,
        logical_change_id=logical_change_id,
        microsoft_graph_request=microsoft_graph_request,
        module_has_external_teams_calendar=module_has_external_teams_calendar,
        option_groups_to_apply=option_groups_to_apply,
        original_calendar_request=original_calendar_request,
        pending_option_groups=pending_option_groups,
        pending_warning=pending_warning,
        persist_recreated_occurrence_details=persist_recreated_occurrence_details,
        presenter_co_organizers=presenter_co_organizers,
        publish_teams_calendar_attendees=publish_teams_calendar_attendees,
        record_graph_failure=record_graph_failure,
        record_reconcile=record_reconcile,
        refresh_standalone_occurrence_options=refresh_standalone_occurrence_options,
        remaining_pending=remaining_pending,
        replace_live_session_occurrences=replace_live_session_occurrences,
        reported_failure=reported_failure,
        roles_changed=roles_changed,
        same_schedule=same_schedule,
        save_weekday_calendar=save_weekday_calendar,
        saved_live_session_occurrences=saved_live_session_occurrences,
        saved_meeting_options=saved_meeting_options,
        schedule_request=curriculum_teams_meeting_schedule,
        sessions_a_rewrite_would_drop=sessions_a_rewrite_would_drop,
        stored_calendar_series=stored_calendar_series,
        targets_snapshot=targets_snapshot,
        teams_attendee_emails=teams_attendee_emails,
        teams_calendar_subject=teams_calendar_subject,
        teams_meeting_default_organizer=teams_meeting_default_organizer,
        teams_newly_invited=teams_newly_invited,
        teams_non_delivery_reason=teams_non_delivery_reason,
        teams_schedule_settings=teams_schedule_settings,
        teams_series_email_list=teams_series_email_list,
        teams_shifted_occurrence_targets=teams_shifted_occurrence_targets,
        teams_warning_sentence=teams_warning_sentence,
        unresolved_saved_bindings=unresolved_saved_bindings,
        update_authoring_rows=update_authoring_rows,
        urllib_parse=urllib_parse,
        verify_teams_calendar_with_standalones=verify_teams_calendar_with_standalones,
        with_schedule_change_notice=with_schedule_change_notice,
        without_missing=without_missing,
        prune_study_week_fillers=prune_study_week_fillers,
        teams_module_session_limit=teams_module_session_limit,
    )


def curriculum_teams_meeting_off_schedule_runs(request, live_session_id):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.api.calendar import curriculum_teams_meeting_off_schedule_runs as implementation
    from curriculum_api.teams_calendar_integrity import off_schedule_runs, read_events
    return implementation(
        request,
        live_session_id,
        JsonResponse=JsonResponse,
        LIVE_SESSIONS_TABLE=LIVE_SESSIONS_TABLE,
        LIVE_SESSION_OCCURRENCES_TABLE=LIVE_SESSION_OCCURRENCES_TABLE,
        authoring_fetch_all=authoring_fetch_all,
        clean_str=clean_str,
        graph_timezone_iana=graph_timezone_iana,
        json_error=json_error,
        off_schedule_runs=off_schedule_runs,
        read_events=read_events,
        teams_schedule_settings=teams_schedule_settings,
    )


@require_GET
def curriculum_teams_meeting_summary(request):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.api.calendar import curriculum_teams_meeting_summary as implementation
    return implementation(
        request,
        LIVE_SESSIONS_TABLE=LIVE_SESSIONS_TABLE,
        LIVE_SESSION_OCCURRENCES_TABLE=LIVE_SESSION_OCCURRENCES_TABLE,
        TEAMS_OFF_CALENDAR_OCCURRENCE_STATUSES=TEAMS_OFF_CALENDAR_OCCURRENCE_STATUSES,
        authoring_fetch_all=authoring_fetch_all,
        clean_str=clean_str,
        curriculum_in_clause=curriculum_in_clause,
        curriculum_results_response=curriculum_results_response,
        datetime=datetime,
        defaultdict=defaultdict,
        ensure_live_session_tracking_tables=ensure_live_session_tracking_tables,
        graph_timezone_iana=graph_timezone_iana,
        logger=logger,
        microsoft_update_summary=microsoft_update_summary,
        parse_graph_datetime=parse_graph_datetime,
        parse_int=parse_int,
        parse_json_value=parse_json_value,
        stored_calendar_series=stored_calendar_series,
        teams_calendar_sync_verdict=teams_calendar_sync_verdict,
        teams_calendar_sync_verdicts=teams_calendar_sync_verdicts,
        teams_schedule_settings=teams_schedule_settings,
        teams_series_email_list=teams_series_email_list,
        utc_iso_value=utc_iso_value,
    )
