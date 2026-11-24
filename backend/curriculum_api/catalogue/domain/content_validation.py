"""Pure content shape, URL and partial-read rules; no framework or persistence."""


from urllib.parse import urlparse

from curriculum_api.catalogue.domain.component_types import is_retired_component_type as _default_is_retired_component_type
from curriculum_api.catalogue.domain.component_types import normalise_component_type as _default_normalise_component_type
from curriculum_api.catalogue.domain.read_contracts import COMPONENT_SETTINGS_OMITTED_FLAG as _default_COMPONENT_SETTINGS_OMITTED_FLAG
from curriculum_api.catalogue.domain.read_contracts import LEGACY_REFLECTION_QUESTION_SETTING as _default_LEGACY_REFLECTION_QUESTION_SETTING
from curriculum_api.catalogue.domain.read_contracts import WEEK_OUTLINE_MODULE_FLAG as _default_WEEK_OUTLINE_MODULE_FLAG
from curriculum_api.catalogue.domain.read_contracts import WEEK_OUTLINE_WEEK_FLAG as _default_WEEK_OUTLINE_WEEK_FLAG
from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str
from curriculum_api.catalogue.domain.values import parse_float as _default_parse_float


def frontend_component_type(value):
    return str(value or '').replace('_', '-')


def display_component_type(
    value,
    *,
    clean_str=_default_clean_str,
    frontend_component_type=frontend_component_type,
):
    raw = frontend_component_type(value)
    labels = {
        'live-session': 'Live Session',
        'recording-placeholder': 'Recording Placeholder',
        'video': 'Self-study',
        'podcast': 'Self-study',
        'reading': 'Self-study',
        'powerpoint': 'Self-study',
        'quiz': 'Quiz',
        'monthly-ksb-quiz': 'Quiz',
        'assignment': 'Assignment',
        'workshop': 'Workshop',
        'reflection': 'Self-study',
        'checkpoint': 'Quiz',
        'coaching-preparation': 'Self-study',
    }
    return labels.get(raw, clean_str(value).replace('-', ' ').replace('_', ' ').title() or 'Self-study')


def stored_component_type(
    value,
    *,
    clean_str=_default_clean_str,
    normalise_component_type=_default_normalise_component_type,
):
    label = clean_str(value).lower()
    mapping = {
        'live session': 'live_session',
        'recording placeholder': 'recording_placeholder',
        'video': 'video',
        'podcast': 'podcast',
        'reading': 'reading',
        'reading material': 'reading',
        'powerpoint': 'powerpoint',
        'power point': 'powerpoint',
        'self-study': 'reading',
        'self study': 'reading',
        'quiz': 'quiz',
        'checkpoint': 'checkpoint',
        'checkpoint quiz': 'checkpoint',
        'monthly ksb quiz': 'monthly_ksb_quiz',
        'assignment': 'assignment',
        'reflection': 'reflection',
        'coaching preparation': 'coaching_preparation',
        'workshop': 'workshop',
    }
    return mapping.get(label, normalise_component_type(value) or 'reading')


def http_url(value, *, clean_str=_default_clean_str):
    text = clean_str(value)
    if not text:
        return False
    parsed = urlparse(text)
    return parsed.scheme in {'http', 'https'} and bool(parsed.netloc)


def component_resource_url(value, *, clean_str=_default_clean_str, http_url=http_url):
    text = clean_str(value)
    return text.startswith('/curriculum_api/curriculum/uploads/') or http_url(text)


def component_uploaded_video_url(value, *, clean_str=_default_clean_str):
    """Existing LMS MP4 resources may predate the generated video-import path."""
    from urllib.parse import unquote
    parsed = urlparse(clean_str(value))
    path = unquote(parsed.path)
    return (not parsed.scheme and not parsed.netloc and not parsed.query and not parsed.fragment
            and path.startswith('/curriculum_api/curriculum/uploads/')
            and path.lower().endswith('.mp4') and '\\' not in path
            and not any(part in {'.', '..'} for part in path.split('/')))


def host_matches(value, allowed_hosts, *, clean_str=_default_clean_str, http_url=http_url):
    if not http_url(value):
        return False
    host = (urlparse(clean_str(value)).hostname or '').lower()
    return any(host == allowed or host.endswith(f'.{allowed}') for allowed in allowed_hosts)


def component_expected_otjh(component, default=2, *, parse_float=_default_parse_float):
    component = component or {}
    if component.get('expectedOtjh') not in (None, ''):
        return parse_float(component.get('expectedOtjh'), default)
    if component.get('expected_otjh') not in (None, ''):
        return parse_float(component.get('expected_otjh'), default)
    return default


def payload_reflection_question(
    component,
    settings=None,
    *,
    LEGACY_REFLECTION_QUESTION_SETTING=_default_LEGACY_REFLECTION_QUESTION_SETTING,
    clean_str=_default_clean_str,
):
    """The reflection question a component payload is asking us to store.

    ``reflectionQuestion`` is what the builders send, and an explicit empty
    string there clears the question. A payload that names neither spelling is
    older than the field, so its legacy ``settings.reflectionPrompt`` stands in.
    """
    if 'reflectionQuestion' in component or 'reflection_question' in component:
        return clean_str(component.get('reflectionQuestion') or component.get('reflection_question'))
    if settings is None:
        settings = component.get('settings')
    settings = settings if isinstance(settings, dict) else {}
    return clean_str(settings.get(LEGACY_REFLECTION_QUESTION_SETTING))


def partial_read_errors(
    payload,
    path='',
    *,
    COMPONENT_SETTINGS_OMITTED_FLAG=_default_COMPONENT_SETTINGS_OMITTED_FLAG,
    WEEK_OUTLINE_MODULE_FLAG=_default_WEEK_OUTLINE_MODULE_FLAG,
    WEEK_OUTLINE_WEEK_FLAG=_default_WEEK_OUTLINE_WEEK_FLAG,
):
    """Refuse a save built from a partial read (see the two projections above).

    A component carrying ``settingsOmitted`` lacks text the stored row holds,
    and a week or module marked as an outline lacks every component. Saved as
    they are, a full structure save would withdraw that content. Nothing in
    the frontend sends either; this is the server's own guarantee.
    """
    errors = []
    if not isinstance(payload, dict):
        return errors
    prefix = f'{path}.' if path else ''
    if payload.get(COMPONENT_SETTINGS_OMITTED_FLAG):
        errors.append({
            'path': f'{prefix}settings',
            'message': 'This component was loaded without its full content. Reload it before saving.',
        })
    if payload.get(WEEK_OUTLINE_MODULE_FLAG) or payload.get(WEEK_OUTLINE_WEEK_FLAG):
        errors.append({
            'path': f'{prefix}weekStructure' if payload.get(WEEK_OUTLINE_MODULE_FLAG) else f'{prefix}components',
            'message': 'This module was loaded as an outline without its components. Reload it before saving.',
        })
    return errors


def active_components_payload(components, *, is_retired_component_type=_default_is_retired_component_type):
    return [
        component
        for component in (components or [])
        if isinstance(component, dict) and not is_retired_component_type(component.get('type'))
    ]


def without_retired_components(weeks, *, active_components_payload=active_components_payload):
    clean_weeks = []
    for week in weeks if isinstance(weeks, list) else []:
        if not isinstance(week, dict):
            clean_weeks.append(week)
            continue
        clean_weeks.append({
            **week,
            'components': active_components_payload(week.get('components')),
        })
    return clean_weeks


def validate_mapping_duplicates(mappings, path, *, component_mapping_identity):
    errors = []
    seen = set()
    for index, mapping in enumerate(mappings or []):
        key = component_mapping_identity('component', mapping)[1:]
        if key[0] and key in seen:
            errors.append({'path': f'{path}.{index}.code', 'message': 'This KSB is already mapped to this component.'})
        seen.add(key)
    return errors
