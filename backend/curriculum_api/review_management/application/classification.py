"""Create, rename and archive review types while preserving stable codes and system guards."""
from __future__ import annotations

from curriculum_api.review_management.domain.classification import DUPLICATE_NAME_ERROR
from curriculum_api.review_management.infrastructure.relations import REVIEW_TYPES_TABLE
from curriculum_api.review_management.domain.classification import _normalised_name
from curriculum_api.catalogue.domain.values import clean_str
from datetime import datetime
from curriculum_api.review_management.infrastructure.type_schema import ensure_review_types_table
from curriculum_api.review_management.domain.classification import generate_review_type_code
from curriculum_api.review_management.infrastructure.type_rows import get_review_type
from curriculum_api.review_management.infrastructure.type_rows import get_review_type_rows
from curriculum_api.catalogue.infrastructure.authoring_storage import insert_row
from curriculum_api.review_management.infrastructure.type_rows import list_review_types
from curriculum_api.catalogue.infrastructure.record_identity import unique_prefixed_id
from curriculum_api.catalogue.infrastructure.authoring_storage import update_rows


def duplicate_active_name_exists(name, *, exclude_id=None):
    target = _normalised_name(name)
    if not target:
        return False
    for row in list_review_types():
        if exclude_id and row.get('id') == exclude_id:
            continue
        if _normalised_name(row.get('name')) == target:
            return True
    return False


def create_review_type(name, *, actor='staff', invalidate_curriculum_cache):
    """Create a custom type from the ONE field a user supplies: its name.

    Everything else -- id, code, is_system, is_active -- is generated here;
    none of it is accepted from the payload, so the create UI stays a single
    text box.
    """
    ensure_review_types_table()
    clean_name = ' '.join(clean_str(name).split())
    if not clean_name:
        return None, {'name': 'Review type name is required.'}
    if len(clean_name) > 255:
        return None, {'name': 'Review type name must be 255 characters or fewer.'}
    if duplicate_active_name_exists(clean_name):
        return None, {'name': DUPLICATE_NAME_ERROR}

    existing_rows = get_review_type_rows()
    code = generate_review_type_code(clean_name, [row.get('code') for row in existing_rows])
    type_id = unique_prefixed_id(
        'REVT', '', [row.get('id') for row in existing_rows],
    )
    row = insert_row(REVIEW_TYPES_TABLE, {
        'id': type_id,
        'name': clean_name,
        'code': code,
        'is_system': False,
        'is_active': True,
        'created_by': actor,
        'updated_by': actor,
        'created_at': datetime.utcnow(),
        'updated_at': datetime.utcnow(),
    })
    invalidate_curriculum_cache()
    return row, None


def rename_review_type(type_id, name, *, actor='staff', invalidate_curriculum_cache):
    """Rename a custom type. ``code`` is deliberately untouched: routing must
    survive a rename (a Review Type is classification, not a label)."""
    ensure_review_types_table()
    row = get_review_type(type_id)
    if not row:
        return None, {'_': 'Review type not found.'}
    if bool(row.get('is_system')):
        return None, {'_': 'System review types cannot be renamed.'}
    clean_name = ' '.join(clean_str(name).split())
    if not clean_name:
        return None, {'name': 'Review type name is required.'}
    if duplicate_active_name_exists(clean_name, exclude_id=type_id):
        return None, {'name': DUPLICATE_NAME_ERROR}
    rows = update_rows(REVIEW_TYPES_TABLE, 'id = %s', [type_id], {
        'name': clean_name, 'updated_by': actor, 'updated_at': datetime.utcnow(),
    })
    invalidate_curriculum_cache()
    return (rows[0] if rows else get_review_type(type_id)), None


def archive_review_type(type_id, *, actor='staff', invalidate_curriculum_cache):
    """Deactivate a custom type -- never a hard delete.

    Templates already classified with it keep working and keep classifying
    exactly as before; the type simply stops being offered for new Reviews.
    System types cannot be archived.
    """
    ensure_review_types_table()
    row = get_review_type(type_id)
    if not row:
        return None, {'_': 'Review type not found.'}
    if bool(row.get('is_system')):
        return None, {'_': 'Monthly Coaching Meeting and Progress Review are system review types and cannot be deleted.'}
    rows = update_rows(REVIEW_TYPES_TABLE, 'id = %s', [type_id], {
        'is_active': False, 'updated_by': actor, 'updated_at': datetime.utcnow(),
    })
    invalidate_curriculum_cache()
    return (rows[0] if rows else get_review_type(type_id)), None
