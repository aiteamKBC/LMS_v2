"""JSON API for enrolment users (no DRF — plain Django views).

Routes (mounted under /learner_api/ in config/urls.py):
    GET  /learner_api/enrolment-users/            -> {count, results:[UserListRow]}
    POST /learner_api/enrolment-users/            -> create; returns the new UserListRow
    GET  /learner_api/enrolment-users/options/    -> canonical dropdown option lists
    GET  /learner_api/enrolment-users/<id>/       -> EnrolmentBoard
    PATCH/PUT /learner_api/enrolment-users/<id>/  -> update flat fields; returns board

CSRF is exempted: this is an internal same-origin dev API reached through the
Vite proxy, with no cookie-based auth.
"""
import json

from django.db import DatabaseError
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from .active_users import cohort_dates, sync_active_user
from .constants import STATUS_CHOICES, TYPE_CHOICES, PROGRAMME_STATUS_CHOICES
from .mappers import (
    ValidationError,
    to_board,
    to_commercial_row,
    to_list_row,
    write_commercial_fields,
    write_fields,
)
from .models import CommercialUser, EnrolmentUser, LearnerProfile


def _parse_body(request):
    if not request.body:
        return {}
    try:
        return json.loads(request.body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as exc:
        raise ValidationError(f"Invalid JSON body: {exc}")


def _error(message, status):
    return JsonResponse({"error": message}, status=status)


def _profile_to_delivery_row(profile):
    """Adapt the normalized Learner mirror to the Delivery table shape.

    Some Neon environments do not contain the legacy enrolment source tables
    yet, while ``Learner.learners`` is already populated and is the source used
    by the rest of the application. Keep the Delivery page usable in that
    situation without pretending that legacy training-plan fields exist.
    """
    return {
        "id": str(profile.id),
        "username": profile.full_name or "",
        "email": profile.email or "",
        "phone": profile.phone_number or "",
        "employer": getattr(profile, "employer", "") or "",
        "lineManager": getattr(profile, "line_manager", "") or "",
        "organization": "",
        "programmeStatus": profile.programme_status or "",
        "programme": profile.programme or "",
        "cohort": profile.cohort or "",
        "group": profile.group_name or "",
        "modules": "",
        "weeks": "",
        "components": "",
        "trainingPlan": [],
    }


@csrf_exempt
def learner_coach(request, pk):
    """Read/update a learner's coach contact, stored on the "Learner"."Active_users"
    mirror (columns coach_name / coach_email). Set from the delivery "Enrolled
    learners" page. The learner must be Active (they only have a mirror row then).

        GET   /learner_api/learners/<id>/coach/   -> {coachName, coachEmail}
        PATCH /learner_api/learners/<id>/coach/   -> {coachName?, coachEmail?} -> same

    Written straight to the mirror (not the source tables), so a status toggle to
    non-Active deletes the row and the coach data with it — re-entered on
    reactivation. An Active->Active re-save preserves it (sync_active_user's UPDATE
    excludes these columns).
    """
    try:
        active = LearnerProfile.objects.filter(id=pk, lifecycle_status="active").first()
    except DatabaseError as exc:
        return _error(f"Database error: {exc}", 502)
    if active is None:
        return _error("No active learner record. Coach can be set once the learner is Active.", 404)

    if request.method == "GET":
        return JsonResponse({"coachName": active.coach_name or "", "coachEmail": active.coach_email or ""})

    if request.method in ("PATCH", "PUT"):
        try:
            payload = _parse_body(request)
        except ValidationError as exc:
            return _error(str(exc), 400)

        update = {}
        if "coachName" in payload:
            update["coach_name"] = (str(payload["coachName"]).strip() or None) if payload["coachName"] is not None else None
        if "coachEmail" in payload:
            update["coach_email"] = (str(payload["coachEmail"]).strip() or None) if payload["coachEmail"] is not None else None
        if not update:
            return _error("Provide coachName and/or coachEmail.", 400)

        for attr, value in update.items():
            setattr(active, attr, value)
        try:
            active.save(update_fields=list(update.keys()))
        except DatabaseError as exc:
            return _error(f"Database error: {exc}", 502)
        return JsonResponse({"coachName": active.coach_name or "", "coachEmail": active.coach_email or ""})

    return _error("Method not allowed.", 405)


@csrf_exempt
def enrolment_users(request):
    if request.method == "GET":
        try:
            rows = [to_list_row(u) for u in EnrolmentUser.objects.all().order_by("id")]
        except DatabaseError:
            # The current Neon branch has no legacy apprenticeship source
            # table. Return an empty section rather than showing a database
            # error; normalized learners are handled by commercial_users.
            rows = []
        return JsonResponse({"count": len(rows), "results": rows})

    if request.method == "POST":
        try:
            payload = _parse_body(request)
            fields = write_fields(payload, require_create=True)
        except ValidationError as exc:
            return _error(str(exc), 400)

        # Stamp who/when enrolled, server-side.
        stamp = timezone.now().strftime("%d/%m/%Y %H:%M:%S")
        fields.setdefault("enrolled_time_and_user", f"{stamp} by Enrolment Officer")

        # Stamp the cohort's delivery window from the authored cohort table.
        start, end = cohort_dates(fields.get("programme"), fields.get("cohort"))
        if start is not None:
            fields["start_date"] = start
        if end is not None:
            fields["end_date"] = end

        try:
            user = EnrolmentUser.objects.create(**fields)
        except DatabaseError as exc:
            return _error(f"Database error: {exc}", 502)
        return JsonResponse(to_list_row(user), status=201)

    return _error("Method not allowed.", 405)


@csrf_exempt
def enrolment_user_options(request):
    if request.method != "GET":
        return _error("Method not allowed.", 405)
    return JsonResponse(
        {
            "status": STATUS_CHOICES,
            "type": TYPE_CHOICES,
            "programmeStatus": PROGRAMME_STATUS_CHOICES,
        }
    )


@csrf_exempt
def enrolment_user_detail(request, pk):
    try:
        user = EnrolmentUser.objects.get(pk=pk)
    except EnrolmentUser.DoesNotExist:
        return _error("User not found.", 404)
    except DatabaseError as exc:
        return _error(f"Database error: {exc}", 502)

    if request.method == "GET":
        return JsonResponse(to_board(user))

    if request.method in ("PATCH", "PUT"):
        try:
            payload = _parse_body(request)
            fields = write_fields(payload)
        except ValidationError as exc:
            return _error(str(exc), 400)
        # If the cohort/programme changed, refresh the delivery window too.
        if "cohort" in fields or "programme" in fields:
            start, end = cohort_dates(
                fields.get("programme", user.programme),
                fields.get("cohort", user.cohort),
            )
            fields["start_date"] = start
            fields["end_date"] = end
        if fields:
            for attr, value in fields.items():
                setattr(user, attr, value)
            try:
                # Only write the flat columns we touched — never the JSON columns.
                user.save(update_fields=list(fields.keys()))
            except DatabaseError as exc:
                return _error(f"Database error: {exc}", 502)
        # Mirror into learner."Active_users" if this learner is now Active.
        sync_active_user(user)
        return JsonResponse(to_board(user))

    return _error("Method not allowed.", 405)


@csrf_exempt
def commercial_users(request):
    if request.method == "GET":
        try:
            rows = [to_commercial_row(u) for u in CommercialUser.objects.all().order_by("id")]
        except DatabaseError:
            # Fallback for Neon branches where the legacy enrolment table has
            # not been created but Learner.learners is already populated.
            rows = [
                _profile_to_delivery_row(profile)
                for profile in LearnerProfile.objects.all().order_by("id")
            ]
        return JsonResponse({"count": len(rows), "results": rows})

    if request.method == "POST":
        try:
            payload = _parse_body(request)
            fields = write_commercial_fields(payload, require_create=True)
        except ValidationError as exc:
            return _error(str(exc), 400)

        # Stamp the cohort's delivery window from the authored cohort table.
        start, end = cohort_dates(fields.get("programme"), fields.get("cohort"))
        if start is not None:
            fields["start_date"] = start
        if end is not None:
            fields["end_date"] = end

        try:
            user = CommercialUser.objects.create(**fields)
        except DatabaseError as exc:
            return _error(f"Database error: {exc}", 502)
        return JsonResponse(to_commercial_row(user), status=201)

    return _error("Method not allowed.", 405)


@csrf_exempt
def commercial_user_detail(request, pk):
    try:
        user = CommercialUser.objects.get(pk=pk)
    except CommercialUser.DoesNotExist:
        return _error("User not found.", 404)
    except DatabaseError as exc:
        return _error(f"Database error: {exc}", 502)

    if request.method == "GET":
        return JsonResponse(to_commercial_row(user))

    if request.method in ("PATCH", "PUT"):
        try:
            payload = _parse_body(request)
            fields = write_commercial_fields(payload)
        except ValidationError as exc:
            return _error(str(exc), 400)
        # If the cohort/programme changed, refresh the delivery window too.
        if "cohort" in fields or "programme" in fields:
            start, end = cohort_dates(
                fields.get("programme", user.programme),
                fields.get("cohort", user.cohort),
            )
            fields["start_date"] = start
            fields["end_date"] = end
        if fields:
            for attr, value in fields.items():
                setattr(user, attr, value)
            try:
                user.save(update_fields=list(fields.keys()))
            except DatabaseError as exc:
                return _error(f"Database error: {exc}", 502)
        # Mirror into learner."Active_users" if this learner is now Active.
        sync_active_user(user)
        return JsonResponse(to_commercial_row(user))

    return _error("Method not allowed.", 405)
