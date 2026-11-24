"""Concrete catalogue / api / catalogue adapters capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""
from curriculum_api.catalogue.api.adapters import authoring_summary_catalogue_item
from curriculum_api.catalogue.api.responses import csv_param
from curriculum_api.catalogue.api.responses import json_error
from curriculum_api.catalogue.domain.archive_policy import programme_deleted_row
from curriculum_api.catalogue.domain.read_contracts import LIBRARY_PAGE_SIZE_DEFAULT
from curriculum_api.catalogue.domain.read_contracts import LIBRARY_PAGE_SIZE_MAX
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.domain.values import parse_int
from curriculum_api.catalogue.domain.values import truthy
from curriculum_api.catalogue.infrastructure.cache_runtime import curriculum_read_scope
from curriculum_api.catalogue.infrastructure.catalogue_enrichment import archived_module_payload
from curriculum_api.catalogue.infrastructure.catalogue_enrichment import library_component_rows
from curriculum_api.catalogue.infrastructure.catalogue_resolution import authoring_catalogue_summaries
from curriculum_api.catalogue.infrastructure.catalogue_sources import get_program_config_rows
from curriculum_api.catalogue.infrastructure.catalogue_sources import get_training_rows
from curriculum_api.catalogue.infrastructure.database_reads import CURRICULUM_SCHEMA
from curriculum_api.catalogue.infrastructure.hierarchy_composition import archived_programme_keys
from curriculum_api.catalogue.infrastructure.hierarchy_composition import authoring_programme_structure_counts
from curriculum_api.catalogue.infrastructure.hierarchy_composition import programme_structure_counts
from curriculum_api.catalogue.infrastructure.lifecycle_runtime import archived_module_component_counts
from curriculum_api.catalogue.infrastructure.lifecycle_runtime import archived_module_rows
from curriculum_api.catalogue.infrastructure.lifecycle_runtime import is_archived_module_summary
from curriculum_api.catalogue.infrastructure.placement_runtime import serialize_staff_profile
from curriculum_api.catalogue.infrastructure.runtime_config import logger
from curriculum_api.catalogue.infrastructure.structure_runtime import build_modules
from curriculum_api.catalogue.infrastructure.structure_runtime import get_module_rows
from curriculum_api.catalogue.infrastructure.structure_runtime import is_canonical_module_catalogue_id
from curriculum_api.course_pricing import API_FIELDS as COURSE_PRICING_FIELDS
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET


def build_staff_profiles(profile_rows, role, modules=None, groups=None):
    from curriculum_api.catalogue.application.staff_profiles import build_staff_profiles as query
    return query(
        profile_rows,
        role,
        modules,
        groups,
        build_modules=build_modules,
        enrich_modules_with_authoring=enrich_modules_with_authoring,
        get_module_rows=get_module_rows,
        get_program_config_rows=get_program_config_rows,
        get_training_rows=get_training_rows,
        serialize_staff_profile=serialize_staff_profile,
    )


@csrf_exempt
def curriculum_component_library(request):
    from curriculum_api.catalogue.api.module_reads import curriculum_component_library as read
    return read(
        request,
        CURRICULUM_SCHEMA=CURRICULUM_SCHEMA,
        JsonResponse=JsonResponse,
        LIBRARY_PAGE_SIZE_DEFAULT=LIBRARY_PAGE_SIZE_DEFAULT,
        LIBRARY_PAGE_SIZE_MAX=LIBRARY_PAGE_SIZE_MAX,
        csv_param=csv_param,
        json_error=json_error,
        library_component_rows=library_component_rows,
        logger=logger,
        parse_int=parse_int,
        truthy=truthy,
    )


def enrich_modules_with_authoring(modules, include_programme_deleted=False, include_content=True, *, list_only=False):
    from curriculum_api.catalogue.application.module_assembly import enrich_modules_with_authoring as query
    return query(
        modules,
        include_programme_deleted,
        include_content,
        list_only=list_only,
        COURSE_PRICING_FIELDS=COURSE_PRICING_FIELDS,
        authoring_catalogue_summaries=authoring_catalogue_summaries,
        authoring_summary_catalogue_item=authoring_summary_catalogue_item,
        is_canonical_module_catalogue_id=is_canonical_module_catalogue_id,
        logger=logger,
        programme_deleted_row=programme_deleted_row,
    )


def enrich_programmes_with_module_counts(programmes, modules, modules_enriched=False, include_archived=False, *, include_structure_counts=True):
    """Compatibility adapter for the catalogue programme read boundary."""
    from curriculum_api.catalogue.application.programme_enrichment import enrich_programmes_with_module_counts as query
    return query(
        programmes,
        modules,
        modules_enriched,
        include_archived,
        include_structure_counts=include_structure_counts,
        archived_programme_keys=archived_programme_keys,
        authoring_programme_structure_counts=authoring_programme_structure_counts,
        enrich_modules_with_authoring=enrich_modules_with_authoring,
        is_archived_module_summary=is_archived_module_summary,
        programme_structure_counts=programme_structure_counts,
    )


@require_GET
def curriculum_archived_modules(request):
    from curriculum_api.catalogue.api.archive_reads import curriculum_archived_modules as query
    return query(
        request, CURRICULUM_SCHEMA=CURRICULUM_SCHEMA, JsonResponse=JsonResponse,
        archived_module_component_counts=archived_module_component_counts,
        archived_module_payload=archived_module_payload, archived_module_rows=archived_module_rows,
        clean_str=clean_str, curriculum_read_scope=curriculum_read_scope,
    )
