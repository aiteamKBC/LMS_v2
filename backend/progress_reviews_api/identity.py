"""Strict learner identity mapping for Progress Review operations.

Progress Review URLs and the login account still expose the enrolment-side
Created_users.id. Run ownership is the canonical LearnerProfile.id stored in
``progress_review_runs.learner_id``. This module is the only bridge between
those spaces: it follows the explicit LearnerProfile.enrolment_id relationship
and never guesses by matching numeric values or email addresses.
"""
from dataclasses import dataclass


class LearnerIdentityError(LookupError):
    """The requested learner has no single validated canonical relationship."""


@dataclass(frozen=True)
class LearnerIdentity:
    profile_id: int
    enrolment_id: int
    learner_kind: str
    profile: object
    source: object


def _one_profile(queryset, *, requested_id) -> object:
    profiles = list(queryset[:2])
    if len(profiles) != 1:
        raise LearnerIdentityError(
            f"Learner identity {requested_id} does not have one canonical profile."
        )
    return profiles[0]


def _identity(profile) -> LearnerIdentity:
    from learner_api.models import EnrolmentUser

    enrolment_id = getattr(profile, "enrolment_id", None)
    if enrolment_id is None:
        raise LearnerIdentityError(
            f"Canonical learner {profile.pk} has no linked enrolment identity."
        )
    try:
        source = EnrolmentUser.all_learners.get(pk=enrolment_id)
    except EnrolmentUser.DoesNotExist as exc:
        raise LearnerIdentityError(
            f"Canonical learner {profile.pk} has no linked enrolment record."
        ) from exc

    kind = (
        "commercial"
        if str(getattr(source, "learner_type", "") or "").strip().lower() == "commercial"
        else "apprenticeship"
    )
    return LearnerIdentity(
        profile_id=int(profile.pk),
        enrolment_id=int(enrolment_id),
        learner_kind=kind,
        profile=profile,
        source=source,
    )


def identity_from_enrolment_id(enrolment_id: int) -> LearnerIdentity:
    """Resolve a legacy API id through the explicit profile relationship."""
    from learner_api.models import LearnerProfile

    try:
        value = int(enrolment_id)
    except (TypeError, ValueError) as exc:
        raise LearnerIdentityError("Invalid enrolment learner identity.") from exc
    if value <= 0:
        raise LearnerIdentityError("Invalid enrolment learner identity.")

    profile = _one_profile(
        LearnerProfile.objects.filter(enrolment_id=value),
        requested_id=value,
    )
    return _identity(profile)


def identity_from_profile_id(profile_id: int) -> LearnerIdentity:
    """Resolve a canonical id and validate its linked legacy source row."""
    from learner_api.models import LearnerProfile

    try:
        value = int(profile_id)
    except (TypeError, ValueError) as exc:
        raise LearnerIdentityError("Invalid canonical learner identity.") from exc
    if value <= 0:
        raise LearnerIdentityError("Invalid canonical learner identity.")

    profile = _one_profile(
        LearnerProfile.objects.filter(pk=value),
        requested_id=value,
    )
    return _identity(profile)


def identity_for_run(run: dict) -> LearnerIdentity:
    """Resolve and validate a run's canonical learner owner."""
    profile_id = run.get("learner_id")
    if profile_id is None:
        raise LearnerIdentityError("Review run has no canonical learner identity.")
    return identity_from_profile_id(profile_id)
