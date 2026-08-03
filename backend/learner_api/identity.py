"""Shared identity resolution for enrolment rows and learner profiles."""

from .models import LearnerProfile


def learner_profile_for_source(source, source_pk=None, *, active_only=False):
    """Return the profile belonging to a Created_users row.

    The two tables have independent primary-key sequences.  Email is therefore
    the cross-table identity; a primary-key fallback is safe only for legacy
    source rows that genuinely have no email.
    """
    email = str(getattr(source, "email", "") or "").strip()
    filters = {"lifecycle_status": "active"} if active_only else {}
    if email:
        return LearnerProfile.objects.filter(email__iexact=email, **filters).first()
    if source_pk is None:
        source_pk = getattr(source, "pk", None) or getattr(source, "id", None)
    if source_pk is None:
        return None
    return LearnerProfile.objects.filter(pk=source_pk, **filters).first()
