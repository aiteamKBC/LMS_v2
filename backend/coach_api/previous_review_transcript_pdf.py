"""PDF of the stored transcript for a coach's immediately previous Review."""
import json
import logging
import re

from django.http import HttpResponse, JsonResponse
from django.views.decorators.http import require_GET

from .auth import authenticated_coach_email, coach_access_required
from .recordings_pdf import review_transcript_pdf, transcript_turns


log = logging.getLogger(__name__)


def _previous_record_and_text(request, previous_id, review_type):
    from . import views

    if previous_id.startswith('imported-review:'):
        from .migrated_session_scope import stored_transcript_selection
        from .models import ImportedReviewInstance
        from .review_sources import ReviewIdentityConflict, booking_for_overlay

        owner = authenticated_coach_email(request).strip().casefold()
        overlays = list(ImportedReviewInstance.objects.filter(event_key=previous_id)[:2])
        if len(overlays) != 1 or overlays[0].owner_email.casefold() != owner:
            return None, None
        overlay = overlays[0]
        try:
            record = booking_for_overlay(overlay)
        except ReviewIdentityConflict:
            return None, None
        if not record or record.owner_email.casefold() != owner or record.learner_id != overlay.learner_id:
            return None, None
        expected_type = {'aptem_mcm': 'mcr', 'aptem_progress_review': 'progress-review'}.get(review_type)
        if not expected_type or record.event_type != expected_type:
            return None, None
        selection = stored_transcript_selection(record, views.stored_coach_meeting_snapshot(record), meeting_scoped=True)
        if selection['code'] is not None or not selection['artifactIds']:
            return None, None
        stored = views.stored_coach_meeting_transcript_for_summary(record, artifact_ids=selection['artifactIds'])
    else:
        previous, error = views._authorized_review_instance(request, previous_id)
        if error:
            return None, None
        record = views._review_instance_calendar_record(previous)
        stored = views.stored_coach_meeting_transcript_for_summary(record) if record else None
    return record, stored


def _saved_turns(record, stored):
    from .views import stored_coach_meeting_transcript

    ids = [value for value in (stored.get('artifactId') or '').split(',') if value]
    if ids:
        turns = []
        for artifact_id in ids:
            try:
                part = stored_coach_meeting_transcript(record, artifact_id)
            except Exception as exc:
                log.warning('Saved previous Review VTT could not be read (%s).', type(exc).__name__)
                break
            if not part:
                break
            part_turns = transcript_turns(part['transcript_vtt'])
            if not part_turns:
                break
            turns.extend(part_turns)
        else:
            if turns:
                return turns

    # Readable text survives even when an older VTT no longer exists.
    turns = []
    for line in (stored.get('text') or '').splitlines():
        line = line.strip()
        if not line:
            continue
        match = re.match(r'^([^:\n]{1,120}):\s+(.+)$', line)
        turns.append((match[1], '', match[2]) if match else ('', '', line))
    return turns


@coach_access_required
@require_GET
def previous_review_transcript_pdf(request, instance_id):
    from .views import coach_review_instance_previous

    # The existing context endpoint proves the current Review's ownership and
    # selects its preceding occurrence, including Aptem identity/order checks.
    context = coach_review_instance_previous(request, instance_id)
    if context.status_code != 200:
        return context
    previous = json.loads(context.content)
    if not previous.get('available') or not previous.get('transcriptAvailable'):
        return JsonResponse({'detail': 'No saved previous session transcript is available.'}, status=404)
    previous_id = (previous.get('instance') or {}).get('id')
    if not isinstance(previous_id, str) or not previous_id:
        return JsonResponse({'detail': 'Previous Review not found.'}, status=404)
    record, stored = _previous_record_and_text(request, previous_id, (previous.get('review') or {}).get('reviewTypeCode'))
    if not record or not stored or not stored.get('text'):
        return JsonResponse({'detail': 'The saved previous session transcript is unavailable.'}, status=404)
    turns = _saved_turns(record, stored)
    if not turns:
        return JsonResponse({'detail': 'The saved previous session transcript is empty.'}, status=404)
    try:
        content = review_transcript_pdf(record, turns)
    except Exception as exc:
        log.warning('Previous Review transcript PDF rendering failed (%s).', type(exc).__name__)
        return JsonResponse({'detail': 'This PDF could not be prepared. Please retry.'}, status=503)
    response = HttpResponse(content, content_type='application/pdf')
    response['Content-Disposition'] = 'attachment; filename="previous-review-transcript.pdf"'
    response['Cache-Control'] = 'private, no-store'
    response['X-Content-Type-Options'] = 'nosniff'
    response['Content-Security-Policy'] = "frame-ancestors 'self'"
    response['Content-Length'] = str(len(content))
    return response
