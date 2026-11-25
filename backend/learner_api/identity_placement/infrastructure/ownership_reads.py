"""Concrete reads used by learner ownership authorization."""


def linked_enrolment_id(email, *, normalize_email):
    """Return the existing enrolment linked by the authenticated staff email."""
    from django.apps import apps
    from django.db import DatabaseError

    email = normalize_email(email)
    if not email:
        return None
    try:
        EnrolmentUser = apps.get_model("learner_api", "EnrolmentUser")
        learner = (
            EnrolmentUser.all_learners.filter(email__iexact=email)
            .only("id", "learner_type")
            .first()
        )
        return learner.pk if learner is not None else None
    except DatabaseError:
        return None


def authorized_coach_email(
    staff_id,
    *,
    normalize_email,
    accesses_for_staff,
    coach_access,
):
    """Return the normalized email only for a current Coach staff identity."""
    from django.apps import apps
    from django.db import DatabaseError

    try:
        StaffUser = apps.get_model("learner_api", "StaffUser")
        staff = (
            StaffUser.objects.filter(pk=staff_id)
            .only("email", "access", "access_extra")
            .first()
        )
        email = normalize_email(getattr(staff, "email", ""))
        if not staff or not email or coach_access not in accesses_for_staff(staff):
            return None
        return email
    except DatabaseError:
        return None


def coach_caseload_contains(email, learner_id):
    """Apply the existing exact normalized Coach Dashboard caseload rule."""
    from django.apps import apps
    from django.db import DatabaseError
    from django.db.models.functions import Lower, Trim

    try:
        LearnerProfile = apps.get_model("learner_api", "LearnerProfile")
        return (
            LearnerProfile.objects.annotate(coach_email_key=Lower(Trim("coach_email")))
            .filter(coach_email_key=email, enrolment_id=learner_id)
            .exists()
        )
    except DatabaseError:
        return False
