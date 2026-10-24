"""Coach-authorized transcript upload, independent of Teams booking."""
from copy import deepcopy

from django.db import transaction
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_POST

from .auth import coach_access_required
from .migrated_completion_views import _coach_review
from .migrated_reviews import meeting_summary_field
from .migrated_summary_binding import answer_version
from .migrated_summary_generation import apply_suggestion, parse_upload, summary_binding_response
from .migrated_summary_errors import summary_generation_error
from .migrated_template_sync import active_answers, snapshot_fingerprint
from .migrated_summary_attempts import claim, owns, release, SummaryInProgress

EDITABLE = {"scheduled", "in-progress"}


def _identity(overlay):
    return tuple(getattr(overlay, key) for key in ('pk', 'owner_email', 'event_key', 'learner_id', 'source_review_id'))


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
    from .views import _owned_migrated_overlay, MeetingSummaryContext, meeting_summary_transcript_excerpt

    owner, definition = _coach_review(request, review_id)
    overlay = _owned_migrated_overlay(owner, definition) if definition else None
    if not overlay:
        return JsonResponse({"detail": "Migrated review not found for this coach."}, status=404)
    if (overlay.status not in EDITABLE or definition.get("readOnly") or definition.get('previewOnly')
            or (definition.get('templateSync') or {}).get('status') == 'conflict'):
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
    original_fingerprint = snapshot_fingerprint(overlay.template_snapshot)
    with transaction.atomic():
        locked = _owned_migrated_overlay(owner, definition, lock=True)
        if not locked or _identity(locked) != _identity(overlay) or locked.status not in EDITABLE:
            return JsonResponse({"detail": "Review ownership or status changed during generation."}, status=409)
        if snapshot_fingerprint(locked.template_snapshot) != original_fingerprint:
            return JsonResponse({"detail": "The review template changed. Reopen it before generating a summary.", "code": "template_sync_changed"}, status=409)
        try:
            token = claim(locked)
        except SummaryInProgress as exc:
            return JsonResponse({"detail": str(exc), "code": "SUMMARY_IN_PROGRESS"}, status=409)
    try:
        return _generate_upload(request, review_id, overlay, owner, context, transcript, provenance, original_fingerprint, token)
    finally:
        release(overlay.pk, owner, token)


def _generate_upload(request, review_id, overlay, owner, context, transcript, provenance, original_fingerprint, token):
    from .views import _owned_migrated_overlay, openai_meeting_summary

    summary, model = None, None
    generation_error = None
    try:
        summary, model = openai_meeting_summary(context, transcript)
    except Exception as exc:
        generation_error = summary_generation_error(request, exc)
    # No upload body is stored, and generation holds no database lock.
    current_owner, definition = _coach_review(request, review_id)
    if (current_owner != owner or not definition or definition.get('readOnly') or definition.get('previewOnly')
            or (definition.get('templateSync') or {}).get('status') == 'conflict'):
        return JsonResponse({'detail': 'Review ownership or availability changed during generation.'}, status=409)
    with transaction.atomic():
        locked = _owned_migrated_overlay(owner, definition, lock=True)
        if not locked or _identity(locked) != _identity(overlay) or locked.status not in EDITABLE:
            return JsonResponse({"detail": "Review ownership or status changed during generation."}, status=409)
        error = _binding_error(locked)
        if error:
            return JsonResponse({"detail": error, "code": "INVALID_SUMMARY_BINDING"}, status=409)
        if snapshot_fingerprint(locked.template_snapshot) != original_fingerprint:
            return JsonResponse({"detail": "The review template changed during generation. Reopen the review before generating its summary again. Your saved answers are unchanged.", "code": "template_sync_changed"}, status=409)
        if not owns(locked, token):
            return JsonResponse({'detail': 'A newer summary request replaced this attempt. Refresh the review.', 'code': 'SUMMARY_SUPERSEDED'}, status=409)
        state = deepcopy(locked.meeting_intelligence or {})
        state.pop('_summaryAttempt', None)
        result = {}
        if summary is not None:
            provenance.update(model=model, generatedAt=timezone.now().isoformat())
            result = apply_suggestion(locked, state, summary, provenance)
        else:
            state["summaryGeneration"] = {**provenance, "status": "failed", "attemptedBy": owner,
                                          "attemptedAt": timezone.now().isoformat(), "bindingResult": "answer-preserved",
                                          "error": generation_error}
        locked.meeting_intelligence = state
        locked.save(update_fields=["meeting_intelligence", "updated_at"] + (["answers"] if result.get("status") == "populated" else []))
        return JsonResponse({"artifacts": [], "summaryBinding": summary_binding_response(locked),
                             "answerVersion": answer_version(locked), "reviewAnswers": active_answers(locked.template_snapshot, locked.answers),
                             "partial": summary is None}, status=200 if summary is not None else 207)
