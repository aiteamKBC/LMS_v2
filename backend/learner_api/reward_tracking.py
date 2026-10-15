"""Own-learner measured-time adapter shared by browser and mobile rewards."""
from django.conf import settings
from django.db import connections
from django.http import JsonResponse
from . import mobile
from .time_tracking import verify_tracking_session, TrackingSessionError
from engagement_api.segment_rules import RewardError
from engagement_api.shared_rewards import policy, record_observations
from engagement_api.learning_policy import activity_type

def resolve(request, kind, activity_id):
    mobile._require_active_profile(request)
    detail = mobile._detail(request)
    if mobile._learning_blocked(detail):
        raise mobile.MobileError("Learning access is not open.",403,"learning_access_blocked")
    candidates = []
    for item in detail.get("components", []):
        match = (str((item.get("quizMeta") or {}).get("quizId")) == str(activity_id)
                 if kind == "quiz" else item.get("componentId") == activity_id)
        if match and item.get("moduleId") and activity_type(item, kind):
            candidates.append(item)
    if len(candidates) != 1:
        raise mobile.MobileError("This activity cannot be matched to your assigned course.",404,"activity_not_assigned")
    item = candidates[0]
    return {**item, "componentId": item.get("componentId") or "quiz-"+str(activity_id),
            "weekId": item.get("weekId") or "unscheduled"}

def capability(request, kind, activity_id):
    if getattr(settings,"KBC_SHARED_REWARDS_READY",False) is not True:
        return False
    # Administrator previews and other identities cannot award learner study time.
    from login.sessions import authenticate_request
    account = authenticate_request(request)
    if account is None or account.role != "learner":
        return False
    request.mobile_context = mobile._context(request)
    component = resolve(request, kind, activity_id)
    with connections["default"].cursor() as cursor:
        cfg = policy(cursor, component["moduleId"], require=False)
    return bool(cfg and cfg["enabled"] and cfg["starts_at"])

@mobile.endpoint("POST")
def observations(request):
    body = mobile._only(mobile._body(request),
        {"trackingToken","activityKind","activityId","eventId","sequence","intervals"})
    _, source, learner_kind, profile = request.mobile_context
    kind, activity_id = body.get("activityKind"), body.get("activityId")
    if kind not in {"component","video","quiz"} or not isinstance(activity_id,str):
        raise mobile.MobileError("Invalid activity.",400,"invalid_activity")
    component = resolve(request,kind,activity_id)
    try:
        tracking = verify_tracking_session(body.get("trackingToken"),activity_kind=kind,
            activity_id=activity_id,learner_kind=learner_kind,learner_id=source.pk,claimed_seconds=0)
        mode = tracking["countingMode"]
        if mode != ("active_quiz" if kind=="quiz" else mode) or (
                mode=="active_playback" and not (component.get("audioUrl") or component.get("videoUrl"))):
            raise RewardError("invalid_tracking_mode",400)
        result = record_observations(learner_id=str(source.pk),profile_id=profile.pk,
            component=component,tracking={**tracking,"learnerKind":learner_kind,
                "activityKind":kind,"activityId":activity_id},token=body.get("trackingToken"),
            event_id=body.get("eventId"),sequence=body.get("sequence"),observed_intervals=body.get("intervals"))
        return JsonResponse(result)
    except TrackingSessionError:
        raise mobile.MobileError("The timing session does not match this activity.",400,"invalid_tracking_session") from None
    except RewardError as exc:
        raise mobile.MobileError("Study time could not be confirmed. "+exc.code.replace("_"," ")+".",exc.status,exc.code) from None
