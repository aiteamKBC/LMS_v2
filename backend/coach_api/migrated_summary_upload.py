"""Coach-authorized transcript upload, independent of Teams booking."""
from copy import deepcopy
import logging

from django.db import transaction
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_POST

from .auth import coach_access_required
from .migrated_completion_views import _coach_review
from .migrated_reviews import meeting_summary_field
from .migrated_summary_binding import answer_version
from .migrated_summary_generation import apply_suggestion, parse_upload, summary_binding_response
from .migrated_template_sync import active_answers, snapshot_fingerprint

logger = logging.getLogger(__name__)
EDITABLE = {"scheduled", "in-progress"}


def _binding_error(overlay):
    try:
        if not meeting_summary_field(overlay.template_snapshot):
            return "This review has no AI Meeting Summary field."
    except ValueError as exc:
        return str(exc)
    return None


@coach_access_required
@require_POST
def migrated_review_summary_upload(request, review_id):
    from .views import _owned_migrated_overlay, MeetingSummaryContext, openai_meeting_summary, meeting_summary_transcript_excerpt

    owner, definition = _coach_review(request, review_id)
    overlay = _owned_migrated_overlay(owner, definition) if definition else None
    if not overlay:
        return JsonResponse({"detail": "Migrated review not found for this coach."}, status=404)
    if overlay.status not in EDITABLE or definition.get("readOnly"):
        return JsonResponse({"detail": "Meeting Summary is read-only at this review stage."}, status=409)
    error = _binding_error(overlay)
    if error:
        return JsonResponse({"detail": error, "code": "INVALID_SUMMARY_BINDING"}, status=409)
    family = definition["template"]["reviewTypeCode"]
    if family not in {"aptem_mcm", "aptem_progress_review"}:
        return JsonResponse({"detail": "Unsupported migrated review family."}, status=409)
    try:
        if len(request.FILES.getlist("transcript")) != 1 or set(request.FILES) != {"transcript"}:
            raise ValueError("Select one .vtt or .txt transcript.")
        transcript, provenance = parse_upload(request.FILES.get("transcript"))
    except ValueError as exc:
        return JsonResponse({"detail": str(exc), "code": "INVALID_TRANSCRIPT_UPLOAD"}, status=400)
    provenance.update(uploadedAt=timezone.now().isoformat(), uploadedBy=owner, eventKey=overlay.event_key,
                      generatedBy=owner, transcriptTruncated=meeting_summary_transcript_excerpt(transcript)[1])
    context = MeetingSummaryContext(event_type="mcr" if family == "aptem_mcm" else "progress-review",
                                    learner_name=definition.get("learnerName", ""),
                                    owner_name=getattr(getattr(request, "login_account", None), "display_name", ""))
    summary, model = None, None
    try:
        summary, model = openai_meeting_summary(context, transcript)
    except Exception as exc:
        logger.warning("Migrated upload summary failed overlay_id=%s error_type=%s", overlay.pk, type(exc).__name__)
    # No upload body is stored, and generation holds no database lock.
    with transaction.atomic():
        locked = _owned_migrated_overlay(owner, definition, lock=True)
        if not locked or locked.pk != overlay.pk or locked.status not in EDITABLE:
            return JsonResponse({"detail": "Review ownership or status changed during generation."}, status=409)
        error = _binding_error(locked)
        if error:
            return JsonResponse({"detail": error, "code": "INVALID_SUMMARY_BINDING"}, status=409)
        if snapshot_fingerprint(locked.template_snapshot) != snapshot_fingerprint(overlay.template_snapshot):
            return JsonResponse({"detail": "The review template changed during generation. Reopen the review before generating its summary again. Your saved answers are unchanged.", "code": "template_sync_changed"}, status=409)
        state = deepcopy(locked.meeting_intelligence or {})
        result = {}
        if summary is not None:
            provenance.update(model=model, generatedAt=timezone.now().isoformat())
            result = apply_suggestion(locked, state, summary, provenance)
        else:
            state["summaryGeneration"] = {**provenance, "status": "failed", "attemptedBy": owner,
                                          "attemptedAt": timezone.now().isoformat(), "bindingResult": "answer-preserved"}
        locked.meeting_intelligence = state
        locked.save(update_fields=["meeting_intelligence", "updated_at"] + (["answers"] if result.get("status") == "populated" else []))
        return JsonResponse({"artifacts": [], "summaryBinding": summary_binding_response(locked),
                             "answerVersion": answer_version(locked), "reviewAnswers": active_answers(locked.template_snapshot, locked.answers),
                             "partial": summary is None}, status=200 if summary is not None else 207)
