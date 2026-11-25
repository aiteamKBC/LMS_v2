"""Occurrence overrides and clash decisions, including existing soft-delete history."""
from __future__ import annotations

from curriculum_api.review_management.infrastructure.relations import CLASH_RESOLUTIONS_TABLE
from curriculum_api.review_management.infrastructure.relations import OCCURRENCE_OVERRIDES_TABLE
from django.db import connection
from datetime import datetime
from curriculum_api.catalogue.infrastructure.database_reads import fetch_all
from curriculum_api.catalogue.domain.values import format_date
from curriculum_api.catalogue.infrastructure.authoring_storage import insert_row
from curriculum_api.catalogue.infrastructure.lifecycle_persistence import soft_delete_rows
from curriculum_api.catalogue.infrastructure.database_reads import table_name
from curriculum_api.catalogue.infrastructure.record_identity import unique_prefixed_id
from curriculum_api.catalogue.infrastructure.authoring_storage import update_rows


def _fetch_active_overrides(review_ids):
    if not review_ids:
        return {}
    if connection.vendor == 'postgresql':
        rows = fetch_all(
            f'select * from {table_name(OCCURRENCE_OVERRIDES_TABLE)} '
            f'where review_id = any(%s) and deleted_at is null',
            [review_ids],
        )
    else:
        placeholders = ', '.join(['%s'] * len(review_ids))
        rows = fetch_all(
            f'select * from {table_name(OCCURRENCE_OVERRIDES_TABLE)} '
            f'where review_id in ({placeholders}) and deleted_at is null',
            review_ids,
        )
    return {(row.get('review_id'), format_date(row.get('occurrence_date'))): row for row in rows}


def _fetch_active_clash_resolutions(programme_id):
    rows = fetch_all(
        f'select * from {table_name(CLASH_RESOLUTIONS_TABLE)} '
        f'where programme_id = %s and deleted_at is null',
        [programme_id],
    )
    return {(row.get('clash_month'), row.get('clash_signature')): row for row in rows}


def _find_active_override(review_id, occurrence_date_iso):
    rows = fetch_all(
        f'select * from {table_name(OCCURRENCE_OVERRIDES_TABLE)} '
        f'where review_id = %s and occurrence_date = %s and deleted_at is null',
        [review_id, occurrence_date_iso],
    )
    return rows[0] if rows else None


def skip_occurrence(review_id, occurrence_date_iso, programme_id, *, actor='staff', reason=''):
    existing = _find_active_override(review_id, occurrence_date_iso)
    if existing:
        update_rows(OCCURRENCE_OVERRIDES_TABLE, 'id = %s', [existing['id']], {
            'reason': reason, 'updated_by': actor, 'updated_at': datetime.utcnow(),
        })
        return existing['id']
    override_id = unique_prefixed_id('REVO')
    insert_row(OCCURRENCE_OVERRIDES_TABLE, {
        'id': override_id,
        'review_id': review_id,
        'programme_id': programme_id,
        'occurrence_date': occurrence_date_iso,
        'action': 'skip',
        'reason': reason,
        'created_by': actor,
        'updated_by': actor,
        'created_at': datetime.utcnow(),
        'updated_at': datetime.utcnow(),
    })
    return override_id


def restore_occurrence(review_id, occurrence_date_iso, *, actor='staff'):
    """Undo a skip. The override row is soft-deleted, not hard-deleted -- it
    stays as an auditable "this was skipped, then restored by X" record."""
    existing = _find_active_override(review_id, occurrence_date_iso)
    if not existing:
        return False
    soft_delete_rows(OCCURRENCE_OVERRIDES_TABLE, 'id = %s', [existing['id']], deleted_by=actor)
    return True


def _upsert_keep_all_resolution(programme_id, month, signature, *, actor='staff', note=''):
    existing = fetch_all(
        f'select * from {table_name(CLASH_RESOLUTIONS_TABLE)} '
        f'where programme_id = %s and clash_month = %s and clash_signature = %s and deleted_at is null',
        [programme_id, month, signature],
    )
    if existing:
        return existing[0]['id']
    resolution_id = unique_prefixed_id('REVOC')
    insert_row(CLASH_RESOLUTIONS_TABLE, {
        'id': resolution_id,
        'programme_id': programme_id,
        'clash_month': month,
        'clash_signature': signature,
        'resolution': 'keep_all',
        'note': note,
        'created_by': actor,
        'updated_by': actor,
        'created_at': datetime.utcnow(),
        'updated_at': datetime.utcnow(),
    })
    return resolution_id
