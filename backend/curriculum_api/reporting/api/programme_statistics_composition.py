"""Concrete reporting / api / programme statistics composition capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""
from curriculum_api.catalogue.api.adapters import request_bypasses_curriculum_cache
from curriculum_api.catalogue.api.responses import curriculum_visibility
from curriculum_api.catalogue.domain.read_contracts import CURRICULUM_LEARNER_DATA_TTL_SECONDS
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.infrastructure.cache_access import cached_curriculum_value
from curriculum_api.catalogue.infrastructure.programme_builder_runtime import build_programme_ksb_stats
from curriculum_api.http_cache import conditional_json_response
from curriculum_api.http_cache import encode_json_entry
from curriculum_api.http_cache import encode_json_error_entry
from curriculum_api.reporting.infrastructure.source_runtime import forced_programme_ksb_design
from django.views.decorators.http import require_GET


@require_GET
def curriculum_programme_ksb_stats(request, programme_id):
    """Compatibility composition for programme statistics and KSB sources."""
    from curriculum_api.reporting.api.statistics import curriculum_programme_ksb_stats as read
    return read(
        request,
        programme_id,
        CURRICULUM_LEARNER_DATA_TTL_SECONDS=CURRICULUM_LEARNER_DATA_TTL_SECONDS,
        build_programme_ksb_stats=build_programme_ksb_stats,
        cached_curriculum_value=cached_curriculum_value,
        clean_str=clean_str,
        conditional_json_response=conditional_json_response,
        curriculum_visibility=curriculum_visibility,
        encode_json_entry=encode_json_entry,
        encode_json_error_entry=encode_json_error_entry,
        forced_programme_ksb_design=forced_programme_ksb_design,
        request_bypasses_curriculum_cache=request_bypasses_curriculum_cache,
    )
