"""Concrete catalogue / api / query adapters capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""
from curriculum_api.canonical_read_sql import module_expected_otjh_sql
from curriculum_api.catalogue.api.adapters import reference_json_response
from curriculum_api.catalogue.api.adapters import request_bypasses_curriculum_cache
from curriculum_api.catalogue.api.responses import json_error
from curriculum_api.catalogue.domain.archive_policy import programme_deleted_row
from curriculum_api.catalogue.domain.programme_values import is_archived_program_config
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.infrastructure.authoring_runtime import authoring_fetch_all
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import COHORT_AUTHORING_DETAILS_TABLE
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import GROUPS_TABLE
from curriculum_api.catalogue.infrastructure.cache_access import cached_curriculum_value
from curriculum_api.catalogue.infrastructure.catalogue_sources import active_learner_delivery_counts
from curriculum_api.catalogue.infrastructure.catalogue_sources import tutor_profile_for_identity
from curriculum_api.catalogue.infrastructure.content_runtime import component_source_inputs_fingerprint
from curriculum_api.catalogue.infrastructure.content_runtime import component_summary_rows
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_MODULES_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import CURRICULUM_SCHEMA
from curriculum_api.catalogue.infrastructure.database_reads import authoring_table_name
from curriculum_api.catalogue.infrastructure.database_reads import rows_as_dicts
from curriculum_api.catalogue.infrastructure.hierarchy_composition import archived_group_payload
from curriculum_api.catalogue.infrastructure.hierarchy_composition import authoring_programme_config_for_save
from curriculum_api.catalogue.infrastructure.lifecycle_runtime import archived_authoring_rows
from curriculum_api.catalogue.infrastructure.placement_runtime import staff_profile_assignment_ids
from curriculum_api.catalogue.infrastructure.placement_runtime import tutor_workspace_module_payload
from curriculum_api.catalogue.infrastructure.runtime_config import logger
from curriculum_api.catalogue.infrastructure.template_composition import week_template_record
from curriculum_api.http_cache import conditional_json_response
from curriculum_api.http_cache import encode_json_entry
from curriculum_api.meetings.infrastructure.tracking_queries import tutor_workspace_next_session_by_module
from curriculum_api.reporting.infrastructure.source_catalogue_runtime import build_skills_england_standards
from curriculum_api.reporting.infrastructure.source_catalogue_runtime import find_skills_england_standard
from django.db import connection
from django.http import JsonResponse
from django.views.decorators.http import require_GET
import hashlib


@require_GET
def curriculum_standards(request):
    from curriculum_api.catalogue.api.ksb_sources import curriculum_standards as read
    return read(request,
        CURRICULUM_SCHEMA=CURRICULUM_SCHEMA,
        build_skills_england_standards=build_skills_england_standards,
        cached_curriculum_value=cached_curriculum_value,
        reference_json_response=reference_json_response,
    )


@require_GET
def curriculum_standard_detail(request, identifier):
    from curriculum_api.catalogue.api.ksb_sources import curriculum_standard_detail as read
    return read(request, identifier,
        CURRICULUM_SCHEMA=CURRICULUM_SCHEMA,
        find_skills_england_standard=find_skills_england_standard,
        json_error=json_error,
        reference_json_response=reference_json_response,
    )


def archived_programme_module_edit_error(existing_module_row, *, title, programme_id, programme_name=''):
    from curriculum_api.catalogue.api.authoring_guards import archived_programme_module_edit_error as implementation
    return implementation(
        existing_module_row, title=title, programme_id=programme_id, programme_name=programme_name,
        authoring_programme_config_for_save=authoring_programme_config_for_save, clean_str=clean_str,
        is_archived_program_config=is_archived_program_config, json_error=json_error,
        programme_deleted_row=programme_deleted_row,
    )


@require_GET
def curriculum_component_summary(request):
    from curriculum_api.catalogue.api.content_commands import curriculum_component_summary as implementation
    return implementation(
        request,
        CURRICULUM_SCHEMA=CURRICULUM_SCHEMA,
        cached_curriculum_value=cached_curriculum_value,
        clean_str=clean_str,
        component_source_inputs_fingerprint=component_source_inputs_fingerprint,
        component_summary_rows=component_summary_rows,
        conditional_json_response=conditional_json_response,
        encode_json_entry=encode_json_entry,
        hashlib=hashlib,
        json_error=json_error,
        logger=logger,
        request_bypasses_curriculum_cache=request_bypasses_curriculum_cache,
    )


@require_GET
def curriculum_archived_groups(request):
    from curriculum_api.catalogue.api.archive_reads import curriculum_archived_groups as query
    return query(
        request, COHORT_AUTHORING_DETAILS_TABLE=COHORT_AUTHORING_DETAILS_TABLE,
        CURRICULUM_SCHEMA=CURRICULUM_SCHEMA, GROUPS_TABLE=GROUPS_TABLE, JsonResponse=JsonResponse,
        active_learner_delivery_counts=active_learner_delivery_counts,
        archived_authoring_rows=archived_authoring_rows, archived_group_payload=archived_group_payload,
        authoring_fetch_all=authoring_fetch_all, clean_str=clean_str,
    )


@require_GET
def curriculum_tutor_workspace(request):
    from curriculum_api.catalogue.api.tutor_workspace import curriculum_tutor_workspace as implementation
    from curriculum_api.catalogue.application.tutor_workspace import tutor_workspace_payload
    from curriculum_api.catalogue.infrastructure.workspace_reads import tutor_workspace_module_rows
    def read_modules(module_ids):
        return tutor_workspace_module_rows(
            module_ids, connection=connection, module_expected_otjh_sql=module_expected_otjh_sql,
            authoring_table_name=authoring_table_name, AUTHORING_MODULES_TABLE=AUTHORING_MODULES_TABLE,
            COHORT_AUTHORING_DETAILS_TABLE=COHORT_AUTHORING_DETAILS_TABLE, GROUPS_TABLE=GROUPS_TABLE,
            rows_as_dicts=rows_as_dicts, authoring_fetch_all=authoring_fetch_all,
        )
    def payload(email, name):
        return tutor_workspace_payload(
            email, name, tutor_profile_for_identity=tutor_profile_for_identity,
            staff_profile_assignment_ids=staff_profile_assignment_ids,
            tutor_workspace_next_session_by_module=tutor_workspace_next_session_by_module,
            read_module_rows=read_modules, tutor_workspace_module_payload=tutor_workspace_module_payload,
            clean_str=clean_str,
        )
    return implementation(request, clean_str=clean_str, json_error=json_error, JsonResponse=JsonResponse,
        tutor_workspace_payload=payload,
    )


def week_template_detail_response(template_id, wrapper_key='weekTemplate', *, after_write=False, **extra):
    record = week_template_record(template_id, after_write=after_write)
    if not record:
        return json_error('Week template not found.', status=404)
    payload = {'schema': CURRICULUM_SCHEMA, wrapper_key: record}
    payload.update(extra)
    return JsonResponse(payload)
