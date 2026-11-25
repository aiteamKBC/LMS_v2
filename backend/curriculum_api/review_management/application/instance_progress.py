"""Frozen progress writes and learner-scoped historical RAG reads."""
from __future__ import annotations

from curriculum_api.review_management.domain.instance_definitions import PROGRESS_SNAPSHOT_COLUMN
from curriculum_api.review_management.infrastructure.instance_relations import REVIEW_INSTANCES_TABLE
from curriculum_api.review_management.domain.classification import REVIEW_TYPE_CODE_PROGRESS_REVIEW
from curriculum_api.review_management.domain.instance_rules import STATUS_AWAITING_SIGNATURE
from curriculum_api.review_management.domain.instance_rules import STATUS_COMPLETED
from curriculum_api.review_management.domain.instance_definitions import _rag_field_ids
from curriculum_api.catalogue.domain.values import as_json_value
from curriculum_api.catalogue.infrastructure.database_reads import column_names
from datetime import datetime
from curriculum_api.catalogue.domain.hierarchy_dates import format_created_at
from curriculum_api.catalogue.domain.values import format_date
from curriculum_api.review_management.infrastructure.instance_rows import get_review_instance_answers
from curriculum_api.review_management.infrastructure.template_rows import get_review_template_row
from curriculum_api.catalogue.infrastructure.row_queries import json_db_value
from curriculum_api.review_management.domain.instance_definitions import json_safe
from curriculum_api.review_management.infrastructure.instance_rows import list_learner_review_instances
from coach_api.reconciliation_links import native_write
from curriculum_api.catalogue.infrastructure.authoring_storage import update_rows


@native_write
def save_review_instance_progress_snapshot(instance_row, snapshot, *, actor='system'):
    """Freeze (or replace) this instance's calculated progress.

    Same lifecycle rule the answers themselves follow: once the instance has
    reached awaiting-signature/completed, the figures a party is about to sign
    -- or has already signed -- can no longer move underneath them. Guarded in
    the UPDATE's own WHERE clause as well as checked up front, so a Calculate
    racing a completion cannot slip in after the transition.
    """
    if instance_row.get('status') in (STATUS_AWAITING_SIGNATURE, STATUS_COMPLETED):
        raise ValueError('Progress cannot be recalculated after the signature step begins.')
    if PROGRESS_SNAPSHOT_COLUMN not in column_names(REVIEW_INSTANCES_TABLE):
        # filtered_payload would otherwise drop the snapshot silently and the
        # write would look like it succeeded. Fail loudly instead, naming the
        # migration that adds the column.
        raise ValueError(
            'This deployment cannot store a Progress Review snapshot yet: run '
            'sql/2026-09-16_curriculum_review_instance_progress_snapshot.sql.'
        )

    rows = update_rows(
        REVIEW_INSTANCES_TABLE,
        'id = %s and status not in (%s, %s)',
        [instance_row.get('id'), STATUS_AWAITING_SIGNATURE, STATUS_COMPLETED],
        {
            PROGRESS_SNAPSHOT_COLUMN: json_db_value(json_safe(snapshot)),
            'updated_by': actor,
            'updated_at': datetime.utcnow(),
        },
    )
    if not rows:
        raise ValueError('Progress cannot be recalculated after the signature step begins.')
    return rows[0]


def review_instance_rag_value(instance_row):
    """This instance's own recorded RAG answer, or ''.

    Read from the answer saved against this instance, located through the
    RAG marker in the definition THIS instance froze -- never from the
    learner's current/live coach_rag, which a coach can change at any time and
    which would otherwise rewrite the history of an already-signed review.
    """
    snapshot = as_json_value(instance_row.get('definition_snapshot'), {})
    field_ids = _rag_field_ids(snapshot)
    if not field_ids:
        return ''
    answers = get_review_instance_answers(instance_row.get('id'))
    for field_id in field_ids:
        saved = answers.get(field_id)
        value = as_json_value(saved.get('answer'), None) if saved else None
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ''


def progress_review_rag_history(learner_id, *, limit=8):
    """Completed Progress Reviews for this learner, newest first, each with the
    RAG answer IT recorded.

    A review that never captured a RAG value contributes an empty rag rather
    than being dropped, so the history shows the occurrence took place -- the
    same way the legacy export shows an entry with no RAG against it.
    """
    history = []
    for row in list_learner_review_instances(learner_id, REVIEW_TYPE_CODE_PROGRESS_REVIEW):
        template = get_review_template_row(row.get('review_template_id'), include_deleted=True)
        history.append({
            'reviewInstanceId': row.get('id'),
            'reviewName': (template or {}).get('name') or '',
            'occurrenceNumber': row.get('occurrence_number'),
            'targetDate': format_date(row.get('target_date')),
            'completedAt': format_created_at(row.get('completed_at')),
            'rag': review_instance_rag_value(row),
        })
        if len(history) >= limit:
            break
    return history
