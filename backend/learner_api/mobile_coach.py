"""Read-only coach mobile views over live caseload and canonical LMS records.

Route keys are LearnerProfile IDs. Enrolment IDs are resolved independently;
neither a cached client identity nor a matching learner name grants access.
No learner writer, timer, reward grant or plan-repair path is delegated here.
"""
from __future__ import annotations

import functools
import inspect
import json
import re

from django.db.models.functions import Lower, Trim
from django.http import JsonResponse
from django.utils import timezone

from coach_api.auth import authenticated_coach_email, coach_access_required
from . import canonical_learning, mobile
from .models import EnrolmentUser, LearnerProfile

PAGE_SIZE = 100
PROFILE_FIELDS = ("id", "enrolment_id", "full_name", "learner_type", "programme",
                  "cohort", "cohort_id", "lifecycle_status", "coach_email")
QUIZ_RESULT_FIELDS = frozenset({
    "quizId", "componentId", "componentTitle", "moduleId", "moduleTitle", "attempt",
    "grade", "achievedScore", "totalScore", "passed", "startedAt", "submittedAt",
})


def _coach_context(request):
    account = mobile.authenticate_request(request)
    if account is None:
        if mobile.session_unreadable(request):
            raise mobile.MobileError("Sign-in is temporarily unavailable.", 503, "auth_unavailable")
        raise mobile.MobileError("Please sign in.", 401, "unauthenticated")
    if not getattr(account, "is_active", False):
        raise mobile.MobileError("Please sign in.", 401, "unauthenticated")
    if account.subject_type != "staff" or account.role not in {"staff", "admin"}:
        raise mobile.MobileError("Coach access is required.", 403, "coach_only")
    # The maintained decorator below re-reads primary/additional staff grants.
    request.login_account = account
    return account, None, None, None


def endpoint(view):
    @mobile.endpoint("GET", context=_coach_context)
    @coach_access_required
    @functools.wraps(view)
    def wrapped(request, *args, **kwargs):
        return view(request, *args, **kwargs)
    return wrapped


def _query(request, allowed=()):
    if set(request.GET) - set(allowed) or any(len(request.GET.getlist(key)) != 1 for key in request.GET):
        raise mobile.MobileError("The request contains unsupported parameters.")


def _caseload(request):
    return (LearnerProfile.objects.annotate(coach_email_key=Lower(Trim("coach_email")))
            .filter(coach_email_key=authenticated_coach_email(request)))


def _not_found():
    raise mobile.MobileError("Learner not found.", 404, "learner_not_found")


def _kind(source):
    value = str(getattr(source, "learner_type", "") or "").strip().lower()
    return value if value in {"apprenticeship", "commercial"} else None


def _identity(profile, source):
    return {"profileId": str(profile.pk), "learnerId": str(source.pk),
            "learnerKind": _kind(source), "displayName": profile.full_name or source.username or "Learner",
            "programme": profile.programme or "", "cohort": profile.cohort or "",
            "cohortId": profile.cohort_id or None, "status": profile.lifecycle_status}


def _envelope(request, learner=None):
    value = {"source": "lms", "coachAccountId": str(request.mobile_context[0].pk),
             "readOnly": True, "generatedAt": timezone.now().isoformat()}
    if learner is not None:
        value["learner"] = learner
    return value


def _scope(request, profile_id, *, content=False):
    # Re-evaluate ownership on every request, including media/quiz requests.
    profile = _caseload(request).filter(pk=profile_id).only(*PROFILE_FIELDS).first()
    if profile is None or not profile.enrolment_id:
        _not_found()
    try:
        owner = canonical_learning.require_profile(profile.enrolment_id)
    except canonical_learning.ServiceError:
        _not_found()
    if str(owner.get("id")) != str(profile.pk):
        _not_found()
    source = EnrolmentUser.all_learners.filter(pk=profile.enrolment_id).first()
    if source is None or _kind(source) is None:
        _not_found()
    request.mobile_context = request.mobile_context[0], source, _kind(source), profile
    if content:
        # Do not hydrate saved plans, activate a learner or persist OTJ snapshots.
        request._mobile_detail = mobile.build_learner_detail(
            source, source.pk, compact=True, read_only=True, quiz_view=True)
    return profile, source, owner


def _hours(summary, *, records=None):
    value = {"scope": "programme", "plannedBasis": "canonical_monthly_targets",
             "acceptedOtjhHours": summary.get("actual") if summary else None,
             "plannedOtjhHours": summary.get("planned") if summary else None,
             "period": {"startDate": summary.get("start_date") if summary else None,
                        "endDate": summary.get("end_date") if summary else None}}
    if records is not None:
        value["recordedLearningHours"] = round(sum(
            canonical_learning.recorded_seconds(row) for row in records) / 3600, 4)
        value["recordedBasis"] = "canonical_recorded_seconds_including_unaccepted"
    return value


@endpoint
def learners(request):
    _query(request, {"before"})
    query = _caseload(request)
    before = request.GET.get("before")
    if before is not None:
        if not re.fullmatch(r"[1-9][0-9]{0,18}", before):
            raise mobile.MobileError("A valid page cursor is required.")
        query = query.filter(pk__lt=int(before))
    page = list(query.only(*PROFILE_FIELDS).order_by("-id")[:PAGE_SIZE + 1])
    profiles = page[:PAGE_SIZE]
    ids = [profile.enrolment_id for profile in profiles if profile.enrolment_id]
    # Bounded reads: no per-learner detail hydration on the roster.
    sources = {row.pk: row for row in EnrolmentUser.all_learners.filter(pk__in=ids)
               .only("id", "username", "learner_type")}
    summaries = canonical_learning.otjh_summary_bulk(ids)
    result = []
    for profile in profiles:
        source, summary = sources.get(profile.enrolment_id), summaries.get(profile.enrolment_id)
        # The canonical bulk read validates unique profile/account linkage.
        if (source is None or _kind(source) is None or summary is None
                or str(summary.get("profile_id")) != str(profile.pk)):
            continue
        result.append({**_identity(profile, source), "hours": _hours(summary)})
    return JsonResponse({**_envelope(request), "learners": result,
                         "nextBefore": str(profiles[-1].pk) if len(page) > PAGE_SIZE else None})


def _shared_rewards(request, source):
    from django.conf import settings
    if getattr(settings, "KBC_SHARED_REWARDS_READY", False) is not True:
        return None
    if mobile._learning_blocked(mobile._detail(request)) or not any(
            row["moduleId"] == mobile.PILOT_MODULE_ID for row in mobile._assigned_courses(request)):
        return None
    from engagement_api.shared_rewards import summary
    value = summary(learner_id=str(source.pk), module_id=mobile.PILOT_MODULE_ID)
    # Preserve the maintained opted-in leaderboard, without payment/claim data.
    return {key: value[key] for key in ("moduleId", "policy", "study", "leaderboard") if key in value}


@endpoint
def learner(request, profile_id):
    _query(request)
    profile, source, owner = _scope(request, profile_id, content=True)
    records = canonical_learning.entries_for(owner, overview_only=True)
    summary = canonical_learning.otjh_summary_bulk([source.pk]).get(source.pk)
    completed = sum(canonical_learning.counts_as_completed(row) for row in records)
    attempts = [{key: row[key] for key in QUIZ_RESULT_FIELDS if key in row}
                for row in mobile._detail(request).get("quizAttempts", []) if isinstance(row, dict)]
    from engagement_api.services import points_summary
    return JsonResponse({**_envelope(request, _identity(profile, source)),
        "hours": _hours(summary, records=records),
        "performance": {"scope": "programme-records", "basis": "canonical_recorded_activities",
            "completedActivities": completed, "totalActivities": len(records),
            "completionPercent": round(completed * 100 / len(records), 2) if records else None,
            "quizAttempts": attempts},
        "points": points_summary(str(source.pk)), "sharedRewards": _shared_rewards(request, source)})


def _json_read(request, handler, profile, source, **kwargs):
    # Only named GET projections are reused, after installing read-only detail.
    response = inspect.unwrap(handler)(request, **kwargs)
    if response.status_code != 200:
        return response
    return {**json.loads(response.content), **_envelope(request, _identity(profile, source))}


@endpoint
def catalogue(request, profile_id):
    _query(request)
    profile, source, _ = _scope(request, profile_id, content=True)
    data = _json_read(request, mobile.catalogue, profile, source)
    if not isinstance(data, dict):
        return data
    from .mobile_coach_media import rewrite_media_url
    for component in data["components"]:
        component["rewardObservationsSupported"] = False
        for field in ("audioUrl", "videoUrl"):
            if component.get(field):
                component[field] = rewrite_media_url(profile.pk, component["componentId"], component[field])
    return JsonResponse(data)


@endpoint
def progress(request, profile_id):
    _query(request, {"moduleId"})
    profile, source, _ = _scope(request, profile_id, content=True)
    data = _json_read(request, mobile.progress, profile, source)
    if not isinstance(data, dict):
        return data
    data["scope"] = "course-mobile-activities"
    return JsonResponse(data)


@endpoint
def quiz(request, profile_id, component_id):
    _query(request)
    profile, source, _ = _scope(request, profile_id, content=True)
    component = mobile._component(request, component_id)
    if component["mobileMode"] != "quiz":
        raise mobile.MobileError("Quiz not found.", 404, "quiz_unavailable")
    from .quizzes import _fetch_quiz
    value = _fetch_quiz(mobile._quiz_id(component))
    if value is None:
        raise mobile.MobileError("Quiz not found.", 404, "quiz_unavailable")
    # Coach preview may inspect answer keys but never grades or saves an attempt.
    return JsonResponse({**value, **_envelope(request, _identity(profile, source)),
                         "componentId": component_id, "moduleId": component["moduleId"]})


@endpoint
def transcript(request, profile_id, component_id):
    _query(request)
    profile, source, _ = _scope(request, profile_id, content=True)
    data = _json_read(request, mobile.transcript, profile, source, component_id=component_id)
    return JsonResponse(data) if isinstance(data, dict) else data


@endpoint
def media(request, profile_id, component_id):
    _query(request)
    _scope(request, profile_id, content=True)
    component = mobile._component(request, component_id)
    from .mobile_coach_media import stream
    return stream(request, component)
