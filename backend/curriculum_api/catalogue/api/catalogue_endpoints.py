"""Concrete catalogue catalogue endpoints bindings.

Owns HTTP/decorator and runtime capability composition. Application operations,
domain policies, SQL and transaction behavior remain in their existing owners.
Public signatures and response contracts are unchanged."""
from curriculum_api.catalogue.api.adapters import curriculum_collection_response
from curriculum_api.catalogue.api.adapters import request_bypasses_curriculum_cache
from curriculum_api.catalogue.api.catalogue_adapters import enrich_modules_with_authoring
from curriculum_api.catalogue.api.catalogue_adapters import enrich_programmes_with_module_counts
from curriculum_api.catalogue.api.overview_composition import build_curriculum_overview
from curriculum_api.catalogue.api.overview_composition import build_curriculum_payload
from curriculum_api.catalogue.api.overview_composition import build_curriculum_payload_from_rows
from curriculum_api.catalogue.api.responses import curriculum_visibility
from curriculum_api.catalogue.api.responses import json_error
from curriculum_api.catalogue.domain.archive_policy import programme_deleted_row
from curriculum_api.catalogue.domain.delivery_values import is_operational_training_row
from curriculum_api.catalogue.domain.hierarchy_dates import format_created_at
from curriculum_api.catalogue.domain.hierarchy_values import find_programme
from curriculum_api.catalogue.domain.programme_values import program_config_by_id
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.domain.values import normalise
from curriculum_api.catalogue.infrastructure.cache_access import cached_curriculum_value
from curriculum_api.catalogue.infrastructure.cache_runtime import curriculum_read_scope
from curriculum_api.catalogue.infrastructure.catalogue_sources import get_cached_curriculum_rows
from curriculum_api.catalogue.infrastructure.catalogue_sources import get_curriculum_rows
from curriculum_api.catalogue.infrastructure.catalogue_sources import programme_list_learner_counts
from curriculum_api.catalogue.infrastructure.catalogue_sources import programme_list_sources
from curriculum_api.catalogue.infrastructure.cohort_calendar_composition import home_source_rows
from curriculum_api.catalogue.infrastructure.database_reads import CURRICULUM_SCHEMA
from curriculum_api.catalogue.infrastructure.hierarchy_composition import authoring_programme_structure_counts
from curriculum_api.catalogue.infrastructure.hierarchy_composition import programme_list_needs_module_enrichment
from curriculum_api.catalogue.infrastructure.lifecycle_runtime import is_archived_module_summary
from curriculum_api.catalogue.infrastructure.placement_runtime import compact_module_list_rows
from curriculum_api.catalogue.infrastructure.programme_builder_runtime import build_programmes
from curriculum_api.catalogue.infrastructure.runtime_config import logger
from curriculum_api.catalogue.infrastructure.structure_runtime import authoring_modules_as_training_rows
from curriculum_api.catalogue.infrastructure.structure_runtime import compact_module_rows
from curriculum_api.catalogue.infrastructure.structure_runtime import home_programmes_need_enrichment
from django.conf import settings
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.gzip import gzip_page
from django.views.decorators.http import require_GET


@require_GET
def curriculum_overview(request):
    from curriculum_api.catalogue.api.overview import curriculum_overview as implementation
    return implementation(
        request,
        JsonResponse=JsonResponse, build_curriculum_overview=build_curriculum_overview, cached_curriculum_value=cached_curriculum_value,
        compact_module_rows=compact_module_rows, curriculum_visibility=curriculum_visibility, logger=logger,
        request_bypasses_curriculum_cache=request_bypasses_curriculum_cache, settings=settings,
    )


def get_cached_payload(request, compact=False):
    from curriculum_api.catalogue.api.cached_reads import get_cached_payload as query
    return query(
        request, compact, build_curriculum_payload=build_curriculum_payload,
        cached_curriculum_value=cached_curriculum_value, curriculum_visibility=curriculum_visibility,
        request_bypasses_curriculum_cache=request_bypasses_curriculum_cache,
    )


def rows_for_programme(identifier, visibility='all'):
    from curriculum_api.catalogue.application.hierarchy_queries import rows_for_programme as implementation
    return implementation(
        identifier,
        visibility,
        build_curriculum_payload_from_rows=build_curriculum_payload_from_rows,
        curriculum_read_scope=curriculum_read_scope,
        get_curriculum_rows=get_curriculum_rows,
        program_config_by_id=program_config_by_id,
    )


def programme_response(identifier):
    # force: this answers a caller that has just written and is asking for the
    # record it saved, so it must never be assembled from cached rows.
    from curriculum_api.catalogue.application.hierarchy_queries import programme_response as implementation
    return implementation(
        identifier,
        build_curriculum_payload=build_curriculum_payload, find_programme=find_programme,
    )


def first_programme_response(*identifiers):
    from curriculum_api.catalogue.application.hierarchy_queries import first_programme_response as implementation
    return implementation(
        *identifiers,
        build_curriculum_payload=build_curriculum_payload,
    )


@require_GET
def curriculum_stats(request):
    return JsonResponse(get_cached_payload(request)['stats'])


def build_home_summary(visibility, *, force=False):
    """Bind the existing runtime capabilities to the catalogue query."""
    from curriculum_api.home_summary import project_home
    from functools import partial
    from curriculum_api.module_authoring_facts import apply_authoring_facts
    from curriculum_api.catalogue.application.projections import build_home_summary as query
    return query(
        visibility,
        force=force,
        apply_authoring_facts=partial(apply_authoring_facts, format_created_at=format_created_at),
        build_curriculum_payload_from_rows=build_curriculum_payload_from_rows,
        curriculum_read_scope=curriculum_read_scope,
        enrich_modules_with_authoring=enrich_modules_with_authoring,
        enrich_programmes_with_module_counts=enrich_programmes_with_module_counts,
        home_programmes_need_enrichment=home_programmes_need_enrichment,
        home_source_rows=home_source_rows,
        project_home=project_home
    )


def build_programme_list(visibility, *, force=False):
    """Bind the existing runtime capabilities to the catalogue query."""
    from curriculum_api.catalogue.application.projections import build_programme_list as query
    return query(
        visibility,
        force=force,
        authoring_modules_as_training_rows=authoring_modules_as_training_rows,
        authoring_programme_structure_counts=authoring_programme_structure_counts,
        build_curriculum_payload_from_rows=build_curriculum_payload_from_rows,
        build_programmes=build_programmes,
        curriculum_read_scope=curriculum_read_scope,
        enrich_modules_with_authoring=enrich_modules_with_authoring,
        enrich_programmes_with_module_counts=enrich_programmes_with_module_counts,
        get_curriculum_rows=get_curriculum_rows,
        is_operational_training_row=is_operational_training_row,
        programme_list_learner_counts=programme_list_learner_counts,
        programme_list_needs_module_enrichment=programme_list_needs_module_enrichment,
        programme_list_sources=programme_list_sources
    )


def _home_projection(request):
    from curriculum_api.home_summary import _home_projection as query

    # Keep the optional read-model import lazy, including its registration.
    def get_curriculum_home(visibility):
        from curriculum_api.read_model import get_curriculum_home as read
        return read(visibility)

    def enqueue_curriculum_home_refresh(visibility, *, reason):
        from curriculum_api.catalogue.infrastructure.home_read_model import enqueue_curriculum_home_refresh as enqueue
        return enqueue(visibility, reason=reason)

    return query(
        request,
        curriculum_visibility=curriculum_visibility,
        request_bypasses_curriculum_cache=request_bypasses_curriculum_cache,
        cached_curriculum_value=cached_curriculum_value,
        build_home_summary=build_home_summary,
        get_curriculum_home=get_curriculum_home,
        enqueue_curriculum_home_refresh=enqueue_curriculum_home_refresh,
    )


def curriculum_home_summary(request):
    from curriculum_api.home_summary import curriculum_home_summary as respond
    return respond(request, load_projection=_home_projection)


def curriculum_home_attention(request):
    from curriculum_api.home_summary import curriculum_home_attention as respond
    return respond(request, load_projection=_home_projection)


@require_GET
def curriculum_programmes(request):
    from curriculum_api.catalogue.api.programme_commands import curriculum_programmes as implementation
    def enqueue_curriculum_home_refresh(*args, **kwargs):
        from curriculum_api.catalogue.infrastructure.home_read_model import enqueue_curriculum_home_refresh as operation
        return operation(*args, **kwargs)
    def get_curriculum_home(*args, **kwargs):
        from curriculum_api.read_model import get_curriculum_home as operation
        return operation(*args, **kwargs)
    return implementation(
        request,
        CURRICULUM_SCHEMA=CURRICULUM_SCHEMA,
        build_programme_list=build_programme_list,
        cached_curriculum_value=cached_curriculum_value,
        curriculum_collection_response=curriculum_collection_response,
        curriculum_visibility=curriculum_visibility,
        enqueue_curriculum_home_refresh=enqueue_curriculum_home_refresh,
        get_curriculum_home=get_curriculum_home,
        request_bypasses_curriculum_cache=request_bypasses_curriculum_cache,
        settings=settings,
    )


@gzip_page
@require_GET
def curriculum_modules(request):
    from curriculum_api.catalogue.api.module_reads import curriculum_modules as read
    return read(
        request,
        CURRICULUM_SCHEMA=CURRICULUM_SCHEMA,
        build_curriculum_payload=build_curriculum_payload,
        build_curriculum_payload_from_rows=build_curriculum_payload_from_rows,
        cached_curriculum_value=cached_curriculum_value,
        clean_str=clean_str,
        compact_module_list_rows=compact_module_list_rows,
        curriculum_collection_response=curriculum_collection_response,
        curriculum_read_scope=curriculum_read_scope,
        curriculum_visibility=curriculum_visibility,
        enrich_modules_with_authoring=enrich_modules_with_authoring,
        get_cached_curriculum_rows=get_cached_curriculum_rows,
        is_archived_module_summary=is_archived_module_summary,
        normalise=normalise,
        programme_deleted_row=programme_deleted_row,
        request_bypasses_curriculum_cache=request_bypasses_curriculum_cache,
    )


@require_GET
def curriculum_ksb_frameworks(request):
    from curriculum_api.catalogue.api.ksb_sources import curriculum_ksb_frameworks as read
    return read(request,
        curriculum_collection_response=curriculum_collection_response,
        get_cached_payload=get_cached_payload,
    )


@csrf_exempt
def curriculum_ksb_framework_collection(request):
    from curriculum_api.catalogue.api.ksb_sources import curriculum_ksb_framework_collection as read
    return read(request,
        curriculum_ksb_frameworks=curriculum_ksb_frameworks,
        json_error=json_error,
    )
