"""Role-constrained answer saves and locked definition refresh."""
from __future__ import annotations

from curriculum_api.review_management.infrastructure.instance_relations import REVIEW_INSTANCES_TABLE
from curriculum_api.review_management.infrastructure.instance_relations import REVIEW_INSTANCE_ANSWERS_TABLE
from curriculum_api.review_management.domain.instance_rules import STATUS_AWAITING_SIGNATURE
from curriculum_api.review_management.domain.instance_rules import STATUS_COMPLETED
from curriculum_api.review_management.domain.instance_definitions import _flatten_snapshot_fields
from curriculum_api.catalogue.domain.values import as_json_value
from datetime import datetime
from curriculum_api.review_management.application.instance_definitions import effective_review_definition_snapshot
from curriculum_api.review_management.infrastructure.instance_rows import find_review_instance_answer_rows
from curriculum_api.review_management.infrastructure.instance_rows import get_review_instance
from curriculum_api.catalogue.infrastructure.authoring_storage import insert_row
from curriculum_api.catalogue.infrastructure.row_queries import json_db_value
from coach_api.reconciliation_links import native_write
from curriculum_api.review_management.application.instance_definitions import review_instance_form_definition
from django.db import transaction
from curriculum_api.catalogue.infrastructure.record_identity import unique_prefixed_id
from curriculum_api.catalogue.infrastructure.authoring_storage import update_rows
from curriculum_api.review_management.domain.instance_definitions import writable_field_ids_for_role


def _refresh_locked_editable_definition_snapshot(instance_row, *, actor):
    """Persist the effective editable form while the instance lock is held."""
    stored = as_json_value(instance_row.get('definition_snapshot'), {})
    effective = effective_review_definition_snapshot(instance_row, snapshot=stored)
    if effective == stored:
        return instance_row

    updated = update_rows(
        REVIEW_INSTANCES_TABLE,
        'id = %s and status = %s',
        [instance_row.get('id'), instance_row.get('status')],
        {
            'definition_snapshot': json_db_value(effective),
            'updated_by': actor,
            'updated_at': datetime.utcnow(),
        },
    )
    if not updated:
        raise ValueError('This review changed while its Curriculum form was being refreshed. Reload it and try again.')
    refreshed = dict(instance_row)
    refreshed['definition_snapshot'] = effective
    refreshed['updated_by'] = actor
    return refreshed


def save_review_instance_answers_for_role(instance_row, answers, role, *, actor='system'):
    """Like ``save_review_instance_answers``, restricted to the fields this
    respondent role (participant/employer) is allowed to answer.

    Fails closed: posting even one field id outside the role's allowed set
    raises rather than silently dropping it, so a stale or tampered payload
    is rejected instead of partially applied.
    """
    definition = review_instance_form_definition(instance_row)
    allowed_ids = writable_field_ids_for_role(definition.get('sections', []), role)
    posted_ids = set((answers or {}).keys())
    disallowed = posted_ids - allowed_ids
    if disallowed:
        raise PermissionError(
            f"Not authorised to answer: {', '.join(sorted(disallowed))}."
        )
    return save_review_instance_answers(instance_row, answers, actor=actor)


@native_write
def save_review_instance_answers(instance_row, answers, *, actor='system'):
    """Draft save -- merges posted {fieldId: value} into whatever is already
    stored. A conditional field hidden by its parent's current answer is
    still saved as posted (its previous answer is not corrupted/dropped just
    because it is not visible right now)."""
    if instance_row.get('status') in (STATUS_AWAITING_SIGNATURE, STATUS_COMPLETED):
        raise ValueError('Submitted review answers cannot be changed after the signature step begins.')

    with transaction.atomic():
        # Answer writers and completion lock this same parent first. A stale
        # save that started before submission therefore re-reads the terminal
        # status and is rejected instead of changing signed content.
        locked = get_review_instance(instance_row.get('id'), for_update=True)
        if not locked:
            raise ValueError('Review not found.')
        if locked.get('status') in (STATUS_AWAITING_SIGNATURE, STATUS_COMPLETED):
            raise ValueError('Submitted review answers cannot be changed after the signature step begins.')
        _save_review_instance_answers_locked(locked, answers, actor=actor)

        # Saving a draft answer is not evidence the meeting started -- it used
        # to flip status to in-progress here, which is exactly the "opened/
        # edited the form" trigger Phase 2 removes. The real trigger is a
        # confirmed Microsoft Teams attendance signal; see
        # mark_review_instance_in_progress_from_attendance and
        # coach_api.views.apply_teams_attendance_status_transition.

    return review_instance_form_definition(get_review_instance(instance_row.get('id')))


def _save_review_instance_answers_locked(instance_row, answers, *, actor):
    """Merge answer values while the caller holds the instance row lock."""
    instance_row = _refresh_locked_editable_definition_snapshot(instance_row, actor=actor)
    snapshot = as_json_value(instance_row.get('definition_snapshot'), {})
    valid_field_ids = {
        field.get('id')
        for field in _flatten_snapshot_fields(snapshot.get('sections', []))
    }
    for field_id, value in (answers or {}).items():
        if field_id not in valid_field_ids:
            continue
        existing_rows = find_review_instance_answer_rows(instance_row.get('id'), field_id)
        payload = {
            'answer': json_db_value(value),
            'answered_by': actor,
            'answered_at': datetime.utcnow(),
            'updated_at': datetime.utcnow(),
        }
        if existing_rows:
            update_rows(
                REVIEW_INSTANCE_ANSWERS_TABLE, 'id = %s', [existing_rows[0]['id']], payload,
                allow_null_columns=['answer'],
            )
        else:
            insert_row(REVIEW_INSTANCE_ANSWERS_TABLE, {
                'id': unique_prefixed_id('REVIA'),
                'review_instance_id': instance_row.get('id'),
                'field_id': field_id,
                'created_at': datetime.utcnow(),
                **payload,
            })
    return instance_row
