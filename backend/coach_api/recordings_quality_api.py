from django.db import DatabaseError
from django.utils import timezone
from django.views.decorators.csrf import csrf_protect
from django.views.decorators.http import require_http_methods

from learner_api.constants import ACCESS_COACH, ACCESS_CURRICULUM
from login.permissions import require_access
from .recordings_api import _authorised_record, _response, _saved_session_evidence, source_details
from .recordings_calendar import is_lms_cancelled
from .recordings_quality import QualityUnavailable, TranscriptUnavailable, keyword_suggestion, prepare_analysis, suggestion
from .recordings_media import session_window


@require_http_methods(['GET', 'POST'])
@require_access(ACCESS_CURRICULUM, ACCESS_COACH)
@csrf_protect
def coaching_quality_suggestion(request):
    method = request.GET.get('method', 'ai')
    if method not in {'keywords', 'ai'} or (method == 'keywords' and request.method != 'GET'):
        return _response({'error': 'Choose a supported analysis method.', 'code': 'invalid_analysis_method'}, 400)
    record, failure = _authorised_record(request)
    if failure is not None:
        return failure
    _, end = session_window(record)
    if not end or end > timezone.now() or is_lms_cancelled({'status': record.status, 'sync_state': record.sync_state}):
        return _response({'error': 'Analysis requires an ended, scheduled session.', 'code': 'analysis_unavailable'}, 409)
    try:
        if method == 'keywords':
            context = request.headers.get('X-Coaching-Context', '')
            try:
                payload = keyword_suggestion(record, context)
            except TranscriptUnavailable:
                evidence = _saved_session_evidence(request, record, source_details(record), part='evidence')
                transcript = (evidence.get('transcript') or {}).get('content')
                if not transcript:
                    raise
                payload = keyword_suggestion(record, context, verified_transcript=transcript)
        else:
            analysis = prepare_analysis(record, request.headers.get('X-Coaching-Context', ''))
            payload = suggestion(record, analysis, generate=request.method == 'POST')
    except QualityUnavailable as failure:
        return _response({'error': str(failure), 'code': 'analysis_prerequisite'}, 409)
    except DatabaseError:
        return _response({'error': 'Saved meeting analysis is unavailable. Please ask an administrator to check the service.',
                          'code': 'analysis_storage_unavailable'}, 503)
    return _response({'eventKey': record.event_key, **payload}, 202 if payload['state'] == 'running' else 200)
