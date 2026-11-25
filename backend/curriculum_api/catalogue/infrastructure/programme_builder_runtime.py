"""Concrete catalogue / infrastructure / programme builder runtime capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""
from curriculum_api.catalogue.domain.delivery_values import is_operational_training_row
from curriculum_api.catalogue.domain.programme_values import is_archived_program_config
from curriculum_api.catalogue.domain.programme_values import program_config_by_id
from curriculum_api.catalogue.domain.programme_values import programme_config_status
from curriculum_api.catalogue.domain.read_contracts import PROGRAMME_KSB_STAT_FIELDS
from curriculum_api.catalogue.infrastructure.cache_runtime import curriculum_read_scope
from curriculum_api.catalogue.infrastructure.catalogue_sources import active_learner_programme_counts
from curriculum_api.catalogue.infrastructure.catalogue_sources import get_ksb_profile_rows
from curriculum_api.catalogue.infrastructure.catalogue_sources import get_program_config_rows
from curriculum_api.catalogue.infrastructure.catalogue_sources import get_training_rows
from curriculum_api.catalogue.infrastructure.hierarchy_composition import authoring_programme_structure_counts
from curriculum_api.catalogue.infrastructure.hierarchy_composition import programme_structure_counts
from curriculum_api.reporting.domain.source_values import ksb_profile_required_codes
from curriculum_api.reporting.domain.source_values import ksb_profile_source_id
from curriculum_api.reporting.domain.source_values import normalise_ksb_profile_source_value
from curriculum_api.reporting.infrastructure.programme_statistics_runtime import _programme_ksb_stats
from curriculum_api.reporting.infrastructure.source_catalogue_runtime import applied_standard_name
from curriculum_api.reporting.infrastructure.source_catalogue_runtime import applied_standard_required_codes
from curriculum_api.reporting.infrastructure.source_runtime import programme_applied_ksb_profile


def build_programmes(training_rows, program_configs, ksb_profiles, include_config_only=False, only_stats_for_ids=None, *, include_learner_counts=True, include_structure_counts=True, structure_counts=None, learner_counts=None):
    """Compatibility entry point for programme card construction."""
    from curriculum_api.catalogue.application.programme_builder import build_programmes as query
    return query(
        training_rows,
        program_configs,
        ksb_profiles,
        include_config_only,
        only_stats_for_ids,
        include_learner_counts=include_learner_counts,
        include_structure_counts=include_structure_counts,
        structure_counts=structure_counts,
        learner_counts=learner_counts,
        _programme_ksb_stats=_programme_ksb_stats,
        active_learner_programme_counts=active_learner_programme_counts,
        applied_standard_name=applied_standard_name,
        applied_standard_required_codes=applied_standard_required_codes,
        authoring_programme_structure_counts=authoring_programme_structure_counts,
        is_archived_program_config=is_archived_program_config,
        is_operational_training_row=is_operational_training_row,
        ksb_profile_required_codes=ksb_profile_required_codes,
        ksb_profile_source_id=ksb_profile_source_id,
        normalise_ksb_profile_source_value=normalise_ksb_profile_source_value,
        program_config_by_id=program_config_by_id,
        programme_applied_ksb_profile=programme_applied_ksb_profile,
        programme_config_status=programme_config_status,
        programme_structure_counts=programme_structure_counts,
    )


def build_programme_ksb_stats(identifier, visibility):
    """Compatibility adapter for the catalogue programme read boundary."""
    from curriculum_api.catalogue.application.programme_detail import build_programme_ksb_stats as query
    return query(
        identifier,
        visibility,
        PROGRAMME_KSB_STAT_FIELDS=PROGRAMME_KSB_STAT_FIELDS,
        build_programmes=build_programmes,
        curriculum_read_scope=curriculum_read_scope,
        get_ksb_profile_rows=get_ksb_profile_rows,
        get_program_config_rows=get_program_config_rows,
        get_training_rows=get_training_rows,
        is_operational_training_row=is_operational_training_row,
    )
