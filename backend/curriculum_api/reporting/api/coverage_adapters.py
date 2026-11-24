"""Concrete reporting / api / coverage adapters capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""
from curriculum_api.catalogue.api.responses import json_error
from curriculum_api.catalogue.domain.values import truthy
from curriculum_api.catalogue.infrastructure.catalogue_resolution import authoring_scope_data
from curriculum_api.catalogue.infrastructure.placement_runtime import resolve_group_row
from curriculum_api.ksb_coverage import build_coverage
from curriculum_api.reporting.api.source_queries import resolve_coverage_source
from curriculum_api.reporting.infrastructure.source_catalogue_runtime import annotate_coverage_sources
from curriculum_api.reporting.infrastructure.source_catalogue_runtime import coverage_source_payload
from curriculum_api.reporting.infrastructure.source_catalogue_runtime import mappings_with_inferred_sources
from curriculum_api.reporting.infrastructure.source_catalogue_runtime import required_ksbs_for_resolved_source
from django.http import HttpResponse
from django.http import JsonResponse


def _coverage_response_uncached(request, scope='', identifier=''):
    """Compatibility entry point for the reporting query boundary."""
    from curriculum_api.reporting.api.responses import _coverage_response_uncached as read
    return read(
        request,
        scope,
        identifier,
        HttpResponse=HttpResponse,
        JsonResponse=JsonResponse,
        _coverage_payload_uncached=_coverage_payload_uncached,
    )


def _coverage_payload_uncached(request, scope='', identifier=''):
    """Compatibility entry point for the reporting query boundary."""
    from curriculum_api.reporting.application.coverage import _coverage_payload_uncached as read
    (payload, error) = read(
        request.GET,
        scope,
        identifier,
        annotate_coverage_sources=annotate_coverage_sources,
        authoring_scope_data=authoring_scope_data,
        build_coverage=build_coverage,
        coverage_source_payload=coverage_source_payload,
        mappings_with_inferred_sources=mappings_with_inferred_sources,
        required_ksbs_for_resolved_source=required_ksbs_for_resolved_source,
        resolve_coverage_source=lambda *args: resolve_coverage_source(request, *args),
        resolve_group_row=resolve_group_row,
        truthy=truthy,
    )
    if error is not None:
        message, status = error
        return json_error(message, status=status)
    return payload
