"""Concrete reporting / api / source queries capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""
from curriculum_api.reporting.domain.source_values import split_ksb_source
from curriculum_api.reporting.infrastructure.source_catalogue_runtime import infer_source_from_scope
from curriculum_api.reporting.infrastructure.source_catalogue_runtime import required_ksbs_for_resolved_source


def resolve_coverage_source(request, module_rows, scope='', identifier=''):
    """Compatibility entry point for the reporting query boundary."""
    from curriculum_api.reporting.application.coverage import resolve_coverage_source as read
    return read(
        request.GET,
        module_rows,
        scope,
        identifier,
        infer_source_from_scope=infer_source_from_scope,
        split_ksb_source=split_ksb_source,
    )


def required_ksbs_for_request(request, module_rows, scope='', identifier=''):
    return required_ksbs_for_resolved_source(
        *resolve_coverage_source(request, module_rows, scope, identifier),
    )
