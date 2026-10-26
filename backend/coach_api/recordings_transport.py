"""Private Microsoft video delivery after LMS meeting/owner authorization."""
import re
import asyncio
from urllib.error import HTTPError
from urllib.parse import quote, urlsplit
from urllib.request import Request, build_opener

from django.http import HttpResponse, StreamingHttpResponse

from curriculum_api.recordings_external import RecordingRedirect

RANGE = re.compile(r'bytes=(\d{0,19})-(\d{0,19})\Z')
CONTENT_RANGE = re.compile(r'bytes (\d+)-(\d+)/(\d+)\Z')


def valid_range(value):
    if not value:
        return None
    match = RANGE.fullmatch(value)
    if not match or not any(match.groups()):
        raise ValueError('Only one valid byte range is supported.')
    first, last = match.groups()
    if (first and last and int(last) < int(first)) or (not first and int(last) == 0):
        raise ValueError('Invalid byte range.')
    return value


def open_source(base, recording_id, byte_range=None, if_range=None):
    from .views import get_graph_settings, microsoft_graph_token
    graph = get_graph_settings()['base_url'].rstrip('/')
    if urlsplit(graph).scheme != 'https' or urlsplit(graph).hostname != 'graph.microsoft.com':
        raise ValueError('Microsoft recording transport is unavailable.')
    if not re.fullmatch(r'users/[^/?#]+/onlineMeetings/[^/?#]+', base) or not recording_id:
        raise ValueError('Invalid verified meeting path.')
    headers = {'Authorization': f'Bearer {microsoft_graph_token()}', 'Accept': 'video/mp4'}
    if byte_range:
        headers['Range'] = valid_range(byte_range)
    if if_range and byte_range and len(if_range) <= 256 and '\r' not in if_range and '\n' not in if_range:
        headers['If-Range'] = if_range
    source = build_opener(RecordingRedirect()).open(Request(
        f'{graph}/{base}/recordings/{quote(recording_id, safe="")}/content', headers=headers), timeout=25)
    if source.status not in (200, 206) or source.headers.get('Content-Type', '').split(';', 1)[0].lower() not in ('video/mp4', 'application/octet-stream'):
        source.close()
        raise ValueError('Microsoft did not return video content.')
    if source.status == 206 and not CONTENT_RANGE.fullmatch(source.headers.get('Content-Range', '')):
        source.close()
        raise ValueError('Microsoft returned an invalid video byte range.')
    return source


def recording_accessible(base, recording_id):
    """Verify actual MP4 bytes without downloading the recording."""
    source = open_source(base, recording_id, 'bytes=0-63')
    try:
        prefix = source.read(64)
        if len(prefix) < 12 or prefix[4:8] != b'ftyp':
            raise ValueError('Microsoft did not return a playable MP4.')
        return True
    finally:
        source.close()


def recording_response(base, recording_id, *, preview=False, byte_range=None, if_range=None, asynchronous=False):
    byte_range = valid_range(byte_range)
    try:
        source = open_source(base, recording_id, byte_range, if_range)
    except HTTPError as error:
        if error.code != 416:
            raise
        response = HttpResponse(status=416)
        value = error.headers.get('Content-Range', '') if error.headers else ''
        if re.fullmatch(r'bytes \*/\d+', value):
            response['Content-Range'] = value
        error.close()
        response['Cache-Control'] = 'private, no-store'
        return response

    def chunks():
        try:
            while True:
                chunk = source.read(256 * 1024)
                if not chunk:
                    break
                yield chunk
        finally:
            source.close()

    async def async_chunks():
        # ASGI must receive an async iterator; adapting a sync iterator there
        # would buffer the entire recording before returning its first byte.
        try:
            while True:
                chunk = await asyncio.to_thread(source.read, 256 * 1024)
                if not chunk:
                    break
                yield chunk
        finally:
            source.close()

    response = StreamingHttpResponse(async_chunks() if asynchronous else chunks(), status=source.status, content_type='video/mp4')
    response['Content-Disposition'] = f'{"inline" if preview else "attachment"}; filename="coaching-recording.mp4"'
    response['Cache-Control'] = 'private, no-store'
    response['X-Content-Type-Options'] = 'nosniff'
    if source.headers.get('Content-Length', '').isdecimal():
        response['Content-Length'] = source.headers['Content-Length']
    if source.status == 206:
        response['Content-Range'] = source.headers['Content-Range']
    if source.headers.get('Accept-Ranges') == 'bytes' or source.status == 206:
        response['Accept-Ranges'] = 'bytes'
    for name in ('ETag', 'Last-Modified'):
        if source.headers.get(name):
            response[name] = source.headers[name]
    response._resource_closers.append(source.close)
    return response
