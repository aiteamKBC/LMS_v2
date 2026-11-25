"""Concrete catalogue / domain / archive values capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""
from curriculum_api.catalogue.domain.archive_policy import row_has_deleted_at
from curriculum_api.catalogue.domain.hierarchy_dates import format_created_at
from curriculum_api.catalogue.domain.values import clean_str


def archived_at(row):
    """When this row was archived: history's stamp where annotated, else its last update."""
    if not row_has_deleted_at(row):
        return None
    return row.get('deleted_at') or row.get('updated_at') or row.get('created_at')


def archive_stamp_fields(row):
    from curriculum_api.catalogue.application.archive_queries import archive_stamp_fields as query
    return query(
        row, clean_str=clean_str, format_created_at=format_created_at,
    )
