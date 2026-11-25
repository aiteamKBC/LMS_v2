"""Assemble ordered section trees and template results from existing Review reads."""
from __future__ import annotations

from curriculum_api.review_management.domain.template_rules import CONDITIONAL_FIELD_TYPE
from curriculum_api.catalogue.domain.values import as_json_value
from curriculum_api.catalogue.domain.values import clean_str
from collections import defaultdict
from curriculum_api.catalogue.domain.values import format_date
from curriculum_api.review_management.infrastructure.template_rows import get_review_field_rows
from curriculum_api.review_management.infrastructure.template_rows import get_review_section_rows
from curriculum_api.review_management.infrastructure.type_rows import get_review_type
from curriculum_api.catalogue.domain.values import parse_int


def review_field_payload(row, children_of):
    """``children_of(parent_id, condition)`` looks up a field's direct
    yes/no children within its own section. Recurses to any depth -- a
    conditional child may itself be a ``boolean_case_block`` with its own
    yesFields/noFields, and so on.
    """
    payload = {
        'id': row.get('id'),
        'reviewId': row.get('review_id'),
        'sectionId': row.get('section_id'),
        'parentFieldId': row.get('parent_field_id'),
        'conditionValue': row.get('condition_value'),
        'title': row.get('title') or '',
        'fieldType': row.get('field_type') or 'text',
        'required': bool(row.get('required')),
        'displayOrder': parse_int(row.get('display_order'), 0),
        'configuration': as_json_value(row.get('configuration'), {}),
        'createdAt': row.get('created_at'),
        'updatedAt': row.get('updated_at'),
    }
    if row.get('field_type') == CONDITIONAL_FIELD_TYPE:
        payload['yesFields'] = [review_field_payload(f, children_of) for f in children_of(row.get('id'), 'yes')]
        payload['noFields'] = [review_field_payload(f, children_of) for f in children_of(row.get('id'), 'no')]
    return payload


def assemble_review_sections(review_id, *, section_rows=None, field_rows=None):
    """Build the nested sections[].fields[].(yesFields|noFields) tree in memory.

    Exactly two queries regardless of how many sections/fields/children a
    Review has -- callers with 10 sections and 100 fields never issue more
    than get_review_section_rows + get_review_field_rows. The tree can be
    arbitrarily deep (a case block nested inside a case block, and so on);
    every level is resolved from the same two in-memory lists.
    """
    section_rows = get_review_section_rows(review_id) if section_rows is None else section_rows
    field_rows = get_review_field_rows(review_id) if field_rows is None else field_rows

    fields_by_section = defaultdict(list)
    for row in field_rows:
        fields_by_section[row.get('section_id')].append(row)

    sections = []
    for section in section_rows:
        section_id = section.get('id')
        section_rows_list = fields_by_section.get(section_id, [])

        def children_of(parent_id, condition, _rows=section_rows_list):
            return [
                row for row in _rows
                if row.get('parent_field_id') == parent_id and row.get('condition_value') == condition
            ]

        top_fields = [row for row in section_rows_list if not row.get('parent_field_id')]
        field_payloads = [review_field_payload(field_row, children_of) for field_row in top_fields]
        sections.append({
            'id': section.get('id'),
            'reviewId': section.get('review_id'),
            'title': section.get('title') or '',
            'estimatedMinutes': parse_int(section.get('estimated_minutes'), 0),
            'displayOrder': parse_int(section.get('display_order'), 0),
            'enabled': bool(section.get('enabled')),
            'fields': field_payloads,
        })
    return sections


def flatten_fields(sections):
    """Every top-level field across every section, in section then field order.

    A convenience view for callers of the first implementation, which only
    ever knew a single flat field list. Conditional children are deliberately
    excluded here -- they only exist nested under their parent.
    """
    flattened = []
    for section in sections:
        for field in section['fields']:
            flattened.append({k: v for k, v in field.items() if k not in ('yesFields', 'noFields')})
    return flattened


def review_template_summary_payload(row, *, type_index=None):
    """``type_index`` is review_types.review_type_index()'s {id: row} map --
    pass it when serialising a list so the type catalogue is read once for the
    whole response instead of once per Review."""
    type_row = _resolve_review_type(row.get('review_type_id'), type_index)
    return {
        'id': row.get('id'),
        'programmeId': row.get('programme_id') or '',
        'name': row.get('name') or '',
        'enabled': bool(row.get('enabled')),
        'recurrence': {
            'interval': parse_int(row.get('recurrence_interval'), 1),
            'unit': row.get('recurrence_unit') or 'weeks',
        },
        # The date the first occurrence is calculated from -- see
        # review_schedule.py, which is the only other reader of this column.
        'scheduleAnchorDate': format_date(row.get('schedule_anchor_date')),
        # None/unset means unlimited -- the review keeps recurring indefinitely.
        'occurrenceCount': row.get('occurrence_count'),
        # The Review's classification. ``reviewTypeId`` is the stable
        # identity everything downstream keys on; the code/name are echoed
        # for display and for Coach's calendar routing. Nothing anywhere
        # classifies a Review by ``name`` -- "Monthly Learner Catch-up" of
        # type Monthly Coaching Meeting still routes as MCM.
        'reviewTypeId': row.get('review_type_id') or '',
        'reviewTypeCode': (type_row or {}).get('code') or '',
        'reviewTypeName': (type_row or {}).get('name') or '',
        'applicableStatuses': as_json_value(row.get('applicable_statuses'), []),
        'applicability': as_json_value(row.get('applicability'), {'scope': 'programme', 'ids': []}),
        'fieldCount': parse_int(row.get('field_count'), 0),
        'createdAt': row.get('created_at'),
        'updatedAt': row.get('updated_at'),
    }


def review_template_detail_payload(row, sections=None, *, type_index=None):
    sections = assemble_review_sections(row.get('id')) if sections is None else sections
    return {
        **review_template_summary_payload(row, type_index=type_index),
        'signatures': {
            'advisor': bool(row.get('signature_advisor')),
            'employer': bool(row.get('signature_employer')),
            'participant': bool(row.get('signature_participant')),
            'referrer': bool(row.get('signature_referrer')),
        },
        'visibleTo': {
            'advisor': bool(row.get('visible_advisor')),
            'employer': bool(row.get('visible_employer')),
            'participant': bool(row.get('visible_participant')),
            'referrer': bool(row.get('visible_referrer')),
        },
        'recordTimeSpent': bool(row.get('record_time_spent')),
        'expectedOtjh': float(row.get('expected_otjh') or 0),
        # Whether completing an occurrence of this review adds expectedOtjh
        # hours to the learner's total OTJH.
        'countsTowardsOtjh': bool(row.get('counts_towards_otjh')),
        'allowEditingPriorDays': parse_int(row.get('allow_editing_prior_days'), 0),
        'notifications': {
            'employer': bool(row.get('notify_employer')),
            'participant': bool(row.get('notify_participant')),
        },
        'incompleteMarker': row.get('incomplete_marker') or '',
        'createdBy': row.get('created_by') or '',
        'updatedBy': row.get('updated_by') or '',
        'sections': sections,
        # Flattened convenience view -- see module docstring.
        'fields': flatten_fields(sections),
    }


def _resolve_review_type(review_type_id, type_index=None):
    review_type_id = clean_str(review_type_id)
    if not review_type_id:
        return None
    if type_index is not None:
        return type_index.get(review_type_id)
    return get_review_type(review_type_id)
