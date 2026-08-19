"""Shared identity resolution for enrolment rows and learner profiles."""

from .models import LearnerProfile


def learner_profile_for_source(source, source_pk=None, *, active_only=False):
    """Return the profile belonging to a Created_users row.

    ``enrolment_id`` is the real link and is tried first: it is the learner's id
    in ``Created_users``, written when the profile is created and backfilled for
    everything older by ``apply_learner_enrolment_id``.

    Email is kept only as a fallback, for profiles that predate that column and
    could not be matched during the backfill. It is a poor key — the two tables
    have independent primary-key sequences, so email was the only bridge
    available before, but a corrected address silently breaks it and two people
    sharing an address collide. Anything it resolves is repaired in passing, so
    the fallback empties itself over time.

    The primary-key fallback below is narrower still: it only helps legacy source
    rows that genuinely have no email.
    """
    filters = {"lifecycle_status": "active"} if active_only else {}

    if source_pk is None:
        source_pk = getattr(source, "pk", None) or getattr(source, "id", None)

    if source_pk is not None:
        profile = LearnerProfile.objects.filter(enrolment_id=source_pk, **filters).first()
        if profile is not None:
            return profile

    email = str(getattr(source, "email", "") or "").strip()
    if email:
        profile = LearnerProfile.objects.filter(email__iexact=email, **filters).first()
        if profile is not None:
            # Self-healing: record the link we just had to infer, so the next
            # lookup takes the fast, correct path. Best-effort — a failure here
            # must not stop the caller getting their profile.
            if source_pk is not None and profile.enrolment_id != source_pk:
                try:
                    profile.enrolment_id = source_pk
                    profile.save(update_fields=["enrolment_id"])
                except Exception:  # noqa: BLE001 - linking is opportunistic
                    pass
        return profile

    if source_pk is None:
        return None
    return LearnerProfile.objects.filter(pk=source_pk, **filters).first()
