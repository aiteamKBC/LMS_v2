"""Component assurance, KSB shapes, comparison keys and reusable-template scope rules."""

from .archive_policy import programme_deleted_row

from curriculum_api.catalogue.domain.component_types import is_retired_component_type as _default_is_retired_component_type
from curriculum_api.catalogue.domain.content_validation import component_expected_otjh
from curriculum_api.catalogue.domain.read_contracts import AUTHORING_COMPARE_IGNORED_COLUMNS as _default_AUTHORING_COMPARE_IGNORED_COLUMNS
from curriculum_api.catalogue.domain.read_contracts import AUTHORING_JSON_COMPARE_COLUMNS as _default_AUTHORING_JSON_COMPARE_COLUMNS
from curriculum_api.catalogue.domain.read_contracts import SUPPORTED_KSB_WEIGHT_CLASSES
from curriculum_api.catalogue.domain.values import as_json_value as _default_as_json_value
from curriculum_api.catalogue.domain.values import bool_payload as _default_bool_payload
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str
from curriculum_api.catalogue.domain.values import parse_float
from curriculum_api.catalogue.domain.values import parse_int
from curriculum_api.catalogue.domain.values import parse_json_value as _default_parse_json_value
import json as _default_json
import re


def component_reflection_question(
    row,
    settings=None,
    *,
    LEGACY_REFLECTION_QUESTION_SETTING,
    REFLECTION_QUESTION_COLUMN,
    clean_str=_default_clean_str,
    component_builder_settings,
):
    """The reflection question stored against a component row.

    The column is the source of truth. Rows written before it existed kept the
    same text under ``settings_json.reflectionPrompt``, so that is the fallback
    - and a narrowed read that skipped ``settings_json`` simply falls back to
    nothing rather than reporting the question as cleared.
    """
    stored = clean_str(row.get(REFLECTION_QUESTION_COLUMN))
    if stored:
        return stored
    if settings is None:
        settings = component_builder_settings(row)
    settings = settings if isinstance(settings, dict) else {}
    return clean_str(settings.get(LEGACY_REFLECTION_QUESTION_SETTING))


def component_coach_validation(row, *, bool_payload=_default_bool_payload):
    """Whether a coach has to validate this component.

    On unless the row says otherwise. The column arrived after the table, so a
    row written before it - or a narrowed read that never selected it - reports
    ``None``, and that means "nobody turned it off", not "off".
    """
    value = row.get('coach_validation_required')
    return True if value is None else bool_payload(value)


def payload_coach_validation(component, default=True, *, bool_payload=_default_bool_payload):
    """What a component payload is asking us to store for coach validation.

    Either spelling counts, and an explicit ``False`` turns it off. A payload
    naming neither is older than the field, so the default stands rather than
    silently clearing a flag the author never saw.
    """
    for key in ('coachValidationRequired', 'coach_validation_required'):
        if key in component:
            return bool_payload(component.get(key))
    return default


def component_ksb_mappings_from_row(
    row,
    projection_rows=None,
    *,
    as_json_value=_default_as_json_value,
    component_ksb_mapping_json_item,
    coverage_normalise_code,
):
    canonical = as_json_value((row or {}).get('ksb_mappings'), [])
    if isinstance(canonical, list) and canonical:
        return [
            component_ksb_mapping_json_item({
                'id': mapping.get('id'),
                'standard_ksb_id': mapping.get('standardKsbId') or mapping.get('standard_ksb_id'),
                'ksb_id': mapping.get('ksbId') or mapping.get('ksb_id'),
                'ksb_code': mapping.get('code') or mapping.get('ksbCode') or mapping.get('ksb_code'),
                'ksb_description': mapping.get('description') or mapping.get('ksbDescription') or mapping.get('ksb_description'),
                'source_type': mapping.get('sourceType') or mapping.get('source_type'),
                'source_id': mapping.get('sourceId') or mapping.get('source_id'),
                'classification': mapping.get('classification') or mapping.get('type'),
                'weight_class': mapping.get('weight_class') or mapping.get('weightClass'),
                'weight': mapping.get('weight'),
            })
            for mapping in canonical
            if isinstance(mapping, dict) and coverage_normalise_code(mapping.get('code') or mapping.get('ksbCode') or mapping.get('ksb_code'))
        ]
    return [
        component_ksb_mapping_json_item(mapping)
        for mapping in (projection_rows or [])
        if coverage_normalise_code(mapping.get('ksb_code') or mapping.get('code'))
    ]


def week_template_scope_fields(payload, course_type, *, clean_str=_default_clean_str):
    if course_type == 'free':
        return {
            'programme_id': None,
            'programme_name': '',
            'module_catalogue_id': None,
            'group_id': None,
            'group_name': '',
        }
    return {
        'programme_id': clean_str(payload.get('programmeId')) or None,
        'programme_name': clean_str(payload.get('programmeName')),
        'module_catalogue_id': clean_str(payload.get('moduleCatalogueId')) or None,
        'group_id': clean_str(payload.get('groupId')) or None,
        'group_name': clean_str(payload.get('groupName')),
    }


def active_component_rows(
    rows,
    *,
    is_retired_component_type=_default_is_retired_component_type,
    programme_deleted_row=programme_deleted_row,
):
    return [
        row for row in rows
        if not is_retired_component_type(row.get('type'))
        and not programme_deleted_row(row)
    ]


def authoring_comparable(
    column,
    value,
    *,
    AUTHORING_JSON_COMPARE_COLUMNS=_default_AUTHORING_JSON_COMPARE_COLUMNS,
    parse_json_value=_default_parse_json_value,
):
    if column in AUTHORING_JSON_COMPARE_COLUMNS:
        return parse_json_value(value, value)
    if isinstance(value, bool) or value is None:
        return value
    if isinstance(value, (int, float)) or type(value).__name__ == 'Decimal':
        return float(value)
    return value


def authoring_row_differs(
    payload,
    stored_row,
    *,
    AUTHORING_COMPARE_IGNORED_COLUMNS=_default_AUTHORING_COMPARE_IGNORED_COLUMNS,
    authoring_comparable=authoring_comparable,
):
    """Would writing ``payload`` change ``stored_row``? Timestamps aside.

    Errs towards True: a value that merely looks different is written, which
    costs a row, never correctness.
    """
    if not stored_row:
        return True
    for column, value in payload.items():
        if column in AUTHORING_COMPARE_IGNORED_COLUMNS or column not in stored_row:
            continue
        if authoring_comparable(column, value) != authoring_comparable(column, stored_row.get(column)):
            return True
    return False


def authoring_mapping_signature(
    rows,
    *,
    AUTHORING_COMPARE_IGNORED_COLUMNS=_default_AUTHORING_COMPARE_IGNORED_COLUMNS,
    authoring_comparable=authoring_comparable,
    json=_default_json,
):
    """What an owner's KSB mappings say, without their ids.

    By content because a mapping that arrives without an id is minted a fresh
    one on every save: compared by id, an untouched component would always
    look changed.
    """
    return sorted(
        json.dumps({
            column: authoring_comparable(column, value)
            for column, value in row.items()
            if column not in AUTHORING_COMPARE_IGNORED_COLUMNS
            and column not in {'id', 'deleted_at', 'deleted_by', 'deleted_via_parent', 'is_programme_deleted'}
        }, sort_keys=True, default=str)
        for row in rows
    )


def authoring_mapping_owner(row, *, clean_str=_default_clean_str):
    if clean_str(row.get('component_id')):
        return ('component', clean_str(row.get('component_id')))
    if clean_str(row.get('week_id')):
        return ('week', clean_str(row.get('week_id')))
    return ('module', '')


def otjh_rounded_minutes(value):
    number = parse_float(value, 0)
    if number <= 0:
        return 0
    return int((number * 60) + 0.5)


def otjh_hours_from_minutes(total_minutes):
    try:
        minutes = int(total_minutes)
    except (TypeError, ValueError):
        minutes = 0
    return round(minutes / 60, 2)


def component_expected_otjh_minutes(component, default=2):
    return otjh_rounded_minutes(component_expected_otjh(component, default))


def normalise_ksb_weight_class(value, fallback='soft'):
    raw = clean_str(value).lower().replace('_', '-')
    if raw in SUPPORTED_KSB_WEIGHT_CLASSES:
        return raw
    return fallback if fallback in SUPPORTED_KSB_WEIGHT_CLASSES else 'soft'


def normalise_ksb_weight(value):
    return max(0, parse_float(value, 0))


def component_ksb_mapping_json_item(
    mapping_payload,
    *,
    clean_str=_default_clean_str,
    coverage_normalise_code,
    legacy_weight_class_from_classification,
    normalise_ksb_classification,
    normalise_ksb_weight=normalise_ksb_weight,
    normalise_ksb_weight_class=normalise_ksb_weight_class,
):
    classification = normalise_ksb_classification(mapping_payload.get('classification'))
    weight_class = normalise_ksb_weight_class(
        mapping_payload.get('weight_class') if 'weight_class' in mapping_payload else mapping_payload.get('weightClass'),
        legacy_weight_class_from_classification(classification),
    )
    code = coverage_normalise_code(mapping_payload.get('ksb_code') or mapping_payload.get('code'))
    ksb_id = clean_str(mapping_payload.get('ksb_id') or mapping_payload.get('ksbId') or code)
    return {
        'id': clean_str(mapping_payload.get('id')),
        **({'standard_ksb_id': mapping_payload['standard_ksb_id']} if mapping_payload.get('standard_ksb_id') else {}),
        'ksb_id': ksb_id,
        'ksb_code': code,
        'description': clean_str(mapping_payload.get('ksb_description') or mapping_payload.get('description')),
        'source_type': clean_str(mapping_payload.get('source_type') or mapping_payload.get('sourceType')),
        'source_id': clean_str(mapping_payload.get('source_id') or mapping_payload.get('sourceId')),
        'classification': classification,
        'weight': normalise_ksb_weight(mapping_payload.get('weight')),
        'weight_class': weight_class,
    }


def component_ksb_mapping_api_item(
    mapping,
    *,
    clean_str=_default_clean_str,
    coverage_normalise_code,
    legacy_weight_class_from_classification,
    normalise_ksb_classification,
    normalise_ksb_weight=normalise_ksb_weight,
    normalise_ksb_weight_class=normalise_ksb_weight_class,
):
    classification = normalise_ksb_classification(mapping.get('classification') or mapping.get('type'))
    weight_class = normalise_ksb_weight_class(mapping.get('weight_class') or mapping.get('weightClass'), legacy_weight_class_from_classification(classification))
    code = coverage_normalise_code(mapping.get('ksb_code') or mapping.get('code'))
    ksb_id = clean_str(mapping.get('ksb_id') or mapping.get('ksbId') or code)
    return {
        'id': clean_str(mapping.get('id')),
        **({'standardKsbId': mapping['standard_ksb_id']} if mapping.get('standard_ksb_id') else {}),
        'ksbId': ksb_id,
        'code': code,
        'description': clean_str(mapping.get('description') or mapping.get('ksb_description')),
        'sourceType': clean_str(mapping.get('source_type') or mapping.get('sourceType')),
        'sourceId': clean_str(mapping.get('source_id') or mapping.get('sourceId')),
        'classification': classification,
        'type': classification,
        'weight': normalise_ksb_weight(mapping.get('weight')),
        'weightClass': weight_class,
        'weight_class': weight_class,
    }


def training_module_identifier(training_id):
    return f'training-module-{clean_str(training_id)}'


def parse_week_number(value):
    match = re.search(r'\d+', str(value or ''))
    return max(1, parse_int(match.group(0), 1)) if match else 1
