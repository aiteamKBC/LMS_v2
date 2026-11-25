"""Concrete reporting / domain / source values capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.domain.values import falsey
from curriculum_api.catalogue.domain.values import normalise
from curriculum_api.catalogue.domain.values import parse_json_value
from curriculum_api.catalogue.domain.values import slugify
from curriculum_api.catalogue.domain.values import unique
from curriculum_api.ksb_coverage import float_weight
from curriculum_api.ksb_coverage import ksb_sort_key
from curriculum_api.ksb_coverage import ksb_type_from_value
from curriculum_api.ksb_coverage import normalise_code as coverage_normalise_code
from curriculum_api.reporting.domain.read_contracts import KSB_TYPE_FAMILIES
import re


def codes_from_session_ksb(value):
    from curriculum_api.reporting.domain.sources import codes_from_session_ksb as read
    return read(value,
        parse_json_value=parse_json_value,
    )


def ksb_type_label(type_code):
    from curriculum_api.reporting.domain.sources import ksb_type_label as read
    return read(type_code)


def normalise_ksb_type(value):
    from curriculum_api.reporting.domain.sources import normalise_ksb_type as read
    return read(value)


def normalise_ksb_code(value, type_code=''):
    from curriculum_api.reporting.domain.sources import normalise_ksb_code as read
    return read(value, type_code,
        normalise_ksb_type=normalise_ksb_type,
    )


def full_ksb_code(item):
    from curriculum_api.reporting.domain.sources import full_ksb_code as read
    return read(item,
        normalise_ksb_code=normalise_ksb_code,
        normalise_ksb_type=normalise_ksb_type,
    )


def get_ksb_profile_for_program(program_name, ksb_profiles):
    """Compatibility composition for programme statistics and KSB sources."""
    from curriculum_api.reporting.domain.sources import get_ksb_profile_for_program as read
    return read(
        program_name,
        ksb_profiles,
        ksb_profile_context_ids=ksb_profile_context_ids,
        normalise=normalise,
        ksb_profile_source_id=ksb_profile_source_id,
    )


def active_ksb_profiles(ksb_profiles):
    """Compatibility composition for programme statistics and KSB sources."""
    from curriculum_api.reporting.domain.sources import active_ksb_profiles as read
    return read(
        ksb_profiles,
        falsey=falsey,
    )


def programme_config_ksb_source(config):
    """Compatibility composition for programme statistics and KSB sources."""
    from curriculum_api.reporting.domain.sources import programme_config_ksb_source as read
    return read(
        config,
        normalise_ksb_profile_source_value=normalise_ksb_profile_source_value,
        split_ksb_source=split_ksb_source,
    )


def ksb_profile_required_codes(profile):
    from curriculum_api.reporting.domain.sources import ksb_profile_required_codes as read
    return read(profile,
        coverage_normalise_code=coverage_normalise_code,
        full_ksb_code=full_ksb_code,
        parse_json_value=parse_json_value,
        unique=unique,
    )


def ksb_profile_source_id(profile):
    from curriculum_api.reporting.domain.sources import ksb_profile_source_id as read
    return read(profile,
        clean_str=clean_str,
    )


def normalise_ksb_profile_source_value(value):
    from curriculum_api.reporting.domain.sources import normalise_ksb_profile_source_value as read
    return read(value,
        clean_str=clean_str,
    )


def ksb_profile_context_ids(profile, key, primary_value=''):
    from curriculum_api.reporting.domain.sources import ksb_profile_context_ids as read
    return read(profile, key, primary_value,
        clean_str=clean_str,
        parse_json_value=parse_json_value,
        unique=unique,
    )


def normalise_skills_england_type(value):
    raw = clean_str(value).lower()
    if raw.startswith('skill'):
        return 'Skill'
    if raw.startswith('behaviour') or raw.startswith('behavior'):
        return 'Behaviour'
    return 'Knowledge'


def format_skills_england_funding(value):
    raw = clean_str(value).replace('\u0141', '\u00a3')
    if not raw:
        return ''
    digits = re.sub(r'[^0-9]', '', raw)
    if digits:
        return f'\u00a3{int(digits):,}'
    return raw


def skills_england_ksb_sort_key(item):
    """Compatibility composition for programme statistics and KSB sources."""
    from curriculum_api.reporting.domain.sources import skills_england_ksb_sort_key as read
    return read(
        item,
        clean_str=clean_str,
    )


def skills_england_standard_id(row):
    """Compatibility composition for programme statistics and KSB sources."""
    from curriculum_api.reporting.domain.sources import skills_england_standard_id as read
    return read(
        row,
        slugify=slugify,
    )


def split_ksb_source(source_type='', source_id=''):
    """Compatibility composition for programme statistics and KSB sources."""
    from curriculum_api.reporting.domain.sources import split_ksb_source as read
    return read(
        source_type,
        source_id,
        clean_str=clean_str,
    )


def standard_required_ksb_definitions(standard, fallback_id=''):
    """Compatibility composition for programme statistics and KSB sources."""
    from curriculum_api.reporting.domain.sources import standard_required_ksb_definitions as read
    return read(
        standard,
        fallback_id,
        ksb_type_from_value=ksb_type_from_value,
    )


def source_payload_from_mapping(mapping):
    """Compatibility composition for programme statistics and KSB sources."""
    from curriculum_api.reporting.domain.sources import source_payload_from_mapping as read
    return read(
        mapping,
        split_ksb_source=split_ksb_source,
    )


def source_type_label(source_type):
    """Compatibility composition for programme statistics and KSB sources."""
    from curriculum_api.reporting.domain.sources import source_type_label as read
    return read(
        source_type,
    )


def source_type_mismatch_message(source_type, source_id):
    source_type, source_id = split_ksb_source(source_type, source_id)
    if source_type == 'standard' and source_id.startswith('ksb-'):
        return 'Framework KSB cannot be submitted using a Standard source.'
    return ''


def scope_programme_id(module_rows, scope='', identifier=''):
    """Compatibility composition for programme statistics and KSB sources."""
    from curriculum_api.reporting.domain.sources import scope_programme_id as read
    return read(
        module_rows,
        scope,
        identifier,
        clean_str=clean_str,
    )


def parse_ksb_weights(value):
    """Compatibility entry point for the curriculum reporting read boundary."""
    from curriculum_api.reporting.domain.ksb import parse_ksb_weights as read
    return read(
        value,
        coverage_normalise_code=coverage_normalise_code, float_weight=float_weight, parse_json_value=parse_json_value,
    )


def merge_ksb_totals(*sources):
    """Compatibility entry point for the curriculum reporting read boundary."""
    from curriculum_api.reporting.domain.ksb import merge_ksb_totals as read
    return read(
        *sources,
        coverage_normalise_code=coverage_normalise_code,
    )


def ksb_type_family(ksb_type, code=''):
    """Compatibility entry point for the curriculum reporting read boundary."""
    from curriculum_api.reporting.domain.ksb import ksb_type_family as read
    return read(
        ksb_type, code,
    )


def ksb_achievement_by_type(rows):
    """Compatibility entry point for the curriculum reporting read boundary."""
    from curriculum_api.reporting.domain.ksb import ksb_achievement_by_type as read
    return read(
        rows,
        KSB_TYPE_FAMILIES=KSB_TYPE_FAMILIES, float_weight=float_weight, ksb_type_family=ksb_type_family,
    )


def scope_ksb_achievement(coverage_items, learner_consumption, learners, plan, learner_plans):
    """Compatibility entry point for the curriculum reporting read boundary."""
    from curriculum_api.reporting.domain.ksb import scope_ksb_achievement as read
    return read(
        coverage_items, learner_consumption, learners, plan, learner_plans,
        clean_str=clean_str, coverage_normalise_code=coverage_normalise_code, float_weight=float_weight,
        ksb_achievement_by_type=ksb_achievement_by_type, ksb_sort_key=ksb_sort_key, ksb_type_family=ksb_type_family,
    )
