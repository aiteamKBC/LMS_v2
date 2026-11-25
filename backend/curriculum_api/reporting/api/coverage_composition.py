"""Concrete reporting coverage composition bindings.

Owns HTTP/decorator and runtime capability composition. Application operations,
domain policies, SQL and transaction behavior remain in their existing owners.
Public signatures and response contracts are unchanged."""
from curriculum_api.catalogue.api.responses import json_error
from curriculum_api.catalogue.domain.read_contracts import COVERAGE_PART_MAPPING_FIELDS
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.domain.values import truthy
from curriculum_api.catalogue.infrastructure.cache_access import cached_curriculum_value
from curriculum_api.catalogue.infrastructure.cache_runtime import curriculum_read_scope
from curriculum_api.catalogue.infrastructure.content_runtime import component_source_inputs_fingerprint
from curriculum_api.http_cache import conditional_json_response
from curriculum_api.http_cache import encode_json_bytes
from curriculum_api.http_cache import encode_json_entry
from curriculum_api.http_cache import plain_json_response
from curriculum_api.ksb_coverage import normalise_code as coverage_normalise_code
from curriculum_api.reporting.api.coverage_adapters import _coverage_payload_uncached
from curriculum_api.reporting.api.coverage_adapters import _coverage_response_uncached
from curriculum_api.reporting.infrastructure.source_runtime import coverage_part_mapping
from django.http import HttpResponse
from django.http import JsonResponse
from django.views.decorators.http import require_GET
import json


def coverage_entry(request, scope='', identifier=''):
    """Compatibility entry point for the reporting query boundary."""
    from curriculum_api.reporting.api.responses import coverage_entry as read
    return read(
        request,
        scope,
        identifier,
        COVERAGE_PART_VIEWS=COVERAGE_PART_VIEWS,
        HttpResponse=HttpResponse,
        _coverage_payload_uncached=_coverage_payload_uncached,
        _coverage_response_uncached=_coverage_response_uncached,
        cached_curriculum_value=cached_curriculum_value,
        clean_str=clean_str,
        component_source_inputs_fingerprint=component_source_inputs_fingerprint,
        coverage_part=coverage_part,
        curriculum_read_scope=curriculum_read_scope,
        encode_json_bytes=encode_json_bytes,
        encode_json_entry=encode_json_entry,
        truthy=truthy,
    )


COVERAGE_PART_VIEWS = ('heatmap', 'items')


COVERAGE_HEATMAP_MAPPING_FIELDS = tuple(
    field for field in COVERAGE_PART_MAPPING_FIELDS if field not in {'mapping_id', 'component_otjh'}
)


def coverage_part(payload, part):
    """Compatibility entry point for the reporting query boundary."""
    from curriculum_api.reporting.application.coverage import coverage_part as read
    return read(
        payload,
        part,
        COVERAGE_HEATMAP_MAPPING_FIELDS=COVERAGE_HEATMAP_MAPPING_FIELDS,
        coverage_part_mapping=coverage_part_mapping,
    )


def coverage_response(request, scope='', identifier=''):
    """Compatibility entry point for the reporting query boundary."""
    from curriculum_api.reporting.api.responses import coverage_response as read
    return read(
        request,
        scope,
        identifier,
        coverage_entry=coverage_entry,
        plain_json_response=plain_json_response,
    )


def coverage_endpoint_response(request, scope='', identifier=''):
    """Coverage for an HTTP client: gzip when accepted, 304 when unchanged."""
    return conditional_json_response(request, coverage_entry(request, scope, identifier))


@require_GET
def curriculum_ksb_coverage(request):
    return coverage_endpoint_response(request)


@require_GET
def curriculum_week_ksb_coverage(request, week_id):
    return coverage_endpoint_response(request, 'week', week_id)


@require_GET
def curriculum_module_ksb_coverage(request, module_catalogue_id):
    return coverage_endpoint_response(request, 'module', module_catalogue_id)


@require_GET
def curriculum_programme_ksb_coverage(request, programme_id):
    return coverage_endpoint_response(request, 'programme', programme_id)


@require_GET
def curriculum_ksb_trace(request, ksb_id):
    from curriculum_api.reporting.api.coverage_reads import curriculum_ksb_trace as implementation
    return implementation(
        request, ksb_id,
        JsonResponse=JsonResponse, coverage_normalise_code=coverage_normalise_code, coverage_response=coverage_response,
        json=json, json_error=json_error,
    )


@require_GET
def curriculum_readiness_validation(request):
    from curriculum_api.reporting.api.coverage_reads import curriculum_readiness_validation as implementation
    return implementation(
        request,
        JsonResponse=JsonResponse, coverage_response=coverage_response, json=json,
    )
