"""Template, section and field SQL reads and ordered section-tree persistence."""
from __future__ import annotations

from curriculum_api.review_management.domain.template_rules import CONDITIONAL_FIELD_TYPE
from curriculum_api.review_management.infrastructure.relations import REVIEW_FIELDS_TABLE
from curriculum_api.review_management.infrastructure.relations import REVIEW_SECTIONS_TABLE
from curriculum_api.review_management.infrastructure.relations import REVIEW_TEMPLATES_TABLE
from datetime import datetime
from curriculum_api.catalogue.infrastructure.write_composition import delete_rows
from curriculum_api.catalogue.infrastructure.database_reads import fetch_all
from curriculum_api.catalogue.infrastructure.authoring_storage import insert_row
from curriculum_api.catalogue.infrastructure.row_queries import json_db_value
from curriculum_api.catalogue.infrastructure.database_reads import table_name
from curriculum_api.catalogue.infrastructure.record_identity import unique_prefixed_id


def get_review_template_rows(where_sql='', params=None, *, include_deleted=False):
    conditions = [where_sql] if where_sql else []
    if not include_deleted:
        conditions.append('deleted_at is null')
    where = ' and '.join(conditions) or '1 = 1'
    return fetch_all(
        f'select * from {table_name(REVIEW_TEMPLATES_TABLE)} '
        f'where {where} order by updated_at desc',
        params or [],
    )


def get_review_template_row(review_id, *, include_deleted=False):
    rows = get_review_template_rows('id = %s', [review_id], include_deleted=include_deleted)
    return rows[0] if rows else None


def get_review_section_rows(review_id):
    return fetch_all(
        f'select * from {table_name(REVIEW_SECTIONS_TABLE)} '
        f'where review_id = %s and deleted_at is null order by display_order asc',
        [review_id],
    )


def get_review_field_rows(review_id):
    """All fields (top-level and conditional children alike), one query."""
    return fetch_all(
        f'select * from {table_name(REVIEW_FIELDS_TABLE)} '
        f'where review_id = %s order by display_order asc',
        [review_id],
    )


def _insert_field_row(review_id, section_id, field, index, *, parent_field_id=None, condition_value=None):
    field_id = field.get('id') or unique_prefixed_id('REVF')
    payload = {
        'id': field_id,
        'review_id': review_id,
        'section_id': section_id,
        'title': field['title'],
        'field_type': field['field_type'],
        'required': field['required'],
        'display_order': index,
        'configuration': json_db_value(field['configuration']),
        'created_at': datetime.utcnow(),
        'updated_at': datetime.utcnow(),
    }
    if parent_field_id:
        payload['parent_field_id'] = parent_field_id
        payload['condition_value'] = condition_value
    insert_row(REVIEW_FIELDS_TABLE, payload)
    return field_id


def save_section_fields(review_id, section_id, fields, *, parent_field_id=None, condition_value=None):
    """Insert one level of fields and recurse into their yes/no children --
    a case block's children may themselves be case blocks, to any depth."""
    count = 0
    for index, field in enumerate(fields or []):
        field_id = _insert_field_row(review_id, section_id, field, index, parent_field_id=parent_field_id, condition_value=condition_value)
        count += 1
        if field['field_type'] == CONDITIONAL_FIELD_TYPE:
            count += save_section_fields(review_id, section_id, field.get('yes_fields'), parent_field_id=field_id, condition_value='yes')
            count += save_section_fields(review_id, section_id, field.get('no_fields'), parent_field_id=field_id, condition_value='no')
    return count


def save_review_sections(review_id, sections):
    """Delete-then-reinsert the whole section/field tree, same replace approach
    the first implementation used for its flat field list."""
    delete_rows(REVIEW_FIELDS_TABLE, 'review_id = %s', [review_id])
    delete_rows(REVIEW_SECTIONS_TABLE, 'review_id = %s', [review_id])
    total_fields = 0
    for index, section in enumerate(sections or []):
        section_id = section.get('id') or unique_prefixed_id('REVS')
        insert_row(REVIEW_SECTIONS_TABLE, {
            'id': section_id,
            'review_id': review_id,
            'title': section['title'],
            'estimated_minutes': section['estimated_minutes'],
            'display_order': index,
            'enabled': section['enabled'],
            'created_at': datetime.utcnow(),
            'updated_at': datetime.utcnow(),
        })
        total_fields += save_section_fields(review_id, section_id, section['fields'])
    return total_fields


def existing_review_ids():
    return [row.get('id') for row in get_review_template_rows(include_deleted=True)]
