"""Orchestrate learner ownership without depending on Django or view code."""

from ..domain.ownership import (
    coach_identity_can_own_learner,
    learner_owns_target,
    staff_identity_can_own_learner,
)


def staff_owns_learner(account, learner_id, *, read_linked_enrolment):
    """Resolve a staff account's authenticated email to its learner record."""
    if not staff_identity_can_own_learner(account, learner_id):
        return False
    linked_id = read_linked_enrolment(account.email)
    return linked_id == learner_id


def coach_owns_learner(
    account,
    learner_id,
    *,
    read_authorized_coach_email,
    caseload_contains,
):
    """Resolve current Coach access and exact caseload ownership."""
    if not coach_identity_can_own_learner(account, learner_id):
        return False
    email = read_authorized_coach_email(account.subject_id)
    return bool(email and caseload_contains(email, learner_id))


__all__ = ("coach_owns_learner", "learner_owns_target", "staff_owns_learner")
