"""Read-only learner identity resolution for Progress Review requests.

The B4B canonical selector owns identity validation.  This adapter only adds
the ORM model instance that Review pack builders need and the two explicitly
approved B4C legacy compatibility paths.  It never repairs an identity link.
"""

from dataclasses import dataclass

from django.db.models import CharField, F, Func, Value
from django.db.models.functions import Cast, Trim

from learner_api.selectors.identity import (
    EnrolmentId,
    ResolutionStatus,
    validate_profile,
)
from learner_api.selectors.lineage_identity import LineageMatchBasis


class _CanonicalValidationError(Exception):
    def __init__(self, message, code, status):
        super().__init__(message)
        self.code = code
        self.status = status


@dataclass(frozen=True)
class ReviewProfileResolution:
    status: ResolutionStatus
    requested_enrolment_id: EnrolmentId | None
    profile: object | None = None
    match_basis: LineageMatchBasis | None = None

    @property
    def resolved(self):
        return self.status in (
            ResolutionStatus.RESOLVED,
            ResolutionStatus.LEGACY_RESOLVED,
        )


def _result(status, requested, *, profile=None, match_basis=None):
    return ReviewProfileResolution(
        status=status,
        requested_enrolment_id=requested,
        profile=profile,
        match_basis=match_basis,
    )


def _normalise_aptem(value):
    value = str(value or "").strip().lstrip("0")
    return value or ""


def _canonical_owner(source, profile):
    return {
        "id": profile.pk,
        "enrolment_id": profile.enrolment_id,
        "aptem_id": profile.aptem_id,
        "learner_type": profile.learner_type,
        "email": profile.email,
        "account_record_id": source.pk,
        "account_email": source.email,
        "account_aptem_id": source.aptem_id,
    }


def _canonical_profile(source, requested, profiles):
    if len(profiles) > 1:
        return _result(ResolutionStatus.AMBIGUOUS, requested)
    if not profiles:
        return None
    profile = profiles[0]
    try:
        validate_profile(_canonical_owner(source, profile), error_type=_CanonicalValidationError)
    except _CanonicalValidationError:
        return _result(ResolutionStatus.MISMATCH, requested)
    return _result(
        ResolutionStatus.RESOLVED,
        requested,
        profile=profile,
        match_basis=LineageMatchBasis.EXPLICIT_BRIDGE,
    )


def _legacy_email_profile(source, requested, email):
    from learner_api.models import EnrolmentUser, LearnerProfile

    owners = list(
        EnrolmentUser.all_learners.filter(email__iexact=email)
        .values_list("pk", flat=True)[:2]
    )
    if len(owners) != 1 or int(owners[0]) != int(requested):
        return _result(ResolutionStatus.AMBIGUOUS, requested)

    profiles = list(
        LearnerProfile.objects.filter(
            email__iexact=email,
            enrolment_id__isnull=True,
        )[:2]
    )
    if len(profiles) != 1:
        return _result(
            ResolutionStatus.AMBIGUOUS if profiles else ResolutionStatus.MISSING,
            requested,
        )
    return _result(
        ResolutionStatus.LEGACY_RESOLVED,
        requested,
        profile=profiles[0],
        match_basis=LineageMatchBasis.LEGACY_UNIQUE_PRIMARY_EMAIL,
    )


def _legacy_equal_pk_profile(source, requested):
    from learner_api.models import EnrolmentUser, LearnerProfile

    profiles = list(
        LearnerProfile.objects.filter(
            pk=requested,
            enrolment_id__isnull=True,
        )[:2]
    )
    if len(profiles) != 1:
        return _result(
            ResolutionStatus.AMBIGUOUS if profiles else ResolutionStatus.MISSING,
            requested,
        )
    profile = profiles[0]

    profile_email = str(getattr(profile, "email", "") or "").strip()
    if profile_email and EnrolmentUser.all_learners.filter(
        email__iexact=profile_email,
    ).exclude(pk=requested).exists():
        return _result(ResolutionStatus.AMBIGUOUS, requested)

    source_aptem = _normalise_aptem(getattr(source, "aptem_id", None))
    profile_aptem = _normalise_aptem(getattr(profile, "aptem_id", None))
    if source_aptem and source_aptem != profile_aptem:
        return _result(ResolutionStatus.MISMATCH, requested)
    if profile_aptem:
        competing_aptem_owner = (
            EnrolmentUser.all_learners
            .exclude(pk=requested)
            .annotate(
                _review_aptem=Func(
                    Cast(Trim(F("aptem_id")), CharField()),
                    Value("0"),
                    function="LTRIM",
                )
            )
            .filter(_review_aptem=profile_aptem)
            .exists()
        )
        if competing_aptem_owner:
            return _result(ResolutionStatus.AMBIGUOUS, requested)

    return _result(
        ResolutionStatus.LEGACY_RESOLVED,
        requested,
        profile=profile,
        match_basis=LineageMatchBasis.LEGACY_NO_EMAIL_EQUAL_PROFILE_PK,
    )


def resolve_review_profile(source, source_pk=None):
    """Resolve one already-authorized enrolment source without mutations."""
    from learner_api.models import LearnerProfile

    raw = source_pk if source_pk is not None else getattr(source, "pk", None)
    try:
        requested = EnrolmentId(int(raw))
    except (TypeError, ValueError):
        return _result(ResolutionStatus.MISSING, None)
    if int(requested) <= 0 or source is None or int(getattr(source, "pk", 0) or 0) != int(requested):
        return _result(ResolutionStatus.MISSING, requested)

    canonical = _canonical_profile(
        source,
        requested,
        list(LearnerProfile.objects.filter(enrolment_id=requested)[:2]),
    )
    if canonical is not None:
        return canonical

    email = str(getattr(source, "email", "") or "").strip()
    if email:
        return _legacy_email_profile(source, requested, email)
    return _legacy_equal_pk_profile(source, requested)


def review_profile_for_source(source, source_pk=None):
    """Compatibility wrapper for Review callers that expect a model or None."""
    return resolve_review_profile(source, source_pk).profile
