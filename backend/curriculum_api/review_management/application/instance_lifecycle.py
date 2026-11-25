"""Guarded scheduling, manual-start and submission transactions."""
from __future__ import annotations

from curriculum_api.review_management.domain.instance_rules import MANUAL_OVERRIDE_REASON_CODES
from curriculum_api.review_management.infrastructure.instance_relations import REVIEW_INSTANCES_TABLE
from curriculum_api.review_management.domain.instance_rules import STATUS_AWAITING_SIGNATURE
from curriculum_api.review_management.domain.instance_rules import STATUS_COMPLETED
from curriculum_api.review_management.domain.instance_rules import STATUS_IN_PROGRESS
from curriculum_api.review_management.domain.instance_rules import STATUS_NOT_SCHEDULED
from curriculum_api.review_management.domain.instance_rules import STATUS_SCHEDULED
from curriculum_api.review_management.domain.instance_rules import _complete_review_instance_status_rejection
from curriculum_api.review_management.infrastructure.instance_calendar import _locked_linked_calendar_for_mirror
from curriculum_api.review_management.domain.instance_rules import _manual_override_status_rejection
from curriculum_api.review_management.infrastructure.instance_calendar import _mirror_linked_calendar_after_signature
from curriculum_api.review_management.application.instance_answers import _refresh_locked_editable_definition_snapshot
from curriculum_api.review_management.application.instance_answers import _save_review_instance_answers_locked
from curriculum_api.review_management.domain.instance_definitions import _visible_required_unanswered_fields
from curriculum_api.catalogue.domain.values import as_json_value
from curriculum_api.catalogue.domain.values import clean_str
from datetime import datetime
from curriculum_api.review_management.infrastructure.instance_schema import ensure_review_instance_manual_overrides_table
from curriculum_api.review_management.infrastructure.instance_rows import get_review_instance
from curriculum_api.review_management.infrastructure.instance_rows import get_review_instance_answers
import logging
from coach_api.reconciliation_links import native_write
from curriculum_api.review_management.infrastructure.instance_rows import record_review_instance_manual_override
from curriculum_api.review_management.domain.instance_rules import required_signature_roles
from django.db import transaction
from curriculum_api.catalogue.infrastructure.authoring_storage import update_rows


@native_write
def mark_review_instance_scheduled(instance_id, *, actor='system'):
    """not-scheduled -> scheduled, once a real booking (date/time) exists on
    the linked CoachCalendarEvent -- see coach_api.views
    persist_calendar_sync_reservation, which calls this for both new and
    already-linked bookings. Guarded in the UPDATE
    itself (``and status = 'not-scheduled'``) rather than read-then-write, so
    it is atomic and a repeat call is a no-op instead of a race.
    """
    rows = update_rows(
        REVIEW_INSTANCES_TABLE, 'id = %s and status = %s', [instance_id, STATUS_NOT_SCHEDULED],
        {'status': STATUS_SCHEDULED, 'updated_by': actor, 'updated_at': datetime.utcnow()},
    )
    return rows[0] if rows else None


@native_write
def mark_review_instance_not_scheduled(
    instance_id,
    *,
    calendar_event_id,
    learner_id,
    review_template_id,
    coach_email,
    actor='system',
):
    """Cancel an unstarted linked review without weakening its lifecycle.

    The only write this function can make is ``scheduled -> not-scheduled``.
    Link identity and current status are all predicates in the UPDATE itself,
    so a stale request cannot cancel a different learner's review or regress
    an instance that attendance, completion or signatures already advanced.
    Returning the already-not-scheduled row makes cancellation retries
    idempotent; every other no-op returns ``None`` for the caller to reject.
    """
    where = (
        'id = %s and status = %s and calendar_event_id = %s '
        'and learner_id = %s and review_template_id = %s '
        'and lower(trim(coach_email)) = lower(trim(%s))'
    )
    identity = [
        instance_id,
        STATUS_SCHEDULED,
        calendar_event_id,
        learner_id,
        review_template_id,
        coach_email,
    ]
    rows = update_rows(
        REVIEW_INSTANCES_TABLE,
        where,
        identity,
        {
            'status': STATUS_NOT_SCHEDULED,
            'updated_by': actor,
            'updated_at': datetime.utcnow(),
        },
    )
    if rows:
        return rows[0]

    current = get_review_instance(instance_id)
    if not current or current.get('status') != STATUS_NOT_SCHEDULED:
        return None
    if (
        current.get('calendar_event_id') != calendar_event_id
        or current.get('learner_id') != learner_id
        or clean_str(current.get('review_template_id'))
        != clean_str(review_template_id)
        or clean_str(current.get('coach_email')).lower()
        != clean_str(coach_email).lower()
    ):
        return None
    return current


@native_write
def mark_review_instance_in_progress_from_attendance(instance_id, *, started_at, actor='attendance-sync'):
    """The ONLY writer of review_instances.status -> in-progress that reflects
    a real, Microsoft-Graph-confirmed Teams join by an expected coach or
    learner (see coach_api.views.apply_teams_attendance_status_transition for
    how the caller established that, and where it is invoked from). Never
    call this because a form was opened, a draft was saved, a "Start" button
    was clicked, or the scheduled time has passed.

    Strictly monotonic and idempotent: the UPDATE only ever matches a row
    still at exactly ``scheduled`` (guarded in the WHERE clause, not by a
    separate read first, so there is no race and no possibility of
    regressing an instance already at awaiting-signature/completed/
    not-scheduled back to in-progress). A second sync pass that finds the
    same attendance again is a no-op -- ``started_at`` is not rewritten and no
    duplicate transition is recorded.
    """
    rows = update_rows(
        REVIEW_INSTANCES_TABLE, 'id = %s and status = %s', [instance_id, STATUS_SCHEDULED],
        {'status': STATUS_IN_PROGRESS, 'started_at': started_at, 'updated_by': actor, 'updated_at': datetime.utcnow()},
    )
    return rows[0] if rows else None


_manual_override_logger = logging.getLogger('curriculum_api.review_instance_manual_override')


def _log_manual_in_progress_override(*, review_instance_id, calendar_event_id, reason_code, note, changed_by):
    """Operational log line for a manual override -- useful for debugging,
    but NOT the authoritative record. curriculum.review_instance_manual_
    overrides (record_review_instance_manual_override, below) is the
    persistent business record; this log may still be handy for
    operational debugging alongside it."""
    _manual_override_logger.info(
        'review_instance_manual_in_progress_override',
        extra={
            'review_instance_id': review_instance_id,
            'calendar_event_id': calendar_event_id,
            'previous_status': STATUS_SCHEDULED,
            'new_status': STATUS_IN_PROGRESS,
            'source': 'manual',
            'reason_code': reason_code,
            'note': note,
            'changed_by': changed_by,
            'changed_at': datetime.utcnow().isoformat(),
        },
    )


@native_write
def mark_review_instance_in_progress_manually(instance_row, *, reason_code, note='', started_at=None, actor='system'):
    """Authorised fallback for scheduled -> in-progress when Microsoft Teams
    attendance cannot be detected (Graph outage, a delayed attendance report,
    a meeting held on another channel, a scheduler failure, or another
    exceptional operational problem). This is the EXCEPTION path --
    apply_teams_attendance_status_transition (a confirmed Teams join) remains
    the normal one. Never touches Teams identifiers, review answers,
    signatures, target_date, or scheduled_date/time.

    Authorization (the assigned coach, or a super-admin acting through the
    existing view-as/attributed-write mechanism) is the CALLER's
    responsibility -- see
    coach_api.views.coach_review_instance_mark_in_progress_manually. This
    function only enforces the lifecycle/data rules:

    * a valid reason code, with a required note when the reason is "other"
    * the instance is currently exactly `scheduled` (atomic compare-and-swap,
      same pattern as mark_review_instance_in_progress_from_attendance --
      cannot regress not-scheduled/awaiting-signature/completed, and a
      second call after a successful override is rejected, not a silent
      no-op, so a repeat click can't be mistaken for success)
    * started_at: an already-set value is never overwritten; otherwise the
      caller's optional actual-start-time, otherwise now. This value is
      never presented as Teams attendance evidence -- the instance's own
      audit trail (see _log_manual_in_progress_override) records that the
      source was manual, and that is not overwritten by a later attendance
      sync (mark_review_instance_in_progress_from_attendance's own guard
      already refuses to fire once status has moved past `scheduled`).

    Returns (ok, errors_or_row): errors is {'reason': [...]}, {'note': [...]}
    or {'status': [...]} depending on which check failed.
    """
    reason_code = clean_str(reason_code).lower()
    note = clean_str(note)
    if reason_code not in MANUAL_OVERRIDE_REASON_CODES:
        return False, {'reason': ['Choose a valid reason for this manual override.']}
    if reason_code == 'other' and not note:
        return False, {'note': ['Add details when the reason is "Other".']}

    current_status = instance_row.get('status')
    if current_status != STATUS_SCHEDULED:
        return False, {'status': [_manual_override_status_rejection(current_status)]}

    effective_started_at = instance_row.get('started_at') or started_at or datetime.utcnow()

    # Provisioned here, before the transaction below opens -- a lazy
    # first-time CREATE TABLE run *inside* transaction.atomic() interacts
    # badly with sqlite (DDL there implicitly ends the surrounding
    # transaction underneath Django's savepoint bookkeeping, which then
    # leaves the following pragma/column-lookup reading against a
    # connection state Django still thinks is mid-transaction). Every other
    # table's provisioning call already runs outside any atomic() block for
    # the same reason; this one is no different, it is just triggered lazily
    # instead of from a test's setUp().
    ensure_review_instance_manual_overrides_table()

    # The status UPDATE and the audit INSERT happen inside one transaction on
    # the same ('default') connection review_instances itself already lives
    # on (update_rows/insert_row both go through
    # django.db.connection, never 'enrolment') -- so either both apply or,
    # on any error, neither does. A rejected attempt (wrong status, bad
    # reason, lost race) never reaches this block, so no row is ever written
    # for one.
    with transaction.atomic():
        updated = update_rows(
            REVIEW_INSTANCES_TABLE, 'id = %s and status = %s',
            [instance_row.get('id'), STATUS_SCHEDULED],
            {
                'status': STATUS_IN_PROGRESS, 'started_at': effective_started_at,
                'updated_by': actor, 'updated_at': datetime.utcnow(),
            },
        )
        if not updated:
            return False, {'status': ['This review is no longer scheduled. Reload it and try again.']}

        row = updated[0]
        record_review_instance_manual_override(
            review_instance_id=row.get('id'), calendar_event_id=row.get('calendar_event_id'),
            previous_status=STATUS_SCHEDULED, new_status=STATUS_IN_PROGRESS,
            reason_code=reason_code, note=note, changed_by=actor,
            manual_started_at=effective_started_at,
        )

    _log_manual_in_progress_override(
        review_instance_id=row.get('id'), calendar_event_id=row.get('calendar_event_id'),
        reason_code=reason_code, note=note, changed_by=actor,
    )
    return True, row


@native_write
def link_calendar_event(instance_id, calendar_event_id, *, actor='system'):
    return update_rows(REVIEW_INSTANCES_TABLE, 'id = %s', [instance_id], {
        'calendar_event_id': calendar_event_id, 'updated_by': actor, 'updated_at': datetime.utcnow(),
    })


@native_write
def complete_review_instance(instance_row, *, actor='system', answers=None):
    """Finishes the form: validates every visible required field is
    answered, then moves the instance to Awaiting Signature (if the
    Curriculum template requires any signature) or straight to Completed (if
    it requires none). Returns (ok, errors).

    Submission does not require a booking or attendance transition. The DB
    write is guarded by the locked current status, so a
    concurrent completion attempt or an out-of-order request
    can't silently move the same instance twice or race a legitimate
    transition -- ``errors`` names the reason as ``{'fields': [...]}`` for
    unmet field requirements (as before), or ``{'status': [...]}`` for an
    invalid status transition, so callers can tell the two apart.
    """
    current_status = instance_row.get('status')
    editable_statuses = (STATUS_NOT_SCHEDULED, STATUS_SCHEDULED, STATUS_IN_PROGRESS)
    if current_status not in editable_statuses:
        return False, {'status': [_complete_review_instance_status_rejection(current_status)]}

    with transaction.atomic():
        # This is the same first lock used by save_review_instance_answers.
        # Optional browser answers are saved, validated and frozen within this
        # one critical section, making Send for Signatures an atomic action.
        locked = get_review_instance(instance_row.get('id'), for_update=True)
        if not locked:
            return False, {'status': ['Review not found.']}
        current_status = locked.get('status')
        if current_status not in editable_statuses:
            return False, {'status': [_complete_review_instance_status_rejection(current_status)]}
        # An optional booking must still belong to this exact review, learner
        # and coach. Refuse inconsistent links before saving any form answers.
        try:
            calendar = _locked_linked_calendar_for_mirror(locked)
        except ValueError as exc:
            return False, {'status': [str(exc)]}
        if calendar is not None and calendar.status not in editable_statuses:
            return False, {'status': ['The linked Calendar status changed. Reload this review.']}
        if answers is not None:
            locked = _save_review_instance_answers_locked(locked, answers, actor=actor)
        else:
            locked = _refresh_locked_editable_definition_snapshot(locked, actor=actor)

        snapshot = as_json_value(locked.get('definition_snapshot'), {})
        requires_signature = bool(required_signature_roles(snapshot.get('signatures', {})))
        answers_by_field = get_review_instance_answers(locked.get('id'))
        missing_fields = _visible_required_unanswered_fields(snapshot.get('sections', []), answers_by_field)
        if missing_fields:
            return False, {'fields': missing_fields}

        if requires_signature:
            updated = update_rows(
                REVIEW_INSTANCES_TABLE, 'id = %s and status = %s',
                [locked.get('id'), current_status],
                {'status': STATUS_AWAITING_SIGNATURE, 'updated_by': actor, 'updated_at': datetime.utcnow()},
            )
        else:
            updated = update_rows(
                REVIEW_INSTANCES_TABLE, 'id = %s and status = %s',
                [locked.get('id'), current_status],
                {
                    'status': STATUS_COMPLETED, 'completed_at': datetime.utcnow(),
                    'updated_by': actor, 'updated_at': datetime.utcnow(),
                },
            )
        if not updated:
            return False, {'status': ['This review status changed. Reload it and try again.']}
        _mirror_linked_calendar_after_signature(
            updated[0], status=updated[0]['status'], completed_at=updated[0].get('completed_at'),
        )
    return True, None
