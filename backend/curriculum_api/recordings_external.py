"""Read and download Teams recordings without creating a curriculum link or archive."""
from urllib.parse import quote, urlsplit
from urllib.request import Request, HTTPRedirectHandler, build_opener
from urllib.error import URLError
from django.core import signing
from django.db import DatabaseError
from django.http import JsonResponse, StreamingHttpResponse
from django.views.decorators.http import require_GET
from login.permissions import require_role
from .session_results import read, unavailable
from .session_results_policy import instant
from .recordings_external_policy import event_join_url, occurrence_recordings

SALT = 'recordings-calendar-event-v1'


def event_reference(mailbox, event_id, start, end):
    return signing.dumps({'mailbox': mailbox, 'event': event_id, 'start': start, 'end': end}, salt=SALT, compress=True)


def resolve_recordings(request):
    reference = signing.loads(request.GET.get('reference', ''), salt=SALT, max_age=3600)
    mailbox = reference['mailbox']
    account = request.login_account
    if account.role != 'admin' and str(account.email).strip().lower() != mailbox:
        raise PermissionError()
    known = read("SELECT DISTINCT organizer_email FROM curriculum.live_sessions WHERE status='active' AND btrim(organizer_email)<>''")
    if mailbox not in {row['organizer_email'].strip().lower() for row in known}:
        raise PermissionError()
    from coach_api.views import microsoft_graph_request, get_graph_settings
    from .teams_weekly_calendar import graph_event_utc
    from .views import teams_online_meeting_from_join_url, teams_online_meeting_owner_id
    from .session_graph import collection
    event = graph_event_utc(microsoft_graph_request('GET', f'users/{quote(mailbox, safe="")}/events/{quote(reference["event"], safe="")}'
        '?$select=id,subject,start,end,organizer,onlineMeeting,onlineMeetingUrl,body,isCancelled'))
    start, end = instant((event.get('start') or {}).get('dateTime')), instant((event.get('end') or {}).get('dateTime'))
    if not start or not end or start != instant(reference['start']) or end != instant(reference['end']):
        raise ValueError('The meeting time changed. Refresh the calendar comparison.')
    link = event_join_url(event)
    organizer = ((event.get('organizer') or {}).get('emailAddress') or {}).get('address')
    if not link or not organizer:
        raise ValueError('This event has no accessible Teams meeting identity.')
    meeting = teams_online_meeting_from_join_url(organizer, link)
    if not meeting.get('id'):
        raise ValueError('Microsoft did not provide access to this meeting.')
    owner = teams_online_meeting_owner_id(organizer, link)
    path = f'users/{quote(owner, safe="")}/onlineMeetings/{quote(meeting["id"], safe="")}/recordings'
    rows = occurrence_recordings(collection(microsoft_graph_request, path, get_graph_settings()['base_url']), start, end)
    return event, path, rows


class RecordingRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        parsed = urlsplit(newurl)
        host = parsed.hostname or ''
        if parsed.scheme != 'https' or parsed.username or parsed.password or parsed.port not in (None, 443) or not (host == 'graph.microsoft.com' or host.endswith('.sharepoint.com')):
            raise URLError('Unsafe recording redirect.')
        redirected = super().redirect_request(req, fp, code, msg, headers, newurl)
        if host != urlsplit(req.full_url).hostname:
            redirected.remove_header('Authorization')
        return redirected


def recording_stream(path):
    from coach_api.views import get_graph_settings, microsoft_graph_token
    base = get_graph_settings()['base_url'].rstrip('/')
    if urlsplit(base).scheme != 'https' or urlsplit(base).hostname != 'graph.microsoft.com':
        raise ValueError('Recording transport is unavailable.')
    source = build_opener(RecordingRedirect()).open(Request(f'{base}/{path}/content',
        headers={'Authorization': f'Bearer {microsoft_graph_token()}', 'Accept': 'video/mp4'}), timeout=90)
    media_type = source.headers.get('Content-Type', '').split(';', 1)[0].lower()
    if source.status != 200 or media_type not in ('video/mp4', 'application/octet-stream'):
        source.close()
        raise ValueError('Microsoft did not return a complete recording.')
    def chunks():
        try:
            while True:
                chunk = source.read(256 * 1024)
                if not chunk:
                    break
                yield chunk
        finally:
            source.close()
    response = StreamingHttpResponse(chunks(), content_type='video/mp4')
    response['Content-Disposition'] = 'attachment; filename="teams-recording.mp4"'
    response['Cache-Control'] = 'private, no-store'
    if source.headers.get('Content-Length', '').isdigit():
        response['Content-Length'] = source.headers['Content-Length']
    response._resource_closers.append(source.close)
    return response


@require_GET
@require_role('admin', 'staff')
def external_recordings(request):
    try:
        event, path, rows = resolve_recordings(request)
        recording_id = request.GET.get('recording')
        if recording_id:
            if not any(row['id'] == recording_id for row in rows):
                return JsonResponse({'error': 'Recording not found for this calendar occurrence.'}, status=404)
            return recording_stream(f'{path}/{quote(recording_id, safe="")}')
        response = JsonResponse({'title': str(event.get('subject') or 'Teams meeting'), 'linkedToLms': False,
            'recordings': [{'id': row['id'], 'startsAt': row['createdDateTime'], 'endsAt': row['endDateTime']} for row in rows]})
        response['Cache-Control'] = 'private, no-store'
        return response
    except (signing.BadSignature, KeyError, TypeError):
        return JsonResponse({'error': 'This calendar reference expired or is invalid. Refresh the comparison.'}, status=400)
    except PermissionError:
        return JsonResponse({'error': 'You cannot access this calendar.'}, status=403)
    except DatabaseError:
        return unavailable()
    except (RuntimeError, ValueError, URLError):
        return JsonResponse({'error': 'Teams recordings could not be accessed. Refresh the comparison and retry; Microsoft permissions may be required.'}, status=503)
