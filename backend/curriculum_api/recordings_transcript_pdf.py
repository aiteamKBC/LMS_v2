"""Private PDFs of saved lecture transcripts. No Graph, storage, AI or writes."""
import logging

from django.db import DatabaseError
from django.http import HttpResponse, JsonResponse
from django.views.decorators.http import require_GET
from learner_api.constants import ACCESS_CURRICULUM
from login.permissions import require_access
from .session_results import read
from .session_results_policy import instant
from .session_media_policy import artifact_metadata, transcript_timing_ready

log = logging.getLogger(__name__)


def response_error(message, status):
    response = JsonResponse({'error': message}, status=status)
    response['Cache-Control'] = 'private, no-store'
    return response


@require_GET
@require_access(ACCESS_CURRICULUM)
def lecture_transcript(request):
    keys = ('moduleId', 'seriesId', 'occurrenceId')
    scope = [request.GET.get(key, '').strip() for key in keys]
    if any(not value or len(value) > 128 for value in scope):
        return response_error('Choose a saved lecture before opening its transcript.', 400)
    try:
        rows = read('''SELECT m.title AS title,coalesce(t.name,'') AS tutor,coalesce(p.name,'') AS programme,
            coalesce(c.cohort_name,'') AS cohort,coalesce(g.group_name,'') AS "group",o.scheduled_start,o.scheduled_end
            FROM curriculum.live_session_occurrences o
            JOIN curriculum.live_sessions s ON s.id=o.live_session_id
            JOIN curriculum.modules m ON m.module_catalogue_id=s.module_catalogue_id
            LEFT JOIN curriculum.programmes p ON p.programme_id=m.programme_id
            LEFT JOIN curriculum.cohorts c ON c.cohort_id=m.cohort_id
            LEFT JOIN curriculum.groups g ON g.group_id=m.group_id
            LEFT JOIN curriculum.tutors t ON t.id=m.tutor_id
            WHERE m.module_catalogue_id=%s AND s.id=%s AND o.id=%s''', scope)
        if not rows:
            return response_error('This module lecture was not found.', 404)
        lecture = rows[0]
        start, end = instant(lecture['scheduled_start']), instant(lecture['scheduled_end'])
        if not start or not end or end <= start:
            return response_error('This lecture has no valid saved time window.', 409)
        artifacts = read('''SELECT a.id,a.metadata,r.status,r.transcript_text
            FROM curriculum.live_session_artifacts a
            JOIN curriculum.live_session_occurrences o ON o.id=a.occurrence_id
            LEFT JOIN curriculum.session_result_archive r ON r.artifact_id=a.id AND r.occurrence_id=o.id
            WHERE o.live_session_id=%s AND o.id=%s AND a.artifact_type='transcript'
            ORDER BY a.created_datetime,a.id''', scope[1:])
        if not artifacts:
            return response_error('No saved transcript is available for this lecture yet. A recording can be available without a transcript.', 404)
        if any(row['status'] != 'ready' or not (row['transcript_text'] or '').strip() for row in artifacts):
            return response_error('Some transcript parts are still being saved. Please try again later.', 409)
        parts = [{'content': row['transcript_text'],
                  'cues': artifact_metadata(row)['lmsTranscriptTimeline']['cues'] if transcript_timing_ready(row) else None}
                 for row in artifacts]
        from coach_api.recordings_pdf import lecture_transcript_pdf
        content = lecture_transcript_pdf({**lecture, 'startsAt': start, 'endsAt': end}, parts)
    except DatabaseError:
        return response_error('Saved lecture transcripts are temporarily unavailable. Please retry.', 503)
    except Exception as error:
        log.warning('Lecture transcript PDF failed (%s).', type(error).__name__)
        return response_error('The lecture transcript PDF could not be prepared. Please retry.', 503)
    response = HttpResponse(content, content_type='application/pdf')
    response['Content-Disposition'] = 'attachment; filename="tutor-session-transcript.pdf"'
    response['Content-Length'] = str(len(content))
    response['Cache-Control'] = 'private, no-store'
    response['X-Content-Type-Options'] = 'nosniff'
    response['Content-Security-Policy'] = "frame-ancestors 'self'"
    return response
