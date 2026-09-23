"""Read-only Employer Portal learner summary projection."""

from datetime import date

from django.db import DatabaseError, connections
from django.utils import timezone

from curriculum_api import review_instances, review_types

from .attendance_lectures import build_lectures, lecture_register, lecture_totals
from .coach_assignment import current_coach
from .dashboard_metrics import read_metrics
from .employer_portal_access import resolve_employer_owned_learner, resolve_single_profile_for_source
from .mappers import _s
from .overview_week import read_week
from .training_plan_dashboard import read_dashboard


def _date(value):
    return value.isoformat() if hasattr(value, "isoformat") else (_s(value) or None)


def _number(value):
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _today():
    return timezone.localdate()


def _date_key(value):
    text = _s(value)
    if not text:
        return ""
    return text[:10]


def _normalise(value):
    return _s(value).casefold()


def _compatible_modules(modules, learner):
    fields = (
        ("programme_name", getattr(learner, "programme", "")),
        ("cohort_name", getattr(learner, "cohort", "")),
        ("group_name", getattr(learner, "group", "")),
    )
    compatible = [
        module for module in modules
        if all(not _normalise(expected) or not _normalise(module.get(key)) or _normalise(module.get(key)) == _normalise(expected)
               for key, expected in fields)
    ]
    exact = [
        module for module in compatible
        if all(not _normalise(expected) or _normalise(module.get(key)) == _normalise(expected)
               for key, expected in fields)
    ]
    candidates = [module for module in (exact or compatible) if _s(module.get("title"))]
    return sorted(candidates, key=lambda module: (
        _date_key(module.get("start_date")) or "9999",
        _s(module.get("title")),
        _s(module.get("id")),
    ))


def select_learning_modules(modules, learner, *, today=None):
    today_text = (today or _today()).isoformat() if isinstance(today or _today(), date) else _s(today)
    sorted_modules = _compatible_modules(modules or [], learner)
    active = [
        module for module in sorted_modules
        if _date_key(module.get("start_date")) and _date_key(module.get("end_date"))
        and _date_key(module.get("start_date")) <= today_text <= _date_key(module.get("end_date"))
    ]
    if active:
        return "multiple" if len(active) > 1 else "current", active
    next_module = next((module for module in sorted_modules if _date_key(module.get("start_date")) > today_text), None)
    if next_module:
        return "next", [next_module]
    past = sorted(
        [module for module in sorted_modules if _date_key(module.get("end_date")) and _date_key(module.get("end_date")) < today_text],
        key=lambda module: (_date_key(module.get("end_date")), _s(module.get("id"))),
        reverse=True,
    )
    if past:
        return "last", [past[0]]
    return ("unavailable" if not sorted_modules else "unavailable"), sorted_modules


def _subject_for_module(plan_subjects, module_id):
    module_id = _s(module_id)
    for subject in plan_subjects or []:
        ids = {_s(item) for item in subject.get("moduleIds") or []}
        if module_id in ids or subject.get("id") == f"current:{module_id}":
            return subject
    return None


def _module_percent(completed, total):
    """Completion for one module, from the counts the learning plan reports.

    `summarise_plan` reports `completed`/`total` but no percentage, so the ratio
    is derived here rather than by changing that shared projection, which the
    learner's own workspace also reads.

    A module with no activities yet is `None`, not 0%: nothing has been planned
    to complete, so a zero would read as "done nothing" instead of "nothing set".
    """
    if completed is None or not total:
        return None
    return round(completed / total * 100, 2)


def _current_week(module, *, today=None):
    """Which week of the module today falls in, 1-based.

    Weeks are counted from the module's own start date and clamped to its length,
    so a module running late reports its final week rather than one past the end.
    Returns None when the dates or length are missing — the employer sees
    "Unavailable" rather than a week number derived from a guess.
    """
    start = _date_key(module.get("start_date"))
    total_weeks = module.get("weeks_number")
    if not start or not total_weeks:
        return None
    today_date = today or _today()
    try:
        start_date = date.fromisoformat(start)
        total_weeks = int(total_weeks)
    except (TypeError, ValueError):
        return None
    if total_weeks <= 0 or today_date < start_date:
        return None
    week = (today_date - start_date).days // 7 + 1
    return min(week, total_weeks)


def _current_learning(learning, week, learner):
    modules = learning.get("modules") or []
    state, selected = select_learning_modules(modules, learner)
    subjects = week.get("planSubjects") or []
    out = []
    for module in selected:
        subject = _subject_for_module(subjects, module.get("id"))
        completed = subject.get("completed") if subject else None
        total = subject.get("total") if subject else None
        out.append({
            "moduleId": _s(module.get("id")) or None,
            "moduleName": _s(module.get("title")) or None,
            "progressPercent": _module_percent(completed, total) if subject else None,
            "completedActivities": completed,
            "totalActivities": total,
            "currentWeek": _current_week(module),
            "totalWeeks": module.get("weeks_number"),
            "available": subject is not None,
            "source": "learner_learning_plan",
        })
    return {"selectionState": state, "modules": out}


def _attendance(source, kind):
    try:
        register = lecture_register(source)
        # `lecture_register` deliberately returns source-shaped rows.  The
        # Employer summary needs the presentation-shaped lecture rows because
        # `lecture_totals` and the last-session values both depend on the
        # canonical `status` field built by `build_lectures`.  Passing the raw
        # register here caused a KeyError for real attendance data.
        #
        # Unit callers may already provide normalised rows; retain that small
        # seam without altering the production data path.
        lectures = (
            register
            if all("status" in row for row in register)
            else build_lectures(register, {}, [], [], kind, source.pk)
        )
        totals = lecture_totals(lectures)
    except (DatabaseError, KeyError, TypeError, ValueError):
        return {"available": False, "ratePercent": None, "sessionsHeld": None, "sessionsAttended": None,
                "absences": None, "classification": "unavailable", "lastSessionDate": None,
                "lastAttendanceStatus": None}
    denominator = totals["attended"] + totals["absent"]
    if denominator == 0 or totals["attendanceRate"] is None:
        return {"available": False, "ratePercent": None, "sessionsHeld": None, "sessionsAttended": None,
                "absences": None, "classification": "unavailable", "lastSessionDate": None,
                "lastAttendanceStatus": None}
    counted = [row for row in lectures if row.get("status") in {"completed", "late", "absent"}]
    latest = sorted(counted, key=lambda row: (row.get("date") or "", row.get("startTime") or ""), reverse=True)[0] if counted else None
    rate = totals["attendanceRate"]
    return {
        "available": True,
        "ratePercent": rate,
        "sessionsHeld": denominator,
        "sessionsAttended": totals["attended"],
        "absences": totals["absent"],
        "classification": "green" if rate >= 90 else "amber" if rate >= 80 else "red",
        "lastSessionDate": latest.get("date") if latest else None,
        "lastAttendanceStatus": latest.get("status") if latest else None,
    }


def _planned_to_date(planned_total, start, end, *, today=None):
    """How much off-the-job time the programme expects by today.

    Pro-rated across the programme's own start and end dates: the schedule is not
    recorded week by week, so elapsed calendar time is the available proxy. It is
    an even spread, not a reading of the training plan — a learner whose hours are
    deliberately front- or back-loaded will sit either side of it for good reason.

    Returns None unless the programme total and both dates are present, so the
    employer sees "Unavailable" rather than a figure pro-rated from a guess.
    """
    if planned_total is None or not start or not end:
        return None
    try:
        start_date = date.fromisoformat(_date_key(start))
        end_date = date.fromisoformat(_date_key(end))
        planned_total = float(planned_total)
    except (TypeError, ValueError):
        return None
    span = (end_date - start_date).days
    if span <= 0:
        return None
    elapsed = ((today or _today()) - start_date).days
    # Before the start nothing is due yet; after the end the whole programme is.
    fraction = min(max(elapsed / span, 0.0), 1.0)
    return round(planned_total * fraction, 2)


def _otj(metrics, week, programme=None):
    metric_otj = metrics.get("otjh") or {}
    home_otj = (week.get("homeProgress") or {}).get("otjh") or {}
    planned_total = metric_otj.get("planned")
    actual = metric_otj.get("actual")
    programme = programme or {}
    planned_to_date = _planned_to_date(
        planned_total, programme.get("startDate"), programme.get("plannedEndDate"),
    )
    # Variance is only meaningful when both sides are real numbers; a missing
    # actual must not read as a full shortfall against the plan.
    variance = round(_number(actual) - planned_to_date, 2) if planned_to_date is not None and _number(actual) is not None else None
    return {
        "actualHours": actual,
        "submittedPendingHours": home_otj.get("submitted"),
        "plannedTotalHours": planned_total,
        "plannedToDateHours": planned_to_date,
        "varianceToDateHours": variance,
        "plannedToDateAvailable": planned_to_date is not None,
        # Negative variance only; being ahead of plan is not a concern to flag.
        "behindPlan": variance < 0 if variance is not None else None,
    }


def _category_progress(codes, prefix):
    bucket = [row for row in codes or [] if _s(row.get("code")).startswith(prefix)]
    if not bucket:
        return None
    completed = sum((row.get("completed") or 0) for row in bucket)
    total = sum((row.get("total") or 0) for row in bucket)
    return {"achieved": completed, "total": total, "percentage": round(completed / total * 100, 2) if total else None}


def _ksb(metrics):
    ksb = metrics.get("ksb") or {}
    if ksb.get("status") != "ready":
        return {"available": False, "metric": "activity_ksb_points", "achieved": None, "total": None,
                "percentage": None, "knowledge": None, "skills": None, "behaviours": None,
                "reason": ksb.get("reason") or ksb.get("status")}
    codes = ksb.get("codes") or []
    return {
        "available": True,
        "metric": "activity_ksb_points",
        "unit": "activity-KSB points",
        "achieved": ksb.get("completed"),
        "total": ksb.get("total"),
        "percentage": ksb.get("percent"),
        "knowledge": _category_progress(codes, "K"),
        "skills": _category_progress(codes, "S"),
        "behaviours": _category_progress(codes, "B"),
    }


def _last_submission_at(kind, learner_id):
    try:
        with connections["enrolment"].cursor() as cursor:
            cursor.execute(
                '''SELECT max(submitted_at) FROM "Learner".learning_reflection_submissions
                   WHERE learner_kind=%s AND learner_id=%s''',
                [kind, str(learner_id)],
            )
            row = cursor.fetchone()
    except DatabaseError:
        return None
    value = row[0] if row else None
    return value.isoformat() if value else None


def _activity(source, kind, week):
    progress = []
    try:
        from .student_activity import _direct_progress_records
        progress = _direct_progress_records(source.pk)
    except DatabaseError:
        progress = []
    last_lms = max([_s(row.get("submittedAt")) for row in progress if _s(row.get("submittedAt"))] or [""], default="")
    last_live = None
    attendance = week.get("homeProgress", {}).get("lectures")
    return {"lastLmsActivityAt": last_lms or None, "lastSubmissionAt": _last_submission_at(kind, source.pk),
            "lastLiveSessionAt": last_live}


def _reviews(profile):
    try:
        instances = review_instances.list_review_instances_for_learner(str(profile.pk))
    except DatabaseError:
        return {"lastReviewDate": None, "nextReviewDate": None, "pendingEmployerSignatureCount": None,
                "available": False}
    progress = []
    pending = 0
    for instance in instances:
        try:
            definition = review_instances.review_instance_form_definition(instance)
        except DatabaseError:
            continue
        if definition.get("template", {}).get("reviewTypeCode") != review_types.REVIEW_TYPE_CODE_PROGRESS_REVIEW:
            continue
        signature = definition.get("signatures", {}).get("employer", {})
        visible = definition.get("template", {}).get("visibleTo", {}).get("employer", False)
        if visible and signature.get("required") and not signature.get("signed"):
            pending += 1
        progress.append(instance)
    today = _today().isoformat()
    dated = [(str(row.get("target_date") or ""), row) for row in progress if row.get("target_date")]
    past = [item for item in dated if item[0] <= today]
    future = [item for item in dated if item[0] > today]
    last = max(past, default=(None, None))[0]
    next_date = min(future, default=(None, None))[0]
    return {"lastReviewDate": last, "nextReviewDate": next_date,
            "pendingEmployerSignatureCount": pending, "available": True}


def build_employer_learner_summary(employer, kind, learner_id):
    access = resolve_employer_owned_learner(employer, kind, learner_id)
    if not access.ok:
        return None, access.error, access.status
    profile, profile_error = resolve_single_profile_for_source(access.learner, kind)
    if profile_error:
        return None, profile_error, 404
    learner = access.learner
    learning = read_dashboard(learner, section="learning")
    week = read_week(learner, home_kind=kind, dashboard_kind=kind)
    metrics = week.get("metrics") or read_metrics(learner, kind)
    coach = current_coach(learner, profile, None)
    payload_programme = {
        "name": _s(getattr(learner, "programme", "")) or _s(getattr(profile, "programme", "")),
        "status": _s(getattr(learner, "programme_status", "")) or _s(getattr(profile, "programme_status", "")),
        "cohort": _s(getattr(learner, "cohort", "")) or _s(getattr(profile, "cohort", "")),
        "group": _s(getattr(learner, "group", "")) or _s(getattr(profile, "group_name", "")),
        "startDate": _date(getattr(learner, "start_date", None) or getattr(profile, "start_date", None)),
        "plannedEndDate": _date(getattr(learner, "end_date", None) or getattr(profile, "end_date", None)),
    }
    payload = {
        "learner": {
            "id": str(learner.pk),
            "kind": kind,
            "name": _s(getattr(learner, "username", "")),
            "email": _s(getattr(learner, "email", "")),
        },
        "programme": payload_programme,
        "coach": {"id": None, "name": coach.get("coach_name") or None, "email": coach.get("coach_email") or None},
        "trainingPlan": {"available": bool(learning.get("modules")), "plannedOtjTotalHours": (metrics.get("otjh") or {}).get("planned")},
        "currentLearning": _current_learning(learning, week, learner),
        "attendance": _attendance(learner, kind),
        "otj": _otj(metrics, week, payload_programme),
        "ksb": _ksb(metrics),
        "activity": _activity(learner, kind, week),
        "reviews": _reviews(profile),
        "sources": {
            "ownership": "Created_users.Employer_id",
            "learning": "overview_week.read_week + training_plan_dashboard.read_dashboard(section=learning)",
            "attendance": "attendance_lectures.lecture_register",
            "otj": "dashboard_metrics.read_metrics",
            "ksb": "dashboard_metrics.ksb_totals",
            "reviews": "curriculum_api.review_instances",
        },
    }
    return payload, "", 200
