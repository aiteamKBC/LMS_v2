"""JSON API for enrolment users (no DRF — plain Django views).

Routes (mounted under /learner_api/ in config/urls.py):
    GET  /learner_api/enrolment-users/            -> {count, results:[UserListRow]}
    POST /learner_api/enrolment-users/            -> create; returns the new UserListRow
    GET  /learner_api/enrolment-users/options/    -> canonical dropdown option lists
    GET  /learner_api/enrolment-users/<id>/       -> EnrolmentBoard
    PATCH/PUT /learner_api/enrolment-users/<id>/  -> update flat fields; returns board
    GET  /learner_api/staff-users/                -> {count, results:[staff rows]}
    POST /learner_api/staff-users/                -> create an admin/staff account

Authentication: write methods require an authenticated staff or admin session —
see ``@staff_only(writes_only=True)`` on each view and
``login.permissions.staff_only`` for why the read paths are not gated yet.
Django's CSRF middleware is exempted because these are JSON endpoints; the
cross-site protection is the ``X-Requested-With`` header the login API also
requires, plus the SameSite=Lax session cookie.
"""
import json

import logging

from django.db import DatabaseError, transaction
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from login.permissions import staff_only
from login.models import Invitation, LoginAccount, LoginSession, PasswordReset

from .active_users import cohort_delivery_window, replace_training_plan, sync_active_user
from .identity import learner_profile_for_source
from .learner_progression import ACTIVE_STATUS, advance_learner
from .constants import (
    ACCESS_SUPER_ADMIN,
    STATUS_CHOICES,
    TYPE_CHOICES,
    PROGRAMME_STATUS_CHOICES,
    DEFAULT_PROGRAMME_STATUS,
    POSITION_CHOICES,
    LEARNER_TYPE_CHOICES,
)
from .mappers import (
    ValidationError,
    restrict_to_self_writable,
    to_board,
    to_commercial_row,
    to_list_row,
    to_staff_row,
    write_commercial_fields,
    write_fields,
    write_staff_fields,
)
from .models import CommercialUser, Employer, EnrolmentUser, LearnerProfile, StaffUser

logger = logging.getLogger(__name__)


def _learner_profiles_with_plan():
    """Load a learner list and its nested plan in four queries, not one per row."""
    return LearnerProfile.objects.prefetch_related(
        'plan_modules__weeks__components',
    )


def _parse_body(request):
    if not request.body:
        return {}
    try:
        return json.loads(request.body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as exc:
        raise ValidationError(f"Invalid JSON body: {exc}")


def _error(message, status):
    return JsonResponse({"error": message}, status=status)


def _send_platform_invitation(request, subject_type, subject_id, subject=None):
    """Invite a just-created person to the platform, and describe the outcome.

    Called from the create paths when the form's "Invite to platform" flag is
    set. Imported lazily so learner_api keeps no import-time dependency on the
    login app — the two are wired together at the URL layer, and a circular
    import here would be easy to introduce and annoying to unpick.

    Never raises: see login.services.invite_subject. The returned dict rides
    along on the 201 so the console can say "created, but the invitation email
    could not be sent" instead of silently doing nothing.

    Authorisation matters here and is *not* assumed. These creation endpoints
    carry no auth decorator of their own, so the signed-in account is passed
    down and ``invite_subject`` refuses an anonymous or under-privileged caller.
    Without that, an unauthenticated POST naming ``position: "Admin"`` would
    mint an admin credential and email the set-password link to whatever address
    the request supplied.
    """
    from login.services import invite_subject
    from login.security import client_ip, user_agent

    inviter = getattr(request, "login_account", None)
    return invite_subject(
        subject_type,
        subject_id,
        subject=subject,
        inviter=inviter,
        invited_by=inviter.email if inviter else None,
        ip=client_ip(request),
        user_agent=user_agent(request),
    )


def _check_employer_id(fields):
    """Reject an "Employer_id" that names no employer record.

    The column is a plain integer rather than a real FK (these tables are
    unmanaged), so this is where referential integrity is actually enforced.
    Clearing it to None is always allowed.
    """
    employer_id = fields.get("employer_id")
    if employer_id is None:
        return
    if not Employer.objects.filter(pk=employer_id).exists():
        raise ValidationError(f"Unknown employerId: {employer_id}")


def _profile_is_apprenticeship(profile):
    """Whether this profile is an apprenticeship learner.

    ``learner_type`` is the stored answer, copied from the enrolment record, and
    is trusted whenever it is set.

    The name-based guess below is the old rule, kept only for profiles that have
    no enrolment record to read the type from (see apply_learner_type_column's
    untyped list). It is a guess: a commercial learner on a programme called
    "Apprenticeship Skills" would be misfiled by it, which is why the column
    exists.
    """
    stored = str(getattr(profile, "learner_type", "") or "").strip().casefold()
    if stored:
        return stored == "apprenticeship"

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
        # Kept in step with mappers.to_list_row, which the directory also reads
        # from — a row missing the key would render blank instead of the name.
        "programme": profile.programme or "",
        "cohort": profile.cohort or "",
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
            "status": profile.programme_status or DEFAULT_PROGRAMME_STATUS,
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
    # email_normalized is GENERATED ALWAYS in Postgres — the database derives it
    # from `email`, and naming it in a write is rejected outright. See the field's
    # note on LearnerProfile.
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
    # enrolment_id is deliberately left null: this path creates a profile
    # straight from a payload, with no enrolment."Created_users" row behind it,
    # so there is no enrolment id to record. Inventing one would be worse than
    # the honest null — apply_learner_enrolment_id reports these as unlinked.
    #
    # email_normalized is GENERATED ALWAYS in Postgres and created_at/updated_at
    # are auto_now_add/auto_now — Django and the DB supply all three, so naming
    # them here would be rejected on insert.
    return LearnerProfile.objects.create(
        full_name=name,
        email=email,
        phone_number=str(payload.get("phone") or "").strip(),
        lifecycle_status=lifecycle_status,
        programme=str(payload.get("programme") or "").strip(),
        programme_status=programme_status,
        cohort=str(payload.get("cohort") or "").strip(),
        group_name=str(payload.get("group") or "").strip(),
    )


@csrf_exempt
@staff_only(writes_only=True)
def learner_coach(request, pk):
    """Read/update a learner's coach contact, stored on "Learner"."learners"
    (LearnerProfile, columns coach_name / coach_email), resolved from the
    enrolment row by ``learner_profile_for_source``. Set from the Owner cell in
    the learner header (BoardPage's HeroCoach), which picks a Caseowner/Admin out
    of Staff_users and writes both columns together. The learner must be Active —
    they only have a profile row then — so this 404s otherwise and the UI treats
    that as "no coach yet" rather than an error.

        GET   /learner_api/learners/<id>/coach/   -> {coachName, coachEmail}
        PATCH /learner_api/learners/<id>/coach/   -> {coachName?, coachEmail?} -> same

    Written straight to the mirror (not the source tables), so a status toggle to
    non-Active deletes the row and the coach data with it — re-entered on
    reactivation. An Active->Active re-save preserves it (sync_active_user's UPDATE
    excludes these columns).
    """
    try:
        source = EnrolmentUser.all_learners.filter(pk=pk).first()
        active = (
            learner_profile_for_source(source, pk, active_only=True)
            if source is not None
            else None
        )
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

        # Empty string, never None: both columns on "Learner"."learners" are
        # NOT NULL, so coercing a cleared field to NULL made unassigning a coach
        # fail with an IntegrityError. "" is the table's own "no coach" value —
        # the model declares blank=True and every reader already treats a blank
        # as unassigned.
        update = {}
        if "coachName" in payload:
            update["coach_name"] = str(payload["coachName"] or "").strip()
        if "coachEmail" in payload:
            update["coach_email"] = str(payload["coachEmail"] or "").strip()
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
@staff_only(writes_only=True)
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
            learners = list(qs.order_by("id"))
            # A date can arrive without any signing action, so make normal
            # enrolment reads a safe, idempotent backstop for the daily sweep.
            for learner in learners:
                advance_learner(learner)
            rows = [to_list_row(u) for u in learners]
        except DatabaseError as exc:
            return _error(f"Database error: {exc}", 502)
        return JsonResponse({"count": len(rows), "results": rows})

    if request.method == "POST":
        try:
            payload = _parse_body(request)
            fields = write_fields(payload, require_create=True)
            _check_employer_id(fields)
        except ValidationError as exc:
            return _error(str(exc), 400)

        # Stamp who/when enrolled, server-side.
        stamp = timezone.now().strftime("%d/%m/%Y %H:%M:%S")
        fields.setdefault("enrolled_time_and_user", f"{stamp} by Enrolment Officer")

        # Every learner is invited on enrolment — the form no longer asks, and a
        # caller cannot opt out by sending the flag as false. Assignment rather
        # than setdefault for exactly that reason: the column now records what
        # the platform does, not a choice somebody made on a form.
        fields["invite_to_platform"] = True

        # Stamp the cohort's delivery window from the authored cohort table. The
        # cohort carries two end dates: end_date/practical_period_end_date close
        # the practical period, and apprenticeship_end_date adds the cohort's EPA
        # period on top. These columns are text on this table, so the dates are
        # written as ISO strings.
        start, practical_end, apprenticeship_end = cohort_delivery_window(
            fields.get("programme"), fields.get("cohort")
        )
        if start is not None:
            fields["start_date"] = start
        if practical_end is not None:
            fields["end_date"] = practical_end
            fields.setdefault("practical_period_end_date", practical_end.isoformat())
        if apprenticeship_end is not None:
            # setdefault, not assignment: this column doubles as a per-learner
            # override (see mappers.py), so an explicitly supplied one wins.
            fields.setdefault("apprenticeship_end_date", apprenticeship_end.isoformat())

        try:
            # all_learners: the default manager is scoped to apprenticeship, so
            # creating through it would fight the learnerType we just set.
            user = EnrolmentUser.all_learners.create(**fields)
        except DatabaseError as exc:
            return _error(f"Database error: {exc}", 502)

        # Commercial learners are date-driven from the moment they are
        # created: before the start date they are Delivery, and on/after it
        # they become Active. Apprenticeship learners keep the normal document
        # and review progression.
        advance_learner(user)
        row = to_list_row(user)
        # Send the set-your-password email. Unconditional: enrolling somebody is
        # what gives them a platform account, so there is no longer a form
        # question gating it. Reported alongside the created learner rather than
        # raising: the learner exists either way, and a mail outage must not turn
        # a successful enrolment into a 5xx.
        row["invitation"] = _send_platform_invitation(request, "learner", user.id, subject=user)
        return JsonResponse(row, status=201)

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
# allow_own_learner: the onboarding wizard submits on the learner's own behalf.
# The payload is narrowed to LEARNER_SELF_WRITABLE_KEYS below — owning the row
# is not permission to set programmeStatus on it.
@staff_only(writes_only=True, allow_own_learner="pk")
def enrolment_user_detail(request, pk):
    try:
        # all_learners, not objects: `objects` is scoped to apprenticeship rows, so
        # looking a learner up by id must span both kinds or a commercial learner
        # 404s here — ids are unique across the single table.
        user = EnrolmentUser.all_learners.filter(pk=pk).first()
    except DatabaseError as exc:
        return _error(f"Database error: {exc}", 502)
    if user is None:
        return _error("User not found.", 404)
    if request.method == "DELETE":
        # The shared decorator allows a learner to PATCH their own wizard
        # record. That exception must never extend to account deletion.
        if getattr(request, "learner_self_write", False):
            return _error("Only staff can delete a user account.", 403)

        account = LoginAccount.objects.filter(
            subject_type="learner", subject_id=user.pk
        ).first()
        try:
            with transaction.atomic(using="enrolment"):
                # These tables use deliberate non-cascading links so account
                # removal is explicit and active sessions are revoked first.
                if account is not None:
                    LoginSession.objects.filter(account_id=account.pk).delete()
                    Invitation.objects.filter(account_id=account.pk).delete()
                    PasswordReset.objects.filter(account_id=account.pk).delete()
                    account.delete()
                user.delete()
        except DatabaseError as exc:
            return _error(f"Could not delete user account: {exc}", 502)
        return JsonResponse({"deleted": True, "id": pk})
    if request.method == "GET":
        # Safety net: a learner whose onboarding reviews are all signed belongs in
        # Delivery. The sign endpoint normally moves them the moment the last
        # signature lands, but reviews signed before that hook existed were never
        # re-evaluated — so opening the learner re-checks and heals them.
        from .learning_plan import promote_learner_if_ready

        learner_kind = str(getattr(user, "learner_type", "") or "").strip() or "apprenticeship"
        if promote_learner_if_ready(learner_kind, user.pk):
            user.refresh_from_db()
        advance_learner(user)
        return JsonResponse(to_board(user))
    if request.method in ("PATCH", "PUT"):
        try:
            payload = _parse_body(request)
            # A learner submitting their own wizard may only touch their own
            # details — not programmeStatus, programme, cohort or employer,
            # which WRITABLE_FIELDS otherwise accepts. Stripped rather than
            # rejected so a wizard step that has always sent a field keeps
            # working; what was dropped is logged, not silently forgotten.
            if getattr(request, "learner_self_write", False):
                payload, rejected = restrict_to_self_writable(payload)
                if rejected:
                    logger.warning(
                        "Learner %s attempted to write fields they do not own: %s",
                        pk, ", ".join(rejected),
                    )
            fields = write_fields(payload)
            _check_employer_id(fields)
        except ValidationError as exc:
            return _error(str(exc), 400)
        try:
            for attr, value in fields.items():
                setattr(user, attr, value)
            if fields:
                user.save(update_fields=list(fields.keys()))
                advance_learner(user)
        except DatabaseError as exc:
            return _error(f"Database error: {exc}", 502)
        return JsonResponse(to_board(user))
    return _error("Method not allowed.", 405)


@csrf_exempt
# Same reason as enrolment_user_detail: the learner presses Finish themselves.
@staff_only(writes_only=True, allow_own_learner="pk")
def enrolment_user_finish(request, pk):
    """Check whether an enrolled learner is ready for automatic activation.

        POST /learner_api/enrolment-users/<id>/finish/  -> EnrolmentBoard

    Enrolment happens entirely in enrolment."Created_users": every learner the
    console creates lives there and nowhere else. This endpoint is the single
    gate out of it. Only when enrolment is finished does the learner get a
    "Learner"."learners" row — created by sync_active_user with the SAME id, so
    the training plan, KSBs, progress, activity and chat rows that key off
    learners.id all line up — and only then does their journey (learner page,
    coach caseload, calendar) become reachable.

    Deliberately explicit rather than automatic on create: an in-progress
    enrolment must not appear as a live learner.
    """
    if request.method != "POST":
        return _error("Method not allowed.", 405)

    try:
        user = EnrolmentUser.all_learners.filter(pk=pk).first()
    except DatabaseError as exc:
        return _error(f"Database error: {exc}", 502)
    if user is None:
        return _error("User not found.", 404)

    if not str(user.email or "").strip():
        return _error("This learner needs an email address before enrolment can be finished.", 400)

    try:
        # Programme activation is evidence/date driven. This legacy endpoint is
        # kept for the UI, but cannot bypass unsigned documents or a future
        # start date.
        advance_learner(user)
        if str(user.programme_status or "").strip() != ACTIVE_STATUS:
            if str(getattr(user, "learner_type", "") or "").strip().casefold() == "commercial":
                return _error(
                    "This commercial learner becomes Active once a learning plan is assigned and the programme start date has arrived.",
                    409,
                )
            return _error(
                "This learner becomes Active automatically once every compliance document is signed and the programme start date has arrived.",
                409,
            )
        learner = sync_active_user(user)
    except DatabaseError as exc:
        return _error(f"Database error: {exc}", 502)

    if learner is None:
        return _error("Could not create the learner record. Please try again.", 502)

    return JsonResponse(to_board(user))



@csrf_exempt
@staff_only(writes_only=True)
def commercial_users(request):
    if request.method == "GET":
        try:
            rows = [
                _profile_commercial_row(profile)
                for profile in _learner_profiles_with_plan().order_by("id")
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
@staff_only(writes_only=True)
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

        # As on the learner form: creating a colleague invites them, and the
        # column records that rather than a choice — see enrolment_users.
        fields["invite_to_platform"] = True

        try:
            user = StaffUser.objects.create(**fields)
        except DatabaseError as exc:
            return _error(f"Database error: {exc}", 502)

        row = to_staff_row(user)
        # Unconditional. The authorisation in login.services still applies, so a
        # staff member creating an Admin gets a refused invitation reported on
        # the row — the record saves, the credential does not.
        row["invitation"] = _send_platform_invitation(request, "staff", user.id, subject=user)
        return JsonResponse(row, status=201)

    return _error("Method not allowed.", 405)


@csrf_exempt
@staff_only(writes_only=True)
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

        # Granting access is an admin-only act, even though editing a staff
        # record is not. `staff_only` lets any staff account write any staff
        # row, so without this a curriculum- or coach-access user could PATCH
        # their own record to access='super-admin' and take the whole platform —
        # the escalation this mechanism exists to prevent.
        if "access" in fields:
            actor = getattr(request, "login_account", None)
            if actor is None or actor.role != "admin":
                return _error(
                    "Only an administrator can change an account's access.", 403
                )
            if actor.subject_type == "staff" and actor.subject_id == user.pk:
                # Self-*demotion* is refused: it would strip the caller's own
                # admin role mid-request and, with one administrator, could leave
                # nobody able to grant access to anyone ever again.
                #
                # Self-promotion to super-admin is allowed, and has to be: the
                # bootstrap administrator holds their role via Position with no
                # Access recorded, so refusing every self-change would leave them
                # permanently unable to record the access they already exercise.
                # It grants nothing new either way — they are already an admin.
                if fields["access"] != ACCESS_SUPER_ADMIN:
                    return _error(
                        "You cannot reduce your own access. Ask another administrator.",
                        400,
                    )

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
@staff_only(writes_only=True)
def commercial_user_detail(request, pk):
    try:
        profile = _learner_profiles_with_plan().filter(pk=pk).first()
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
