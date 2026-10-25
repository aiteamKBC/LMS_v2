"""Stored resources for an already-authorized APTEM review meeting.

The portal's existing resolver supplies the calendar record and source marker.
Refresh remains a Coach action; these readers never fall back to Graph or AI.
"""
from django.http import HttpResponseRedirect, JsonResponse


def _bound_resources(record, snapshot):
    """Apply a saved call claim only after the party route resolved this Review."""
    from coach_api.bound_actual_session import bound_session
    from coach_api.migrated_session_scope import has_verified_meeting_evidence, scope_snapshot
    from coach_api.models import ImportedReviewInstance

    event = getattr(record, '_imported_review_event', None) or {}
    if has_verified_meeting_evidence(snapshot):
        return {**scope_snapshot(record, snapshot, meeting_scoped=True), '_boundSession': True}
    try:
        source_id = int(event.get('reviewId') or 0)
    except (TypeError, ValueError):
        source_id = 0
    if source_id <= 0:
        return snapshot
    overlays = list(ImportedReviewInstance.objects.filter(source_review_id=source_id)[:2])
    if len(overlays) > 1:
        raise ValueError('Review continuation is ambiguous.')
    bound = bound_session(record, overlay=overlays[0]) if overlays else None
    return {**scope_snapshot(record, snapshot, session=bound.context), '_boundSession': True} if bound else snapshot


def is_imported_meeting(record):
    # Set by _learner_calendar_record after source/association resolution,
    # including legacy booking keys and explicitly reconciled Native calendars.
    return isinstance(getattr(record, "_imported_review_event", None), dict)


def stored_resources(record, *, include_attendance=False):
    from coach_api.recording_archive import archived_recording_url
    from coach_api.views import public_coach_meeting_artifact, stored_coach_meeting_snapshot

    try:
        snapshot = _bound_resources(record, stored_coach_meeting_snapshot(record))
    except ValueError:
        return JsonResponse({'detail': 'Meeting resources are unavailable for this Review.',
                             'code': 'MEETING_RESOURCES_UNAVAILABLE'}, status=409)
    recordings = []
    for artifact in snapshot["artifacts"]:
        if str(artifact.get("artifact_type", "")).strip().lower() != "recording":
            continue
        recording = public_coach_meeting_artifact(artifact)
        # Metadata alone is not a saved video. Check the existing archive
        # reference without a remote request; never put its signed URL in JSON.
        recording["content_available"] = bool(archived_recording_url(
            record.event_key, artifact.get("graph_artifact_id") or artifact.get("id"),
        ))
        recordings.append(recording)
    payload = {
        "artifacts": recordings,
        "meetingSummary": None,  # Formal answers retain their own visibility rules.
        "errors": snapshot["errors"],
        "partial": snapshot["partial"],
        "storage": snapshot.get("storage") or {"stored": False},
        "resourceMode": "stored",
    }
    if include_attendance:
        payload["attendance"] = snapshot["attendance"]
    response = JsonResponse(payload, status=207 if snapshot["partial"] else 200)
    response["Cache-Control"] = "private, no-store"
    return response


def stored_recording(record, artifact_id):
    from coach_api.recording_archive import archived_recording_url
    from coach_api.views import stored_coach_meeting_snapshot

    try:
        snapshot = _bound_resources(record, stored_coach_meeting_snapshot(record))
    except ValueError:
        snapshot = {'artifacts': [], '_boundSession': True}
    if snapshot.get('_boundSession') and not any(row.get('artifact_type') == 'recording'
               and row.get('graph_artifact_id') == artifact_id for row in snapshot['artifacts']):
        return JsonResponse({'detail': 'A saved copy of this recording is not available yet.',
                             'code': 'STORED_RECORDING_UNAVAILABLE'}, status=404)

    # This helper reads the event + recording ID and signs the existing private
    # blob locally. Missing archive/configuration must never trigger Graph.
    url = archived_recording_url(record.event_key, artifact_id)
    response = HttpResponseRedirect(url) if url else JsonResponse({
        "detail": "A saved copy of this recording is not available yet.",
        "code": "STORED_RECORDING_UNAVAILABLE",
    }, status=404)
    response["Cache-Control"] = "private, no-store"
    return response
