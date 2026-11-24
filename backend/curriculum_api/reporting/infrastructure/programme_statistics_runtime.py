"""Concrete reporting / infrastructure / programme statistics runtime capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.infrastructure.catalogue_resolution import authoring_scope_data
from curriculum_api.catalogue.infrastructure.hierarchy_composition import assigned_learners_for_programme
from curriculum_api.catalogue.infrastructure.runtime_config import logger
from curriculum_api.ksb_coverage import build_coverage
from curriculum_api.ksb_coverage import float_weight
from curriculum_api.ksb_coverage import normalise_code as coverage_normalise_code
from curriculum_api.reporting.application.design_errors import _ProgrammeKsbDesignUnavailable
from curriculum_api.reporting.domain.source_values import merge_ksb_totals
from curriculum_api.reporting.infrastructure.source_catalogue_runtime import infer_source_from_scope
from curriculum_api.reporting.infrastructure.source_catalogue_runtime import mappings_with_inferred_sources
from curriculum_api.reporting.infrastructure.source_catalogue_runtime import programme_ksb_design_value
from curriculum_api.reporting.infrastructure.source_catalogue_runtime import required_ksbs_for_resolved_source
from curriculum_api.reporting.infrastructure.source_runtime import learner_declared_ksb_codes
from curriculum_api.reporting.infrastructure.source_runtime import learner_progress_ksb_totals


def _programme_ksb_stats(source_id, required_ksb_codes, only_stats_for_ids):
    """Compatibility composition for programme statistics and KSB sources."""
    from curriculum_api.reporting.application.programme_statistics import _programme_ksb_stats as read
    return read(
        source_id,
        required_ksb_codes,
        only_stats_for_ids,
        clean_str=clean_str,
        programme_component_ksb_mapping_count=programme_component_ksb_mapping_count,
        programme_learner_ksb_progress=programme_learner_ksb_progress,
    )


def programme_component_ksb_mapping_count(programme_id, required_codes=None):
    """Compatibility composition for programme statistics and KSB sources."""
    from curriculum_api.reporting.application.programme_statistics import programme_component_ksb_mapping_count as read
    return read(
        programme_id,
        required_codes,
        _ProgrammeKsbDesignUnavailable=_ProgrammeKsbDesignUnavailable,
        _programme_component_ksb_mapping_count=_programme_component_ksb_mapping_count,
        coverage_normalise_code=coverage_normalise_code,
        logger=logger,
        programme_ksb_design_value=programme_ksb_design_value,
    )


def _programme_component_ksb_mapping_count(programme_id, required):
    """Compatibility composition for programme statistics and KSB sources."""
    from curriculum_api.reporting.application.programme_statistics import _programme_component_ksb_mapping_count as read
    return read(
        programme_id,
        required,
        _ProgrammeKsbDesignUnavailable=_ProgrammeKsbDesignUnavailable,
        authoring_scope_data=authoring_scope_data,
        clean_str=clean_str,
        coverage_normalise_code=coverage_normalise_code,
    )


def _programme_ksb_expected_weights(programme_id):
    """Compatibility composition for programme statistics and KSB sources."""
    from curriculum_api.reporting.application.programme_statistics import _programme_ksb_expected_weights as read
    return read(
        programme_id,
        _ProgrammeKsbDesignUnavailable=_ProgrammeKsbDesignUnavailable,
        authoring_scope_data=authoring_scope_data,
        build_coverage=build_coverage,
        coverage_normalise_code=coverage_normalise_code,
        infer_source_from_scope=infer_source_from_scope,
        mappings_with_inferred_sources=mappings_with_inferred_sources,
        required_ksbs_for_resolved_source=required_ksbs_for_resolved_source,
    )


def programme_learner_ksb_progress(programme_id, required_codes=None):
    """Compatibility composition for programme statistics and KSB sources."""
    from curriculum_api.reporting.application.programme_statistics import programme_learner_ksb_progress as read
    return read(
        programme_id,
        required_codes,
        _ProgrammeKsbDesignUnavailable=_ProgrammeKsbDesignUnavailable,
        _programme_ksb_expected_weights=_programme_ksb_expected_weights,
        assigned_learners_for_programme=assigned_learners_for_programme,
        float_weight=float_weight,
        learner_declared_ksb_codes=learner_declared_ksb_codes,
        learner_progress_ksb_totals=learner_progress_ksb_totals,
        logger=logger,
        merge_ksb_totals=merge_ksb_totals,
        programme_ksb_design_value=programme_ksb_design_value,
    )
