"""Add a manual outcome to an existing LMS live-session occurrence.

This endpoint deliberately writes only
``curriculum.live_session_learner_attendance``. It does not create or update a
Teams meeting, occurrence, invite, or raw Teams attendance evidence.
"""
import json
import re
from datetime import date

from django.db import DatabaseError, connections, router, transaction
from django.db.models import Q
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_POST

from learner_api.models import EnrolmentUser, LearnerProfile

from .live_session_register import upsert_live_session_register
from .models import LiveSession, LiveSessionLearnerAttendance, LiveSessionOccurrence
from .session_results_policy import instant


MAX_LEARNERS = 1000
LIVE_STATUSES = {"present", "absent"}


class LiveAttendanceTargetError(ValueError):
    """The requested manual result cannot be attached to one live occurrence."""


def parse_live_attendance_request(body):
    """Validate browser input; recheck the requested occurrence against the server's module and date."""
    if not isinstance(body, dict):
        raise ValueError("Invalid request.")
    learner_ids = body.get("learnerIds")
    if not isinstance(learner_ids, list) or not learner_ids or len(learner_ids) > MAX_LEARNERS:
        raise ValueError(f"Choose between 1 and {MAX_LEARNERS} learners.")
    cleaned_ids = []
    for learner_id in learner_ids:
        value = str(learner_id or "").strip()
        if not re.fullmatch(r"\d{1,20}", value):
            raise ValueError("Each learner needs a valid KBC identifier.")
        if value not in cleaned_ids:
            cleaned_ids.append(value)

    module_catalogue_id = str(body.get("moduleCatalogueId") or "").strip()
    if not module_catalogue_id or len(module_catalogue_id) > 128:
        raise ValueError("Choose a lecture linked to a curriculum module.")
    try:
        session_date = date.fromisoformat(str(body.get("date") or "").strip())
    except ValueError as exc:
        raise ValueError("Choose a valid live-session date.") from exc
    attendance = str(body.get("attendance") or "").strip().lower()
    if attendance not in LIVE_STATUSES:
        raise ValueError("Attendance must be present or absent.")
    occurrence_id = str(body.get("occurrenceId") or "").strip()
    if len(occurrence_id) > 128:
        raise ValueError("The selected live session is invalid.")
    result = {
        "learner_ids": cleaned_ids,
        "module_catalogue_id": module_catalogue_id,
        "session_date": session_date,
        "attendance": attendance,
    }
    if occurrence_id:
        result["occurrence_id"] = occurrence_id
    return result


def matching_occurrence(occurrences, session_date, local_date, occurrence_id=""):
    """Return one scheduled occurrence on the requested local calendar date."""
    matches = [
        occurrence for occurrence in occurrences
        if occurrence.get("status") not in {"cancelled", "deleted"}
        and local_date(occurrence.get("scheduled_start")) == session_date
        and (not occurrence_id or occurrence.get("id") == occurrence_id)
    ]
    if len(matches) != 1:
        raise LiveAttendanceTargetError(
            "The selected date has no single scheduled live session. Choose a lecture date from the register."
        )
    return matches[0]


def _local_date(value):
    moment = instant(value)
    return timezone.localtime(moment).date() if moment else None


def live_occurrence_for_date(database, module_catalogue_id, session_date, occurrence_id=""):
    sessions = list(
        LiveSession.objects.using(database)
        .filter(module_catalogue_id=module_catalogue_id, status="active")
        .values("id", "module_catalogue_id")
    )
    if len(sessions) != 1:
        raise LiveAttendanceTargetError(
            "The selected lecture is not linked to one active live session."
        )
    session = sessions[0]
    occurrences = list(
        LiveSessionOccurrence.objects.using(database)
        .filter(live_session_id=session["id"])
        .values("id", "live_session_id", "scheduled_start", "status")
    )
    occurrence = matching_occurrence(occurrences, session_date, _local_date, occurrence_id)
    return session, occurrence


def profiles_for_kbc_ids(learner_ids):
    """Resolve the stable KBC/Aptem identity to one learner profile each."""
    source_database = router.db_for_read(EnrolmentUser) or "default"
    source_rows = list(
        EnrolmentUser.all_learners.using(source_database)
        .filter(aptem_id__in=learner_ids)
        .only("id", "aptem_id")
    )
    linked_enrolment_ids = [row.id for row in source_rows]
    profile_database = router.db_for_read(LearnerProfile) or "default"
    legacy_aptem_ids = [
        int(learner_id)
        for learner_id in learner_ids
        if int(learner_id) <= 9_223_372_036_854_775_807
    ]
    profile_match = Q(enrolment_id__in=linked_enrolment_ids)
    if legacy_aptem_ids:
        profile_match |= Q(enrolment_id__isnull=True, aptem_id__in=legacy_aptem_ids)
    profiles = list(
        LearnerProfile.objects.using(profile_database)
        .filter(profile_match)
        .only("id", "enrolment_id", "aptem_id", "email", "full_name")
    )
    from coach_api.views import resolve_effective_aptem_ids

    aptem_by_profile, _conflicts = resolve_effective_aptem_ids(profiles)
    profiles_by_kbc_id = {}
    for profile in profiles:
        key = str(aptem_by_profile.get(profile.id) or "").strip()
        if key in learner_ids:
            profiles_by_kbc_id.setdefault(key, []).append(profile)

    resolved = {}
    for learner_id in learner_ids:
        candidates = profiles_by_kbc_id.get(learner_id, [])
        if len(candidates) == 1:
            resolved[learner_id] = candidates[0]
    if len(resolved) != len(learner_ids):
        raise LiveAttendanceTargetError(
            "Some selected learners do not have a unique LMS profile, so no attendance was added."
        )
    return [resolved[learner_id] for learner_id in learner_ids]


def register_rows(occurrence, session, profiles, attendance, existing, now):
    """Keep existing Teams evidence when a manual status replaces its outcome."""
    rows = []
    for profile in profiles:
        prior = existing.get(profile.id, {})
        rows.append({
            "occurrence_id": occurrence["id"],
            "live_session_id": session["id"],
            "module_catalogue_id": session["module_catalogue_id"],
            "learner_profile_id": profile.id,
            "learner_email": profile.email,
            "learner_name": profile.full_name,
            "attendance_status": attendance,
            "recovery_status": prior.get("recovery_status") or "none",
            "attended_seconds": prior.get("attended_seconds") or 0,
            "attendance_report_id": prior.get("attendance_report_id") or "",
            "first_join_at": prior.get("first_join_at"),
            "last_leave_at": prior.get("last_leave_at"),
            "calculated_at": now,
        })
    return rows


@require_POST
def bulk_attendance_live_day(request):
    """Upsert selected learners' result on an existing live-session occurrence."""
    try:
        body = json.loads(request.body or b"{}")
    except (json.JSONDecodeError, UnicodeDecodeError):
        return JsonResponse({"error": "Invalid request."}, status=400)
    try:
        payload = parse_live_attendance_request(body)
        profiles = profiles_for_kbc_ids(payload["learner_ids"])
        database = router.db_for_write(LiveSessionLearnerAttendance) or "default"
        session, occurrence = live_occurrence_for_date(
            database, payload["module_catalogue_id"], payload["session_date"],
            payload.get("occurrence_id", ""),
        )
        with transaction.atomic(using=database):
            existing = {
                row["learner_profile_id"]: row
                for row in LiveSessionLearnerAttendance.objects.using(database)
                .select_for_update()
                .filter(
                    occurrence_id=occurrence["id"],
                    learner_profile_id__in=[profile.id for profile in profiles],
                )
                .values(
                    "learner_profile_id", "recovery_status", "attended_seconds",
                    "attendance_report_id", "first_join_at", "last_leave_at",
                )
            }
            rows = register_rows(
                occurrence, session, profiles, payload["attendance"], existing, timezone.now()
            )
            with connections[database].cursor() as cursor:
                upsert_live_session_register(cursor, rows)
            from engagement_api.feedback_delivery import reconcile_feedback_after_attendance_commit
            reconcile_feedback_after_attendance_commit([occurrence['id']], using=database)
    except LiveAttendanceTargetError as exc:
        return JsonResponse({"error": str(exc)}, status=409)
    except ValueError as exc:
        return JsonResponse({"error": str(exc)}, status=400)
    except DatabaseError:
        return JsonResponse({
            "error": "The live-session attendance register is unavailable. Nothing was changed; please try again."
        }, status=503)

    return JsonResponse({
        "created": sum(profile.id not in existing for profile in profiles),
        "updated": sum(profile.id in existing for profile in profiles),
    })
