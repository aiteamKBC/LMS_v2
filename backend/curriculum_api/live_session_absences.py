"""Persistence helpers for the curriculum live-session absence ledger."""

from django.utils import timezone

from .models import LiveSessionAbsence, LiveSessionLearnerAttendance, LiveSessionOccurrence


def recovery_status_for(method: str) -> str:
    method = str(method or '').strip().casefold()
    if method == 'catch-up':
        return LiveSessionAbsence.RECOVERY_CATCHUP_BOOKED
    if method:
        return LiveSessionAbsence.RECOVERY_REQUESTED
    return LiveSessionAbsence.RECOVERY_NONE


def record_reported_absence(
    *,
    database: str,
    occurrence_id: str,
    learner_profile_id: int,
    source_kind: str,
    source_learner_id: int,
    learner_email: str,
    learner_name: str,
    recovery_method: str,
    recovery_reference: str = '',
):
    """Create/update the learner-owned report without changing Teams evidence."""

    occurrence = LiveSessionOccurrence.objects.using(database).only('id').get(
        pk=occurrence_id,
    )
    saved = LiveSessionAbsence.objects.using(database).update_or_create(
        occurrence_id=occurrence.id,
        learner_profile_id=learner_profile_id,
        defaults={
            'source_kind': str(source_kind or '').strip(),
            'source_learner_id': source_learner_id,
            'learner_email': str(learner_email or '').strip().casefold(),
            'learner_name': str(learner_name or '').strip(),
            'recovery_status': recovery_status_for(recovery_method),
            'recovery_method': str(recovery_method or '').strip(),
            'recovery_reference': str(recovery_reference or '').strip(),
            'reported_at': timezone.now(),
        },
    )
    LiveSessionLearnerAttendance.objects.using(database).filter(
        occurrence_id=occurrence.id,
        learner_profile_id=learner_profile_id,
        attendance_status=LiveSessionLearnerAttendance.STATUS_ABSENT,
    ).update(
        recovery_status=recovery_status_for(recovery_method),
        updated_at=timezone.now(),
    )
    return saved
