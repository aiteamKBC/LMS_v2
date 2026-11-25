"""Audited reopen preserving prior evidence and calendar consistency."""
from __future__ import annotations

from curriculum_api.review_management.domain.instance_rules import REOPENABLE_STATUSES
from curriculum_api.review_management.domain.instance_rules import REOPEN_REASON_CODES
from curriculum_api.review_management.infrastructure.instance_relations import REVIEW_INSTANCES_TABLE
from curriculum_api.review_management.domain.instance_rules import STATUS_IN_PROGRESS
from curriculum_api.review_management.infrastructure.instance_rows import _clear_review_instance_signatures
from curriculum_api.review_management.infrastructure.instance_calendar import _mirror_linked_calendar_after_reopen
from curriculum_api.review_management.domain.instance_rules import _reopen_review_instance_status_rejection
from curriculum_api.catalogue.domain.values import as_json_value
from curriculum_api.catalogue.domain.values import clean_str
from datetime import datetime
from curriculum_api.review_management.infrastructure.instance_schema import ensure_review_instance_reopens_table
from curriculum_api.review_management.infrastructure.instance_rows import get_review_instance
from curriculum_api.review_management.infrastructure.instance_rows import get_review_instance_answers
from curriculum_api.review_management.infrastructure.instance_rows import get_review_instance_signatures
from curriculum_api.review_management.domain.instance_definitions import json_safe
import logging
from coach_api.reconciliation_links import native_write
from curriculum_api.review_management.infrastructure.instance_rows import record_review_instance_reopen
from django.db import transaction
from curriculum_api.catalogue.infrastructure.authoring_storage import update_rows


_reopen_logger = logging.getLogger('curriculum_api.review_instance_reopen')


def _reopen_state_snapshot(instance_row):
    """Freeze what this instance looked like immediately before a reopen.

    This is the ONLY surviving record of the signatures the reopen is about to
    clear -- _clear_review_instance_signatures blanks them in place -- so the
    full signature image (a base64 data URI) is captured here verbatim rather
    than hashed or summarised. Audit evidence only: nothing reads this back
    into the live review.
    """
    instance_id = instance_row.get('id')
    answers = get_review_instance_answers(instance_id)
    signatures = get_review_instance_signatures(instance_id)
    return json_safe({
        'capturedAt': datetime.utcnow(),
        'instance': {
            'status': instance_row.get('status'),
            'startedAt': instance_row.get('started_at'),
            'completedAt': instance_row.get('completed_at'),
        },
        'answers': [
            {
                'fieldId': field_id,
                'answer': as_json_value(row.get('answer'), None),
                'answeredBy': row.get('answered_by') or '',
                'answeredAt': row.get('answered_at'),
            }
            for field_id, row in sorted(answers.items())
        ],
        'signatures': [
            {
                'role': role,
                'signedBy': row.get('signed_by') or '',
                'signedName': row.get('signed_name') or '',
                'signature': row.get('signature') or '',
                'signedAt': row.get('signed_at'),
            }
            for role, row in sorted(signatures.items())
        ],
    })


@native_write
def reopen_review_instance_for_editing(instance_row, *, reason_code, note='', actor='system'):
    """Authorised awaiting-signature/completed -> in-progress reopen, so a coach
    can correct a finished review and re-complete it.

    This edits the SAME review_instances row in place -- no new instance is
    created, and no revision/series concept is involved. The consequence is
    deliberate and destructive: every signature already collected is blanked
    (see _clear_review_instance_signatures), because the answers they were
    given against are about to change, and a signature must never outlive the
    content it signed. The pre-reopen answers AND signatures are frozen into
    curriculum.review_instance_reopens.previous_state_snapshot first, in this
    same transaction, and that row is the only surviving copy.

    Authorization (the assigned coach, or a super-admin acting through the
    existing view-as/attributed-write mechanism) is the CALLER's
    responsibility -- see coach_api.views.coach_review_instance_reopen. This
    function only enforces the lifecycle/data rules:

    * a valid reason code, with a required note when the reason is "other"
    * the instance is currently exactly awaiting-signature or completed, held
      under SELECT ... FOR UPDATE and re-checked after the lock, with the
      status UPDATE guarded on the status observed under that lock (an atomic
      compare-and-swap, not a read-then-write) -- so a double submit or a
      concurrent completion is rejected, never a silent no-op
    * started_at and target_date are left untouched: this review still
      happened when it happened. Only status, completed_at, the signatures and
      the Calendar projection move.

    Returns (ok, errors_or_row): errors is {'reason': [...]}, {'note': [...]}
    or {'status': [...]} depending on which check failed -- the same contract
    as mark_review_instance_in_progress_manually. A failed Calendar mirror
    raises ValueError instead (as it does for signatures), rolling the whole
    transaction back, since a Calendar row that no longer matches its instance
    is a reconciliation problem, not a user input error.
    """
    reason_code = clean_str(reason_code).lower()
    note = clean_str(note)
    if reason_code not in REOPEN_REASON_CODES:
        return False, {'reason': ['Choose a valid reason for reopening this review.']}
    if reason_code == 'other' and not note:
        return False, {'note': ['Add details when the reason is "Other".']}

    current_status = instance_row.get('status')
    if current_status not in REOPENABLE_STATUSES:
        return False, {'status': [_reopen_review_instance_status_rejection(current_status)]}

    # Provisioned before the transaction opens -- same sqlite/DDL-inside-
    # atomic() reason documented on mark_review_instance_in_progress_manually.
    ensure_review_instance_reopens_table()

    with transaction.atomic():
        # The same lock the completion path takes, so a reopen and a concurrent
        # completion/signature serialise against each other rather than
        # interleaving.
        locked = get_review_instance(instance_row.get('id'), for_update=True)
        if not locked:
            return False, {'status': ['Review not found.']}
        entry_status = locked.get('status')
        if entry_status not in REOPENABLE_STATUSES:
            return False, {'status': [_reopen_review_instance_status_rejection(entry_status)]}

        # Captured BEFORE anything is cleared -- this is the audit record.
        snapshot = _reopen_state_snapshot(locked)

        updated = update_rows(
            REVIEW_INSTANCES_TABLE, 'id = %s and status = %s',
            [locked.get('id'), entry_status],
            {
                'status': STATUS_IN_PROGRESS, 'completed_at': None,
                'updated_by': actor, 'updated_at': datetime.utcnow(),
            },
            # completed_at must actually become NULL; filtered_payload would
            # otherwise drop the None and leave the old completion time behind.
            allow_null_columns=['completed_at'],
        )
        if not updated:
            return False, {'status': [
                'This review changed while it was being reopened. Reload it and try again.',
            ]}
        row = updated[0]

        cleared = _clear_review_instance_signatures(row.get('id'))

        record_review_instance_reopen(
            review_instance_id=row.get('id'), calendar_event_id=row.get('calendar_event_id'),
            previous_status=entry_status, reason_code=reason_code, note=note,
            changed_by=actor, previous_state_snapshot=snapshot,
        )

        _mirror_linked_calendar_after_reopen(row)

    _reopen_logger.info(
        'review_instance_reopened',
        extra={
            'review_instance_id': row.get('id'),
            'calendar_event_id': row.get('calendar_event_id'),
            'previous_status': entry_status,
            'new_status': STATUS_IN_PROGRESS,
            'reason_code': reason_code,
            'note': note,
            'signatures_cleared': cleared,
            'changed_by': actor,
            'changed_at': datetime.utcnow().isoformat(),
        },
    )
    return True, row
