"""Concrete catalogue free course composition bindings.

Owns HTTP/decorator and runtime capability composition. Application operations,
domain policies, SQL and transaction behavior remain in their existing owners.
Public signatures and response contracts are unchanged."""
from curriculum_api.catalogue.infrastructure import free_course_rows as free_course_catalogue
from curriculum_api import schema_compat
from curriculum_api import versioning
from curriculum_api.catalogue.api.adapters import request_bypasses_curriculum_cache
from curriculum_api.catalogue.api.authoring_composition import delete_module_authoring_structure
from curriculum_api.catalogue.api.authoring_errors import StaleModuleStructureWrite
from curriculum_api.catalogue.api.cache_lifecycle import invalidate_curriculum_cache
from curriculum_api.catalogue.api.programme_command_composition import save_tree_group_modules
from curriculum_api.catalogue.api.responses import json_body
from curriculum_api.catalogue.api.responses import json_error
from curriculum_api.catalogue.api.structure_composition import get_authoring_structure_payload
from curriculum_api.catalogue.domain.content_validation import active_components_payload
from curriculum_api.catalogue.domain.content_values import active_component_rows
from curriculum_api.catalogue.domain.content_values import component_expected_otjh_minutes
from curriculum_api.catalogue.domain.content_values import otjh_hours_from_minutes
from curriculum_api.catalogue.domain.read_contracts import FREE_PROGRAMME_COMPONENTS_TABLE
from curriculum_api.catalogue.domain.read_contracts import MODULE_TEAMS_CALENDAR_BLOCKS_ARCHIVE
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.domain.values import parse_date
from curriculum_api.catalogue.infrastructure.authoring_storage import authoring_upsert
from curriculum_api.catalogue.infrastructure.cache_access import cached_curriculum_value
from curriculum_api.catalogue.infrastructure.cohort_calendar_composition import serialize_cohort_authoring_detail
from curriculum_api.catalogue.infrastructure.content_runtime import _free_module_response_to_input
from curriculum_api.catalogue.infrastructure.content_runtime import _scrub_free_course_learner_assignments
from curriculum_api.catalogue.infrastructure.content_runtime import build_free_course_week_structure
from curriculum_api.catalogue.infrastructure.content_runtime import build_module_free_course_weeks
from curriculum_api.catalogue.infrastructure.content_runtime import free_programme_component_payload
from curriculum_api.catalogue.infrastructure.content_runtime import free_programme_week_payload
from curriculum_api.catalogue.infrastructure.course_schema_runtime import FREE_COURSES_TABLE
from curriculum_api.catalogue.infrastructure.course_schema_runtime import FREE_PROGRAMME_MODULES_TABLE
from curriculum_api.catalogue.infrastructure.cover_image_storage import stored_module_cover_image
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_WEEKS_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import CURRICULUM_SCHEMA
from curriculum_api.catalogue.infrastructure.free_course_persistence import free_programme_fetch_all
from curriculum_api.catalogue.infrastructure.free_course_persistence import free_programme_module_id
from curriculum_api.catalogue.infrastructure.free_course_persistence import free_programme_owned_ids
from curriculum_api.catalogue.infrastructure.free_course_persistence import free_programme_upsert
from curriculum_api.catalogue.infrastructure.hierarchy_persistence import repair_curriculum_parent_links
from curriculum_api.catalogue.infrastructure.placement_runtime import curriculum_cohort_from_authoring_detail
from curriculum_api.catalogue.infrastructure.placement_runtime import curriculum_group_from_authoring_detail
from curriculum_api.catalogue.infrastructure.placement_runtime import resolve_cohort_row
from curriculum_api.catalogue.infrastructure.placement_runtime import resolve_group_row
from curriculum_api.catalogue.infrastructure.placement_runtime import serialize_group_authoring_detail
from curriculum_api.catalogue.infrastructure.record_identity import free_programme_course_id
from curriculum_api.catalogue.infrastructure.record_identity import unique_timestamp_prefixed_id
from curriculum_api.catalogue.infrastructure.row_queries import json_db_value
from curriculum_api.catalogue.infrastructure.runtime_config import logger
from curriculum_api.catalogue.infrastructure.structure_runtime import free_programme_module_response
from curriculum_api.catalogue.infrastructure.write_composition import authoring_delete
from curriculum_api.catalogue.infrastructure.write_composition import free_programme_delete
from curriculum_api.catalogue.infrastructure.free_course_catalogue_store import FreeCourseInUse
from curriculum_api.catalogue.infrastructure.free_course_writer_mode import LEGACY
from curriculum_api.catalogue.infrastructure.free_course_writer_mode import require_mode
from curriculum_api.http_cache import conditional_json_response
from curriculum_api.http_cache import encode_json_entry
from curriculum_api.meetings.api.adapters import module_future_teams_sessions
from django.db import transaction
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_protect
from learner_api.constants import ACCESS_CURRICULUM
from learner_api.constants import ACCESS_FREE_COURSE_AUTHORING
from login.permissions import require_access
from login.permissions import require_all_access
import re


def get_free_programme_modules_payload(programme_id):
    from curriculum_api.catalogue.application.content_preparation import get_free_programme_modules_payload as implementation

    def adopted_courses(*args, **kwargs):
        from curriculum_api.legacy_free_course_adoption import adopted_courses as capability
        return capability(*args, **kwargs)
    return implementation(
        programme_id,
        FREE_COURSES_TABLE=FREE_COURSES_TABLE,
        FREE_PROGRAMME_COMPONENTS_TABLE=FREE_PROGRAMME_COMPONENTS_TABLE,
        FREE_PROGRAMME_MODULES_TABLE=FREE_PROGRAMME_MODULES_TABLE,
        active_component_rows=active_component_rows,
        adopted_courses=adopted_courses,
        free_course_catalogue=free_course_catalogue,
        free_programme_module_response=free_programme_module_response,
    )


def delete_free_programme_data(programme_id):
    from curriculum_api.catalogue.application.free_programme_commands import delete_free_programme_data as implementation
    def adopted_courses(*args, **kwargs):
        from curriculum_api.legacy_free_course_adoption import adopted_courses as operation
        return operation(*args, **kwargs)
    return implementation(
        programme_id,
        AUTHORING_WEEKS_TABLE=AUTHORING_WEEKS_TABLE,
        CURRICULUM_SCHEMA=CURRICULUM_SCHEMA,
        FREE_COURSES_TABLE=FREE_COURSES_TABLE,
        FREE_PROGRAMME_COMPONENTS_TABLE=FREE_PROGRAMME_COMPONENTS_TABLE,
        FREE_PROGRAMME_MODULES_TABLE=FREE_PROGRAMME_MODULES_TABLE,
        LEGACY=LEGACY,
        adopted_courses=adopted_courses,
        authoring_delete=authoring_delete,
        clean_str=clean_str,
        free_programme_delete=free_programme_delete,
        free_programme_fetch_all=free_programme_fetch_all,
        free_programme_owned_ids=free_programme_owned_ids,
        logger=logger,
        require_mode=require_mode,
        schema_compat=schema_compat,
    )


def save_free_programme_modules(programme_id, payload):
    from curriculum_api.catalogue.application.free_programme_commands import save_free_programme_modules as implementation
    def adopted_courses(*args, **kwargs):
        from curriculum_api.legacy_free_course_adoption import adopted_courses as operation
        return operation(*args, **kwargs)
    def load_free_course_catalogue_store():
        from curriculum_api.catalogue.infrastructure import free_course_catalogue_store as operation
        return operation
    return implementation(
        programme_id, payload,
        AUTHORING_WEEKS_TABLE=AUTHORING_WEEKS_TABLE,
        CURRICULUM_SCHEMA=CURRICULUM_SCHEMA,
        FREE_COURSES_TABLE=FREE_COURSES_TABLE,
        FREE_PROGRAMME_COMPONENTS_TABLE=FREE_PROGRAMME_COMPONENTS_TABLE,
        FREE_PROGRAMME_MODULES_TABLE=FREE_PROGRAMME_MODULES_TABLE,
        LEGACY=LEGACY,
        active_components_payload=active_components_payload,
        adopted_courses=adopted_courses,
        authoring_delete=authoring_delete,
        authoring_upsert=authoring_upsert,
        clean_str=clean_str,
        component_expected_otjh_minutes=component_expected_otjh_minutes,
        delete_free_programme_data=delete_free_programme_data,
        free_programme_component_payload=free_programme_component_payload,
        free_programme_course_id=free_programme_course_id,
        free_programme_module_id=free_programme_module_id,
        free_programme_upsert=free_programme_upsert,
        free_programme_week_payload=free_programme_week_payload,
        get_free_programme_modules_payload=get_free_programme_modules_payload,
        invalidate_curriculum_cache=invalidate_curriculum_cache,
        json_db_value=json_db_value,
        load_free_course_catalogue_store=load_free_course_catalogue_store,
        otjh_hours_from_minutes=otjh_hours_from_minutes,
        require_mode=require_mode,
        schema_compat=schema_compat,
        stored_module_cover_image=stored_module_cover_image,
        transaction=transaction,
    )


@require_all_access(ACCESS_CURRICULUM, ACCESS_FREE_COURSE_AUTHORING)
def _legacy_free_writer_access(request):
    return None


@csrf_protect
@require_access(ACCESS_CURRICULUM)
def curriculum_free_programme_modules(request, programme_id):
    from curriculum_api.catalogue.api.free_programme_commands import curriculum_free_programme_modules as implementation
    return implementation(
        request, programme_id,
        FreeCourseInUse=FreeCourseInUse,
        JsonResponse=JsonResponse,
        _legacy_free_writer_access=_legacy_free_writer_access,
        cached_curriculum_value=cached_curriculum_value,
        clean_str=clean_str,
        conditional_json_response=conditional_json_response,
        encode_json_entry=encode_json_entry,
        get_free_programme_modules_payload=get_free_programme_modules_payload,
        json_body=json_body,
        json_error=json_error,
        logger=logger,
        request_bypasses_curriculum_cache=request_bypasses_curriculum_cache,
        save_free_programme_modules=save_free_programme_modules,
    )


def _delete_single_free_course_rows(course_id):
    from curriculum_api.catalogue.application.free_programme_commands import _delete_single_free_course_rows as implementation
    def load_free_course_catalogue_store():
        from curriculum_api.catalogue.infrastructure import free_course_catalogue_store as operation
        return operation
    return implementation(
        course_id,
        AUTHORING_WEEKS_TABLE=AUTHORING_WEEKS_TABLE,
        FREE_COURSES_TABLE=FREE_COURSES_TABLE,
        FREE_PROGRAMME_COMPONENTS_TABLE=FREE_PROGRAMME_COMPONENTS_TABLE,
        FREE_PROGRAMME_MODULES_TABLE=FREE_PROGRAMME_MODULES_TABLE,
        authoring_delete=authoring_delete,
        clean_str=clean_str,
        free_programme_delete=free_programme_delete,
        free_programme_fetch_all=free_programme_fetch_all,
        load_free_course_catalogue_store=load_free_course_catalogue_store,
    )


def inject_free_course_into_group(
    course_id,
    group_id,
    *,
    free_programme_id='FREE-COURSES',
    mode='clone',
    start_date=None,
    end_date=None,
):
    from curriculum_api.catalogue.application.free_programme_commands import inject_free_course_into_group as implementation
    return implementation(
        course_id, group_id, free_programme_id=free_programme_id, mode=mode, start_date=start_date, end_date=end_date,
        _delete_single_free_course_rows=_delete_single_free_course_rows,
        _scrub_free_course_learner_assignments=_scrub_free_course_learner_assignments,
        build_free_course_week_structure=build_free_course_week_structure,
        clean_str=clean_str,
        curriculum_cohort_from_authoring_detail=curriculum_cohort_from_authoring_detail,
        curriculum_group_from_authoring_detail=curriculum_group_from_authoring_detail,
        get_free_programme_modules_payload=get_free_programme_modules_payload,
        invalidate_curriculum_cache=invalidate_curriculum_cache,
        parse_date=parse_date,
        re=re,
        repair_curriculum_parent_links=repair_curriculum_parent_links,
        resolve_cohort_row=resolve_cohort_row,
        resolve_group_row=resolve_group_row,
        save_tree_group_modules=save_tree_group_modules,
        serialize_cohort_authoring_detail=serialize_cohort_authoring_detail,
        serialize_group_authoring_detail=serialize_group_authoring_detail,
        transaction=transaction,
        versioning=versioning,
    )


@csrf_protect
@require_all_access(ACCESS_CURRICULUM, ACCESS_FREE_COURSE_AUTHORING)
def curriculum_free_programme_convert(request, programme_id):
    from curriculum_api.catalogue.api.free_programme_commands import curriculum_free_programme_convert as implementation
    return implementation(
        request, programme_id,
        FreeCourseInUse=FreeCourseInUse,
        JsonResponse=JsonResponse,
        StaleModuleStructureWrite=StaleModuleStructureWrite,
        clean_str=clean_str,
        inject_free_course_into_group=inject_free_course_into_group,
        json_body=json_body,
        json_error=json_error,
        logger=logger,
    )


def convert_module_to_free_course(module_catalogue_id, *, free_programme_id='FREE-COURSES', mode='clone'):
    from curriculum_api.catalogue.application.free_programme_commands import convert_module_to_free_course as implementation
    return implementation(
        module_catalogue_id, free_programme_id=free_programme_id, mode=mode,
        MODULE_TEAMS_CALENDAR_BLOCKS_ARCHIVE=MODULE_TEAMS_CALENDAR_BLOCKS_ARCHIVE,
        _free_module_response_to_input=_free_module_response_to_input,
        build_module_free_course_weeks=build_module_free_course_weeks,
        clean_str=clean_str,
        delete_module_authoring_structure=delete_module_authoring_structure,
        get_authoring_structure_payload=get_authoring_structure_payload,
        get_free_programme_modules_payload=get_free_programme_modules_payload,
        invalidate_curriculum_cache=invalidate_curriculum_cache,
        module_future_teams_sessions=module_future_teams_sessions,
        save_free_programme_modules=save_free_programme_modules,
        transaction=transaction,
        unique_timestamp_prefixed_id=unique_timestamp_prefixed_id,
        versioning=versioning,
    )


@csrf_protect
@require_all_access(ACCESS_CURRICULUM, ACCESS_FREE_COURSE_AUTHORING)
def curriculum_free_programme_import_module(request, programme_id):
    from curriculum_api.catalogue.api.free_programme_commands import curriculum_free_programme_import_module as implementation
    return implementation(
        request, programme_id,
        FreeCourseInUse=FreeCourseInUse,
        JsonResponse=JsonResponse,
        clean_str=clean_str,
        convert_module_to_free_course=convert_module_to_free_course,
        json_body=json_body,
        json_error=json_error,
        logger=logger,
    )
