"""Validate template edits against current type and programme placement records."""
from __future__ import annotations

from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import COHORT_AUTHORING_DETAILS_TABLE
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import GROUPS_TABLE
from curriculum_api.review_management.domain.template_rules import MEETING_SUMMARY_SEMANTIC_KEY
from curriculum_api.review_management.domain.template_rules import PARTICIPANT_ROLES
from curriculum_api.review_management.domain.classification import REVIEW_TYPE_CODE_MCM
from curriculum_api.review_management.domain.classification import REVIEW_TYPE_CODE_PROGRESS_REVIEW
from curriculum_api.review_management.domain.template_rules import _sections_payload_from
from curriculum_api.catalogue.infrastructure.authoring_runtime import authoring_fetch_all
from curriculum_api.catalogue.domain.values import clean_str
from datetime import datetime
from curriculum_api.review_management.infrastructure.type_rows import get_review_type
from curriculum_api.catalogue.domain.values import parse_date
from curriculum_api.review_management.domain.template_rules import validate_expected_otjh
from curriculum_api.review_management.domain.template_rules import validate_occurrence_count
from curriculum_api.review_management.domain.template_rules import validate_recurrence
from curriculum_api.review_management.domain.template_rules import validate_section_payload
from curriculum_api.review_management.domain.template_rules import validate_statuses


def validate_schedule_anchor_date(payload, errors, *, required=True):
    """The date recurrence is calculated from -- see review_schedule.py.

    A canonical ISO date string ('2027-01-15') is required whenever the field
    is present at all; an unparseable value is an error rather than silently
    falling back, since a wrong anchor silently produces a wrong occurrence
    schedule with no error ever surfacing to the user.
    """
    raw = payload.get('scheduleAnchorDate')
    if raw is None:
        if required:
            return datetime.utcnow().date()
        return None
    parsed = parse_date(raw)
    if not parsed:
        errors['scheduleAnchorDate'] = 'Schedule anchor date must be a valid date.'
        return None
    return parsed


def validate_review_type_id(payload, errors):
    """The Review's classification -- required, and always a review_types.id.

    Never a name: the type is what Coach routes on, so it has to survive the
    Review being renamed. An archived (inactive) type is still accepted on an
    existing Review so that deactivating a type never blocks editing the
    Reviews already classified with it.
    """
    raw = clean_str(payload.get('reviewTypeId'))
    if not raw:
        errors['reviewTypeId'] = 'Review type is required.'
        return None
    if not get_review_type(raw):
        errors['reviewTypeId'] = 'Choose a valid review type.'
        return None
    return raw


def validate_applicability(value, programme_id, errors):
    if not isinstance(value, dict) or value.get('scope') not in ('programme', 'cohort', 'group'):
        errors['applicability'] = 'Choose programme, cohort or group applicability.'
        return None
    scope, identifiers = value['scope'], value.get('ids', [])
    if not isinstance(identifiers, list) or any(not isinstance(item, str) or not item.strip() for item in identifiers):
        errors['applicability'] = 'Select valid cohort or group identifiers.'
        return None
    identifiers = list(dict.fromkeys(item.strip() for item in identifiers))
    if scope == 'programme':
        if identifiers:
            errors['applicability'] = 'Programme applicability cannot include cohort or group identifiers.'
        return {'scope': scope, 'ids': []}
    if not identifiers:
        errors['applicability'] = 'Select at least one cohort or group.'
        return None
    table = COHORT_AUTHORING_DETAILS_TABLE if scope == 'cohort' else GROUPS_TABLE
    rows = authoring_fetch_all(table, 'programme_id = %s', [programme_id])
    allowed = {clean_str(row.get(f'{scope}_id')) for row in rows}
    if not set(identifiers).issubset(allowed):
        errors['applicability'] = 'Selected cohorts or groups must belong to this programme.'
    return {'scope': scope, 'ids': identifiers}


def validate_review_payload(
    payload, *, partial=False, programme_id=None, current_review_type_id=None,
    current_signature_referrer=False,
):
    """Returns (cleaned, errors). ``partial`` allows PATCH to omit unset fields.

    ``current_signature_referrer`` is the stored template's value on update, so
    a legacy template already requiring a Referrer signature can still be saved
    unchanged while no new Referrer requirement can be introduced."""
    errors = {}
    cleaned = {}

    if not partial or 'name' in payload:
        name = clean_str(payload.get('name'))
        if not name:
            errors['name'] = 'Review name is required.'
        cleaned['name'] = name

    if not partial or 'enabled' in payload:
        cleaned['enabled'] = bool(payload.get('enabled', True))

    if not partial or 'recurrence' in payload or 'recurrenceInterval' in payload or 'recurrenceUnit' in payload:
        interval, unit = validate_recurrence(payload, errors, required=not partial)
        if interval is not None:
            cleaned['recurrence_interval'] = interval
            cleaned['recurrence_unit'] = unit

    if not partial or 'scheduleAnchorDate' in payload:
        anchor = validate_schedule_anchor_date(payload, errors, required=not partial)
        if anchor is not None:
            cleaned['schedule_anchor_date'] = anchor

    if not partial or 'reviewTypeId' in payload:
        review_type_id = validate_review_type_id(payload, errors)
        if review_type_id is not None:
            cleaned['review_type_id'] = review_type_id

    if not partial or 'occurrenceCount' in payload:
        cleaned['occurrence_count'] = validate_occurrence_count(payload, errors)

    if not partial or 'applicableStatuses' in payload:
        cleaned['applicable_statuses'] = validate_statuses(payload, errors)

    if not partial or 'applicability' in payload:
        cleaned['applicability'] = validate_applicability(
            payload.get('applicability', {'scope': 'programme', 'ids': []}), programme_id, errors,
        )

    signatures = payload.get('signatures') if isinstance(payload.get('signatures'), dict) else {}
    if not partial or 'signatures' in payload:
        for role in PARTICIPANT_ROLES:
            cleaned[f'signature_{role}'] = bool(signatures.get(role))
        # Referrer stays a structural role, but nobody can sign as one yet, so a
        # new Referrer requirement would leave its Reviews stuck awaiting signature.
        if cleaned['signature_referrer'] and not current_signature_referrer:
            errors['signatures'] = 'Referrer signatures are not currently supported.'

    visible_to = payload.get('visibleTo') if isinstance(payload.get('visibleTo'), dict) else {}
    if not partial or 'visibleTo' in payload:
        for role in PARTICIPANT_ROLES:
            cleaned[f'visible_{role}'] = bool(visible_to.get(role, True))

    if not partial or 'recordTimeSpent' in payload:
        cleaned['record_time_spent'] = bool(payload.get('recordTimeSpent'))

    if not partial or 'expectedOtjh' in payload:
        cleaned['expected_otjh'] = validate_expected_otjh(payload, errors)

    if not partial or 'countsTowardsOtjh' in payload:
        cleaned['counts_towards_otjh'] = bool(payload.get('countsTowardsOtjh'))

    if not partial or 'allowEditingPriorDays' in payload:
        try:
            prior_days = int(payload.get('allowEditingPriorDays', 0) or 0)
        except (TypeError, ValueError):
            prior_days = -1
        if prior_days < 0:
            errors['allowEditingPriorDays'] = 'Allow editing prior days must be zero or a positive number.'
            prior_days = 0
        cleaned['allow_editing_prior_days'] = prior_days

    notifications = payload.get('notifications') if isinstance(payload.get('notifications'), dict) else {}
    if not partial or 'notifications' in payload:
        cleaned['notify_employer'] = bool(notifications.get('employer'))
        cleaned['notify_participant'] = bool(notifications.get('participant'))

    if not partial or 'incompleteMarker' in payload:
        cleaned['incomplete_marker'] = clean_str(payload.get('incompleteMarker'))

    sections_payload = _sections_payload_from(payload)
    cleaned_sections = None
    if sections_payload is not None:
        if not isinstance(sections_payload, list):
            errors['sections'] = 'sections must be a list.'
        else:
            cleaned_sections = [validate_section_payload(section, index, errors) for index, section in enumerate(sections_payload)]
            semantic_fields = []

            def _collect_semantic_fields(fields):
                for field in fields or []:
                    if (field.get('configuration') or {}).get('semanticKey') == MEETING_SUMMARY_SEMANTIC_KEY:
                        semantic_fields.append(field)
                    _collect_semantic_fields(field.get('yes_fields'))
                    _collect_semantic_fields(field.get('no_fields'))

            for section in cleaned_sections:
                _collect_semantic_fields(section.get('fields'))
            if semantic_fields:
                review_type_id = (
                    cleaned.get('review_type_id')
                    or clean_str(payload.get('reviewTypeId'))
                    or clean_str(current_review_type_id)
                )
                type_row = get_review_type(review_type_id) if review_type_id else None
                if (type_row or {}).get('code') not in {
                    REVIEW_TYPE_CODE_MCM,
                    REVIEW_TYPE_CODE_PROGRESS_REVIEW,
                }:
                    errors['sections'] = 'Only a Monthly Coaching Meeting or Progress Review may define a Meeting Summary field.'
                elif len(semantic_fields) > 1:
                    errors['sections'] = 'A Review can define only one Meeting Summary field.'
                elif semantic_fields[0].get('field_type') not in ('text', 'text_multiline'):
                    errors['sections'] = 'The Meeting Summary field must be a text field.'
    cleaned['_sections'] = cleaned_sections

    return cleaned, errors
