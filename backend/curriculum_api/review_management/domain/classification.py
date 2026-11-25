"""Stable review-type codes, system classifications and their public value projection."""
from __future__ import annotations

from curriculum_api.catalogue.domain.values import clean_str
import re


REVIEW_TYPE_CODE_MCM = 'mcm'


REVIEW_TYPE_CODE_PROGRESS_REVIEW = 'progress_review'


SYSTEM_REVIEW_TYPES = (
    {'id': 'REVT-MCM', 'name': 'Monthly Coaching Meeting', 'code': REVIEW_TYPE_CODE_MCM},
    {'id': 'REVT-PROGRESS_REVIEW', 'name': 'Progress Review', 'code': REVIEW_TYPE_CODE_PROGRESS_REVIEW},
)


SYSTEM_REVIEW_TYPE_CODES = tuple(entry['code'] for entry in SYSTEM_REVIEW_TYPES)


COACH_SURFACE_LEGACY_CODES = {
    'mcr': REVIEW_TYPE_CODE_MCM,
    'progress_review': REVIEW_TYPE_CODE_PROGRESS_REVIEW,
}


DUPLICATE_NAME_ERROR = 'A review type with this name already exists.'


def review_type_payload(row):
    return {
        'id': row.get('id'),
        'name': row.get('name') or '',
        'code': row.get('code') or '',
        'isSystem': bool(row.get('is_system')),
        'isActive': bool(row.get('is_active')),
    }


def generate_review_type_code(name, existing_codes=None):
    """A stable snake_case code for a display name.

    Frozen at creation: a later rename keeps the original code, because every
    calendar/routing decision downstream is keyed on it.
    """
    base = re.sub(r'[^a-z0-9]+', '_', clean_str(name).lower()).strip('_')
    base = base or 'review_type'
    taken = {clean_str(code).lower() for code in (existing_codes or [])}
    if base not in taken:
        return base
    suffix = 2
    while f'{base}_{suffix}' in taken:
        suffix += 1
    return f'{base}_{suffix}'


def _normalised_name(value):
    """Trimmed and case-folded -- how duplicate names are compared."""
    return ' '.join(clean_str(value).split()).lower()
