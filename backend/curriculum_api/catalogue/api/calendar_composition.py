"""Concrete catalogue / api / calendar composition capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""
from curriculum_api.catalogue.api.adapters import curriculum_results_response
from curriculum_api.catalogue.api.adapters import request_bypasses_curriculum_cache
from curriculum_api.catalogue.api.responses import curriculum_visibility
from curriculum_api.catalogue.api.responses import json_body
from curriculum_api.catalogue.api.responses import json_error
from curriculum_api.catalogue.application.staff_profiles import staff_user_profile_source
from curriculum_api.catalogue.application.tutor_availability import tutor_conflict_message
from curriculum_api.catalogue.domain.delivery_pattern import tutor_delivery_schedule
from curriculum_api.catalogue.domain.delivery_values import module_session_clock
from curriculum_api.catalogue.domain.delivery_values import module_stored_week_count
from curriculum_api.catalogue.domain.read_contracts import DEFAULT_SESSION_END_TIME
from curriculum_api.catalogue.domain.read_contracts import DEFAULT_SESSION_START_TIME
from curriculum_api.catalogue.domain.staff_identity import staff_assignment_key
from curriculum_api.catalogue.domain.staff_identity import staff_profile_is_archived
from curriculum_api.catalogue.domain.staff_identity import staff_profile_name
from curriculum_api.catalogue.domain.tutor_conflicts import module_time_window
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.domain.values import format_date
from curriculum_api.catalogue.domain.values import parse_date
from curriculum_api.catalogue.domain.values import parse_int
from curriculum_api.catalogue.domain.values import truthy
from curriculum_api.catalogue.domain.values import unique
from curriculum_api.catalogue.infrastructure.authoring_runtime import authoring_fetch_all
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import GROUPS_TABLE
from curriculum_api.catalogue.infrastructure.cache_access import cached_curriculum_value
from curriculum_api.catalogue.infrastructure.cache_runtime import curriculum_read_scope
from curriculum_api.catalogue.infrastructure.calendar_runtime import build_module_session_plan
from curriculum_api.catalogue.infrastructure.calendar_runtime import module_delivery_row
from curriculum_api.catalogue.infrastructure.calendar_runtime import module_schedule_view
from curriculum_api.catalogue.infrastructure.catalogue_resolution import resolve_stored_module_catalogue_id
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_MODULES_TABLE
from curriculum_api.catalogue.infrastructure.lifecycle_runtime import surviving_authoring_module_rows
from curriculum_api.catalogue.infrastructure.placement_runtime import fetch_group_row
from curriculum_api.catalogue.infrastructure.placement_runtime import fetch_staff_users_by_access
from curriculum_api.catalogue.infrastructure.runtime_config import GROUP_ROWS_ORDER
from curriculum_api.catalogue.infrastructure.runtime_config import logger
from curriculum_api.catalogue.infrastructure.session_plan_composition import module_delivery_session_plan
from curriculum_api.catalogue.infrastructure.session_plan_composition import module_session_dates
from curriculum_api.catalogue.infrastructure.session_plan_composition import module_session_plan_for_count
from curriculum_api.catalogue.infrastructure.session_plan_composition import module_session_plan_for_weeks
from curriculum_api.catalogue.infrastructure.tutor_availability_composition import find_tutor_schedule_conflicts
from curriculum_api.weekly_schedule import first_weekly_session_day
from curriculum_api.weekly_schedule import module_week_starts_on
from curriculum_api.weekly_schedule import module_weekly_schedule
from django.db import connections
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET


def read_programme_sessions(programme, visibility):
    from curriculum_api.catalogue.api.delivery_dashboard import build_calendar_snapshot
    return build_calendar_snapshot(visibility=visibility,
        programme_id=clean_str(programme.get('sourceId') or programme.get('id')))['sessions']


def build_curriculum_sessions(visibility='operational', force=False):
    """Read current authored sessions without legacy training-count generation."""
    from curriculum_api.catalogue.api.delivery_dashboard import build_calendar_snapshot
    return build_calendar_snapshot(visibility=visibility)['sessions']


def get_cached_sessions(request):
    from curriculum_api.catalogue.api.cached_reads import get_cached_sessions as query
    return query(
        request, build_curriculum_sessions=build_curriculum_sessions,
        cached_curriculum_value=cached_curriculum_value, curriculum_visibility=curriculum_visibility,
        request_bypasses_curriculum_cache=request_bypasses_curriculum_cache,
    )


@csrf_exempt
def curriculum_preview_module_session_plan(request):
    from curriculum_api.catalogue.api.calendar_editing import curriculum_preview_module_session_plan as implementation
    return implementation(
        request, JsonResponse=JsonResponse, build_module_session_plan=build_module_session_plan,
        first_weekly_session_day=first_weekly_session_day, json_body=json_body,
        json_error=json_error, module_delivery_session_plan=module_delivery_session_plan,
        module_schedule_view=module_schedule_view, module_session_clock=module_session_clock,
        module_week_starts_on=module_week_starts_on, module_weekly_schedule=module_weekly_schedule,
        parse_date=parse_date, parse_int=parse_int,
    )


@csrf_exempt
def curriculum_preview_tutor_availability(request):
    from curriculum_api.catalogue.api.calendar_editing import curriculum_preview_tutor_availability as implementation
    return implementation(
        request, AUTHORING_MODULES_TABLE=AUTHORING_MODULES_TABLE,
        DEFAULT_SESSION_END_TIME=DEFAULT_SESSION_END_TIME,
        DEFAULT_SESSION_START_TIME=DEFAULT_SESSION_START_TIME, GROUPS_TABLE=GROUPS_TABLE,
        GROUP_ROWS_ORDER=GROUP_ROWS_ORDER, JsonResponse=JsonResponse,
        authoring_fetch_all=authoring_fetch_all, clean_str=clean_str, connections=connections,
        curriculum_read_scope=curriculum_read_scope,
        fetch_staff_users_by_access=fetch_staff_users_by_access,
        find_tutor_schedule_conflicts=find_tutor_schedule_conflicts, json_body=json_body,
        json_error=json_error, logger=logger, module_schedule_view=module_schedule_view,
        module_session_dates=module_session_dates, module_time_window=module_time_window,
        module_week_starts_on=module_week_starts_on, module_weekly_schedule=module_weekly_schedule,
        resolve_stored_module_catalogue_id=resolve_stored_module_catalogue_id,
        staff_assignment_key=staff_assignment_key,
        staff_profile_is_archived=staff_profile_is_archived, staff_profile_name=staff_profile_name,
        staff_user_profile_source=staff_user_profile_source,
        surviving_authoring_module_rows=surviving_authoring_module_rows, truthy=truthy,
        tutor_conflict_message=tutor_conflict_message,
        tutor_delivery_schedule=tutor_delivery_schedule, unique=unique,
    )


@csrf_exempt
def curriculum_module_session_plan(request, module_catalogue_id):
    from curriculum_api.catalogue.api.module_reads import curriculum_module_session_plan as read
    return read(request, module_catalogue_id,
        AUTHORING_MODULES_TABLE=AUTHORING_MODULES_TABLE,
        JsonResponse=JsonResponse,
        authoring_fetch_all=authoring_fetch_all,
        clean_str=clean_str,
        fetch_group_row=fetch_group_row,
        format_date=format_date,
        json_error=json_error,
        logger=logger,
        module_delivery_row=module_delivery_row,
        module_session_plan_for_count=module_session_plan_for_count,
        module_session_plan_for_weeks=module_session_plan_for_weeks,
        module_stored_week_count=module_stored_week_count,
        parse_int=parse_int,
        resolve_stored_module_catalogue_id=resolve_stored_module_catalogue_id,
    )


def module_scoped_sessions(module_catalogue_id, *, visibility='operational'):
    from curriculum_api.catalogue.api.delivery_dashboard import build_calendar_snapshot
    return build_calendar_snapshot(module_ids=[clean_str(module_catalogue_id)], visibility=visibility)['sessions']


@require_GET
def curriculum_sessions(request):
    from curriculum_api.catalogue.application.overview import CurriculumOverviewUnavailable
    requested = clean_str(request.GET.get('module_catalogue_id') or request.GET.get('moduleCatalogueId'))
    visibility = curriculum_visibility(request)
    try:
        if requested:
            return curriculum_results_response(module_scoped_sessions(requested, visibility=visibility))
        if visibility == 'operational':
            from curriculum_api.catalogue.api.delivery_dashboard import calendar_sessions
            return calendar_sessions(request)
        return curriculum_results_response(get_cached_sessions(request))
    except CurriculumOverviewUnavailable:
        return JsonResponse({'error': 'The session calendar could not be loaded. Please try again.'}, status=503)


@csrf_exempt
def curriculum_session_collection(request):
    from curriculum_api.catalogue.api.calendar_editing import curriculum_session_collection as implementation
    return implementation(
        request, curriculum_sessions=curriculum_sessions, json_error=json_error,
    )
