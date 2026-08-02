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


def _profile_is_apprenticeship(profile):
    programme = str(profile.programme or "").strip().casefold()
    lifecycle = str(profile.lifecycle_status or "").strip().casefold()
    return "apprentice" in programme or programme.startswith("apm") or lifecycle == "onboarding"


def _profile_commercial_row(profile):
    training_plan = profile.training_plan
    return {
        "id": str(profile.id),
        "username": profile.full_name or "",
        "email": profile.email or "",
        "phone": profile.phone_number or "",
        "employer": "",
        "lineManager": "",
        "organization": "",
        "programmeStatus": profile.programme_status or "",
        "programme": profile.programme or "",
        "cohort": profile.cohort or "",
        "group": profile.group_name or "",
        "modules": ", ".join(item.get("moduleTitle", "") for item in training_plan if item.get("moduleTitle")),
        "weeks": "",
        "components": "",
        "trainingPlan": training_plan,
    }


def _profile_enrolment_row(profile):
    lifecycle = str(profile.lifecycle_status or "").strip()
    subscription_status = "FullUser" if lifecycle.casefold() == "active" else lifecycle or "Invited"
    return {
        "id": str(profile.id),
        "name": profile.full_name or "",
        "type": "User",
        "email": profile.email or "",
        "group": profile.group_name or "",
        "subscriptionStatus": subscription_status,
        "subscriptionVerified": subscription_status.casefold() == "fulluser",
        "learningPlan": True,
        "programmeStatus": profile.programme_status or "",
        "notesCount": 0,
        "hasTasks": True,
        "reference": "",
    }


def _profile_enrolment_board(profile):
    return {
        "user": {"id": str(profile.id), "name": profile.full_name or "", "reference": "", "owner": ""},
        "contact": {
            "email": profile.email or "",
            "phone": profile.phone_number or "",
            "dob": "",
            "groupMembership": profile.group_name or "",
            "signatureUrl": None,
            "hasMandate": False,
        },
        "activity": {
            "aptemUsage": "00:00",
            "daysTillNextReporting": 0,
            "lastLoggedIn": None,
            "logins": 0,
            "tasksAddedByUser": 0,
            "uncompletedTasks": 0,
            "adviceItemsAccessed": 0,
            "adviceLastAccessed": None,
            "actionPlans": "No plans created",
        },
        "programme": {
            "type": "Delivery",
            "name": profile.programme or "",
            "cohort": profile.cohort or "",
            "status": profile.programme_status or "Non starter",
            "startDate": profile.start_date.isoformat() if profile.start_date else "",
            "endDate": profile.end_date.isoformat() if profile.end_date else "",
            "enrolledAt": "",
            "enrolledBy": "",
            "onboardingStatus": "Not started",
            "onboardingCompletedAt": None,
        },
        "subProgrammes": [],
        "aims": [],
        "previousProgrammes": [],
        "functionalSkills": {
            "english": {"assessments": [], "exempt": False, "evidence": []},
            "maths": {"assessments": [], "exempt": False, "evidence": []},
            "ict": {"assessments": [], "exempt": False, "evidence": []},
        },
        "managedJobs": [],
        "tracker": [],
        "milestones": [],
        "notes": [],
        "courseProgress": [],
        "contacts": [],
        "activities": [],
        "complianceDocuments": [],
        "reviewDocuments": [],
        "documents": [],
        "competencies": [],
        "subscription": {"startDate": "", "endDate": "", "status": profile.lifecycle_status or ""},
        "auditTrail": [],
        "trainingPlan": profile.training_plan,
    }


def _update_profile_from_delivery_payload(profile, payload):
    field_map = {
        "username": "full_name",
        "email": "email",
        "phone": "phone_number",
        "programmeStatus": "programme_status",
        "programme": "programme",
        "cohort": "cohort",
        "group": "group_name",
    }
    update_fields = []
    for payload_key, model_field in field_map.items():
        if payload_key not in payload:
            continue
        value = str(payload.get(payload_key) or "").strip()
        setattr(profile, model_field, value)
        update_fields.append(model_field)
    if "email" in update_fields:
        profile.email_normalized = profile.email.strip().casefold()
        update_fields.append("email_normalized")
    if update_fields:
        profile.updated_at = timezone.now()
        update_fields.append("updated_at")
        profile.save(update_fields=update_fields)
    if "trainingPlan" in payload:
        plan = payload.get("trainingPlan")
        if not isinstance(plan, list):
            raise ValidationError("trainingPlan must be a list.")
        replace_training_plan(profile, plan)


def _create_profile_from_delivery_payload(payload, *, apprenticeship):
    email = str(payload.get("email") or "").strip()
    name = str(payload.get("username") or payload.get("name") or "").strip()
    if not email:
        raise ValidationError("email is required.")
    if not name:
        raise ValidationError("username is required.")
    programme_status = str(payload.get("programmeStatus") or "").strip()
    requested_status = str(payload.get("status") or "").strip().casefold()
    lifecycle_status = (
        "active"
        if requested_status in {"active", "fulluser"} or programme_status.casefold() == "active"
        else ("onboarding" if apprenticeship else "inactive")
    )
    now = timezone.now()
    return LearnerProfile.objects.create(
        full_name=name,
        email=email,
        email_normalized=email.casefold(),
        phone_number=str(payload.get("phone") or "").strip(),
        lifecycle_status=lifecycle_status,
        programme=str(payload.get("programme") or "").strip(),
        programme_status=programme_status,
        cohort=str(payload.get("cohort") or "").strip(),
        group_name=str(payload.get("group") or "").strip(),
        created_at=now,
        updated_at=now,
    )


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
            profile = _create_profile_from_delivery_payload(payload, apprenticeship=True)
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
        return JsonResponse(_profile_enrolment_row(profile), status=201)

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
    if profile is None:
        return _error("User not found.", 404)
    if request.method == "GET":
        return JsonResponse(_profile_enrolment_board(profile))
    if request.method in ("PATCH", "PUT"):
        try:
            payload = _parse_body(request)
            _update_profile_from_delivery_payload(profile, payload)
        except ValidationError as exc:
            return _error(str(exc), 400)
        except DatabaseError as exc:
            return _error(f"Database error: {exc}", 502)
        return JsonResponse(_profile_enrolment_board(profile))
    return _error("Method not allowed.", 405)



@csrf_exempt
def commercial_users(request):
    if request.method == "GET":
        try:
            rows = [
                _profile_commercial_row(profile)
                for profile in LearnerProfile.objects.all().order_by("id")
                if not _profile_is_apprenticeship(profile)
            ]
        except DatabaseError as exc:
            return _error(f"Database error: {exc}", 502)
        return JsonResponse({"count": len(rows), "results": rows})

    if request.method == "POST":
        try:
            payload = _parse_body(request)
            profile = _create_profile_from_delivery_payload(payload, apprenticeship=False)
        except ValidationError as exc:
            return _error(str(exc), 400)
        except DatabaseError as exc:
            return _error(f"Database error: {exc}", 502)
        return JsonResponse(_profile_commercial_row(profile), status=201)

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
        profile = LearnerProfile.objects.filter(pk=pk).first()
    except DatabaseError as exc:
        return _error(f"Database error: {exc}", 502)
    if profile is None:
        return _error("User not found.", 404)
    if request.method == "GET":
        return JsonResponse(_profile_commercial_row(profile))
    if request.method in ("PATCH", "PUT"):
        try:
            payload = _parse_body(request)
            _update_profile_from_delivery_payload(profile, payload)
        except ValidationError as exc:
            return _error(str(exc), 400)
        except DatabaseError as exc:
            return _error(f"Database error: {exc}", 502)
        return JsonResponse(_profile_commercial_row(profile))
    return _error("Method not allowed.", 405)
