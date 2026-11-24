"""Concrete reporting / infrastructure / source runtime capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""
from curriculum_api.catalogue.domain.read_contracts import COVERAGE_PART_MAPPING_FIELDS
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.domain.values import normalise
from curriculum_api.catalogue.domain.values import parse_json_value
from curriculum_api.catalogue.infrastructure.database_reads import learner_schema_columns
from curriculum_api.catalogue.infrastructure.database_reads import learner_schema_table_exists
from curriculum_api.catalogue.infrastructure.database_reads import rows_as_dicts
from curriculum_api.catalogue.infrastructure.runtime_config import _PROGRAMME_KSB_DESIGN_FORCE
from curriculum_api.catalogue.infrastructure.runtime_config import logger
from curriculum_api.ksb_coverage import float_weight
from curriculum_api.ksb_coverage import normalise_classification as coverage_normalise_classification
from curriculum_api.ksb_coverage import normalise_code as coverage_normalise_code
from curriculum_api.reporting.domain.source_values import active_ksb_profiles
from curriculum_api.reporting.domain.source_values import codes_from_session_ksb
from curriculum_api.reporting.domain.source_values import get_ksb_profile_for_program
from curriculum_api.reporting.domain.source_values import ksb_profile_context_ids
from curriculum_api.reporting.domain.source_values import ksb_profile_source_id
from curriculum_api.reporting.domain.source_values import ksb_type_label
from curriculum_api.reporting.domain.source_values import normalise_ksb_code
from curriculum_api.reporting.domain.source_values import normalise_ksb_type
from curriculum_api.reporting.domain.source_values import programme_config_ksb_source
from django.db import connection
from learner_api.ksb_exclusions import and_not_excluded
from learner_api.progress_rules import progress_counts_as_achieved
import contextlib


def programme_applied_ksb_profile(config, ksb_profiles, *programme_names):
    """Compatibility composition for programme statistics and KSB sources."""
    from curriculum_api.reporting.application.source_catalogue import programme_applied_ksb_profile as read
    return read(
        config,
        ksb_profiles,
        *programme_names,
        active_ksb_profiles=active_ksb_profiles,
        clean_str=clean_str,
        get_ksb_profile_for_program=get_ksb_profile_for_program,
        ksb_profile_source_id=ksb_profile_source_id,
        normalise=normalise,
        programme_config_ksb_source=programme_config_ksb_source,
    )


@contextlib.contextmanager
def forced_programme_ksb_design(force):
    """Compatibility composition for programme statistics and KSB sources."""
    from curriculum_api.reporting.infrastructure.statistics_cache import forced_programme_ksb_design as read
    yield from read(
        force,
        _PROGRAMME_KSB_DESIGN_FORCE=_PROGRAMME_KSB_DESIGN_FORCE,
    )


def build_ksb_data(ksb_profiles, modules, training_rows, *, summary_only=False):
    from curriculum_api.catalogue.application.ksb_projection import build_ksb_data as read
    return read(
        ksb_profiles,
        modules,
        training_rows,
        summary_only=summary_only,
        codes_from_session_ksb=codes_from_session_ksb,
        ksb_profile_context_ids=ksb_profile_context_ids,
        ksb_profile_source_id=ksb_profile_source_id,
        ksb_type_label=ksb_type_label,
        normalise_ksb_code=normalise_ksb_code,
        normalise_ksb_type=normalise_ksb_type,
    )


def normalise_ksb_classification(value):
    return coverage_normalise_classification(value)


def legacy_weight_class_from_classification(value):
    legacy = normalise_ksb_classification(value)
    if legacy == 'main':
        return 'hard'
    if legacy == 'possible':
        return 'possible'
    return 'soft'


def component_ksb_mapping_json_item(mapping_payload):
    from curriculum_api.catalogue.domain.content_values import component_ksb_mapping_json_item as implementation
    return implementation(
        mapping_payload,
        coverage_normalise_code=coverage_normalise_code,
        legacy_weight_class_from_classification=legacy_weight_class_from_classification,
        normalise_ksb_classification=normalise_ksb_classification,
    )


def component_ksb_mapping_api_item(mapping):
    from curriculum_api.catalogue.domain.content_values import component_ksb_mapping_api_item as implementation
    return implementation(
        mapping,
        coverage_normalise_code=coverage_normalise_code,
        legacy_weight_class_from_classification=legacy_weight_class_from_classification,
        normalise_ksb_classification=normalise_ksb_classification,
    )


def component_ksb_mappings_from_row(row, projection_rows=None):
    from curriculum_api.catalogue.domain.content_values import component_ksb_mappings_from_row as implementation
    return implementation(
        row,
        projection_rows,
        component_ksb_mapping_json_item=component_ksb_mapping_json_item,
        coverage_normalise_code=coverage_normalise_code,
    )


def coverage_part_mapping(mapping, fields=COVERAGE_PART_MAPPING_FIELDS):
    """Compatibility entry point for the reporting query boundary."""
    from curriculum_api.reporting.application.coverage import coverage_part_mapping as read
    return read(
        mapping,
        fields,
    )


def learner_progress_ksb_totals(learner_ids, programme_ksb_codes, *, compact=False):
    """Compatibility entry point for the reporting query boundary."""
    from curriculum_api.reporting.application.supplementary import learner_progress_ksb_totals as read
    from functools import partial
    from curriculum_api.reporting.infrastructure.progress import progress_source_available
    from curriculum_api.reporting.infrastructure.supplementary import progress_total_rows

    def compact_progress_totals():
        from curriculum_api.ksb_stats_reads import progress_totals
        return progress_totals
    return read(
        learner_ids,
        programme_ksb_codes,
        compact=compact,
        clean_str=clean_str,
        compact_progress_totals=compact_progress_totals,
        coverage_normalise_code=coverage_normalise_code,
        float_weight=float_weight,
        logger=logger,
        progress_counts_as_achieved=progress_counts_as_achieved,
        progress_source_available=partial(progress_source_available, connection=connection, learner_schema_table_exists=learner_schema_table_exists),
        progress_total_rows=partial(progress_total_rows, and_not_excluded=and_not_excluded, connection=connection, rows_as_dicts=rows_as_dicts),
    )


def learner_declared_ksb_codes(learner_ids, programme_ksb_codes):
    """Compatibility entry point for the reporting query boundary."""
    from curriculum_api.reporting.application.supplementary import learner_declared_ksb_codes as read
    from functools import partial
    from curriculum_api.reporting.infrastructure.supplementary import declaration_rows
    from curriculum_api.reporting.infrastructure.supplementary import declaration_source_available
    return read(
        learner_ids,
        programme_ksb_codes,
        coverage_normalise_code=coverage_normalise_code,
        declaration_rows=partial(declaration_rows, connection=connection, rows_as_dicts=rows_as_dicts),
        declaration_source_available=partial(declaration_source_available, connection=connection, learner_schema_columns=learner_schema_columns, learner_schema_table_exists=learner_schema_table_exists),
        logger=logger,
        parse_json_value=parse_json_value,
    )
