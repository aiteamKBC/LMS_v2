"""Concrete meetings module link composition bindings.

Owns HTTP/decorator and runtime capability composition. Application operations,
domain policies, SQL and transaction behavior remain in their existing owners.
Public signatures and response contracts are unchanged."""
from collections import defaultdict
from curriculum_api import archive_state
from curriculum_api.catalogue.api.adapters import request_bypasses_curriculum_cache
from curriculum_api.catalogue.api.cache_lifecycle import invalidate_curriculum_cache
from curriculum_api.catalogue.api.query_adapters import archived_programme_module_edit_error
from curriculum_api.catalogue.api.responses import json_body
from curriculum_api.catalogue.api.responses import json_error
from curriculum_api.catalogue.api.structure_composition import get_authoring_structure_payload
from curriculum_api.catalogue.domain.archive_policy import active_week_rows
from curriculum_api.catalogue.domain.component_policy import component_builder_settings
from curriculum_api.catalogue.domain.content_validation import frontend_component_type
from curriculum_api.catalogue.domain.content_validation import http_url
from curriculum_api.catalogue.domain.content_values import active_component_rows
from curriculum_api.catalogue.domain.delivery_values import delivery_days_per_week
from curriculum_api.catalogue.domain.delivery_values import module_session_clock
from curriculum_api.catalogue.domain.delivery_values import module_stored_session_count
from curriculum_api.catalogue.domain.read_contracts import STRUCTURE_REVISION_UNAVAILABLE
from curriculum_api.catalogue.domain.values import as_json_value
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.domain.values import format_date
from curriculum_api.catalogue.domain.values import parse_int
from curriculum_api.catalogue.domain.values import parse_json_value
from curriculum_api.catalogue.domain.values import truthy
from curriculum_api.catalogue.domain.values import unique
from curriculum_api.catalogue.infrastructure.authoring_runtime import authoring_fetch_all
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import GROUPS_TABLE
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import ensure_module_authoring_tables
from curriculum_api.catalogue.infrastructure.authoring_storage import authoring_upsert
from curriculum_api.catalogue.infrastructure.authoring_storage import update_authoring_rows
from curriculum_api.catalogue.infrastructure.cache_access import cached_curriculum_value
from curriculum_api.catalogue.infrastructure.cache_runtime import curriculum_read_scope
from curriculum_api.catalogue.infrastructure.calendar_runtime import calendar_clock_to_utc_iso
from curriculum_api.catalogue.infrastructure.catalogue_resolution import authoring_module_exists
from curriculum_api.catalogue.infrastructure.catalogue_resolution import resolve_stored_module_catalogue_id
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_COMPONENTS_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_MODULES_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_WEEKS_TABLE
from curriculum_api.catalogue.infrastructure.revision_runtime import lock_module_structure_row
from curriculum_api.catalogue.infrastructure.revision_runtime import module_structure_revision
from curriculum_api.catalogue.infrastructure.revision_runtime import stamp_revision_after_write
from curriculum_api.catalogue.infrastructure.revision_runtime import structure_payload_with_revision
from curriculum_api.catalogue.infrastructure.row_queries import json_db_value
from curriculum_api.catalogue.infrastructure.runtime_config import logger
from curriculum_api.catalogue.infrastructure.session_plan_composition import module_week_delivery_slots
from curriculum_api.catalogue.infrastructure.session_plan_composition import module_week_session_plan
from curriculum_api.catalogue.infrastructure.structure_runtime import module_structure_uses_session_rows
from curriculum_api.meetings.api.adapters import live_occurrence_component_settings
from curriculum_api.meetings.api.adapters import live_session_row_to_component_settings
from curriculum_api.meetings.api.adapters import occurrence_local_date
from curriculum_api.meetings.api.time_serialization import utc_iso_value
from curriculum_api.meetings.domain.instants import parse_graph_datetime
from curriculum_api.meetings.domain.read_contracts import LIVE_SESSIONS_TABLE
from curriculum_api.meetings.domain.read_contracts import LIVE_SESSION_MEETING_SCOPE_KEY
from curriculum_api.meetings.domain.read_contracts import LIVE_SESSION_OCCURRENCES_TABLE
from curriculum_api.meetings.infrastructure.calendar_runtime import active_teams_series_for_join_link
from curriculum_api.meetings.infrastructure.calendar_runtime import graph_timezone_iana
from curriculum_api.meetings.infrastructure.calendar_runtime import module_has_active_teams_series
from curriculum_api.meetings.infrastructure.calendar_runtime import module_has_booked_series
from curriculum_api.meetings.infrastructure.calendar_runtime import strip_shared_teams_delivery_settings
from curriculum_api.meetings.infrastructure.session_runtime import live_session_component_points
from curriculum_api.meetings.infrastructure.session_runtime import live_session_meeting_scope
from curriculum_api.meetings.infrastructure.session_runtime import replaceable_live_session
from curriculum_api.meetings.infrastructure.tracking_runtime import ensure_live_session_tracking_tables
from curriculum_api.schema_gate import SchemaNotProvisioned
from curriculum_api.teams_weekly_calendar import stored_calendar_series
from datetime import datetime
from datetime import timezone
from django.db import transaction
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET
from learner_api.models import LearnerProfile
from learner_api.models import LearnerTrainingPlanModule
from zoneinfo import ZoneInfo
import uuid


def attach_teams_meeting_to_module_weeks(module_catalogue_id, series_row, series_settings, occurrence_rows, *, create_missing=False, dry_run=False, unresolved_components=None):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.application.attachment import attach_teams_meeting_to_module_weeks as implementation
    from curriculum_api.teams_external_calendar import external_calendar_settings
    return implementation(
        module_catalogue_id,
        series_row,
        series_settings,
        occurrence_rows,
        create_missing=create_missing,
        dry_run=dry_run,
        unresolved_components=unresolved_components,
        AUTHORING_COMPONENTS_TABLE=AUTHORING_COMPONENTS_TABLE,
        AUTHORING_MODULES_TABLE=AUTHORING_MODULES_TABLE,
        AUTHORING_WEEKS_TABLE=AUTHORING_WEEKS_TABLE,
        GROUPS_TABLE=GROUPS_TABLE,
        LIVE_SESSION_MEETING_SCOPE_KEY=LIVE_SESSION_MEETING_SCOPE_KEY,
        ZoneInfo=ZoneInfo,
        active_component_rows=active_component_rows,
        active_week_rows=active_week_rows,
        archive_state=archive_state,
        authoring_fetch_all=authoring_fetch_all,
        authoring_upsert=authoring_upsert,
        calendar_clock_to_utc_iso=calendar_clock_to_utc_iso,
        clean_str=clean_str,
        component_builder_settings=component_builder_settings,
        datetime=datetime,
        defaultdict=defaultdict,
        delivery_days_per_week=delivery_days_per_week,
        external_calendar_settings=external_calendar_settings,
        format_date=format_date,
        frontend_component_type=frontend_component_type,
        graph_timezone_iana=graph_timezone_iana,
        invalidate_curriculum_cache=invalidate_curriculum_cache,
        json_db_value=json_db_value,
        live_occurrence_component_settings=live_occurrence_component_settings,
        live_session_component_points=live_session_component_points,
        live_session_meeting_scope=live_session_meeting_scope,
        module_has_booked_series=module_has_booked_series,
        module_session_clock=module_session_clock,
        module_stored_session_count=module_stored_session_count,
        module_structure_uses_session_rows=module_structure_uses_session_rows,
        module_week_delivery_slots=module_week_delivery_slots,
        module_week_session_plan=module_week_session_plan,
        occurrence_local_date=occurrence_local_date,
        parse_graph_datetime=parse_graph_datetime,
        parse_int=parse_int,
        stored_calendar_series=stored_calendar_series,
        timezone=timezone,
        update_authoring_rows=update_authoring_rows,
        uuid=uuid,
    )


@csrf_exempt
def curriculum_module_teams_meeting_restore(request, module_catalogue_id):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.api.module_links import curriculum_module_teams_meeting_restore as implementation
    return implementation(
        request,
        module_catalogue_id,
        JsonResponse=JsonResponse,
        LIVE_SESSIONS_TABLE=LIVE_SESSIONS_TABLE,
        LIVE_SESSION_OCCURRENCES_TABLE=LIVE_SESSION_OCCURRENCES_TABLE,
        attach_teams_meeting_to_module_weeks=attach_teams_meeting_to_module_weeks,
        authoring_fetch_all=authoring_fetch_all,
        authoring_module_exists=authoring_module_exists,
        cached_curriculum_value=cached_curriculum_value,
        clean_str=clean_str,
        curriculum_read_scope=curriculum_read_scope,
        ensure_live_session_tracking_tables=ensure_live_session_tracking_tables,
        ensure_module_authoring_tables=ensure_module_authoring_tables,
        get_authoring_structure_payload=get_authoring_structure_payload,
        json_body=json_body,
        json_error=json_error,
        live_session_row_to_component_settings=live_session_row_to_component_settings,
        parse_graph_datetime=parse_graph_datetime,
        parse_json_value=parse_json_value,
        request_bypasses_curriculum_cache=request_bypasses_curriculum_cache,
        resolve_stored_module_catalogue_id=resolve_stored_module_catalogue_id,
        stamp_revision_after_write=stamp_revision_after_write,
        stored_calendar_series=stored_calendar_series,
        structure_payload_with_revision=structure_payload_with_revision,
        teams_module_owner_id=globals().get('teams_module_owner_id'),
        truthy=truthy,
        utc_iso_value=utc_iso_value,
    )


@csrf_exempt
def curriculum_module_teams_links_replace(request, module_catalogue_id):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.api.module_links import curriculum_module_teams_links_replace as implementation
    from curriculum_api.teams_external_calendar import manual_link_settings
    return implementation(
        request,
        module_catalogue_id,
        AUTHORING_COMPONENTS_TABLE=AUTHORING_COMPONENTS_TABLE,
        AUTHORING_MODULES_TABLE=AUTHORING_MODULES_TABLE,
        JsonResponse=JsonResponse,
        STRUCTURE_REVISION_UNAVAILABLE=STRUCTURE_REVISION_UNAVAILABLE,
        SchemaNotProvisioned=SchemaNotProvisioned,
        active_component_rows=active_component_rows,
        active_teams_series_for_join_link=active_teams_series_for_join_link,
        archived_programme_module_edit_error=archived_programme_module_edit_error,
        as_json_value=as_json_value,
        authoring_fetch_all=authoring_fetch_all,
        authoring_module_exists=authoring_module_exists,
        clean_str=clean_str,
        component_builder_settings=component_builder_settings,
        datetime=datetime,
        ensure_live_session_tracking_tables=ensure_live_session_tracking_tables,
        ensure_module_authoring_tables=ensure_module_authoring_tables,
        http_url=http_url,
        invalidate_curriculum_cache=invalidate_curriculum_cache,
        json_body=json_body,
        json_db_value=json_db_value,
        json_error=json_error,
        lock_module_structure_row=lock_module_structure_row,
        logger=logger,
        manual_link_settings=manual_link_settings,
        module_has_active_teams_series=module_has_active_teams_series,
        module_structure_revision=module_structure_revision,
        replaceable_live_session=replaceable_live_session,
        resolve_stored_module_catalogue_id=resolve_stored_module_catalogue_id,
        strip_shared_teams_delivery_settings=strip_shared_teams_delivery_settings,
        transaction=transaction,
        unique=unique,
        update_authoring_rows=update_authoring_rows,
    )


@require_GET
def curriculum_module_meeting_invitees(request, module_catalogue_id):
    """Compose normalized assignment reads without changing the invitation contract."""
    from curriculum_api.meetings.api.invitees import curriculum_module_meeting_invitees as implementation

    def read_sources(identifier):
        from curriculum_api.meetings.infrastructure.invitee_reads import module_invitee_sources
        return module_invitee_sources(
            identifier, authoring_fetch_all=authoring_fetch_all, AUTHORING_MODULES_TABLE=AUTHORING_MODULES_TABLE,
            LearnerTrainingPlanModule=LearnerTrainingPlanModule, LearnerProfile=LearnerProfile, clean_str=clean_str,
        )

    def read_invitees(identifier):
        from curriculum_api.meetings.application.invitee_queries import module_invitee_payload
        return module_invitee_payload(identifier, read_sources=read_sources, clean_str=clean_str)

    return implementation(request, module_catalogue_id, clean_str=clean_str, json_error=json_error,
                          JsonResponse=JsonResponse, read_invitees=read_invitees)
