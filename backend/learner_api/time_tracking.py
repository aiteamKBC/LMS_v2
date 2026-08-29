"""Server-issued timing sessions for learner activities.

The browser measures active time because it can observe playback/visibility.
A signed server session prevents it from claiming time before the activity was
opened: persisted time is the smaller of the browser's active counter and the
signed server-session duration.
"""
import json
import math
import uuid

from django.core import signing
from django.http import JsonResponse
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from django.views.decorators.csrf import csrf_exempt

from login.permissions import learner_self_only


TRACKING_SALT = "learner-api.activity-time.v1"
TRACKING_MAX_AGE_SECONDS = 24 * 60 * 60
ACTIVITY_KINDS = {"quiz", "video", "component"}
COUNTING_MODES = {"active_quiz", "active_playback", "visible_page"}
ALLOWED_MODES_BY_KIND = {
    "quiz": {"active_quiz"},
    "video": {"active_playback", "visible_page"},
    "component": {"visible_page"},
}


class TrackingSessionError(ValueError):
    """The timing token is absent, invalid, expired, or mismatched."""


def _error(message, status):
    return JsonResponse({"error": message}, status=status)


def _normalise_claimed_seconds(value):
    try:
        seconds = float(value)
    except (TypeError, ValueError):
        raise TrackingSessionError("timeTakenSeconds must be a non-negative number.") from None
    if not math.isfinite(seconds) or seconds < 0:
        raise TrackingSessionError("timeTakenSeconds must be a non-negative number.")
    return int(seconds)


def issue_tracking_session(*, activity_kind, activity_id, learner_kind, learner_id, counting_mode):
    if activity_kind not in ACTIVITY_KINDS:
        raise TrackingSessionError("Unknown activity kind.")
    if not str(activity_id).strip():
        raise TrackingSessionError("activityId is required.")
    if counting_mode not in ALLOWED_MODES_BY_KIND[activity_kind]:
        raise TrackingSessionError("The time-counting mode is not valid for this activity kind.")

    started_at = timezone.now()
    claims = {
        "sessionId": str(uuid.uuid4()),
        "activityKind": activity_kind,
        "activityId": str(activity_id),
        "learnerKind": learner_kind,
        "learnerId": str(learner_id),
        "countingMode": counting_mode,
        "startedAt": started_at.isoformat(),
    }
    return {
        "trackingToken": signing.dumps(claims, salt=TRACKING_SALT, compress=True),
        "startedAt": claims["startedAt"],
        "sessionId": claims["sessionId"],
        "countingMode": counting_mode,
    }


def tracking_session_already_used(session_id):
    """The partial unique index is the race-safe guard; this gives a clear 409."""
    from .models import LearnerProgressEntry

    return LearnerProgressEntry.objects.using("enrolment").filter(
        time_tracking_session_ref=str(session_id or "")
    ).exists()


def verify_tracking_session(
    token,
    *,
    activity_kind,
    activity_id,
    learner_kind,
    learner_id,
    claimed_seconds,
    submitted_at=None,
):
    if not token:
        raise TrackingSessionError("A server-issued trackingToken is required. Reopen the activity and try again.")
    try:
        claims = signing.loads(token, salt=TRACKING_SALT, max_age=TRACKING_MAX_AGE_SECONDS)
    except signing.SignatureExpired:
        raise TrackingSessionError("The activity timing session has expired. Reopen the activity and try again.") from None
    except signing.BadSignature:
        raise TrackingSessionError("The activity timing session is invalid. Reopen the activity and try again.") from None

    expected = {
        "activityKind": activity_kind,
        "activityId": str(activity_id),
        "learnerKind": learner_kind,
        "learnerId": str(learner_id),
    }
    if any(str(claims.get(key, "")) != str(value) for key, value in expected.items()):
        raise TrackingSessionError("The activity timing session does not match this learner or activity.")

    counting_mode = str(claims.get("countingMode") or "")
    if counting_mode not in COUNTING_MODES:
        raise TrackingSessionError("The activity timing session has an invalid counting mode.")
    started_at = parse_datetime(str(claims.get("startedAt") or ""))
    if started_at is None:
        raise TrackingSessionError("The activity timing session has an invalid start time.")

    submitted_at = submitted_at or timezone.now()
    server_session_seconds = max(0, int((submitted_at - started_at).total_seconds()))
    claimed = _normalise_claimed_seconds(claimed_seconds)
    verified = min(claimed, server_session_seconds)
    return {
        "sessionId": str(claims.get("sessionId") or ""),
        "startedAt": started_at,
        "submittedAt": submitted_at,
        "claimedSeconds": claimed,
        "serverSessionSeconds": server_session_seconds,
        "verifiedSeconds": verified,
        "countingMode": counting_mode,
        "source": f"signed_session_capped_{counting_mode}",
        "calculation": "min(client_active_seconds, signed_server_session_seconds)",
    }


@csrf_exempt
@learner_self_only(query_param="learnerId")
def start_time_tracking(request):
    if request.method != "POST":
        return _error("Method not allowed.", 405)

    learner_kind = (request.GET.get("kind") or "").strip()
    learner_id = (request.GET.get("learnerId") or "").strip()
    if learner_kind not in {"commercial", "apprenticeship"} or not learner_id:
        return _error("kind and learnerId query params are required.", 400)
    try:
        payload = json.loads(request.body.decode("utf-8")) if request.body else {}
    except (ValueError, UnicodeDecodeError) as exc:
        return _error(f"Invalid JSON body: {exc}", 400)

    try:
        session = issue_tracking_session(
            activity_kind=str(payload.get("activityKind") or "").strip(),
            activity_id=str(payload.get("activityId") or "").strip(),
            learner_kind=learner_kind,
            learner_id=learner_id,
            counting_mode=str(payload.get("countingMode") or "").strip(),
        )
    except TrackingSessionError as exc:
        return _error(str(exc), 400)
    return JsonResponse(session)
