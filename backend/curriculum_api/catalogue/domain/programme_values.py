"""Concrete catalogue / domain / programme values capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""
from curriculum_api.catalogue.domain.archive_policy import row_has_deleted_at
from curriculum_api.catalogue.domain.hierarchy_values import normalise_programme_status
from curriculum_api.catalogue.domain.read_contracts import PLACEHOLDER_PROGRAMME_IDS
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.domain.values import normalise
from curriculum_api.catalogue.domain.values import truthy


def is_archived_program_config(config):
    """Is this programme archived? ``status`` is its archive record."""
    return bool(config) and (
        row_has_deleted_at(config)
        or truthy(config.get('archived'))
        or clean_str(config.get('status')).lower() in {'archived', 'inactive'}
    )


def programme_status_from_payload(payload, current=None, default='active'):
    current_status = programme_config_status(current) if current else default
    if isinstance(payload, dict) and 'status' in payload:
        return normalise_programme_status(payload.get('status'), current_status)
    return current_status


def programme_config_status(config):
    if is_archived_program_config(config):
        return 'archived'
    status = normalise_programme_status((config or {}).get('status'), '')
    if status:
        return status
    return 'active'


def program_config_by_id(program_configs):
    from curriculum_api.catalogue.domain.hierarchy_values import program_config_by_id as implementation
    return implementation(
        program_configs,
        program_config_preference=program_config_preference,
    )


def program_config_preference(config):
    """Compatibility entry point for programme identity policy."""
    from curriculum_api.catalogue.domain.programme_identity import program_config_preference as policy
    return policy(
        config,
        is_archived_program_config=is_archived_program_config,
    )


def preferred_program_config_by_name(program_configs, name):
    name_key = normalise(name)
    if not name_key:
        return None
    matches = [config for config in program_configs if normalise(config.get('name')) == name_key]
    return max(matches, key=program_config_preference) if matches else None


def is_placeholder_programme_id(value):
    from curriculum_api.catalogue.domain.hierarchy_values import is_placeholder_programme_id as implementation
    return implementation(
        value,
        PLACEHOLDER_PROGRAMME_IDS=PLACEHOLDER_PROGRAMME_IDS,
    )


def sanitised_programme_id(value):
    """Return a persistable programme id, or '' when the value is a placeholder."""
    return '' if is_placeholder_programme_id(value) else clean_str(value)
