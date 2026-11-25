"""Concrete catalogue / domain / component policy capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""
from curriculum_api.catalogue.domain.content_validation import frontend_component_type
from curriculum_api.catalogue.domain.values import as_json_value
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.ksb_coverage import normalise_code as coverage_normalise_code
from curriculum_api.reporting.domain.source_values import source_payload_from_mapping


def component_mapping_identity(component_id, mapping):
    source_type, source_id = source_payload_from_mapping(mapping)
    return (
        clean_str(component_id),
        coverage_normalise_code(mapping.get('code') or mapping.get('ksbCode') or mapping.get('ksb_code')),
        source_type,
        source_id,
    )


def component_builder_settings(row):
    settings = as_json_value(row.get('settings_json'), {})
    settings = settings if isinstance(settings, dict) else {}
    if frontend_component_type(row.get('type')) == 'live-session':
        from curriculum_api.teams_external_calendar import meeting_settings
        settings = meeting_settings(settings)
    stored_live_link = clean_str(row.get('live_sessions_link'))
    if stored_live_link and not clean_str(settings.get('liveSessionUrl')):
        settings = {**settings, 'liveSessionUrl': stored_live_link}
    return settings
