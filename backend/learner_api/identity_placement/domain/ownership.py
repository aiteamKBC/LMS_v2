"""Framework-independent learner ownership decisions."""


def is_positive_learner_id(learner_id):
    """Return whether *learner_id* is a valid already-parsed target."""
    return bool(learner_id and learner_id > 0)


def learner_owns_target(account, learner_id):
    """Match the authenticated learner subject to the requested learner ID."""
    return bool(
        getattr(account, "role", None) == "learner"
        and getattr(account, "subject_id", None) == learner_id
    )


def staff_identity_can_own_learner(account, learner_id):
    """Whether a staff account has enough identity to resolve its own link."""
    return bool(
        getattr(account, "role", None) == "staff"
        and getattr(account, "subject_type", None) == "staff"
        and is_positive_learner_id(learner_id)
        and getattr(account, "email", None)
    )


def coach_identity_can_own_learner(account, learner_id):
    """Whether a staff account may be checked against the Coach caseload."""
    return bool(
        getattr(account, "role", None) == "staff"
        and getattr(account, "subject_type", None) == "staff"
        and is_positive_learner_id(learner_id)
    )
