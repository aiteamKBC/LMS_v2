"""Review field trees, recurrence inputs, eligibility statuses and validation errors; pure rules."""
from __future__ import annotations

from learner_api.constants import PROGRAMME_STATUS_CHOICES
from curriculum_api.catalogue.domain.values import clean_str


RECURRENCE_UNITS = ('days', 'weeks', 'months')


FIELD_TYPES = (
    'text', 'boolean', 'numeric', 'date', 'list_item', 'boolean_case_block',
    'email', 'phone', 'postcode_address', 'title_description', 'text_multiline',
    'action_button',
)


FIELD_TYPES_REQUIRING_TITLE = FIELD_TYPES


DISPLAY_ONLY_FIELD_TYPES = ('title_description', 'action_button')


CONDITIONAL_FIELD_TYPE = 'boolean_case_block'


CONDITION_VALUES = ('yes', 'no')


MEETING_SUMMARY_SEMANTIC_KEY = 'meeting_summary'


PARTICIPANT_ROLES = ('advisor', 'employer', 'participant', 'referrer')


FIELD_RESPONDENT_ROLES = ('participant', 'employer')


def validate_recurrence(payload, errors, *, required=True):
    interval_raw = payload.get('recurrence', {}) if isinstance(payload.get('recurrence'), dict) else {}
    interval = interval_raw.get('interval', payload.get('recurrenceInterval'))
    unit = clean_str(interval_raw.get('unit', payload.get('recurrenceUnit'))).lower()

    if interval is None and not required:
        return None, None
    try:
        interval = int(interval)
    except (TypeError, ValueError):
        errors['recurrenceInterval'] = 'Repeat interval must be a whole number.'
        return None, None
    if interval <= 0:
        errors['recurrenceInterval'] = 'Repeat interval must be a positive number.'
    if not unit:
        unit = 'weeks'
    if unit not in RECURRENCE_UNITS:
        errors['recurrenceUnit'] = f'Repeat unit must be one of: {", ".join(RECURRENCE_UNITS)}.'
    return interval, unit


def validate_occurrence_count(payload, errors):
    """How many times a Review recurs before it stops -- optional; blank/None
    means unlimited (the field's existing, still-default behaviour).
    """
    raw = payload.get('occurrenceCount')
    if raw is None or raw == '':
        return None
    try:
        count = int(raw)
    except (TypeError, ValueError):
        errors['occurrenceCount'] = 'Number of occurrences must be a whole number.'
        return None
    if count <= 0:
        errors['occurrenceCount'] = 'Number of occurrences must be a positive number.'
        return None
    return count


def validate_expected_otjh(payload, errors):
    """Expected OTJH hours for one occurrence of this review -- see
    ``validate_review_payload``'s ``countsTowardsOtjh`` handling for whether
    completing it actually adds that many hours to the learner's total (the
    module docstring's future ``learner_review_instances`` is where that flag
    gets acted on)."""
    try:
        expected_otjh = float(payload.get('expectedOtjh', 0) or 0)
    except (TypeError, ValueError):
        errors['expectedOtjh'] = 'Expected OTJH must be a number.'
        return 0
    if expected_otjh < 0:
        errors['expectedOtjh'] = 'Expected OTJH must be zero or a positive number.'
        return 0
    return expected_otjh


def validate_statuses(payload, errors):
    statuses = payload.get('applicableStatuses')
    if statuses is None:
        return []
    if not isinstance(statuses, list):
        errors['applicableStatuses'] = 'applicableStatuses must be a list.'
        return []
    canonical = set(PROGRAMME_STATUS_CHOICES)
    cleaned = []
    invalid = []
    for value in statuses:
        text = clean_str(value)
        if not text:
            continue
        if text not in canonical:
            invalid.append(text)
            continue
        if text not in cleaned:
            cleaned.append(text)
    if invalid:
        errors['applicableStatuses'] = f'Unknown programme status: {", ".join(invalid)}.'
    return cleaned


def _validate_field_configuration(field_type, configuration, path, errors):
    """Returns the cleaned configuration for this field type."""
    if field_type == 'list_item':
        options = configuration.get('options')
        cleaned_options = [clean_str(o) for o in options if clean_str(o)] if isinstance(options, list) else []
        if not cleaned_options:
            errors[f'{path}.configuration.options'] = 'List item fields need at least one option.'
        # De-duplicate while preserving order -- accidental duplicate options
        # (e.g. pasted twice) are silently folded rather than rejected.
        seen = set()
        deduped = []
        for option in cleaned_options:
            if option in seen:
                continue
            seen.add(option)
            deduped.append(option)
        return {**configuration, 'options': deduped}

    if field_type == 'title_description':
        return {**configuration, 'description': clean_str(configuration.get('description'))}

    return configuration if isinstance(configuration, dict) else {}


MAX_FIELD_NESTING_DEPTH = 8


def validate_field_payload(field, path, errors, *, depth=0):
    """Validate one Field (top-level or a conditional child, at any depth).
    Returns cleaned dict.

    ``path`` is the dotted/bracketed location used in error keys, e.g.
    ``sections[0].fields[1]`` or ``sections[0].fields[1].yesFields[0].yesFields[2]``.
    """
    if not isinstance(field, dict):
        field = {}

    field_type = clean_str(field.get('fieldType')).lower() or 'text'
    if field_type not in FIELD_TYPES:
        errors[f'{path}.fieldType'] = f'Unknown field type "{field_type}".'
        field_type = 'text'

    title = clean_str(field.get('title'))
    if not title:
        errors[f'{path}.title'] = "Title can't be empty."

    required = bool(field.get('required')) if field_type not in DISPLAY_ONLY_FIELD_TYPES else False
    configuration = field.get('configuration') if isinstance(field.get('configuration'), dict) else {}
    configuration = _validate_field_configuration(field_type, configuration, path, errors)

    # Who besides the advisor (coach) may answer this field, e.g. so a
    # Learner or Employer can complete their own part of the meeting record.
    # A display-only block (title_description/action_button) never collects
    # an answer, so it never carries a respondent list.
    if field_type in DISPLAY_ONLY_FIELD_TYPES:
        configuration = {k: v for k, v in configuration.items() if k != 'respondentRoles'}
    else:
        posted_roles = configuration.get('respondentRoles')
        respondent_roles = sorted({
            role for role in (posted_roles if isinstance(posted_roles, list) else [])
            if role in FIELD_RESPONDENT_ROLES
        })
        configuration = {**configuration, 'respondentRoles': respondent_roles}

    cleaned = {
        'id': clean_str(field.get('id')),
        'title': title,
        'field_type': field_type,
        'required': required,
        'configuration': configuration,
        'yes_fields': [],
        'no_fields': [],
    }

    yes_fields_payload = field.get('yesFields')
    no_fields_payload = field.get('noFields')
    has_conditional_payload = bool(yes_fields_payload) or bool(no_fields_payload)

    if field_type != CONDITIONAL_FIELD_TYPE:
        if has_conditional_payload:
            errors[f'{path}.yesFields'] = 'Only "Boolean with case block" fields may have conditional fields.'
        return cleaned

    if depth >= MAX_FIELD_NESTING_DEPTH:
        errors[f'{path}.fieldType'] = f'"Boolean with case block" fields cannot nest more than {MAX_FIELD_NESTING_DEPTH} levels deep.'
        return cleaned

    for branch_key, branch_payload in (('yes_fields', yes_fields_payload), ('no_fields', no_fields_payload)):
        branch_name = 'yesFields' if branch_key == 'yes_fields' else 'noFields'
        if branch_payload is None:
            continue
        if not isinstance(branch_payload, list):
            errors[f'{path}.{branch_name}'] = f'{branch_name} must be a list.'
            continue
        cleaned[branch_key] = [
            validate_field_payload(child, f'{path}.{branch_name}[{index}]', errors, depth=depth + 1)
            for index, child in enumerate(branch_payload)
        ]

    return cleaned


def validate_section_payload(section, index, errors):
    if not isinstance(section, dict):
        section = {}

    path = f'sections[{index}]'
    title = clean_str(section.get('title'))
    if not title:
        errors[f'{path}.title'] = "Section title can't be empty."

    try:
        estimated_minutes = int(section.get('estimatedMinutes', 0) or 0)
    except (TypeError, ValueError):
        estimated_minutes = -1
    if estimated_minutes < 0:
        errors[f'{path}.estimatedMinutes'] = 'Estimated time must be zero or a positive number of minutes.'
        estimated_minutes = 0

    fields_payload = section.get('fields')
    cleaned_fields = []
    if fields_payload is not None:
        if not isinstance(fields_payload, list):
            errors[f'{path}.fields'] = 'fields must be a list.'
        else:
            cleaned_fields = [
                validate_field_payload(field, f'{path}.fields[{i}]', errors)
                for i, field in enumerate(fields_payload)
            ]

    return {
        'id': clean_str(section.get('id')),
        'title': title,
        'estimated_minutes': estimated_minutes,
        'enabled': bool(section.get('enabled', True)),
        'fields': cleaned_fields,
    }


def _sections_payload_from(payload):
    """Accepts either the new ``sections`` shape or the legacy flat ``fields`` shape."""
    if payload.get('sections') is not None:
        return payload.get('sections')
    if payload.get('fields') is not None:
        return [{'title': 'General', 'estimatedMinutes': 0, 'enabled': True, 'fields': payload.get('fields')}]
    return None
