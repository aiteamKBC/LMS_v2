"""Review eligibility, lifecycle rejection and frozen signature requirements."""
from __future__ import annotations

from curriculum_api.review_management.domain.template_rules import PARTICIPANT_ROLES
from curriculum_api.catalogue.domain.values import as_json_value
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.domain.values import parse_int


STATUS_NOT_SCHEDULED = 'not-scheduled'


STATUS_SCHEDULED = 'scheduled'


STATUS_IN_PROGRESS = 'in-progress'


STATUS_AWAITING_SIGNATURE = 'awaiting-signature'


STATUS_COMPLETED = 'completed'


EDITABLE_DEFINITION_STATUSES = frozenset({
    STATUS_NOT_SCHEDULED,
    STATUS_SCHEDULED,
    STATUS_IN_PROGRESS,
})


OCCURRENCE_SOURCE_GENERATED = 'generated'


OCCURRENCE_SOURCE_MANUAL = 'manual'


LEARNER_REVIEW_ADDITION_REASON_CODES = (
    'additional-coaching', 'learner-request', 'employer-request',
    'performance-concern', 'safeguarding-follow-up', 'other',
)


SIGNATURE_ROLES = PARTICIPANT_ROLES


def required_signature_roles(signature_requirements):
    """Roles required by one Review Instance's frozen signature rules.

    ``definition_snapshot.signatures`` stores booleans, while the serialized
    form definition exposes the same frozen decision as
    ``signatures[role].required``. Accepting both shapes keeps lifecycle,
    signature validation and PDF availability on one resolver without ever
    consulting the live Curriculum template.
    """
    requirements = signature_requirements or {}
    return tuple(
        role
        for role in SIGNATURE_ROLES
        if bool(
            requirements.get(role, {}).get('required')
            if isinstance(requirements.get(role), dict)
            else requirements.get(role)
        )
    )


def learner_is_eligible(template_row, learner_status):
    """applicable_statuses is Curriculum's only eligibility source -- an empty
    list means no restriction has been configured, not "nobody is eligible"."""
    statuses = as_json_value(template_row.get('applicable_statuses'), [])
    if not statuses:
        return True
    return clean_str(learner_status) in statuses


def template_recurrence_config(row):
    return {
        'interval': parse_int(row.get('recurrence_interval'), 1),
        'unit': row.get('recurrence_unit') or 'weeks',
        'occurrenceLimit': row.get('occurrence_count'),
    }


MANUAL_OVERRIDE_REASON_CODES = (
    'coach-confirmed-live-start',
    'teams-link-issue',
    'graph-unavailable',
    'attendance-not-detected',
    'meeting-held-outside-teams',
    'scheduler-delay',
    'other',
)


REOPEN_REASON_CODES = (
    'correction-required',
    'incorrect-answer',
    'signature-error',
    'employer-requested-change',
    'other',
)


REOPENABLE_STATUSES = (STATUS_AWAITING_SIGNATURE, STATUS_COMPLETED)


def _manual_override_status_rejection(current_status):
    if current_status == STATUS_IN_PROGRESS:
        return 'This review is already in progress.'
    if current_status == STATUS_AWAITING_SIGNATURE:
        return 'This review has already been submitted and is awaiting signature.'
    if current_status == STATUS_COMPLETED:
        return 'This review has already been completed.'
    if current_status == STATUS_NOT_SCHEDULED:
        return 'This review has not been scheduled yet.'
    return 'This review cannot be manually marked in progress from its current status.'


def _complete_review_instance_status_rejection(current_status):
    if current_status == STATUS_AWAITING_SIGNATURE:
        return 'This review has already been submitted and is awaiting signature.'
    if current_status == STATUS_COMPLETED:
        return 'This review has already been completed.'
    return 'This review cannot be completed from its current status.'


def _reopen_review_instance_status_rejection(current_status):
    """Why this instance cannot be reopened, phrased for the coach.

    Same shape and purpose as _complete_review_instance_status_rejection: the
    string is returned inside an ``errors`` dict, never raised.
    """
    if current_status == STATUS_NOT_SCHEDULED:
        return 'This review has not been scheduled yet.'
    if current_status == STATUS_SCHEDULED:
        return 'This review has not started yet, so there is nothing to reopen.'
    if current_status == STATUS_IN_PROGRESS:
        return 'This review is already in progress.'
    return 'This review cannot be reopened from its current status.'
