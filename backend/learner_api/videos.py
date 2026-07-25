"""Video-progress API: record that a learner watched a video component, along
with the post-watch reflection (KSBs, feedback, self-reported time).

    POST /learner_api/videos/<component_id>/complete/?learnerId=<id>&kind=<commercial|apprenticeship>
        -> appends a "kind": "video" record to
           "Learner"."Active_users"."Training_plan_progress"

The record mirrors the quiz-attempt shape (learner_api.quizzes) so the unified
progress log stays consistent; there is no grading — a video is either watched
and reflected on, or not.
"""
import json

from django.db import DatabaseError, connections
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from .active_users import save_progress_record
from .models import CommercialUser, EnrolmentUser, LearnerProfile

SOURCE_MODELS = {
    "commercial": CommercialUser,
    "apprenticeship": EnrolmentUser,
}


def _error(message, status):
    return JsonResponse({"error": message}, status=status)


def _format_clock(seconds):
    """Seconds -> "MM:SS"."""
    try:
        total = int(seconds)
    except (TypeError, ValueError):
        return None
    m, s = divmod(max(total, 0), 60)
    return f"{m:02d}:{s:02d}"


def _video_title(component_id):
    """Live display title for a video component (curriculum.components).
    Returns (title, type) or (None, None) if not found / on error."""
    try:
        with connections["enrolment"].cursor() as cur:
            cur.execute(
                "SELECT type, title FROM curriculum.components WHERE id = %s",
                [component_id],
            )
            row = cur.fetchone()
    except DatabaseError:
        return None, None
    if not row:
        return None, None
    ctype, title = row
    return (title or "Video"), ctype


@csrf_exempt
def submit_video_progress(request, component_id):
    if request.method != "POST":
        return _error("Method not allowed.", 405)

    kind = (request.GET.get("kind") or "").strip()
    learner_id = (request.GET.get("learnerId") or "").strip()
    model = SOURCE_MODELS.get(kind)
    if model is None or not learner_id:
        return _error("kind and learnerId query params are required.", 400)

    try:
        payload = json.loads(request.body.decode("utf-8")) if request.body else {}
    except (ValueError, UnicodeDecodeError) as exc:
        return _error(f"Invalid JSON body: {exc}", 400)

    week_title = payload.get("week")
    module_title = payload.get("module")
    started_at = payload.get("startedAt")
    time_taken_seconds = payload.get("timeTakenSeconds")
    # Post-watch reflection window (same shape as the quiz reflection).
    ksbs = payload.get("ksbs") if isinstance(payload.get("ksbs"), list) else []
    feedback = payload.get("feedback") or ""
    reported_time = payload.get("reportedTime") or ""
    # Client may pass the title it rendered; fall back to a live master lookup.
    video_title = payload.get("videoTitle") or None

    if video_title is None:
        video_title, _ctype = _video_title(component_id)

    try:
        model.objects.get(pk=learner_id)
    except model.DoesNotExist:
        return _error("Learner not found.", 404)
    except (DatabaseError, ValueError) as exc:
        return _error(f"Database error: {exc}", 502)

    try:
        active = LearnerProfile.objects.filter(id=learner_id, lifecycle_status="active").first()
    except DatabaseError as exc:
        return _error(f"Database error: {exc}", 502)

    history = (active.training_plan_progress if active and isinstance(active.training_plan_progress, list) else [])
    # 1-based count of prior completions of THIS video component.
    attempt_number = sum(
        1 for r in history if r.get("kind") == "video" and r.get("componentId") == component_id
    ) + 1

    submitted_at = timezone.now().isoformat()
    time_taken = _format_clock(time_taken_seconds)

    # Slim, id-referenced record. The videoTitle/week/module NAMES are dropped —
    # the plan tree resolves them from componentId.
    record = {
        "kind": "video",
        "componentId": component_id,
        "attempt": attempt_number,
        "ksbs": ksbs,                          # KSB codes the learner selected
        "feedback": feedback,                  # reflection note
        "reportedTime": reported_time,         # self-reported time-to-complete
        "startedAt": started_at,
        "submittedAt": submitted_at,
        "timeTaken": time_taken,
    }

    if active is not None:
        activity = {
            "kind": "video",
            "action": "Watched video",
            "title": video_title or "Video",
            "detail": (f"{reported_time}" if reported_time else "").strip(),
            "componentId": component_id,
            "week": week_title,
            "module": module_title,
            "at": submitted_at,
        }
        try:
            save_progress_record(active, record, activity)
        except DatabaseError as exc:
            return _error(f"Database error saving progress: {exc}", 502)

        # Engagement points: award synchronously the instant the watch is saved.
        # Guarded so a points failure can never break the learner's video save; all
        # point logic (which rule, first-watch gate, etc.) lives in engagement_api.
        try:
            from engagement_api.hooks import record_progress_points
            record_progress_points(learner_id, active.username, record)
        except Exception:  # noqa: BLE001 — engagement points must never break the video save
            pass

    # Echo the display title/week/module in the RESPONSE (not stored) so the
    # results screen can render immediately without resolving componentId.
    return JsonResponse({
        "record": record,
        "videoTitle": video_title or "Video",
        "week": week_title,
        "module": module_title,
    })
