"""JSON API for enrolment users (no DRF — plain Django views).

Routes (mounted under /learner_api/ in config/urls.py):
    GET  /learner_api/enrolment-users/            -> {count, results:[UserListRow]}
    POST /learner_api/enrolment-users/            -> create; returns the new UserListRow
    GET  /learner_api/enrolment-users/options/    -> canonical dropdown option lists
    GET  /learner_api/enrolment-users/<id>/       -> EnrolmentBoard
    PATCH/PUT /learner_api/enrolment-users/<id>/  -> update flat fields; returns board
    GET  /learner_api/staff-users/                -> {count, results:[staff rows]}
    POST /learner_api/staff-users/                -> create an admin/staff account

CSRF is exempted: this is an internal same-origin dev API reached through the
Vite proxy, with no cookie-based auth.
"""
import json

from django.db import DatabaseError
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from .active_users import cohort_dates, sync_active_user
from .constants import (
    STATUS_CHOICES,
    TYPE_CHOICES,
    PROGRAMME_STATUS_CHOICES,
    POSITION_CHOICES,
    LEARNER_TYPE_CHOICES,
)
from .mappers import (
    ValidationError,
    to_board,
    to_commercial_row,
    to_list_row,
    to_staff_row,
    write_commercial_fields,
    write_fields,
    write_staff_fields,
)
from .models import CommercialUser, EnrolmentUser, LearnerProfile, StaffUser


def _parse_body(request):
    if not request.body:
        return {}
    try:
        return json.loads(request.body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as exc:
        raise ValidationError(f"Invalid JSON body: {exc}")


def _error(message, status):
    return JsonResponse({"error": message}, status=status)


@csrf_exempt
def learner_coach(request, pk):
    """Read/update a learner's coach contact, stored on the "Learner"."Active_users"
    mirror (columns coach_name / coach_email). Set from the Delivery block of the
    learner's own page (BoardPage's Programme panel). The learner must be Active —
    they only have a mirror row then — so this 404s otherwise and the UI treats
    that as "no coach yet" rather than an error.

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
    """The single learner collection — both kinds live in one table.

    GET  ?learnerType=apprenticeship|commercial narrows the listing; omitted
         returns every learner regardless of kind.
    POST accepts "learnerType" to say which kind to create (default
         apprenticeship). Both land in enrolment."Created_users".
    """
    if request.method == "GET":
        wanted = (request.GET.get("learnerType") or "").strip()
        if wanted and wanted not in LEARNER_TYPE_CHOICES:
            return _error(
                f"Invalid learnerType: {wanted!r}. Allowed: {', '.join(LEARNER_TYPE_CHOICES)}", 400
            )
        try:
            qs = EnrolmentUser.all_learners.all()
            if wanted == "apprenticeship":
                # Rows predating the merge have a NULL type and are apprenticeship.
                qs = qs.exclude(learner_type="commercial")
            elif wanted == "commercial":
                qs = qs.filter(learner_type="commercial")
            rows = [to_list_row(u) for u in qs.order_by("id")]
        except DatabaseError as exc:
            return _error(f"Database error: {exc}", 502)
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
            # all_learners: the default manager is scoped to apprenticeship, so
            # creating through it would fight the learnerType we just set.
            user = EnrolmentUser.all_learners.create(**fields)
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
            "position": POSITION_CHOICES,
            "learnerType": LEARNER_TYPE_CHOICES,
        }
    )


@csrf_exempt
def enrolment_user_detail(request, pk):
    try:
        # all_learners, not objects: `objects` is scoped to apprenticeship rows, so
        # looking a learner up by id must span both kinds or a commercial learner
        # 404s here — ids are unique across the single table.
        user = EnrolmentUser.all_learners.get(pk=pk)
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
        except DatabaseError as exc:
            return _error(f"Database error: {exc}", 502)
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
def staff_users(request):
    """Staff/admin accounts — enrolment."Staff_users".

    GET accepts a repeatable ?position= filter, used by the create-user form's
    Case owner dropdown to list only the staff who can own a case.
    """
    if request.method == "GET":
        positions = [p for p in request.GET.getlist("position") if p.strip()]
        try:
            qs = StaffUser.objects.all()
            if positions:
                qs = qs.filter(position__in=positions)
            rows = [to_staff_row(u) for u in qs.order_by("username", "id")]
        except DatabaseError as exc:
            return _error(f"Database error: {exc}", 502)
        return JsonResponse({"count": len(rows), "results": rows})

    if request.method == "POST":
        try:
            payload = _parse_body(request)
            fields = write_staff_fields(payload, require_create=True)
        except ValidationError as exc:
            return _error(str(exc), 400)
        try:
            user = StaffUser.objects.create(**fields)
        except DatabaseError as exc:
            return _error(f"Database error: {exc}", 502)
        return JsonResponse(to_staff_row(user), status=201)

    return _error("Method not allowed.", 405)


@csrf_exempt
def staff_user_detail(request, pk):
    try:
        user = StaffUser.objects.get(pk=pk)
    except StaffUser.DoesNotExist:
        return _error("Staff user not found.", 404)
    except DatabaseError as exc:
        return _error(f"Database error: {exc}", 502)

    if request.method == "GET":
        return JsonResponse(to_staff_row(user))

    if request.method in ("PATCH", "PUT"):
        try:
            payload = _parse_body(request)
            fields = write_staff_fields(payload)
        except ValidationError as exc:
            return _error(str(exc), 400)
        if fields:
            for attr, value in fields.items():
                setattr(user, attr, value)
            try:
                # auto_now on Updated_at only fires when it's in update_fields.
                user.save(update_fields=[*fields.keys(), "updated_at"])
            except DatabaseError as exc:
                return _error(f"Database error: {exc}", 502)
        return JsonResponse(to_staff_row(user))

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
