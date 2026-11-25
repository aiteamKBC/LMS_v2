"""Idempotent native instance and learner-addition creation."""
from __future__ import annotations

from curriculum_api.review_management.infrastructure.instance_relations import LEARNER_REVIEW_ADDITIONS_TABLE
from curriculum_api.review_management.domain.instance_rules import OCCURRENCE_SOURCE_GENERATED
from curriculum_api.review_management.domain.instance_rules import OCCURRENCE_SOURCE_MANUAL
from curriculum_api.review_management.infrastructure.instance_relations import REVIEW_INSTANCES_TABLE
from curriculum_api.review_management.domain.instance_rules import STATUS_NOT_SCHEDULED
from curriculum_api.review_management.application.instance_definitions import build_definition_snapshot
from datetime import datetime
from curriculum_api.review_management.infrastructure.instance_schema import ensure_learner_review_additions_table
from curriculum_api.review_management.infrastructure.instance_schema import ensure_review_instance_tables
from curriculum_api.review_management.infrastructure.instance_rows import existing_review_instance_ids
from curriculum_api.review_management.infrastructure.instance_rows import find_active_learner_review_addition
from curriculum_api.review_management.infrastructure.instance_rows import find_review_instance
from curriculum_api.review_management.infrastructure.instance_rows import find_review_instance_by_ref
from curriculum_api.catalogue.infrastructure.authoring_storage import insert_row
from curriculum_api.catalogue.infrastructure.row_queries import json_db_value
from django.db import transaction
from curriculum_api.catalogue.infrastructure.record_identity import unique_prefixed_id


def create_learner_review_addition(
    *, review_template_id, programme_id, learner_id, target_date, reason_code='', reason='', actor='system',
):
    """Idempotent get-or-create for one learner's one additional Review on
    one date -- a repeated request for the exact same
    (review_template_id, learner_id, target_date) returns the SAME addition
    rather than creating a duplicate (see the partial unique index in
    sql/2026-09-15_curriculum_learner_review_additions.sql). This is the ONLY
    way a learner-specific occurrence is created -- it never touches
    review_occurrence_overrides (skip-only) or review_templates (programme-
    wide) at all.
    """
    ensure_learner_review_additions_table()
    existing = find_active_learner_review_addition(review_template_id, learner_id, target_date)
    if existing:
        return existing

    from coach_api.review_sources import require_native_review_creation
    require_native_review_creation(learner_id)

    addition_id = unique_prefixed_id('LRA')
    with transaction.atomic():
        try:
            row = insert_row(LEARNER_REVIEW_ADDITIONS_TABLE, {
                'id': addition_id,
                'review_template_id': review_template_id,
                'programme_id': programme_id,
                'learner_id': learner_id,
                'target_date': target_date,
                'reason_code': reason_code or '',
                'reason': reason or '',
                'created_by': actor,
                'updated_by': actor,
                'created_at': datetime.utcnow(),
                'updated_at': datetime.utcnow(),
            })
        except Exception:
            # Lost the race with a concurrent identical request -- the unique
            # index rejected the insert. The row that won is what we want.
            existing = find_active_learner_review_addition(review_template_id, learner_id, target_date)
            if existing:
                return existing
            raise
    return row


def ensure_review_instance(
    template_row, *, learner_id, learner_kind, programme_id, occurrence_number, target_date,
    coach_email='', actor='system', occurrence_source=OCCURRENCE_SOURCE_GENERATED, occurrence_ref=None,
):
    """Idempotent get-or-create for one learner's one occurrence.

    Identity for a GENERATED occurrence (occurrence_source, the default) is
    (review_template_id, learner_id, occurrence_number) -- see the unique
    index in the SQL migration -- and is completely unchanged by the
    occurrence_source/occurrence_ref parameters below: every existing caller
    passes neither, so its behaviour, lookup and stored values are identical
    to before this parameter pair existed.

    Identity for a MANUAL (learner-specific addition) occurrence is instead
    (review_template_id, learner_id, occurrence_ref) -- occurrence_number is
    stored as NULL for these rows (see
    sql/2026-09-15_curriculum_learner_review_additions.sql for why a manual
    occurrence cannot safely share the generated numbering space). Callers
    creating a manual instance MUST pass occurrence_source='manual' and an
    explicit occurrence_ref (see review_calendar_event_key_manual for the
    matching event key).

    A repeated call (the caseload timetable is recomputed on every page
    load) always returns the same row rather than creating a duplicate.
    """
    ensure_review_instance_tables()
    review_template_id = template_row.get('id')
    is_manual = occurrence_source == OCCURRENCE_SOURCE_MANUAL
    ref = occurrence_ref or f'{OCCURRENCE_SOURCE_GENERATED}:{occurrence_number}'

    def _existing():
        if is_manual:
            row = find_review_instance_by_ref(review_template_id, learner_id, ref)
        else:
            row = find_review_instance(review_template_id, learner_id, occurrence_number)
        if row:
            from coach_api.reconciliation_links import for_native
            if for_native(row['id']):
                raise ValueError('This legacy occurrence is reconciled. Open its imported Aptem Review.')
        return row

    existing = _existing()
    if existing:
        return existing

    from coach_api.review_sources import require_native_review_creation
    require_native_review_creation(learner_id)

    instance_id = unique_prefixed_id('REVI', '', existing_review_instance_ids)
    with transaction.atomic():
        try:
            row = insert_row(REVIEW_INSTANCES_TABLE, {
                'id': instance_id,
                'review_template_id': review_template_id,
                'learner_id': learner_id,
                'learner_kind': learner_kind or '',
                'programme_id': programme_id,
                'occurrence_number': None if is_manual else occurrence_number,
                'occurrence_source': occurrence_source,
                'occurrence_ref': ref,
                'target_date': target_date,
                'coach_email': coach_email or '',
                'definition_snapshot': json_db_value(build_definition_snapshot(template_row)),
                'status': STATUS_NOT_SCHEDULED,
                'created_by': actor,
                'updated_by': actor,
                'created_at': datetime.utcnow(),
                'updated_at': datetime.utcnow(),
            })
        except Exception:
            # Lost the race with a concurrent identical request -- the unique
            # index rejected the insert. The row that won is what we want.
            existing = _existing()
            if existing:
                return existing
            raise
    return row
