"""Private, read-only transcript PDFs for a coach's saved Review meeting."""
import logging

from django.http import HttpResponse, JsonResponse
from django.views.decorators.http import require_GET

from .auth import authenticated_coach_email, coach_access_required
from .recordings_pdf import review_transcript_pdf, transcript_turns


log = logging.getLogger(__name__)


def _combined_ids(request, record, event_key):
    from .views import coach_meeting_transcript_selection, stored_coach_meeting_snapshot

    if not event_key.startswith('imported-review:'):
        return coach_meeting_transcript_selection(record)['artifactIds']

    from .bound_actual_session import BoundSessionConflict, bound_session
    from .migrated_intelligence_views import _association
    from .migrated_session_scope import (has_verified_meeting_evidence, stored_transcript_selection)

    overlay, linked, _definition = _association(request, event_key)
    if not overlay or not linked or linked.pk != record.pk:
        return []
    try:
        bound = bound_session(linked, overlay=overlay)
    except BoundSessionConflict:
        return []
    snapshot = stored_coach_meeting_snapshot(linked)
    meeting_scoped = has_verified_meeting_evidence(snapshot)
    selection = stored_transcript_selection(
        linked, snapshot,
        session=None if meeting_scoped else bound.context if bound else None,
        meeting_scoped=meeting_scoped,
    )
    return selection['artifactIds']


@coach_access_required
@require_GET
def coach_review_transcript_pdf(request, event_key, artifact_id):
    from .review_rescheduling import historical_content
    from .views import (coach_meeting_artifact_record, coach_timetable_event_artifact_content,
                        stored_coach_meeting_snapshot)

    # The existing content endpoint enforces coach ownership, imported Review
    # association and exact current/previous session selection. Reuse it for
    # every VTT segment rather than trusting IDs supplied by the browser.
    first = coach_timetable_event_artifact_content(request, event_key, 'transcript', artifact_id)
    if first.status_code != 200:
        return first
    record = coach_meeting_artifact_record(authenticated_coach_email(request), event_key)
    if not record or record.event_type not in {'mcr', 'progress-review'}:
        return JsonResponse({'detail': 'Review transcript not found.'}, status=404)

    combined = artifact_id.lower() == 'combined'
    ids = _combined_ids(request, record, event_key) if combined else [artifact_id]
    if not ids:
        return JsonResponse({'detail': 'The saved transcript is unavailable.'}, status=404)
    turns = []
    for selected_id in ids:
        response = (coach_timetable_event_artifact_content(request, event_key, 'transcript', selected_id)
                    if combined else first)
        if response.status_code != 200:
            if combined and response.status_code == 404:
                # Older snapshots can retain the complete, authorised plain
                # transcript after an individual VTT has expired. Recheck the
                # combined selection before rendering that text without cues.
                latest = coach_timetable_event_artifact_content(request, event_key, 'transcript', 'combined')
                if latest.status_code != 200:
                    return latest
                if latest.content != first.content:
                    return JsonResponse({'detail': 'The saved transcript changed. Reload the Review.'}, status=409)
                turns = transcript_turns(latest.content.decode('utf-8-sig', errors='replace'))
                break
            return response
        turns.extend(transcript_turns(response.content.decode('utf-8-sig', errors='replace')))
    if not turns:
        return JsonResponse({'detail': 'The saved transcript is empty.'}, status=404)

    window = None
    if not combined:
        snapshot = stored_coach_meeting_snapshot(record)
        previous = historical_content(record, 'transcript', artifact_id, snapshot)
        if previous:
            from .migrated_session_scope import instant
            start = instant(previous.get('created_datetime'))
            end = instant(previous.get('end_datetime'))
            if start and end and end > start:
                window = start, end
    try:
        content = review_transcript_pdf(record, turns, window=window)
    except Exception as exc:
        log.warning('Review transcript PDF rendering failed (%s).', type(exc).__name__)
        return JsonResponse({'detail': 'This PDF could not be prepared. Please retry.'}, status=503)
    response = HttpResponse(content, content_type='application/pdf')
    disposition = 'inline' if request.GET.get('preview') == '1' else 'attachment'
    response['Content-Disposition'] = f'{disposition}; filename="coach-review-transcript.pdf"'
    response['Cache-Control'] = 'private, no-store'
    response['X-Content-Type-Options'] = 'nosniff'
    response['Content-Security-Policy'] = "frame-ancestors 'self'"
    response['Content-Length'] = str(len(content))
    return response
