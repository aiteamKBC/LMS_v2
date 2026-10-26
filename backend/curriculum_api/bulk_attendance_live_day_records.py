"""Read saved live-session attendance for one local calendar date or month.

The bulk-attendance register needs a small, date-scoped read of the LMS
register.  This module never calls Microsoft Graph and never modifies Teams
meetings, occurrences, invitations, or raw attendance evidence.
"""
from datetime import date, datetime, time

from django.db import DatabaseError, router
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_GET

from learner_api.models import LearnerProfile

from .models import LiveSession, LiveSessionLearnerAttendance, LiveSessionOccurrence, ModuleAuthoringModule
from .session_results_policy import instant


def _local_date(value):
    moment = instant(value)
    return timezone.localtime(moment).date() if moment else None


def _parse_request(request):
    try:
        session_date = date.fromisoformat(str(request.GET.get("date") or "").strip())
    except ValueError as exc:
        raise ValueError("Choose a valid attendance date.") from exc
    module_catalogue_id = str(request.GET.get("module_catalogue_id") or "").strip()
    if len(module_catalogue_id) > 128:
        raise ValueError("The selected module is invalid.")
    return session_date, module_catalogue_id


def _parse_month_request(request):
    value = str(request.GET.get("month") or "").strip()
    if len(value) != 7 or value[4] != "-":
        raise ValueError("Choose a valid attendance month.")
    try:
        first = date.fromisoformat(f"{value}-01")
        following = date(first.year + (first.month == 12), first.month % 12 + 1, 1)
    except ValueError as exc:
        raise ValueError("Choose a valid attendance month.") from exc
    module_catalogue_id = str(request.GET.get("module_catalogue_id") or "").strip()
    group_id = str(request.GET.get("group_id") or "").strip()
    module_catalogue_ids = [
        item.strip()
        for item in str(request.GET.get("module_catalogue_ids") or "").split(",")
        if item.strip()
    ]
    if (
        len(module_catalogue_id) > 128
        or len(group_id) > 128
        or len(module_catalogue_ids) > 200
        or any(len(item) > 128 for item in module_catalogue_ids)
        or not (module_catalogue_id or group_id or module_catalogue_ids)
    ):
        raise ValueError("Choose one curriculum module or group for monthly attendance.")
    return first, following, module_catalogue_id, group_id, module_catalogue_ids


def _aptem_ids_by_profile(profile_ids):
    if not profile_ids:
        return {}
    profile_database = router.db_for_read(LearnerProfile) or "default"
    profiles = list(
        LearnerProfile.objects.using(profile_database)
        .filter(id__in=profile_ids)
        .only("id", "enrolment_id", "aptem_id", "email", "full_name")
    )
    from coach_api.views import resolve_effective_aptem_ids

    return {
        profile_id: str(aptem_id)
        for profile_id, aptem_id in resolve_effective_aptem_ids(profiles)[0].items()
        if aptem_id is not None
    }


@require_GET
def bulk_attendance_live_day_records(request):
    try:
        session_date, module_catalogue_id = _parse_request(request)
        database = router.db_for_read(LiveSessionLearnerAttendance) or "default"
        session_query = LiveSession.objects.using(database).filter(status="active")
        if module_catalogue_id:
            session_query = session_query.filter(module_catalogue_id=module_catalogue_id)
        sessions = list(session_query.values("id", "module_catalogue_id"))
        if not sessions:
            return JsonResponse({"records": []})

        module_by_live_session = {
            session["id"]: session["module_catalogue_id"]
            for session in sessions
            if session.get("module_catalogue_id")
        }
        occurrences = list(
            LiveSessionOccurrence.objects.using(database)
            .filter(live_session_id__in=module_by_live_session)
            .exclude(status__in=["cancelled", "deleted"])
            .values("id", "live_session_id", "scheduled_start")
        )
        occurrence_ids = [
            occurrence["id"]
            for occurrence in occurrences
            if _local_date(occurrence.get("scheduled_start")) == session_date
        ]
        if not occurrence_ids:
            return JsonResponse({"records": []})

        register_rows = list(
            LiveSessionLearnerAttendance.objects.using(database)
            .filter(occurrence_id__in=occurrence_ids)
            .values(
                "id", "occurrence_id", "module_catalogue_id",
                "learner_profile_id", "attendance_status",
            )
        )
        aptem_by_profile = _aptem_ids_by_profile({row["learner_profile_id"] for row in register_rows})
        records = [
            {
                "recordKey": f"live:{row['id']}",
                "learnerId": aptem_by_profile[row["learner_profile_id"]],
                "moduleCatalogueId": row["module_catalogue_id"],
                "occurrenceId": row["occurrence_id"],
                "attendance": row["attendance_status"],
            }
            for row in register_rows
            if row["learner_profile_id"] in aptem_by_profile
        ]
        return JsonResponse({"records": records})
    except ValueError as exc:
        return JsonResponse({"error": str(exc)}, status=400)
    except DatabaseError:
        return JsonResponse({
            "error": "The live-session attendance register is unavailable. Please try again."
        }, status=503)


@require_GET
def bulk_attendance_live_month_records(request):
    """Read a module or group's scheduled occurrences and saved outcomes for a local month."""
    try:
        first, following, module_catalogue_id, group_id, module_catalogue_ids = _parse_month_request(request)
        database = router.db_for_read(LiveSessionLearnerAttendance) or "default"
        if module_catalogue_id:
            requested_module_ids = [module_catalogue_id]
        else:
            requested_module_ids = list(module_catalogue_ids)
            group_module_ids = list(
                ModuleAuthoringModule.objects.using(database)
                .filter(group_id=group_id, deleted_at__isnull=True, is_programme_deleted=False)
                .values_list("module_catalogue_id", flat=True)
            ) if group_id else []
            # Keep the frontend's resolved memberships, but also include the
            # authoritative group rows. Older module payloads can omit a
            # module's group id even though its live session is still valid.
            requested_module_ids = list(dict.fromkeys(requested_module_ids + group_module_ids))
        if not requested_module_ids:
            return JsonResponse({"occurrences": [], "records": []})
        session_query = LiveSession.objects.using(database).filter(
            module_catalogue_id__in=requested_module_ids,
        ).exclude(status__in=["cancelled", "deleted", "failed", "superseded"])
        sessions = list(session_query.values("id", "module_catalogue_id", "module_title", "repeat_pattern"))
        if not sessions:
            return JsonResponse({"occurrences": [], "records": []})
        if module_catalogue_id:
            # A module view follows the module's weekly pattern. One-off
            # additions (e.g. a master class) sit beside that series and are
            # only shown in the group view.
            recurring = [session for session in sessions if (session["repeat_pattern"] or "none") != "none"]
            sessions = recurring or sessions
        if module_catalogue_id and len(sessions) != 1:
            return JsonResponse({"error": "The selected module has more than one active live session."}, status=409)
        session_by_id = {session["id"]: session for session in sessions}

        zone = timezone.get_current_timezone()
        start = timezone.make_aware(datetime.combine(first, time.min), zone)
        end = timezone.make_aware(datetime.combine(following, time.min), zone)
        occurrences = list(
            LiveSessionOccurrence.objects.using(database)
            .filter(live_session_id__in=list(session_by_id), scheduled_start__gte=start, scheduled_start__lt=end)
            .exclude(status__in=["cancelled", "canceled", "deleted", "failed", "superseded"])
            .values("id", "live_session_id", "scheduled_start", "session_number")
        )
        occurrences.sort(key=lambda row: (row["scheduled_start"], row["session_number"], row["id"]))
        occurrence_ids = [row["id"] for row in occurrences]
        register_rows = list(
            LiveSessionLearnerAttendance.objects.using(database)
            .filter(occurrence_id__in=occurrence_ids)
            .values("id", "occurrence_id", "learner_profile_id", "attendance_status")
        ) if occurrence_ids else []
        occurrence_by_id = {row["id"]: row for row in occurrences}
        aptem_by_profile = _aptem_ids_by_profile({row["learner_profile_id"] for row in register_rows})
        return JsonResponse({
            "occurrences": [
                {
                    "id": row["id"],
                    "date": _local_date(row["scheduled_start"]).isoformat(),
                    "sessionNumber": row["session_number"],
                    "moduleCatalogueId": session_by_id[row["live_session_id"]]["module_catalogue_id"],
                    "moduleTitle": session_by_id[row["live_session_id"]]["module_title"] or "",
                }
                for row in occurrences
            ],
            "records": [
                {
                    "recordKey": f"live:{row['id']}",
                    "occurrenceId": row["occurrence_id"],
                    "moduleCatalogueId": session_by_id[occurrence_by_id[row["occurrence_id"]]["live_session_id"]]["module_catalogue_id"],
                    "learnerId": aptem_by_profile[row["learner_profile_id"]],
                    "attendance": row["attendance_status"],
                }
                for row in register_rows
                if row["learner_profile_id"] in aptem_by_profile
            ],
        })
    except ValueError as exc:
        return JsonResponse({"error": str(exc)}, status=400)
    except DatabaseError:
        return JsonResponse({"error": "Monthly live-session attendance is unavailable. Please try again."}, status=503)
