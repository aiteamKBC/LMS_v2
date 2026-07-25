"""Generic component-completion API: record that a learner finished a non-quiz,
non-video learning component (podcast, reading, slide deck, reflection, activity,
workplace evidence, …) along with the post-completion reflection (KSBs, feedback,
self-reported time).

    POST /learner_api/components/<component_id>/complete/?learnerId=<id>&kind=<commercial|apprenticeship>
        -> appends a {"kind": "component", "componentType": <type>, ...} record to
           "Learner"."Active_users"."Training_plan_progress"

Mirrors learner_api.videos.submit_video_progress exactly (same unified progress
log, same reflection shape, no grading) — videos keep their own endpoint/`kind`
so existing analytics are undisturbed; everything else flows through here.
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

# Human action label + a fallback display noun per component type, used for the
# activity feed. Any unknown type falls back to a generic "Completed activity".
TYPE_ACTIONS = {
    "podcast": ("Listened to podcast", "Podcast"),
    "reading": ("Completed reading", "Reading"),
    "powerpoint": ("Reviewed slides", "PowerPoint"),
    "reflection": ("Submitted reflection", "Reflection"),
    "activity": ("Completed activity", "Activity"),
    "workplace-evidence": ("Logged workplace evidence", "Workplace evidence"),
    "live_session": ("Completed live session", "Live session"),
    "recording placeholder": ("Watched recording", "Recording"),
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


def _component_meta(component_id):
    """Live (type, title) for a component (curriculum.components).
    Returns (None, None) if not found / on error."""
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
    return (ctype or None), (title or None)


@csrf_exempt
def submit_component_progress(request, component_id):
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
    # Post-completion reflection window (same shape as quiz/video).
    ksbs = payload.get("ksbs") if isinstance(payload.get("ksbs"), list) else []
    feedback = payload.get("feedback") or ""
    reported_time = payload.get("reportedTime") or ""
    client_title = payload.get("componentTitle") or None
    client_type = (payload.get("componentType") or "").strip() or None

    live_type, live_title = _component_meta(component_id)
    component_type = client_type or live_type or "component"
    component_title = client_title or live_title or TYPE_ACTIONS.get(component_type, (None, "Activity"))[1]

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
    # 1-based count of prior completions of THIS component.
    attempt_number = sum(
        1 for r in history if r.get("kind") == "component" and r.get("componentId") == component_id
    ) + 1

    submitted_at = timezone.now().isoformat()
    time_taken = _format_clock(time_taken_seconds)

    record = {
        "kind": "component",
        "componentType": component_type,
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
        action, _noun = TYPE_ACTIONS.get(component_type, ("Completed activity", "Activity"))
        activity = {
            "kind": "component",
            "componentType": component_type,
            "action": action,
            "title": component_title or "Activity",
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

    return JsonResponse({
        "record": record,
        "componentTitle": component_title or "Activity",
        "componentType": component_type,
        "week": week_title,
        "module": module_title,
    })
