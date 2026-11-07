"""Disk-backed Teams recording transfer; never reads Azure or logs source URLs."""
from contextlib import contextmanager
import os
import re
import tempfile
from time import sleep
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from .bunny_stream import VideoImportError

RANGE_BYTES = 16 * 1024 * 1024


def safe_recording_url(url):
    try:
        parsed = urlsplit(url)
        host = parsed.hostname or ''
        return (parsed.scheme == 'https' and not parsed.username and not parsed.password
                and parsed.port in (None, 443)
                and (host == 'graph.microsoft.com' or host.endswith('.sharepoint.com')))
    except ValueError:
        return False


class RecordingRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not safe_recording_url(newurl):
            raise VideoImportError('Microsoft returned an unsafe recording redirect.')
        redirected = super().redirect_request(req, fp, code, msg, headers, newurl)
        if urlsplit(newurl).hostname != urlsplit(req.full_url).hostname:
            redirected.remove_header('Authorization')
        return redirected


def resolve_recording_download(url, token):
    """Read only the MP4 header; hand Bunny a short-lived SharePoint URL.

    Never hand the Microsoft application token to another provider. A Graph
    response without a preauthenticated SharePoint redirect uses the normal
    disk-backed transfer instead. The signed URL is never saved in the journal.
    """
    if not safe_recording_url(url) or urlsplit(url).hostname != 'graph.microsoft.com':
        raise VideoImportError('The stored Microsoft recording identity is invalid.')
    try:
        request = Request(url, headers={'Authorization': 'Bearer ' + token,
            'Range': 'bytes=0-31', 'Accept-Encoding': 'identity', 'Accept': 'video/mp4'})
        with build_opener(RecordingRedirect()).open(request, timeout=120) as response:
            resolved = response.geturl()
            if not safe_recording_url(resolved):
                raise VideoImportError('Microsoft returned an unsafe recording source.')
            if urlsplit(resolved).hostname == 'graph.microsoft.com':
                return None
            header = response.read(32)
            media_type = response.headers.get('Content-Type', '').split(';')[0].lower()
            if (response.status not in (200, 206) or len(header) < 12 or header[4:8] != b'ftyp'
                    or media_type not in ('video/mp4', 'application/octet-stream')):
                raise VideoImportError('Microsoft did not return an MP4 recording.')
            return resolved
    except (HTTPError, URLError, TimeoutError, ConnectionError) as failure:
        status = getattr(failure, 'code', None)
        detail = f' (HTTP {status})' if isinstance(status, int) else ''
        raise VideoImportError('Microsoft recording download failed' + detail + '. Retry the saved recording.') from None


@contextmanager
def download_recording(url, token, progress=None):
    """Retry independent ranges; discard partial ranges and temporary files."""
    if not safe_recording_url(url) or urlsplit(url).hostname != 'graph.microsoft.com':
        raise VideoImportError('The stored Microsoft recording identity is invalid.')
    opener = build_opener(RecordingRedirect())
    with tempfile.TemporaryFile(dir=os.environ.get('SESSION_RECORDINGS_TEMP_DIR') or None) as stream:
        downloaded, total = 0, None
        while True:
            offset = downloaded
            for attempt in range(3):
                stream.seek(offset)
                stream.truncate()
                if progress:
                    progress.update('downloading', offset, total, force=True)
                try:
                    request = Request(url, headers={
                        'Authorization': 'Bearer ' + token,
                        'Range': f'bytes={offset}-{offset + RANGE_BYTES - 1}',
                        'Accept-Encoding': 'identity', 'Accept': 'video/mp4',
                    })
                    with opener.open(request, timeout=120) as response:
                        if not safe_recording_url(response.geturl()):
                            raise VideoImportError('Microsoft returned an unsafe recording source.')
                        media_type = response.headers.get('Content-Type', '').split(';')[0].lower()
                        if media_type not in ('video/mp4', 'application/octet-stream'):
                            raise VideoImportError('Microsoft did not return a video recording.')
                        ranged = response.status == 206
                        expected = None
                        if ranged:
                            match = re.fullmatch(r'bytes (\d+)-(\d+)/(\d+)', response.headers.get('Content-Range', ''))
                            if not match:
                                raise VideoImportError('Microsoft returned an invalid recording range.')
                            start, end, size = map(int, match.groups())
                            if (start != offset or end < start or end >= size
                                    or end - start + 1 > RANGE_BYTES
                                    or (total is not None and total != size)):
                                raise VideoImportError('Microsoft returned an inconsistent recording range.')
                            total, expected = size, end - start + 1
                        elif response.status != 200 or offset:
                            raise VideoImportError('Microsoft did not honor the recording byte range.')
                        else:
                            length = response.headers.get('Content-Length', '')
                            expected = int(length) if length.isdigit() else None
                            total = expected
                        received = 0
                        while True:
                            chunk = response.read(1024 * 1024)
                            if not chunk:
                                break
                            received += len(chunk)
                            if expected is not None and received > expected:
                                raise VideoImportError('Microsoft returned excess recording bytes.')
                            stream.write(chunk)
                            if progress:
                                progress.update('downloading', offset + received, total)
                        if expected is not None and received != expected:
                            raise URLError('Incomplete recording range')
                        downloaded = offset + received
                    break
                except (HTTPError, URLError, TimeoutError, ConnectionError) as failure:
                    status = getattr(failure, 'code', None)
                    transient = not isinstance(failure, HTTPError) or status in (408, 429) or (isinstance(status, int) and status >= 500)
                    if not transient or attempt == 2:
                        detail = f' (HTTP {status})' if isinstance(status, int) else ''
                        raise VideoImportError('Microsoft recording download failed' + detail + '. Retry the saved recording.') from None
                    sleep(2 ** attempt)
            if not ranged or downloaded >= total:
                break
        if not downloaded:
            raise VideoImportError('Microsoft returned an empty recording.')
        stream.seek(0)
        header = stream.read(32)
        if len(header) < 12 or header[4:8] != b'ftyp':
            raise VideoImportError('Microsoft did not return an MP4 recording.')
        stream.seek(0)
        yield stream
