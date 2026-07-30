from collections import defaultdict

from django.db import router
from django.db.models import Q
from django.utils import timezone

from curriculum_api.models import LiveSession, LiveSessionAttendance, LiveSessionOccurrence

from .models import LearnerProfile


def _email(value) -> str:
    return str(value or "").strip().casefold()


def _local_datetime(value):
    if value is None:
        return None
    if timezone.is_aware(value):
        return timezone.localtime(value)
    return value


def fetch_verified_teams_attendance_rows(
    learner_ids: list[int] | None = None,
    learner_emails: list[str] | None = None,
) -> list[dict]:
    """Build real attendance from completed Microsoft Teams reports."""

    ids = sorted({int(value) for value in (learner_ids or []) if value})
    emails = sorted({_email(value) for value in (learner_emails or []) if _email(value)})
    if not ids and not emails:
        return []

    database = router.db_for_read(LearnerProfile) or "default"
    learner_filter = Q()
    if ids:
        learner_filter |= Q(id__in=ids)
    if emails:
        learner_filter |= Q(email_normalized__in=emails)

    learners = list(
        LearnerProfile.objects.using(database)
        .filter(learner_filter)
        .prefetch_related("plan_modules")
    )
    if not learners:
        return []

    learners_by_module: dict[str, list[LearnerProfile]] = defaultdict(list)
    for learner in learners:
        seen_modules = set()
        for plan_module in learner.plan_modules.all():
            module_ref = str(plan_module.module_ref or "").strip()
            if module_ref and module_ref not in seen_modules:
                learners_by_module[module_ref].append(learner)
                seen_modules.add(module_ref)
    if not learners_by_module:
        return []

    sessions = list(
        LiveSession.objects.using(database)
        .filter(module_catalogue_id__in=list(learners_by_module))
        .only("id", "module_catalogue_id", "module_title")
    )
    if not sessions:
        return []

    sessions_by_id = {session.id: session for session in sessions}
    occurrences = list(
        LiveSessionOccurrence.objects.using(database)
        .filter(live_session_id__in=list(sessions_by_id))
        .exclude(Q(attendance_report_id__isnull=True) | Q(attendance_report_id__exact=""))
        .order_by("scheduled_start", "session_number", "id")
    )
    if not occurrences:
        return []

    attendance_by_occurrence: dict[str, dict[str, dict]] = defaultdict(dict)
    attendance_records = (
        LiveSessionAttendance.objects.using(database)
        .filter(occurrence_id__in=[occurrence.id for occurrence in occurrences])
        .only("occurrence_id", "email", "display_name", "total_attendance_seconds")
    )
    for record in attendance_records:
        email_key = _email(record.email)
        if not email_key:
            continue
        existing = attendance_by_occurrence[record.occurrence_id].get(email_key)
        if existing is None:
            attendance_by_occurrence[record.occurrence_id][email_key] = {
                "total_attendance_seconds": max(record.total_attendance_seconds or 0, 0),
            }
        else:
            existing["total_attendance_seconds"] += max(record.total_attendance_seconds or 0, 0)

    rows = []
    for occurrence in occurrences:
        session = sessions_by_id.get(occurrence.live_session_id)
        if session is None:
            continue
        module_ref = str(session.module_catalogue_id or "").strip()
        start = _local_datetime(occurrence.actual_start or occurrence.scheduled_start)
        end = _local_datetime(occurrence.actual_end or occurrence.scheduled_end)
        if start is None:
            continue
        title = str(session.module_title or "").strip() or "Live session"
        if occurrence.session_number:
            title = f"{title} — Session {occurrence.session_number}"

        for learner in learners_by_module.get(module_ref, []):
            attendance = attendance_by_occurrence[occurrence.id].get(_email(learner.email))
            rows.append(
                {
                    "learner_id": learner.id,
                    "learner_name": learner.full_name,
                    "learner_email": learner.email,
                    "session_id": occurrence.id,
                    "session_title": title,
                    "session_type": "live_session",
                    "session_date": start.date(),
                    "session_start_time": start.time().replace(tzinfo=None),
                    "session_end_time": end.time().replace(tzinfo=None) if end else None,
                    "attendance_status": "present" if attendance else "absent",
                    "minutes_late": 0,
                    "catchup_completed": False,
                    "absence_reason": "",
                    "attended_seconds": attendance["total_attendance_seconds"] if attendance else 0,
                    "updated_at": occurrence.artifacts_synced_at or occurrence.updated_at,
                }
            )

    return rows
