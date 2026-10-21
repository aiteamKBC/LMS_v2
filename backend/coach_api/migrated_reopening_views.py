"""Authorized correction and archived PDF reads for LMS Aptem continuations."""
from copy import deepcopy

from django.db import transaction
from django.http import JsonResponse
from django.views.decorators.http import require_GET, require_POST

from login.permissions import authenticate_request
from .auth import coach_access_required
from .migrated_completion_views import _coach_review, _locked_overlay, _payload, _pdf_context, _party_overlay, _response
from .migrated_reopening import archive, clear_active_signatures, validate_reason
from .migrated_review_pdf import stored_pdf_response
from .migrated_summary_binding import AnswerConflict, check_answer_version
from .models import CoachCalendarEvent
from .review_sources import booking_for_overlay


@coach_access_required
@require_POST
def reopen_review(request, review_id):
    owner, definition = _coach_review(request, review_id, pdf_only=True)
    if not definition:
        return JsonResponse({"detail": "Editable Aptem continuation not found."}, status=404)
    account = request.login_account
    if account.role != "staff" or (account.email or "").strip().casefold() != owner:
        return JsonResponse({"detail": "Only the assigned coach can reopen this review."}, status=403)
    payload = _payload(request)
    if payload is None:
        return JsonResponse({"detail": "Invalid JSON object."}, status=400)
    try:
        reason, note = validate_reason(payload)
    except ValueError as exc:
        return JsonResponse({"detail": str(exc)}, status=400)
    try:
        with transaction.atomic():
            overlay = _locked_overlay(owner, definition, lock_calendar=True)
            if not overlay:
                raise ValueError("The migrated review association could not be verified.")
            check_answer_version(overlay, payload)
            if overlay.status not in {"completed", "awaiting-signature"}:
                raise ValueError("Only a completed review or one awaiting signatures can be reopened.")
            revision = archive(
                overlay, account=account, reason=reason, note=note,
                pdf_context=_pdf_context(overlay, definition) if overlay.status == "completed" else {},
            )
            state = deepcopy(overlay.meeting_intelligence or {})
            state["reviewRevision"] = revision.number
            if overlay.completed_at:
                state.setdefault("reopenCompletedAt", overlay.completed_at.isoformat())
            clear_active_signatures(overlay)
            overlay.status = "in-progress"
            overlay.completed_at = None
            overlay.meeting_intelligence = state
            overlay.save(update_fields=["status", "completed_at", "meeting_intelligence", "updated_at"])
            calendar = booking_for_overlay(overlay, lock=True)
            if calendar:
                CoachCalendarEvent.objects.filter(pk=calendar.pk).update(
                    status="in-progress", review_completed_at=None,
                )
    except (AnswerConflict, ValueError) as exc:
        return JsonResponse({"detail": str(exc)}, status=409)
    return _response(owner, review_id)


def archived_pdf(overlay, number, *, role=None):
    revision = overlay.archived_revisions.filter(number=number).first()
    if (not revision or revision.pdf_bytes is None
            or (role and not revision.snapshot.get("signature_requirements", {}).get(role))):
        return JsonResponse({"detail": "Archived signed PDF not found for this account."}, status=404)
    response = stored_pdf_response(overlay, revision)
    response["Content-Disposition"] = f'attachment; filename="review-{overlay.pk}-version-{number}.pdf"'
    return response


@coach_access_required
@require_GET
def coach_revision_pdf(request, review_id, number):
    owner, definition = _coach_review(request, review_id, pdf_only=True)
    with transaction.atomic():
        overlay = _locked_overlay(owner, definition) if definition else None
        if not overlay:
            return JsonResponse({"detail": "Review not found for this coach."}, status=404)
        return archived_pdf(overlay, number)


@require_GET
def party_revision_pdf(request, review_id, number):
    account = authenticate_request(request)
    if account is None:
        return JsonResponse({"detail": "Sign in to view this PDF."}, status=401)
    overlay = _party_overlay(review_id, account)
    if not overlay:
        return JsonResponse({"detail": "Review not found for this account."}, status=404)
    return archived_pdf(overlay, number, role="participant" if account.role == "learner" else "employer")
