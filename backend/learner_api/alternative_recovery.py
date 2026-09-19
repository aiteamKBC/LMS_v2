"""Cohort-linked alternative delivery recovery.

Curriculum owns the delivery facts.  A cohort may have parallel groups with
one active Teams series per group; matching occurrence numbers in that
unambiguous layout are the same cohort delivery slot.  If a group has more
than one active series, this module deliberately returns no alternative: the
repository has no stronger authored-component relationship to choose safely.
"""
from collections import defaultdict

from django.db.models import Q
from django.utils import timezone

from coach_api.models import CoachAbsenceReport
from curriculum_api.models import (
    LiveSession,
    LiveSessionOccurrence,
    ModuleAuthoringModule,
)

from .models import LearnerProfile


ALTERNATIVE_METHOD = "alternative"
ALTERNATIVE_KEY_PREFIX = "alternative:"
INACTIVE_STATUSES = {"cancelled", "canceled", "deleted", "failed", "superseded"}


def alternative_event_key(occurrence_id: str) -> str:
    return f"{ALTERNATIVE_KEY_PREFIX}{str(occurrence_id or '').strip()}"


def alternative_occurrence_id(event_key: str | None) -> str:
    value = str(event_key or "").strip()
    return value[len(ALTERNATIVE_KEY_PREFIX):] if value.startswith(ALTERNATIVE_KEY_PREFIX) else ""


def _active(value) -> bool:
    return str(value or "").strip().casefold() not in INACTIVE_STATUSES


def _local(value):
    return timezone.localtime(value) if value and timezone.is_aware(value) else value


def _cohort_context(original_occurrence_id: str, database: str):
    occurrence = (
        LiveSessionOccurrence.objects.using(database)
        .filter(pk=original_occurrence_id)
        .first()
    )
    if occurrence is None or not _active(occurrence.status):
        return None
    session = (
        LiveSession.objects.using(database)
        .filter(pk=occurrence.live_session_id)
        .first()
    )
    if session is None or not _active(session.status):
        return None
    module = (
        ModuleAuthoringModule.objects.using(database)
        .filter(module_catalogue_id=session.module_catalogue_id, deleted_at__isnull=True)
        .first()
    )
    if module is None or module.is_programme_deleted:
        return None
    if not all((module.programme_id, module.cohort_id, module.group_id)):
        return None
    return occurrence, session, module


def eligible_alternative_occurrences(
    original_occurrence_id: str,
    *,
    at=None,
    database: str = "enrolment",
) -> list[dict]:
    """Return future parallel-group occurrences for one exact occurrence.

    `at` is the apology time.  This intentionally allows an alternative before
    or after the original lecture, provided the alternative has not started.
    """
    context = _cohort_context(original_occurrence_id, database)
    if context is None:
        return []
    original, _original_session, original_module = context
    now = at or timezone.now()

    modules = list(
        ModuleAuthoringModule.objects.using(database)
        .filter(
            programme_id=original_module.programme_id,
            cohort_id=original_module.cohort_id,
            deleted_at__isnull=True,
            is_programme_deleted=False,
        )
        .exclude(Q(group_id__isnull=True) | Q(group_id=""))
    )
    modules_by_id = {module.module_catalogue_id: module for module in modules}
    sessions = list(
        LiveSession.objects.using(database)
        .filter(module_catalogue_id__in=list(modules_by_id))
    )
    active_by_group = defaultdict(list)
    for session in sessions:
        module = modules_by_id.get(session.module_catalogue_id)
        if module and _active(session.status):
            active_by_group[str(module.group_id)].append(session)

    # A cohort is a safe equivalence boundary only while every participating
    # group has one unambiguous active delivery series.
    original_group_series = active_by_group.get(str(original_module.group_id), [])
    if len(original_group_series) != 1 or original_group_series[0].id != _original_session.id:
        return []
    unambiguous_series = {
        group_id: group_sessions[0]
        for group_id, group_sessions in active_by_group.items()
        if len(group_sessions) == 1 and group_id != str(original_module.group_id)
    }
    if not unambiguous_series:
        return []

    candidates = list(
        LiveSessionOccurrence.objects.using(database)
        .filter(
            live_session_id__in=[session.id for session in unambiguous_series.values()],
            session_number=original.session_number,
            scheduled_start__gt=now,
        )
        .order_by("scheduled_start", "id")
    )
    session_group = {
        session.id: group_id for group_id, session in unambiguous_series.items()
    }
    result = []
    for occurrence in candidates:
        if not _active(occurrence.status):
            continue
        group_id = session_group.get(occurrence.live_session_id)
        module = next((item for item in modules if str(item.group_id) == group_id), None)
        session = unambiguous_series.get(group_id)
        if module is None or session is None:
            continue
        start, end = _local(occurrence.scheduled_start), _local(occurrence.scheduled_end)
        result.append({
            "id": occurrence.id,
            "sessionId": f"teams:{occurrence.id}",
            "title": f"{session.module_title or module.title or 'Live session'} — Session {occurrence.session_number}",
            "dateIso": start.date().isoformat(),
            "startTime": start.strftime("%H:%M"),
            "endTime": end.strftime("%H:%M") if end else "",
            "groupId": str(module.group_id),
            "group": module.group_name or "",
            "cohortId": str(module.cohort_id),
            "cohort": module.cohort_name or "",
            "module": session.module_title or module.title or "",
        })
    return result


def validate_alternative_occurrence(
    original_occurrence_id: str,
    target_occurrence_id: str,
    *,
    at=None,
    database: str = "enrolment",
) -> dict | None:
    return next(
        (
            item
            for item in eligible_alternative_occurrences(
                original_occurrence_id, at=at, database=database,
            )
            if item["id"] == str(target_occurrence_id or "").strip()
        ),
        None,
    )


def alternative_target_details(
    event_key: str | None,
    *,
    include_join_url: bool = False,
    database: str = "enrolment",
) -> dict | None:
    occurrence_id = alternative_occurrence_id(event_key)
    if not occurrence_id:
        return None
    occurrence = LiveSessionOccurrence.objects.using(database).filter(pk=occurrence_id).first()
    if occurrence is None:
        return None
    session = LiveSession.objects.using(database).filter(pk=occurrence.live_session_id).first()
    if session is None:
        return None
    module = ModuleAuthoringModule.objects.using(database).filter(
        module_catalogue_id=session.module_catalogue_id,
        deleted_at__isnull=True,
    ).first()
    if module is None:
        return None
    start, end = _local(occurrence.scheduled_start), _local(occurrence.scheduled_end)
    data = {
        "id": occurrence.id,
        "title": f"{session.module_title or module.title or 'Live session'} — Session {occurrence.session_number}",
        "dateIso": start.date().isoformat(),
        "startTime": start.strftime("%H:%M"),
        "endTime": end.strftime("%H:%M") if end else "",
        "groupId": str(module.group_id or ""),
        "group": module.group_name or "",
        "cohortId": str(module.cohort_id or ""),
        "cohort": module.cohort_name or "",
        "status": occurrence.status,
    }
    now = timezone.now()
    if include_join_url and _active(occurrence.status) and occurrence.scheduled_end > now:
        data["joinUrl"] = occurrence.join_url or session.join_url or ""
    return data


def approved_alternative_guests(database: str = "enrolment") -> dict[str, set[str]]:
    """Current learner emails expected only for their approved target occurrence."""
    reports = list(
        CoachAbsenceReport.objects.filter(
            status=CoachAbsenceReport.STATUS_APPROVED,
            recovery_method=ALTERNATIVE_METHOD,
            catchup_event_key__startswith=ALTERNATIVE_KEY_PREFIX,
        ).values("learner_id", "learner_email", "catchup_event_key")
    )
    if not reports:
        return defaultdict(set)
    current_emails = {
        profile.enrolment_id: str(profile.email or "").strip().casefold()
        for profile in LearnerProfile.objects.using(database).filter(
            enrolment_id__in=[report["learner_id"] for report in reports]
        )
    }
    guests = defaultdict(set)
    for report in reports:
        occurrence_id = alternative_occurrence_id(report["catchup_event_key"])
        email = current_emails.get(report["learner_id"]) or str(report["learner_email"] or "").strip().casefold()
        if occurrence_id and email:
            guests[occurrence_id].add(email)
    return guests
