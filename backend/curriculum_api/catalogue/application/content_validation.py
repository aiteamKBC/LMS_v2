"""Authoring validation orchestration over explicit normalization and source-read dependencies."""


import re

from curriculum_api.catalogue.domain.component_settings import allowed_component_setting_keys as _default_allowed_component_setting_keys
from curriculum_api.catalogue.domain.component_settings import normalise_component_settings_payload as _default_normalise_component_settings_payload
from curriculum_api.catalogue.domain.content_validation import component_expected_otjh as _default_component_expected_otjh
from curriculum_api.catalogue.domain.content_validation import component_resource_url as _default_component_resource_url
from curriculum_api.catalogue.domain.content_validation import frontend_component_type as _default_frontend_component_type
from curriculum_api.catalogue.domain.content_validation import host_matches as _default_host_matches
from curriculum_api.catalogue.domain.content_validation import http_url as _default_http_url
from curriculum_api.catalogue.domain.content_validation import partial_read_errors as _default_partial_read_errors
from curriculum_api.catalogue.domain.content_validation import payload_reflection_question as _default_payload_reflection_question
from curriculum_api.catalogue.domain.content_validation import without_retired_components as _default_without_retired_components
from curriculum_api.catalogue.domain.content_values import normalise_ksb_weight_class as _default_normalise_ksb_weight_class
from curriculum_api.catalogue.domain.values import bool_payload as _default_bool_payload
from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str
from curriculum_api.catalogue.domain.values import parse_float as _default_parse_float
from curriculum_api.catalogue.domain.values import parse_int as _default_parse_int
from curriculum_api.weekly_schedule import module_week_boundary_mode


def validate_component_authoring_payload(
    component,
    path,
    *,
    CONTENT_AUTHORING_STATUSES,
    allowed_component_setting_keys=_default_allowed_component_setting_keys,
    bool_payload=_default_bool_payload,
    clean_str=_default_clean_str,
    component_expected_otjh=_default_component_expected_otjh,
    component_resource_url=_default_component_resource_url,
    component_uploaded_video_url,
    frontend_component_type=_default_frontend_component_type,
    host_matches=_default_host_matches,
    http_url=_default_http_url,
    normalise_component_settings_payload=_default_normalise_component_settings_payload,
    parse_float=_default_parse_float,
    parse_int=_default_parse_int,
    payload_reflection_question=_default_payload_reflection_question,
    stored_video_path,
):
    errors = []
    component_type = frontend_component_type(component.get('type'))
    settings = normalise_component_settings_payload(component_type, component.get('settings'))
    component['settings'] = settings
    allowed = allowed_component_setting_keys(component_type)
    title = clean_str(component.get('title'))
    status = clean_str(settings.get('contentStatus') or 'Draft')
    version = clean_str(settings.get('version') or '0.1')

    if not title:
        errors.append({'path': f'{path}.title', 'message': 'Component title is required.'})
    if component_expected_otjh(component) < 0:
        errors.append({'path': f'{path}.expectedOtjh', 'message': 'Expected OTJH cannot be negative.'})
    if parse_int(component.get('points'), 0) < 0:
        errors.append({'path': f'{path}.points', 'message': 'Points cannot be negative.'})
    if status not in CONTENT_AUTHORING_STATUSES:
        errors.append({'path': f'{path}.settings.contentStatus', 'message': 'Status must be Draft, Ready for QA, Needs changes, or Approved.'})
    if not re.match(r'^\d+(?:\.\d+){0,2}$', version):
        errors.append({'path': f'{path}.settings.version', 'message': 'Version must use numbers such as 0.1 or 1.2.0.'})
    if bool_payload(component.get('reflectionRequired')) and not payload_reflection_question(component, settings):
        errors.append({'path': f'{path}.reflectionQuestion', 'message': 'A reflection question is required when reflection is enabled.'})
    for key in settings.keys():
        if key not in allowed:
            errors.append({'path': f'{path}.settings.{key}', 'message': f'Unsupported setting "{key}" for {component_type}.'})

    if component_type == 'video':
        source_type = clean_str(settings.get('sourceType') or settings.get('provider') or 'YouTube')
        if source_type == 'Upload file':
            source_type = 'HTML (MP4)'
        if source_type == 'External link':
            source_type = 'External Link'
        if source_type == 'Shortcode':
            if status != 'Draft':
                errors.append({'path': f'{path}.settings.sourceType', 'message': 'Legacy Shortcode sources are preserved but cannot be marked ready or approved in the new Module Builder.'})
            return errors
        video_url = clean_str(settings.get('videoUrl'))
        progress = parse_float(settings.get('requiredProgressPercentage'), 0)
        if progress < 0 or progress > 100:
            errors.append({'path': f'{path}.settings.requiredProgressPercentage', 'message': 'Required progress must be between 0 and 100.'})
        if video_url and source_type == 'YouTube' and not host_matches(video_url, {'youtube.com', 'youtu.be'}):
            errors.append({'path': f'{path}.settings.videoUrl', 'message': 'Enter a valid YouTube URL.'})
        if video_url and source_type == 'Vimeo' and not host_matches(video_url, {'vimeo.com'}):
            errors.append({'path': f'{path}.settings.videoUrl', 'message': 'Enter a valid Vimeo URL.'})
        saved_mp4 = source_type == 'HTML (MP4)' and (bool(stored_video_path(video_url)) or component_uploaded_video_url(video_url))
        if video_url and source_type in {'External Link', 'HTML (MP4)'} and not (http_url(video_url) or saved_mp4):
            errors.append({'path': f'{path}.settings.videoUrl', 'message': 'Enter a valid URL.'})
        if status != 'Draft' and source_type == 'Embed' and not clean_str(settings.get('embedCode')):
            errors.append({'path': f'{path}.settings.embedCode', 'message': 'Embed content is required before QA or approval.'})
        if status != 'Draft' and source_type != 'Embed' and not video_url:
            errors.append({'path': f'{path}.settings.videoUrl', 'message': 'Video URL is required before QA or approval.'})

    if component_type == 'recording-placeholder':
        recording_url = clean_str(settings.get('recordingUrl'))
        if recording_url and not http_url(recording_url):
            errors.append({'path': f'{path}.settings.recordingUrl', 'message': 'Enter a valid recording URL.'})
        # A linked recording plays its live session's Teams recording, so it
        # has no URL of its own to require.
        linked = clean_str(settings.get('linkedLiveSessionComponentId'))
        if status != 'Draft' and not recording_url and not linked:
            errors.append({'path': f'{path}.settings.recordingUrl', 'message': 'Recording URL is required before QA or approval.'})

    if component_type == 'podcast':
        source_type = clean_str(settings.get('podcastSource') or 'External URL')
        podcast_url = clean_str(settings.get('podcastUrl'))
        embed_code = clean_str(settings.get('embedCode'))
        progress = parse_float(settings.get('requiredProgressPercentage'), 0)
        if progress < 0 or progress > 100:
            errors.append({'path': f'{path}.settings.requiredProgressPercentage', 'message': 'Required progress must be between 0 and 100.'})
        if source_type not in {'Embed', 'Shortcode'} and podcast_url and not component_resource_url(podcast_url):
            errors.append({'path': f'{path}.settings.podcastUrl', 'message': 'Enter a valid podcast URL.'})
        if status != 'Draft' and source_type == 'Embed' and not embed_code:
            errors.append({'path': f'{path}.settings.embedCode', 'message': 'Embed content is required before QA or approval.'})

    if component_type == 'reading':
        resource_url = clean_str(settings.get('resourceUrl'))
        if resource_url and not component_resource_url(resource_url):
            errors.append({'path': f'{path}.settings.resourceUrl', 'message': 'Enter a valid reading URL.'})
        audio_url = clean_str(settings.get('audioUrl'))
        if audio_url and not http_url(audio_url):
            errors.append({'path': f'{path}.settings.audioUrl', 'message': 'Enter a valid audio URL.'})

    if component_type == 'powerpoint':
        value = clean_str(settings.get('presentationUrl'))
        if value and not component_resource_url(value):
            errors.append({'path': f'{path}.settings.presentationUrl', 'message': 'Enter a valid presentation URL.'})

    return errors


def validate_module_authoring_payload(
    payload,
    *,
    clean_str=_default_clean_str,
    module_week_starts_on,
    module_weekly_schedule,
    partial_read_errors=_default_partial_read_errors,
    read_policy,
    validate_component_authoring_payload,
    validate_ksb_mapping_payload,
    validate_mapping_duplicates,
    without_retired_components=_default_without_retired_components,
):
    errors = []
    if 'calendarPolicy' in payload or 'calendar_policy' in payload:
        try:
            read_policy(payload)
        except ValueError as exc:
            errors.append({'path': 'calendarPolicy', 'message': str(exc)})
    if 'scheduleMode' in payload and payload['scheduleMode'] not in ('group', 'custom'):
        errors.append({'path': 'scheduleMode', 'message': 'Choose Group or Custom scheduling.'})
    try:
        module_week_starts_on(payload)
        module_week_boundary_mode(payload)
    except ValueError as exc:
        errors.append({'path': 'weekStartsOn', 'message': str(exc)})
    try:
        weekly = module_weekly_schedule(payload)
        if payload.get('scheduleMode') == 'custom' and not weekly:
            errors.append({'path': 'weeklySchedule', 'message': 'Choose the weekdays and times for the custom schedule.'})
    except ValueError as exc:
        errors.append({'path': 'weeklySchedule', 'message': str(exc)})
    source_cache = {}
    if not clean_str(payload.get('title') or payload.get('name')):
        errors.append({'path': 'title', 'message': 'Module title is required.'})
    errors.extend(partial_read_errors(payload))
    raw_weeks = payload.get('weekStructure')
    if raw_weeks is None:
        raw_weeks = payload.get('weeks')
    # An integer `weeks` is a session count, not a structure. Reject it instead of
    # coercing it to [], which would drop authored weeks without telling anyone.
    if raw_weeks not in (None, '') and not isinstance(raw_weeks, list):
        errors.append({'path': 'weekStructure', 'message': 'Week structure must be a list.'})
        return errors
    weeks = without_retired_components(raw_weeks or [])
    for week_index, week in enumerate(weeks):
        if not isinstance(week, dict):
            errors.append({'path': f'weekStructure.{week_index}', 'message': 'Week must be an object.'})
            continue
        if not clean_str(week.get('title')):
            errors.append({'path': f'weekStructure.{week_index}.title', 'message': f'Week {week_index + 1} needs a title.'})
        errors.extend(partial_read_errors(week, f'weekStructure.{week_index}'))
        components = week.get('components') or []
        if not isinstance(components, list):
            errors.append({'path': f'weekStructure.{week_index}.components', 'message': 'Components must be a list.'})
            continue
        for component_index, component in enumerate(components):
            if not isinstance(component, dict):
                errors.append({'path': f'weekStructure.{week_index}.components.{component_index}', 'message': 'Component must be an object.'})
                continue
            errors.extend(validate_component_authoring_payload(component, f'weekStructure.{week_index}.components.{component_index}'))
            errors.extend(partial_read_errors(component, f'weekStructure.{week_index}.components.{component_index}'))
            component_mappings = component.get('ksbMappings') or []
            errors.extend(validate_mapping_duplicates(component_mappings, f'weekStructure.{week_index}.components.{component_index}.ksbMappings'))
            for mapping_index, mapping in enumerate(component_mappings):
                if not isinstance(mapping, dict):
                    errors.append({'path': f'weekStructure.{week_index}.components.{component_index}.ksbMappings.{mapping_index}', 'message': 'KSB mapping must be an object.'})
                    continue
                errors.extend(validate_ksb_mapping_payload(mapping, f'weekStructure.{week_index}.components.{component_index}.ksbMappings.{mapping_index}', source_cache))
    return errors


def validate_ksb_mapping_payload(
    mapping,
    path='ksbMappings',
    source_cache=None,
    *,
    SUPPORTED_CLASSIFICATIONS,
    SUPPORTED_KSB_SOURCE_TYPES,
    SUPPORTED_KSB_WEIGHT_CLASSES,
    clean_str=_default_clean_str,
    coverage_normalise_code,
    ksb_exists_in_source,
    normalise_ksb_weight_class=_default_normalise_ksb_weight_class,
    source_payload_from_mapping,
    source_record_exists,
    source_type_label,
    source_type_mismatch_message,
):
    errors = []
    code = coverage_normalise_code(mapping.get('code') or mapping.get('ksbCode') or mapping.get('ksb_code'))
    classification = clean_str(mapping.get('classification') or mapping.get('type')).lower()
    has_weight_class = any(key in mapping for key in ('weight_class', 'weightClass'))
    raw_weight_class = mapping.get('weight_class') if 'weight_class' in mapping else mapping.get('weightClass')
    weight_class = normalise_ksb_weight_class(raw_weight_class)
    weight_value = mapping.get('weight')
    source_type, source_id = source_payload_from_mapping(mapping)
    if not code:
        errors.append({'path': f'{path}.code', 'message': 'KSB code is required.'})
    if classification not in SUPPORTED_CLASSIFICATIONS:
        errors.append({'path': f'{path}.classification', 'message': 'Classification must be main, secondary, or possible.'})
    if not has_weight_class:
        errors.append({'path': f'{path}.weight_class', 'message': 'Weight class is required and must be hard, soft, or possible.'})
    elif weight_class not in SUPPORTED_KSB_WEIGHT_CLASSES or clean_str(raw_weight_class).lower() not in SUPPORTED_KSB_WEIGHT_CLASSES:
        errors.append({'path': f'{path}.weight_class', 'message': 'Weight class must be hard, soft, or possible.'})
    try:
        weight = float(weight_value)
    except (TypeError, ValueError):
        weight = None
    if weight is None:
        errors.append({'path': f'{path}.weight', 'message': 'Weight must be numeric.'})
    elif weight <= 0:
        errors.append({'path': f'{path}.weight', 'message': 'Weight must be greater than zero.'})
    if source_type not in SUPPORTED_KSB_SOURCE_TYPES:
        errors.append({'path': f'{path}.sourceType', 'message': 'Source type must be standard or framework.'})
    if not source_id:
        errors.append({'path': f'{path}.sourceId', 'message': 'Source identifier is required.'})
    mismatch_message = source_type_mismatch_message(source_type, source_id) if source_type and source_id else ''
    if mismatch_message:
        errors.append({'path': f'{path}.source', 'message': mismatch_message})
    if source_type in SUPPORTED_KSB_SOURCE_TYPES and source_id and not mismatch_message:
        if not source_record_exists(source_type, source_id, source_cache):
            errors.append({'path': f'{path}.sourceId', 'message': f'Selected {source_type_label(source_type)} source was not found.'})
        elif code and not ksb_exists_in_source(source_type, source_id, code, source_cache):
            errors.append({'path': f'{path}.code', 'message': f'{code} does not belong to the selected {source_type_label(source_type)} source.'})
    return errors
