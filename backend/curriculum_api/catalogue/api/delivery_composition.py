"""Concrete catalogue / api / delivery composition capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""
from curriculum_api.catalogue.api.adapters import curriculum_collection_response
from curriculum_api.catalogue.api.adapters import request_bypasses_curriculum_cache
from curriculum_api.catalogue.api.responses import curriculum_visibility
from curriculum_api.catalogue.api.responses import json_body
from curriculum_api.catalogue.api.responses import json_error
from curriculum_api.catalogue.api.structure_composition import get_authoring_structure_payload
from curriculum_api.catalogue.api.structure_composition import get_authoring_structure_payloads
from curriculum_api.catalogue.domain.archive_values import archive_stamp_fields
from curriculum_api.catalogue.domain.hierarchy_values import matches_curriculum_identifier
from curriculum_api.catalogue.domain.read_contracts import CANONICAL_MODULE_ID_PATTERN
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.domain.values import normalise
from curriculum_api.catalogue.domain.values import unique
from curriculum_api.catalogue.infrastructure.authoring_runtime import authoring_fetch_all
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import COHORT_AUTHORING_DETAILS_TABLE
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import GROUPS_TABLE
from curriculum_api.catalogue.infrastructure.cache_access import cached_curriculum_value
from curriculum_api.catalogue.infrastructure.cache_composition import structure_payloads_cache_key
from curriculum_api.catalogue.infrastructure.cache_runtime import curriculum_read_scope
from curriculum_api.catalogue.infrastructure.catalogue_resolution import authoring_module_exists
from curriculum_api.catalogue.infrastructure.catalogue_resolution import resolve_stored_module_catalogue_id
from curriculum_api.catalogue.infrastructure.catalogue_sources import active_learner_delivery_counts
from curriculum_api.catalogue.infrastructure.catalogue_sources import get_holiday_rows_safe
from curriculum_api.catalogue.infrastructure.cohort_calendar_composition import archived_cohort_payload
from curriculum_api.catalogue.infrastructure.cohort_calendar_composition import build_cohorts_and_groups
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_MODULES_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import CURRICULUM_SCHEMA
from curriculum_api.catalogue.infrastructure.lifecycle_runtime import archived_authoring_rows
from curriculum_api.catalogue.infrastructure.lifecycle_runtime import curriculum_row_effectively_deleted
from curriculum_api.catalogue.infrastructure.lifecycle_runtime import module_authoring_row_is_archived
from curriculum_api.catalogue.infrastructure.runtime_config import logger
from django.db import connection
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.gzip import gzip_page
from django.views.decorators.http import require_GET


def delivery_scope_lists(request):
    from curriculum_api.catalogue.api.delivery_scope import delivery_scope_lists as implementation
    return implementation(
        request, build_cohorts_and_groups=build_cohorts_and_groups,
        cached_curriculum_value=cached_curriculum_value, curriculum_read_scope=curriculum_read_scope,
        curriculum_visibility=curriculum_visibility,
        request_bypasses_curriculum_cache=request_bypasses_curriculum_cache,
    )


@gzip_page
@require_GET
def curriculum_delivery_scope(request):
    return JsonResponse(delivery_scope_lists(request))


@csrf_exempt

def curriculum_module_structure_resolve(request):
    from curriculum_api.catalogue.api.module_reads import curriculum_module_structure_resolve as read
    from curriculum_api.catalogue.application.structure_resolution import resolve_module_structures
    from curriculum_api.catalogue.infrastructure.resolution_candidates import read_resolution_candidates

    def read_candidates(requested_values):
        return read_resolution_candidates(
            requested_values,
            AUTHORING_MODULES_TABLE=AUTHORING_MODULES_TABLE,
            authoring_fetch_all=authoring_fetch_all,
            clean_str=clean_str,
            database_vendor=lambda: connection.vendor,
            normalise=normalise,
            unique=unique,
        )

    def resolve(requested_modules):
        return resolve_module_structures(
            requested_modules,
            CANONICAL_MODULE_ID_PATTERN=CANONICAL_MODULE_ID_PATTERN,
            cached_curriculum_value=cached_curriculum_value,
            clean_str=clean_str,
            get_authoring_structure_payloads=get_authoring_structure_payloads,
            logger=logger,
            module_authoring_row_is_archived=module_authoring_row_is_archived,
            normalise=normalise,
            read_resolution_candidates=read_candidates,
            structure_payloads_cache_key=structure_payloads_cache_key,
            unique=unique,
        )

    return read(
        request,
        JsonResponse=JsonResponse,
        json_body=json_body,
        json_error=json_error,
        resolve_module_structures=resolve,
    )


@require_GET
def curriculum_groups(request):
    from curriculum_api.catalogue.api.group_commands import curriculum_groups as implementation
    return implementation(
        request,
        CURRICULUM_SCHEMA=CURRICULUM_SCHEMA,
        curriculum_collection_response=curriculum_collection_response,
        delivery_scope_lists=delivery_scope_lists,
        matches_curriculum_identifier=matches_curriculum_identifier,
    )


@require_GET
def curriculum_archived_cohorts(request):
    from curriculum_api.catalogue.api.archive_reads import curriculum_archived_cohorts as query
    return query(
        request, COHORT_AUTHORING_DETAILS_TABLE=COHORT_AUTHORING_DETAILS_TABLE,
        CURRICULUM_SCHEMA=CURRICULUM_SCHEMA, GROUPS_TABLE=GROUPS_TABLE, JsonResponse=JsonResponse,
        active_learner_delivery_counts=active_learner_delivery_counts,
        archived_authoring_rows=archived_authoring_rows, archived_cohort_payload=archived_cohort_payload,
        clean_str=clean_str, get_holiday_rows_safe=get_holiday_rows_safe,
    )


@require_GET
def curriculum_archived_module_structure(request, module_catalogue_id):
    from curriculum_api.catalogue.api.archive_reads import curriculum_archived_module_structure as query
    return query(
        request, module_catalogue_id, JsonResponse=JsonResponse, archive_stamp_fields=archive_stamp_fields,
        authoring_module_exists=authoring_module_exists, clean_str=clean_str,
        curriculum_read_scope=curriculum_read_scope,
        curriculum_row_effectively_deleted=curriculum_row_effectively_deleted,
        get_authoring_structure_payload=get_authoring_structure_payload, json_error=json_error,
        logger=logger, resolve_stored_module_catalogue_id=resolve_stored_module_catalogue_id,
    )
