"""Create, edit, archive and clone templates with unchanged transaction and cache timing."""
from __future__ import annotations

from curriculum_api.review_management.infrastructure.relations import REVIEW_FIELDS_TABLE
from curriculum_api.review_management.infrastructure.relations import REVIEW_SECTIONS_TABLE
from curriculum_api.review_management.infrastructure.relations import REVIEW_TEMPLATES_TABLE
from curriculum_api.catalogue.domain.values import as_json_value
from datetime import datetime
from collections import defaultdict
from curriculum_api.review_management.infrastructure.template_rows import existing_review_ids
from curriculum_api.review_management.infrastructure.template_rows import get_review_field_rows
from curriculum_api.review_management.infrastructure.template_rows import get_review_section_rows
from curriculum_api.review_management.infrastructure.template_rows import get_review_template_row
from curriculum_api.catalogue.infrastructure.authoring_storage import insert_row
from curriculum_api.catalogue.infrastructure.row_queries import json_db_value
from curriculum_api.review_management.infrastructure.template_rows import save_review_sections
from curriculum_api.catalogue.infrastructure.lifecycle_persistence import soft_delete_rows
from django.db import transaction
from curriculum_api.catalogue.infrastructure.record_identity import unique_prefixed_id
from curriculum_api.catalogue.infrastructure.authoring_storage import update_rows
from curriculum_api.review_management.application.template_validation import validate_review_payload


def create_review(programme_id, payload, *, actor='system', invalidate_curriculum_cache):
    cleaned, errors = validate_review_payload(payload, partial=False, programme_id=programme_id)
    if errors:
        return None, errors

    review_id = unique_prefixed_id('REV', payload.get('id'), existing_review_ids)
    sections = cleaned.pop('_sections') or []

    with transaction.atomic():
        insert_row(REVIEW_TEMPLATES_TABLE, {
            'id': review_id,
            'programme_id': programme_id,
            **{k: v for k, v in cleaned.items()},
            'applicable_statuses': json_db_value(cleaned['applicable_statuses']),
            'applicability': json_db_value(cleaned['applicability']),
            'field_count': 0,
            'created_by': actor,
            'updated_by': actor,
            'created_at': datetime.utcnow(),
            'updated_at': datetime.utcnow(),
        })
        field_count = save_review_sections(review_id, sections)
        update_rows(REVIEW_TEMPLATES_TABLE, 'id = %s', [review_id], {
            'field_count': field_count, 'updated_at': datetime.utcnow(),
        })

    invalidate_curriculum_cache()
    return review_id, None


def update_review(review_id, payload, *, actor='system', invalidate_curriculum_cache):
    row = get_review_template_row(review_id)
    if not row:
        return None, {'_': 'Review not found.'}

    cleaned, errors = validate_review_payload(
        payload,
        partial=True,
        programme_id=row['programme_id'],
        current_review_type_id=row.get('review_type_id'),
        current_signature_referrer=bool(row.get('signature_referrer')),
    )
    if errors:
        return None, errors

    sections = cleaned.pop('_sections')
    updates = dict(cleaned)
    if 'applicable_statuses' in updates:
        updates['applicable_statuses'] = json_db_value(updates['applicable_statuses'])
    if 'applicability' in updates:
        updates['applicability'] = json_db_value(updates['applicability'])
    updates['updated_by'] = actor
    updates['updated_at'] = datetime.utcnow()

    with transaction.atomic():
        if updates:
            update_rows(REVIEW_TEMPLATES_TABLE, 'id = %s', [review_id], updates)
        if sections is not None:
            field_count = save_review_sections(review_id, sections)
            update_rows(REVIEW_TEMPLATES_TABLE, 'id = %s', [review_id], {
                'field_count': field_count, 'updated_at': datetime.utcnow(),
            })

    invalidate_curriculum_cache()
    return review_id, None


def archive_review(review_id, *, actor='review-delete', invalidate_curriculum_cache):
    row = get_review_template_row(review_id)
    if not row:
        return False
    soft_delete_rows(
        REVIEW_TEMPLATES_TABLE, 'id = %s', [review_id], deleted_by=actor,
    )
    # Sections follow the Review: no orphan active section for an archived
    # Review, even though its fields (and the sections themselves) are left
    # in the database rather than hard-deleted, matching how fields already
    # survive a Review archive.
    soft_delete_rows(
        REVIEW_SECTIONS_TABLE, 'review_id = %s', [review_id], deleted_by=actor, via_parent=review_id,
    )
    invalidate_curriculum_cache()
    return True


def clone_review(source_row, destination_programme_id, *, actor='review-clone'):
    """Deep-copy one Review -- every Section, Field and conditional child --
    into another Programme, with fresh ids throughout. Parent ids on cloned
    conditional children are remapped to the *new* parent Field id; the
    source Review is never touched.

    Deliberately does not touch review_schedule.py's tables: a clone starts
    with no occurrence overrides and no clash-resolution acknowledgements --
    those are schedule *history* for the source Programme, not part of the
    template definition."""
    new_id = unique_prefixed_id('REV', '', existing_review_ids)
    copy_columns = (
        'name', 'enabled', 'recurrence_interval', 'recurrence_unit', 'schedule_anchor_date', 'occurrence_count', 'applicable_statuses',
        'review_type_id',
        'signature_advisor', 'signature_employer', 'signature_participant', 'signature_referrer',
        'visible_advisor', 'visible_employer', 'visible_participant', 'visible_referrer',
        'record_time_spent', 'expected_otjh', 'counts_towards_otjh', 'allow_editing_prior_days', 'notify_employer', 'notify_participant',
        'incomplete_marker', 'field_count',
    )
    insert_payload = {column: source_row.get(column) for column in copy_columns}
    applicability = as_json_value(source_row.get('applicability'), {'scope': 'programme', 'ids': []})
    if source_row.get('programme_id') == destination_programme_id:
        insert_payload['applicability'] = json_db_value(applicability)
    elif applicability.get('scope') != 'programme':
        # The destination has different placement IDs. Require an explicit
        # applicability choice before a restricted clone starts generating.
        insert_payload['enabled'] = False
        insert_payload['applicability'] = json_db_value({'scope': 'programme', 'ids': []})
    insert_row(REVIEW_TEMPLATES_TABLE, {
        'id': new_id,
        'programme_id': destination_programme_id,
        **insert_payload,
        'created_by': actor,
        'updated_by': actor,
        'created_at': datetime.utcnow(),
        'updated_at': datetime.utcnow(),
    })

    for section in get_review_section_rows(source_row.get('id')):
        new_section_id = unique_prefixed_id('REVS')
        insert_row(REVIEW_SECTIONS_TABLE, {
            'id': new_section_id,
            'review_id': new_id,
            'title': section.get('title'),
            'estimated_minutes': section.get('estimated_minutes'),
            'display_order': section.get('display_order'),
            'enabled': section.get('enabled'),
            'created_by': actor,
            'updated_by': actor,
            'created_at': datetime.utcnow(),
            'updated_at': datetime.utcnow(),
        })

        section_fields = [f for f in get_review_field_rows(source_row.get('id')) if f.get('section_id') == section.get('id')]
        # Grouped by parent so a case block nested inside a case block (to any
        # depth) clones parent-before-child at every level, not just two.
        children_by_parent = defaultdict(list)
        for field_row in section_fields:
            children_by_parent[field_row.get('parent_field_id') or None].append(field_row)

        def _clone_field_row(field_row, parent_field_id=None):
            new_field_id = unique_prefixed_id('REVF')
            payload = {
                'id': new_field_id,
                'review_id': new_id,
                'section_id': new_section_id,
                'title': field_row.get('title'),
                'field_type': field_row.get('field_type'),
                'required': field_row.get('required'),
                'display_order': field_row.get('display_order'),
                'configuration': json_db_value(as_json_value(field_row.get('configuration'), {})),
                'created_at': datetime.utcnow(),
                'updated_at': datetime.utcnow(),
            }
            if parent_field_id:
                payload['parent_field_id'] = parent_field_id
                payload['condition_value'] = field_row.get('condition_value')
            insert_row(REVIEW_FIELDS_TABLE, payload)
            return new_field_id

        def _clone_subtree(field_row, parent_field_id=None):
            new_field_id = _clone_field_row(field_row, parent_field_id=parent_field_id)
            for child_row in children_by_parent.get(field_row.get('id'), []):
                _clone_subtree(child_row, parent_field_id=new_field_id)

        for field_row in children_by_parent.get(None, []):
            _clone_subtree(field_row)

    return new_id
