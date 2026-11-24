"""Concrete reporting / infrastructure / source catalogue runtime capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""
from curriculum_api.catalogue.application.scope_identity import programme_identifier_looks_exact
from curriculum_api.catalogue.domain.programme_identity import programme_config_identity
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.domain.values import format_date
from curriculum_api.catalogue.domain.values import normalise
from curriculum_api.catalogue.domain.values import slugify
from curriculum_api.catalogue.domain.values import unique
from curriculum_api.catalogue.infrastructure.authoring_runtime import authoring_fetch_all
from curriculum_api.catalogue.infrastructure.cache_access import cached_curriculum_value
from curriculum_api.catalogue.infrastructure.cache_access import scoped_curriculum_read
from curriculum_api.catalogue.infrastructure.catalogue_sources import get_ksb_profile_rows
from curriculum_api.catalogue.infrastructure.catalogue_sources import get_program_config_rows
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_MODULES_TABLE
from curriculum_api.catalogue.infrastructure.ksb_read_store import get_skills_england_ksb_rows
from curriculum_api.catalogue.infrastructure.runtime_config import _PROGRAMME_KSB_DESIGN_FORCE
from curriculum_api.ksb_coverage import normalise_code as coverage_normalise_code
from curriculum_api.reporting.domain.source_values import active_ksb_profiles
from curriculum_api.reporting.domain.source_values import format_skills_england_funding
from curriculum_api.reporting.domain.source_values import get_ksb_profile_for_program
from curriculum_api.reporting.domain.source_values import ksb_profile_context_ids
from curriculum_api.reporting.domain.source_values import normalise_ksb_profile_source_value
from curriculum_api.reporting.domain.source_values import normalise_skills_england_type
from curriculum_api.reporting.domain.source_values import programme_config_ksb_source
from curriculum_api.reporting.domain.source_values import scope_programme_id
from curriculum_api.reporting.domain.source_values import skills_england_ksb_sort_key
from curriculum_api.reporting.domain.source_values import skills_england_standard_id
from curriculum_api.reporting.domain.source_values import source_type_label
from curriculum_api.reporting.domain.source_values import split_ksb_source
from curriculum_api.reporting.domain.source_values import standard_required_ksb_definitions


def applied_standard_name(config, cache):
    """Compatibility composition for programme statistics and KSB sources."""
    from curriculum_api.reporting.application.source_catalogue import applied_standard_name as read
    return read(
        config,
        cache,
        clean_str=clean_str,
        find_skills_england_standard=find_skills_england_standard,
        programme_config_ksb_source=programme_config_ksb_source,
    )


def applied_standard_required_codes(config, cache):
    """Compatibility composition for programme statistics and KSB sources."""
    from curriculum_api.reporting.application.source_catalogue import applied_standard_required_codes as read
    return read(
        config,
        cache,
        clean_str=clean_str,
        coverage_normalise_code=coverage_normalise_code,
        standard_required_ksbs=standard_required_ksbs,
        unique=unique,
    )


def programme_ksb_design_value(kind, programme_id, build, *, extra_key=''):
    """Compatibility composition for programme statistics and KSB sources."""
    from curriculum_api.reporting.infrastructure.statistics_cache import programme_ksb_design_value as read
    return read(
        kind,
        programme_id,
        build,
        extra_key=extra_key,
        _PROGRAMME_KSB_DESIGN_FORCE=_PROGRAMME_KSB_DESIGN_FORCE,
        cached_curriculum_value=cached_curriculum_value,
        clean_str=clean_str,
    )


@scoped_curriculum_read
def build_skills_england_standards():
    # Memoised for the read scope: a programme list resolves one standard per
    # programme, and each used to rebuild the whole index (~30 ms apiece).
    # Callers only read what it returns.
    """Compatibility composition for programme statistics and KSB sources."""
    from curriculum_api.reporting.application.source_catalogue import build_skills_england_standards as read
    return read(
        clean_str=clean_str,
        format_date=format_date,
        format_skills_england_funding=format_skills_england_funding,
        get_skills_england_ksb_rows=get_skills_england_ksb_rows,
        normalise_skills_england_type=normalise_skills_england_type,
        skills_england_ksb_sort_key=skills_england_ksb_sort_key,
        skills_england_standard_id=skills_england_standard_id,
    )


@scoped_curriculum_read
def _skills_england_standard_index():
    """Compatibility composition for programme statistics and KSB sources."""
    from curriculum_api.reporting.application.source_catalogue import _skills_england_standard_index as read
    return read(
        build_skills_england_standards=build_skills_england_standards,
        clean_str=clean_str,
        slugify=slugify,
    )


def find_skills_england_standard(identifier):
    """Compatibility composition for programme statistics and KSB sources."""
    from curriculum_api.reporting.application.source_catalogue import find_skills_england_standard as read
    return read(
        identifier,
        _skills_england_standard_index=_skills_england_standard_index,
        clean_str=clean_str,
    )


def standard_required_ksbs(identifier):
    """Compatibility composition for programme statistics and KSB sources."""
    from curriculum_api.reporting.application.source_catalogue import standard_required_ksbs as read
    return read(
        identifier,
        find_skills_england_standard=find_skills_england_standard,
        standard_required_ksb_definitions=standard_required_ksb_definitions,
    )


def all_standard_required_ksbs():
    """Compatibility composition for programme statistics and KSB sources."""
    from curriculum_api.reporting.application.source_catalogue import all_standard_required_ksbs as read
    return read(
        build_skills_england_standards=build_skills_england_standards,
        clean_str=clean_str,
        coverage_normalise_code=coverage_normalise_code,
        standard_required_ksb_definitions=standard_required_ksb_definitions,
    )


def required_ksbs_for_source(source_type='', source_id=''):
    """Compatibility composition for programme statistics and KSB sources."""
    from curriculum_api.reporting.application.source_catalogue import required_ksbs_for_source as read
    return read(
        source_type,
        source_id,
        all_standard_required_ksbs=all_standard_required_ksbs,
        split_ksb_source=split_ksb_source,
        standard_required_ksbs=standard_required_ksbs,
    )


def source_required_ksbs(source_type, source_id, cache=None):
    """Compatibility composition for programme statistics and KSB sources."""
    from curriculum_api.reporting.application.source_catalogue import source_required_ksbs as read
    return read(
        source_type,
        source_id,
        cache,
        required_ksbs_for_source=required_ksbs_for_source,
        split_ksb_source=split_ksb_source,
    )


def source_record_exists(source_type, source_id, cache=None):
    """Compatibility composition for programme statistics and KSB sources."""
    from curriculum_api.reporting.application.source_catalogue import source_record_exists as read
    return read(
        source_type,
        source_id,
        cache,
        source_required_ksbs=source_required_ksbs,
    )


def ksb_exists_in_source(source_type, source_id, code, cache=None):
    """Compatibility composition for programme statistics and KSB sources."""
    from curriculum_api.reporting.application.source_catalogue import ksb_exists_in_source as read
    return read(
        source_type,
        source_id,
        code,
        cache,
        coverage_normalise_code=coverage_normalise_code,
        source_required_ksbs=source_required_ksbs,
        split_ksb_source=split_ksb_source,
    )


def source_display_metadata(source_type='', source_id=''):
    """Compatibility composition for programme statistics and KSB sources."""
    from curriculum_api.reporting.application.source_projection import source_display_metadata as read
    return read(
        source_type,
        source_id,
        clean_str=clean_str,
        find_skills_england_standard=find_skills_england_standard,
        get_ksb_profile_rows=get_ksb_profile_rows,
        ksb_profile_context_ids=ksb_profile_context_ids,
        slugify=slugify,
        source_type_label=source_type_label,
        split_ksb_source=split_ksb_source,
    )


def annotate_coverage_sources(coverage):
    """Compatibility composition for programme statistics and KSB sources."""
    from curriculum_api.reporting.application.source_projection import annotate_coverage_sources as read
    return read(
        coverage,
        clean_str=clean_str,
        source_display_metadata=source_display_metadata,
    )


def infer_mapping_source_from_module(module, code, cache=None):
    """Compatibility composition for programme statistics and KSB sources."""
    from curriculum_api.reporting.application.source_catalogue import infer_mapping_source_from_module as read
    return read(
        module,
        code,
        cache,
        build_skills_england_standards=build_skills_england_standards,
        clean_str=clean_str,
        coverage_normalise_code=coverage_normalise_code,
        get_ksb_profile_for_program=get_ksb_profile_for_program,
        get_ksb_profile_rows=get_ksb_profile_rows,
        ksb_exists_in_source=ksb_exists_in_source,
        normalise=normalise,
        split_ksb_source=split_ksb_source,
    )


def infer_mapping_source_for_code(module_catalogue_id, code):
    module_rows = authoring_fetch_all(AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s', [module_catalogue_id])
    return infer_mapping_source_from_module(module_rows[0] if module_rows else {}, code)


def mappings_with_inferred_sources(mapping_rows, module_rows):
    """Compatibility composition for programme statistics and KSB sources."""
    from curriculum_api.reporting.application.source_catalogue import mappings_with_inferred_sources as read
    return read(
        mapping_rows,
        module_rows,
        clean_str=clean_str,
        infer_mapping_source_from_module=infer_mapping_source_from_module,
    )


def programme_row_ksb_source(programme_id):
    """Compatibility composition for programme statistics and KSB sources."""
    from curriculum_api.reporting.application.source_catalogue import programme_row_ksb_source as read
    return read(
        programme_id,
        clean_str=clean_str,
        get_program_config_rows=get_program_config_rows,
        normalise=normalise,
        programme_config_identity=programme_config_identity,
        programme_config_ksb_source=programme_config_ksb_source,
        programme_identifier_looks_exact=programme_identifier_looks_exact,
    )


def infer_source_from_scope(module_rows, scope='', identifier=''):
    """Compatibility composition for programme statistics and KSB sources."""
    from curriculum_api.reporting.application.source_catalogue import infer_source_from_scope as read
    return read(
        module_rows,
        scope,
        identifier,
        active_ksb_profiles=active_ksb_profiles,
        build_skills_england_standards=build_skills_england_standards,
        clean_str=clean_str,
        get_ksb_profile_for_program=get_ksb_profile_for_program,
        get_ksb_profile_rows=get_ksb_profile_rows,
        normalise=normalise,
        normalise_ksb_profile_source_value=normalise_ksb_profile_source_value,
        programme_row_ksb_source=programme_row_ksb_source,
        scope_programme_id=scope_programme_id,
        split_ksb_source=split_ksb_source,
    )


def required_ksbs_for_resolved_source(source_type, source_id, origin):
    """Compatibility composition for programme statistics and KSB sources."""
    from curriculum_api.reporting.application.source_catalogue import required_ksbs_for_resolved_source as read
    return read(
        source_type,
        source_id,
        origin,
        required_ksbs_for_source=required_ksbs_for_source,
    )


def coverage_source_payload(source_type, source_id, origin, required_count):
    """Compatibility composition for programme statistics and KSB sources."""
    from curriculum_api.reporting.application.source_projection import coverage_source_payload as read
    return read(
        source_type,
        source_id,
        origin,
        required_count,
        source_display_metadata=source_display_metadata,
    )
