"""Locked Coach Calendar identity checks and atomic status projections."""
from __future__ import annotations

from curriculum_api.review_management.domain.instance_rules import STATUS_AWAITING_SIGNATURE
from curriculum_api.review_management.domain.instance_rules import STATUS_COMPLETED
from curriculum_api.catalogue.domain.values import clean_str
from datetime import datetime


def _locked_linked_calendar_for_mirror(instance_row):
    """Lock this instance's linked Calendar row and prove it is really the same
    review, or raise.

    Shared by every mirror that projects an instance-owned status onto Calendar
    (_mirror_linked_calendar_after_signature and
    _mirror_linked_calendar_after_reopen): identity, learner, template and
    coach must all still agree before either is allowed to write. Returns the
    locked CoachCalendarEvent, or None when this instance has no linked
    calendar row at all -- a legitimate, silent no-op for both callers.
    """
    calendar_event_id = instance_row.get('calendar_event_id')
    if not calendar_event_id:
        return None

    # Import lazily: coach_api.views imports this module at application start.
    from coach_api.models import CoachCalendarEvent

    calendar = CoachCalendarEvent.objects.select_for_update().filter(
        pk=calendar_event_id,
    ).first()
    if calendar is None:
        raise ValueError(
            'The linked Calendar event is missing; review reconciliation is required.'
        )

    instance_id = clean_str(instance_row.get('id'))
    if clean_str(calendar.review_instance_id) != instance_id:
        raise ValueError(
            'The linked Calendar event does not point back to this Review Instance; '
            'review reconciliation is required.'
        )
    if str(calendar.learner_profile_id) != str(instance_row.get('learner_id')):
        raise ValueError(
            'The linked Calendar event belongs to a different learner; '
            'review reconciliation is required.'
        )
    template_id = clean_str(instance_row.get('review_template_id'))
    calendar_template_id = clean_str(calendar.review_template_id)
    if template_id and calendar_template_id and template_id != calendar_template_id:
        raise ValueError(
            'The linked Calendar event has a different Review template; '
            'review reconciliation is required.'
        )
    coach_email = clean_str(instance_row.get('coach_email')).lower()
    owner_email = clean_str(calendar.owner_email).lower()
    if coach_email and owner_email and coach_email != owner_email:
        raise ValueError(
            'The linked Calendar event has a different coach; '
            'review reconciliation is required.'
        )
    return calendar


def _mirror_linked_calendar_after_signature(instance_row, *, status, completed_at=None):
    """Project submission/signature status onto an existing owned Calendar row."""
    from coach_api.models import CoachCalendarEvent

    calendar = _locked_linked_calendar_for_mirror(instance_row)
    if calendar is None:
        return

    if status == STATUS_AWAITING_SIGNATURE:
        allowed = {
            CoachCalendarEvent.STATUS_NOT_SCHEDULED,
            CoachCalendarEvent.STATUS_SCHEDULED,
            CoachCalendarEvent.STATUS_IN_PROGRESS,
            CoachCalendarEvent.STATUS_AWAITING_SIGNATURE,
        }
        if calendar.status not in allowed:
            raise ValueError(
                'The linked Calendar event cannot enter awaiting-signature from its '
                f'current status ({calendar.status}).'
            )
        if calendar.status != CoachCalendarEvent.STATUS_AWAITING_SIGNATURE:
            calendar.status = CoachCalendarEvent.STATUS_AWAITING_SIGNATURE
            calendar.save(update_fields=['status', 'updated_at'])
        return

    if status == STATUS_COMPLETED:
        allowed = {
            CoachCalendarEvent.STATUS_NOT_SCHEDULED,
            CoachCalendarEvent.STATUS_SCHEDULED,
            CoachCalendarEvent.STATUS_IN_PROGRESS,
            CoachCalendarEvent.STATUS_AWAITING_SIGNATURE,
            CoachCalendarEvent.STATUS_COMPLETED,
        }
        if calendar.status not in allowed:
            raise ValueError(
                'The linked Calendar event cannot enter completed from its '
                f'current status ({calendar.status}).'
            )
        calendar.status = CoachCalendarEvent.STATUS_COMPLETED
        calendar.review_completed_at = completed_at or datetime.utcnow()
        calendar.save(update_fields=['status', 'review_completed_at', 'updated_at'])


def _mirror_linked_calendar_after_reopen(instance_row):
    """Project a reopen back onto its linked Calendar row atomically.

    The inverse of _mirror_linked_calendar_after_signature's completed branch,
    reusing that function's identity/ownership validation wholesale via
    _locked_linked_calendar_for_mirror -- an instance may only move a Calendar
    row it still demonstrably owns.
    """
    from coach_api.models import CoachCalendarEvent

    calendar = _locked_linked_calendar_for_mirror(instance_row)
    if calendar is None:
        return

    # Strictly the two states a finished review's Calendar row is ever in. The
    # normal paths keep the two exactly in step -- coach_review_instance_complete
    # calls _sync_calendar_record_to_review_instance_status immediately after
    # completing, and the signature mirror advances it again -- so anything else
    # here means instance and Calendar have genuinely diverged. That is a
    # reconciliation problem, and this fails loudly rather than quietly
    # accepting the wider set and writing over it.
    allowed = {
        CoachCalendarEvent.STATUS_AWAITING_SIGNATURE,
        CoachCalendarEvent.STATUS_COMPLETED,
    }
    if calendar.status not in allowed:
        raise ValueError(
            'The linked Calendar event is not in a finished state and cannot be '
            f'reopened: expected awaiting-signature or completed, found '
            f'{calendar.status}. Review reconciliation is required.'
        )
    calendar.status = CoachCalendarEvent.STATUS_IN_PROGRESS
    calendar.review_completed_at = None
    calendar.save(update_fields=['status', 'review_completed_at', 'updated_at'])
