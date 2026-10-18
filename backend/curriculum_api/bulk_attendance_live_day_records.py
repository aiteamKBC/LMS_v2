"""Read saved live-session attendance for one local calendar date.

The bulk-attendance register needs a small, date-scoped read of the LMS
register.  This module never calls Microsoft Graph and never modifies Teams
meetings, occurrences, invitations, or raw attendance evidence.
"""
from datetime import date

from django.db import DatabaseError, router
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_GET

from learner_api.models import LearnerProfile

from .models import LiveSession, LiveSessionLearnerAttendance, LiveSessionOccurrence
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
