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
import logging

from django.db import DatabaseError, connections
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from .active_users import ComponentReferenceError, save_progress_record, sync_active_user
from .identity import learner_profile_for_source
from .models import CommercialUser, EnrolmentUser

logger = logging.getLogger(__name__)

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


# Only assignments collect uploaded evidence, so only they can require it.
EVIDENCE_COMPONENT_TYPES = {"assignment"}


def normalise_component_type(value):
    """Component types are stored with underscores ('live_session') but reach us
    hyphenated from some clients — normalise before comparing."""
    return str(value or "").strip().lower().replace("-", "_")


def component_requires_evidence(component_type):
    return normalise_component_type(component_type) in EVIDENCE_COMPONENT_TYPES


def _component_ksb_mappings(component_id):
    try:
        with connections["enrolment"].cursor() as cur:
            cur.execute(
                "SELECT ksb_mappings FROM curriculum.components WHERE id = %s LIMIT 1",
                [component_id],
            )
            row = cur.fetchone()
            canonical = row[0] if row else []
            if isinstance(canonical, str):
                try:
                    canonical = json.loads(canonical) if canonical else []
                except (TypeError, ValueError):
                    canonical = []
            mappings = []
            if isinstance(canonical, list):
                for item in canonical:
                    if not isinstance(item, dict):
                        continue
                    code = str(item.get("code") or item.get("ksbCode") or item.get("ksb_code") or "").strip()
                    if code:
                        mappings.append({
                            "code": code,
                            "weight": item.get("weight") or 0,
                        })
            if mappings:
                return mappings

            cur.execute(
                "SELECT ksb_code, weight FROM curriculum.ksb_mappings "
                "WHERE component_id = %s AND ksb_code IS NOT NULL AND ksb_code <> '' "
                "AND deleted_at IS NULL AND COALESCE(is_programme_deleted, false) = false "
                "ORDER BY ksb_code",
                [component_id],
            )
            return [{"code": row[0], "weight": row[1] or 0} for row in cur.fetchall()]
    except DatabaseError as exc:
        logger.warning("Could not resolve KSB mappings for component %s: %s", component_id, exc)
        return []


def component_ksb_codes(component_id):
    """The KSB codes authored against a component, in a stable order.

    These are applied automatically on completion — the learner is not asked to
    pick KSBs, because the mapping (and its weighting) is already authored on
    the component itself. Resolved server-side so the credited KSBs always match
    the curriculum rather than whatever a client happens to post.
    """
    seen = set()
    codes = []
    for mapping in _component_ksb_mappings(component_id):
        code = str(mapping.get("code") or "").strip()
        if code and code not in seen:
            seen.add(code)
            codes.append(code)
    return codes


def _completion_criteria(component_id, kind, learner_id, component_type=None):
    """Evaluate the completion gate for a component.

    KSB weights measure curriculum contribution and never block completion.
    Only assignments require an approved evidence file.

    Returns (ok, detail), with the outstanding evidence requirement when gated.
    """
    ksb_weight, ksb_count, evidence_count = 0.0, 0, 0
    needs_evidence = component_requires_evidence(component_type)
    if not needs_evidence:
        return True, None
    try:
        with connections["enrolment"].cursor() as cur:
            mappings = _component_ksb_mappings(component_id)
            ksb_weight = sum(float(item.get("weight") or 0) for item in mappings)
            ksb_count = len(mappings)

            if needs_evidence:
                # Only approved uploads count — a quarantined or rejected file
                # is not usable evidence.
                cur.execute(
                    'SELECT COUNT(*) FROM "Learner"."evidence_files" '
                    "WHERE section_ref = %s AND learner_kind = %s AND learner_id = %s "
                    "AND status = 'approved'",
                    [component_id, kind, str(learner_id)],
                )
                row = cur.fetchone()
                evidence_count = int(row[0] or 0) if row else 0
    except DatabaseError as exc:
        # Fail open: a lookup failure must not strand a learner who has done
        # the work. The criteria are re-checked on every submit.
        logger.warning("Could not evaluate completion criteria for %s: %s", component_id, exc)
        return True, None

    # KSB weight is progress metadata, not a learner completion gate.
    weight_ok = True
    evidence_ok = (evidence_count > 0) if needs_evidence else True
    detail = {
        "ksbWeightTotal": ksb_weight,
        "ksbWeightTarget": 100.0,
        "ksbWeightMet": weight_ok,
        "ksbMappingCount": ksb_count,
        "evidenceRequired": needs_evidence,
        "evidenceCount": evidence_count,
        "evidenceMet": evidence_ok,
    }
    return (weight_ok and evidence_ok), detail


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
    # KSBs are auto-mapped from the component's authored mappings rather than
    # chosen by the learner. Any "ksbs" in the payload is ignored: the component
    # already declares which KSBs it develops, and at what weight.
    ksbs = component_ksb_codes(component_id)
    if not ksbs and isinstance(payload.get("ksbs"), list):
        # Fall back to the client's list only for components with no authored
        # mappings, so legacy/unmapped content keeps working as before.
        ksbs = payload["ksbs"]
    feedback = payload.get("feedback") or ""
    reported_time = payload.get("reportedTime") or ""
    client_title = payload.get("componentTitle") or None
    client_type = (payload.get("componentType") or "").strip() or None

    live_type, live_title = _component_meta(component_id)
    component_type = client_type or live_type or "component"
    component_title = client_title or live_title or TYPE_ACTIONS.get(component_type, (None, "Activity"))[1]

    try:
        source = model.objects.get(pk=learner_id)
    except model.DoesNotExist:
        return _error("Learner not found.", 404)
    except (DatabaseError, ValueError) as exc:
        return _error(f"Database error: {exc}", 502)

    # Completion gate. Enforced here (not only in the UI) so the criteria cannot
    # be bypassed by posting straight to the endpoint. Uses the master type
    # (not the client's) so the evidence rule can't be dodged by mislabelling
    # an assignment in the payload.
    criteria_ok, criteria = _completion_criteria(
        component_id, kind, learner_id, live_type or client_type,
    )
    if not criteria_ok:
        missing = []
        if not criteria["evidenceMet"]:
            missing.append("at least one evidence file must be uploaded")
        return JsonResponse(
            {
                "error": "This component cannot be completed yet: " + ", and ".join(missing) + ".",
                "criteria": criteria,
            },
            status=409,
        )

    try:
        active = learner_profile_for_source(source, learner_id, active_only=True)
        if active is None:
            active = sync_active_user(source)
    except DatabaseError as exc:
        return _error(f"Database error: {exc}", 502)
    if active is None:
        return _error(
            "This learner does not have an active learner profile, so progress cannot be saved.",
            409,
        )

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
    except ComponentReferenceError as exc:
        return _error(str(exc), 400)
    except DatabaseError as exc:
        return _error(f"Database error saving progress: {exc}", 502)

    return JsonResponse({
        "record": record,
        "componentTitle": component_title or "Activity",
        "componentType": component_type,
        "week": week_title,
        "module": module_title,
    })
