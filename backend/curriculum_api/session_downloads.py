"""Staff downloads of a verified original; Bunny remains the playback source."""
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit

from django.core.handlers.asgi import ASGIRequest
from django.http import HttpResponse, JsonResponse
from django.utils.http import content_disposition_header

from .bunny_stream import VideoImportError


def original_recording_download(request, series_id, recording, *, filename):
    from .session_results import read
    from .session_bunny import source_identity
    from coach_api.recordings_transport import recording_accessible, recording_response, valid_range

    try:
        valid_range(request.headers.get('Range'))
    except ValueError:
        response = HttpResponse(status=416)
        response['Cache-Control'] = 'private, no-store'
        return response

    rows = read('''SELECT a.id AS artifact_id,a.occurrence_id,a.graph_artifact_id,
        o.join_url AS occurrence_join_url,o.online_meeting_id AS occurrence_meeting_id,
        s.id AS series_id,s.organizer_email,s.join_url,s.online_meeting_id
        FROM curriculum.live_session_artifacts a
        JOIN curriculum.live_session_occurrences o ON o.id=a.occurrence_id
        JOIN curriculum.live_sessions s ON s.id=o.live_session_id
        WHERE a.id=%s AND a.occurrence_id=%s AND s.id=%s AND a.artifact_type='recording' ''',
        [recording['artifact_id'], recording['occurrence_id'], series_id])
    if not rows:
        raise VideoImportError('The original recording could not be linked to this lecture. Refresh and retry.')
    row = rows[0]
    source = source_identity(row, {'join_url': row.get('occurrence_join_url'),
                                  'online_meeting_id': row.get('occurrence_meeting_id')}, row)
    # source_identity derives these identifiers from the saved occurrence, including
    # recreated meetings; client-provided Microsoft paths are never accepted.
    base = urlsplit(source).path.removeprefix('/v1.0/').rsplit('/recordings/', 1)[0]
    try:
        if request.GET.get('resolve') == '1':
            # Catch expired/unavailable originals while the download button can
            # still show an error, reading just 64 bytes rather than the video.
            recording_accessible(base, row['graph_artifact_id'])
            response = JsonResponse({'url': request.path + '?download=1', 'provider': 'microsoft'})
        else:
            response = recording_response(base, row['graph_artifact_id'],
                byte_range=request.headers.get('Range'), if_range=request.headers.get('If-Range'),
                asynchronous=isinstance(request, ASGIRequest))
            if response.status_code in (200, 206):
                response['Content-Disposition'] = content_disposition_header(True, filename)
        response['Cache-Control'] = 'private, no-store'
        return response
    except HTTPError as error:
        error.close()
        raise VideoImportError('The original recording is unavailable from Microsoft. Retry or contact support.') from None
    except (URLError, OSError, ValueError, RuntimeError):
        raise VideoImportError('The original recording could not be downloaded. Retry or contact support.') from None
