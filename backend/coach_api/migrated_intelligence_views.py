"""Opt-in Teams intelligence for an owned Aptem review overlay.

GET reads local state only. POST is the sole Graph/AI entry point; neither it
nor summary editing changes the Aptem source, booking, or review lifecycle.
"""
import hashlib
import json
import logging
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from django.conf import settings
from django.db import transaction
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_GET, require_POST

from coach_api.auth import coach_access_required
from coach_api.migrated_completion_views import _coach_review
from coach_api.models import CoachCalendarEvent, ImportedReviewInstance
from coach_api.migrated_reviews import meeting_summary_field
from coach_api.migrated_summary_binding import answer_version, binding_state, populate_answer, preserve_original
from coach_api.migrated_summary_generation import apply_suggestion, summary_binding_response
from coach_api.migrated_template_sync import active_answers, snapshot_fingerprint


logger = logging.getLogger(__name__)


def _association(request, review_id, *, lock=False):
    from coach_api.views import _owned_migrated_overlay, imported_review_calendar_rows

    owner, definition = _coach_review(request, review_id)
    if not definition:
        return None, None, None
    overlay = _owned_migrated_overlay(owner, definition)
    if not overlay:
        return None, None, None
    rows = imported_review_calendar_rows(owner, overlay.event_key, lock=lock)
    record = rows[0] if len(rows) == 1 else None
    family = definition["template"]["reviewTypeCode"]
    if family not in {"aptem_mcm", "aptem_progress_review"} or not record or (
        record.owner_email.casefold() != owner
        or record.learner_id != overlay.learner_id
        or record.review_instance_id or record.review_template_id
        or record.event_type != ("mcr" if family == "aptem_mcm" else "progress-review")
        or not record.graph_event_id
        or record.sync_state != CoachCalendarEvent.SYNC_SYNCED
    ):
        return overlay, None, definition
    return overlay, record, definition


def _meeting_end(record):
    if not record.scheduled_date or not record.scheduled_time:
        return None
    start = datetime.combine(record.scheduled_date, record.scheduled_time, ZoneInfo(settings.TIME_ZONE))
    return start + timedelta(minutes=record.duration_minutes or 60)


def _summary(state):
    if not isinstance(state.get("summary"), dict):
        return None
    return {
        "summary": state["summary"],
        "status": state.get("summaryStatus", "ready"),
        "generatedAt": state.get("generatedAt"),
        "editedAt": state.get("editedAt"),
        "editedBy": state.get("editedBy", ""),
        "model": state.get("model", ""),
        "error": state.get("summaryError", ""),
    }


def _response(overlay, record, snapshot=None, *, errors=None, status=200):
    from coach_api.views import public_coach_meeting_artifact, stored_coach_meeting_snapshot

    snapshot = snapshot if snapshot is not None else stored_coach_meeting_snapshot(record)
    state = overlay.meeting_intelligence or {}
    binding = summary_binding_response(overlay)
    return JsonResponse({
        "event": {
            "eventKey": record.event_key,
            "source": record.event_type,
            "status": overlay.status,
            "learner": record.learner_name,
            "scheduledDate": record.scheduled_date.isoformat() if record.scheduled_date else None,
            "scheduledTime": record.scheduled_time.isoformat() if record.scheduled_time else None,
        },
        "attendance": snapshot["attendance"],
        "artifacts": [public_coach_meeting_artifact(item) for item in snapshot["artifacts"]],
        "meetingSummary": _summary(state),
        "summaryBinding": binding,
        "progressVersion": answer_version(overlay),
        "answerVersion": answer_version(overlay),
        "reviewAnswers": active_answers(overlay.template_snapshot, overlay.answers),
        "intelligence": {
            "lastCheckedAt": state.get("lastCheckedAt"),
            "attendanceStatus": state.get("attendanceStatus", "not-checked"),
            "recordingStatus": state.get("recordingStatus", "unknown"),
            "transcriptStatus": state.get("transcriptStatus", "not-checked"),
            "summaryStatus": state.get("summaryStatus", "not-generated"),
            "transcriptArtifactId": state.get("transcriptArtifactId"),
            "errorCodes": state.get("errorCodes", []),
        },
        "errors": errors if errors is not None else snapshot.get("errors", []),
        "partial": bool(errors if errors is not None else snapshot.get("partial")),
        "storage": snapshot.get("storage", {"stored": False}),
    }, status=status)


@coach_access_required
@require_GET
def migrated_review_intelligence(request, review_id):
    overlay, record, _definition = _association(request, review_id)
    if not overlay:
        return JsonResponse({"detail": "Migrated review not found for this coach."}, status=404)
    if not record:
        return JsonResponse({"detail": "Migrated Teams meeting association is missing or inconsistent.", "code": "MEETING_NOT_FOUND"}, status=409)
    return _response(overlay, record)


@coach_access_required
@require_POST
def migrated_review_check_session(request, review_id):
    from coach_api.views import (
        fetch_coach_meeting_graph_snapshot, openai_meeting_summary,
        meeting_summary_transcript_excerpt,
        persist_coach_meeting_snapshots, stored_coach_meeting_snapshot,
        stored_coach_meeting_transcript_for_summary,
    )

    overlay, record, _definition = _association(request, review_id)
    if not overlay:
        return JsonResponse({"detail": "Migrated review not found for this coach."}, status=404)
    if binding_state(overlay).get("status") == "invalid-binding":
        return JsonResponse({"detail": binding_state(overlay)["message"], "code": "INVALID_SUMMARY_BINDING"}, status=409)
    if not record:
        return JsonResponse({"detail": "Migrated Teams meeting association is missing or inconsistent.", "code": "MEETING_NOT_FOUND"}, status=409)
    if overlay.status not in {ImportedReviewInstance.STATUS_SCHEDULED, ImportedReviewInstance.STATUS_IN_PROGRESS}:
        return JsonResponse({"detail": "Meeting intelligence is read-only at this review stage."}, status=409)
    meeting_end = _meeting_end(record)
    if not meeting_end or timezone.now() < meeting_end:
        return JsonResponse({"detail": "Check Session is available after the scheduled meeting ends."}, status=409)

    snapshot, error, status_code = fetch_coach_meeting_graph_snapshot(record)
    if error:
        code = "GRAPH_PERMISSION_ERROR" if status_code == 403 or error.get("code") == "coach_online_meeting_unresolved" else "MEETING_NOT_FOUND" if status_code == 409 else "GRAPH_FETCH_FAILED"
        return JsonResponse({**error, "code": code}, status=status_code)

    # A failed transcript-content fetch must never blank a previously stored
    # transcript during the shared upsert. Keep all successful partial results.
    persistable = [item for item in snapshot["artifacts"] if not item.get("transcript_fetch_error")]
    errors = snapshot["errors"]
    attendance_failed = any("attendance" in message for message in errors)
    # Retain the last verified attendance if Graph temporarily returns an
    # empty report list (or a partial failure) after a successful earlier check.
    previous = stored_coach_meeting_snapshot(record) if attendance_failed or not snapshot["attendanceReports"] else None
    retained_attendance = bool(previous and previous["attendanceReports"])
    storage = persist_coach_meeting_snapshots(
        record, artifacts=persistable,
        attendance_reports=previous["attendanceReports"] if retained_attendance else snapshot["attendanceReports"],
        attendance_tracker=previous["attendanceTracker"] if retained_attendance else snapshot["attendanceTracker"],
    )
    if not storage.get("stored"):
        return JsonResponse({"detail": "Teams snapshot storage is unavailable.", "code": "SNAPSHOT_STORAGE_UNAVAILABLE"}, status=503)

    transcript_rows = [item for item in snapshot["artifacts"] if item.get("artifact_type") == "transcript"]
    recording_rows = [item for item in snapshot["artifacts"] if item.get("artifact_type") == "recording"]
    transcript = stored_coach_meeting_transcript_for_summary(record)
    stored_artifacts = stored_coach_meeting_snapshot(record)["artifacts"]
    transcript_fetch_failed = any(item.get("transcript_fetch_error") for item in transcript_rows)
    transcript_list_failed = any("transcripts" in message for message in errors)
    recording_failed = any("recordings" in message for message in errors)
    transcript_gone = not transcript and any(" 410 " in f" {item.get('transcript_fetch_error', '')} " for item in transcript_rows)
    codes = []
    if attendance_failed:
        codes.append("ATTENDANCE_NOT_AVAILABLE")
    if transcript_gone:
        codes.append("TRANSCRIPT_UNAVAILABLE")
    elif transcript_fetch_failed:
        codes.append("TRANSCRIPT_FETCH_FAILED")
    elif transcript_list_failed:
        codes.append("TRANSCRIPT_FETCH_FAILED")
    elif not transcript:
        codes.append("TRANSCRIPT_PENDING")
    if recording_failed:
        codes.append("RECORDING_FETCH_FAILED")

    with transaction.atomic():
        locked = ImportedReviewInstance.objects.select_for_update().get(pk=overlay.pk)
        if locked.status not in {ImportedReviewInstance.STATUS_SCHEDULED, ImportedReviewInstance.STATUS_IN_PROGRESS}:
            return JsonResponse({"detail": "Review status changed during Check Session."}, status=409)
        current, current_record, _ = _association(request, review_id, lock=True)
        if (not current or not current_record or current.pk != locked.pk
                or any(getattr(locked, key, None) != getattr(current, key, None)
                       for key in ("owner_email", "learner_id", "source_review_id", "event_key"))
                or any(getattr(record, key, None) != getattr(current_record, key, None)
                       for key in ("graph_event_id", "event_type", "scheduled_date", "scheduled_time", "duration_minutes"))):
            return JsonResponse({"detail": "Review ownership or meeting association changed during Check Session."}, status=409)
        binding = binding_state(locked)
        if binding.get("status") == "invalid-binding":
            return JsonResponse({"detail": binding["message"], "code": "INVALID_SUMMARY_BINDING"}, status=409)
        if snapshot_fingerprint(locked.template_snapshot) != snapshot_fingerprint(overlay.template_snapshot):
            return JsonResponse({"detail": "The review template changed during Check Session. Reopen the review before checking again. Your saved answers are unchanged.", "code": "template_sync_changed"}, status=409)
        state = dict(locked.meeting_intelligence or {})
        preserve_original(state)
        state.update({
            "lastCheckedAt": timezone.now().isoformat(),
            "attendanceStatus": "available" if snapshot["attendanceReports"] or retained_attendance else "fetch-failed" if attendance_failed else "not-available",
            "recordingStatus": "available" if recording_rows or any(item.get("artifact_type") == "recording" for item in stored_artifacts) else "unknown" if recording_failed else "not-available",
            "transcriptStatus": "available" if transcript else "unavailable" if transcript_gone else "fetch-failed" if transcript_fetch_failed or transcript_list_failed else "pending",
            "errorCodes": codes,
        })
        if transcript and not state.get("summary"):
            transcript_hash = hashlib.sha256(transcript["text"].encode("utf-8")).hexdigest()
            # A retry after an AI error is explicit (another Check Session).
            try:
                summary, model = openai_meeting_summary(record, transcript["text"])
                state.update({
                    "summary": summary,
                    "summaryStatus": "ready",
                    "generatedAt": timezone.now().isoformat(),
                    "generatedFromTranscript": True,
                    "transcriptArtifactId": transcript["artifactId"],
                    "transcriptHash": transcript_hash,
                    "model": model,
                    "summaryError": "",
                    "source": "teams", "eventKey": record.event_key,
                    "graphEventId": record.graph_event_id, "generatedBy": locked.owner_email,
                    "transcriptTruncated": meeting_summary_transcript_excerpt(transcript["text"])[1],
                })
                preserve_original(state)
            except Exception as exc:  # The Graph results remain useful if AI is unavailable.
                logger.warning("Migrated meeting summary failed overlay_id=%s error_type=%s", locked.pk, type(exc).__name__)
                state["summaryStatus"] = "failed"
                state["summaryError"] = "AI summary generation failed. Check Session can retry."
                codes.append("AI_SUMMARY_FAILED")
        # Reuse the existing generation policy; new transcript segments never
        # silently regenerate or replace a review answer.
        if transcript and isinstance(state.get("summary"), dict) and state.get("summaryStatus") == "ready":
            if binding_state(locked, state).get("fieldKey"):
                provenance = {key: state.get(key) for key in (
                    "generatedAt", "generatedBy", "model", "transcriptArtifactId", "transcriptHash",
                )}
                # A reused summary keeps the meeting identity captured when it
                # was generated, even if the current calendar link has changed.
                provenance.update(source="teams", eventKey=state.get("eventKey") or record.event_key, graphEventId=state.get("graphEventId"),
                                  transcriptTruncated=bool(state.get("transcriptTruncated")))
                result = apply_suggestion(locked, state, state["summary"], provenance)
            else:
                result = populate_answer(locked, state, "")
        else:
            result = populate_answer(locked, state, "")
            if result.get("fieldKey"):
                state["summaryGeneration"] = {"status": "failed" if state.get("summaryStatus") == "failed" else "unavailable",
                    "source": "teams", "attemptedAt": timezone.now().isoformat(), "attemptedBy": locked.owner_email,
                    "bindingResult": result.get("status")}
        locked.meeting_intelligence = state
        locked.save(update_fields=["meeting_intelligence", "updated_at"] + (["answers"] if result.get("status") == "populated" else []))
    return _response(locked, record, errors=errors, status=207 if errors else 200)


@coach_access_required
def migrated_review_summary(request, review_id):
    if request.method != "PATCH":
        return JsonResponse({"detail": "Method not allowed."}, status=405)
    from coach_api.views import normalize_meeting_summary_payload

    overlay, record, _definition = _association(request, review_id)
    if not overlay:
        return JsonResponse({"detail": "Migrated review not found for this coach."}, status=404)
    if not record:
        return JsonResponse({"detail": "Migrated Teams meeting association is missing or inconsistent."}, status=409)
    try:
        payload = json.loads(request.body or b"{}")
    except (UnicodeDecodeError, ValueError):
        return JsonResponse({"detail": "Invalid JSON."}, status=400)
    if not isinstance(payload, dict) or not isinstance(payload.get("summary"), dict):
        return JsonResponse({"detail": "summary must be an object."}, status=400)
    summary = normalize_meeting_summary_payload(payload["summary"], record.event_type)
    with transaction.atomic():
        locked = ImportedReviewInstance.objects.select_for_update().get(pk=overlay.pk)
        if locked.status != ImportedReviewInstance.STATUS_IN_PROGRESS:
            return JsonResponse({"detail": "Only in-progress migrated summaries can be edited."}, status=409)
        if snapshot_fingerprint(locked.template_snapshot) != snapshot_fingerprint(overlay.template_snapshot):
            return JsonResponse({"detail": "The review template changed. Reopen the review before editing its summary.", "code": "template_sync_changed"}, status=409)
        try:
            if meeting_summary_field(getattr(locked, "template_snapshot", {}) or {}):
                return JsonResponse({"detail": "Edit the Meeting Summary answer in the review form."}, status=409)
        except ValueError as exc:
            return JsonResponse({"detail": str(exc)}, status=409)
        state = dict(locked.meeting_intelligence or {})
        if not isinstance(state.get("summary"), dict):
            return JsonResponse({"detail": "Generate the meeting summary before editing it."}, status=409)
        preserve_original(state)
        state.update({
            "summary": summary,
            "summaryStatus": "edited",
            "editedAt": timezone.now().isoformat(),
            "editedBy": request.login_account.email,
        })
        locked.meeting_intelligence = state
        locked.save(update_fields=["meeting_intelligence", "updated_at"])
    return JsonResponse({"meetingSummary": _summary(state), "answerVersion": answer_version(locked),
                         "progressVersion": answer_version(locked), "summaryBinding": summary_binding_response(locked),
                         "reviewAnswers": active_answers(locked.template_snapshot, locked.answers)})
