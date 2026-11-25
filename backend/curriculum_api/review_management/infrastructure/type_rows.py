"""Review-type catalogue reads, active filters and classification indexes."""
from __future__ import annotations

from curriculum_api.review_management.infrastructure.relations import REVIEW_TYPES_TABLE
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.infrastructure.database_reads import fetch_all
from curriculum_api.catalogue.infrastructure.database_reads import table_name


def get_review_type_rows(where_sql='', params=None):
    where = where_sql or '1 = 1'
    return fetch_all(
        f'select * from {table_name(REVIEW_TYPES_TABLE)} '
        f'where {where} order by is_system desc, name asc',
        params or [],
    )


def list_review_types(*, include_inactive=False):
    if include_inactive:
        return get_review_type_rows()
    return get_review_type_rows('is_active = true')


def get_review_type(type_id):
    type_id = clean_str(type_id)
    if not type_id:
        return None
    rows = get_review_type_rows('id = %s', [type_id])
    return rows[0] if rows else None


def get_review_type_by_code(code):
    code = clean_str(code).lower()
    if not code:
        return None
    rows = get_review_type_rows('lower(code) = %s', [code])
    return rows[0] if rows else None


def review_type_index():
    """{id: row} for every type, active or not.

    One query, handed to loops that would otherwise ask per Review row. Not
    cached: production runs nine two-worker services off one process-local
    Django cache, so a cached lookup table would serve a type created in
    another worker as "unknown" until that worker restarted -- and this is a
    handful of rows.
    """
    return {row.get('id'): row for row in get_review_type_rows()}
