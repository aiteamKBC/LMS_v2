"""Existing curriculum archive predicates over rows and payload values.

No storage access: status, historical deletion timestamps and public payload
flags keep their existing meanings. Writers and readers share these rules.
"""
from .values import truthy

INACTIVE = 'inactive'
ACTIVE = 'active'
# Older processes may have stored archived; never display those rows as live.
INACTIVE_STATUSES = ('inactive', 'archived')


def is_inactive(status):
    return str(status or '').strip().lower() in INACTIVE_STATUSES


def row_inactive(row):
    return bool(row) and is_inactive(row.get('status'))


def row_has_deleted_at(row):
    """Is this row archived? ``status`` on the lifecycle tables, ``deleted_at`` elsewhere."""
    return bool(row) and (bool(row.get('deleted_at')) or row_inactive(row))


def programme_deleted_row(row):
    """Is this row archived? ``status`` on the curriculum tables (see
    row_has_deleted_at); the camelCase flags are what API payloads carry."""
    return bool(row) and (
        row_has_deleted_at(row)
        or truthy(row.get('isProgrammeDeleted'))
        or truthy(row.get('isDeleted'))
    )


def active_week_rows(rows):
    return [row for row in rows if not programme_deleted_row(row)]


def active_mapping_rows(rows):
    return [row for row in rows if not programme_deleted_row(row)]
