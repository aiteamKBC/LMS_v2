"""Read actual video bytes, with bounded downloads and public-address pinning."""
from __future__ import annotations

import html
import ipaddress
import re
import socket
import tempfile
import time
from contextlib import contextmanager
from urllib.parse import parse_qs, urlencode, urljoin, urlsplit

import urllib3

from .bunny_stream import VideoImportError

MAX_VIDEO_BYTES = 300 * 1024 * 1024
YOUTUBE_HOSTS = frozenset(('youtu.be', 'youtube.com', 'www.youtube.com', 'm.youtube.com',
                           'youtube-nocookie.com', 'www.youtube-nocookie.com'))


def youtube_url(value):
    """A single video only; discard playlists, redirects and other query values."""
    try:
        parsed = urlsplit(value)
        if parsed.hostname not in YOUTUBE_HOSTS:
            return ''
        if parsed.scheme not in ('https', 'http') or parsed.username or parsed.password or parsed.port not in (None, 80, 443):
            raise ValueError
        parts = parsed.path.strip('/').split('/')
        if parsed.hostname == 'youtu.be' and len(parts) == 1:
            video_id = parts[0]
        elif parsed.path == '/watch':
            video_id = (parse_qs(parsed.query).get('v') or [''])[0]
        elif len(parts) == 2 and parts[0] in ('embed', 'shorts', 'live', 'v'):
            video_id = parts[1]
        else:
            raise ValueError
        if not re.fullmatch(r'[a-zA-Z0-9_-]{11}', video_id):
            raise ValueError
        return 'https://www.youtube.com/watch?v=' + video_id
    except ValueError:
        raise VideoImportError('Use a YouTube link to one video, not a channel or playlist.') from None


def source_url(settings):
    value = str(settings.get('videoUrl') or settings.get('embedCode') or '').strip()
    if '<' in value:
        match = re.search(r'<iframe\b[^>]*\ssrc\s*=\s*[\"\']([^\"\']+)', value, re.I)
        value = html.unescape(match.group(1)).strip() if match else ''
    return value


def download_url(value):
    try:
        parsed = urlsplit(value)
        host = (parsed.hostname or '').lower()
    except ValueError:
        raise VideoImportError('Enter a valid video URL.') from None
    if parsed.scheme not in ('http', 'https') or not host or parsed.username or parsed.password:
        raise VideoImportError('Use a public HTTP(S) video URL without credentials.')
    if host in YOUTUBE_HOSTS:
        return youtube_url(value)
    if host == 'drive.google.com':
        match = re.search(r'/file/d/([\w-]{10,})', parsed.path)
        file_id = match.group(1) if match else (parse_qs(parsed.query).get('id') or [''])[0]
        if not re.fullmatch(r'[\w-]{10,}', file_id):
            raise VideoImportError('The Google Drive link must identify a video file.')
        return 'https://drive.google.com/uc?' + urlencode({'export': 'download', 'id': file_id})
    if host.endswith('.sharepoint.com'):
        # An anonymous share may expose the actual file with download=1. Private
        # shares remain private: no tenant credentials are forwarded here.
        query = parse_qs(parsed.query)
        query['download'] = ['1']
        return parsed._replace(query=urlencode(query, doseq=True)).geturl()
    return value


def _public_target(url):
    parsed = urlsplit(url)
    if parsed.scheme not in ('http', 'https') or parsed.username or parsed.password:
        raise VideoImportError('The video source redirected to an unsupported address.')
    try:
        port = parsed.port or (443 if parsed.scheme == 'https' else 80)
        if port not in (80, 443):
            raise ValueError
        addresses = socket.getaddrinfo(parsed.hostname, port, type=socket.SOCK_STREAM)
        ips = {address[4][0] for address in addresses}
        if not ips or any(not ipaddress.ip_address(ip).is_global for ip in ips):
            raise ValueError
    except (ValueError, OSError):
        raise VideoImportError('Video sources must resolve to public internet addresses.') from None
    return parsed, port, sorted(ips)[0]


@contextmanager
def public_response(url):
    """Pin the validated IP; validate every redirect before following it."""
    for _ in range(6):
        parsed, port, ip = _public_target(url)
        options = {'timeout': urllib3.Timeout(connect=15, read=45), 'retries': False}
        if parsed.scheme == 'https':
            pool = urllib3.HTTPSConnectionPool(ip, port, server_hostname=parsed.hostname,
                                               assert_hostname=parsed.hostname, **options)
        else:
            pool = urllib3.HTTPConnectionPool(ip, port, **options)
        response = None
        try:
            path = parsed.path or '/'
            if parsed.query:
                path += '?' + parsed.query
            response = pool.urlopen('GET', path, headers={'Host': parsed.netloc, 'User-Agent': 'LMS-Curriculum/1.0'},
                                    preload_content=False, redirect=False)
            if response.status in (301, 302, 303, 307, 308):
                url = urljoin(url, response.headers.get('Location', ''))
                continue
            if response.status != 200:
                raise VideoImportError(f'The video source returned HTTP {response.status}. Upload the original MP4 or check sharing access.')
            yield response
            return
        except urllib3.exceptions.HTTPError:
            raise VideoImportError('The video source could not be downloaded. Check access or upload its MP4.') from None
        finally:
            if response is not None:
                response.close()
            pool.close()
    raise VideoImportError('The video source redirected too many times.')


def _drive_confirmation(page):
    form = re.search(r'<form[^>]+id=[\"\']download-form[\"\'][^>]*action=[\"\']([^\"\']+)[\"\'][^>]*>(.*?)</form>', page, re.I | re.S)
    if not form:
        return ''
    action = html.unescape(form.group(1))
    if urlsplit(action).hostname not in ('drive.google.com', 'drive.usercontent.google.com'):
        return ''
    inputs = re.findall(r'<input[^>]+name=[\"\']([^\"\']+)[\"\'][^>]+value=[\"\']([^\"\']*)[\"\']', form.group(2), re.I)
    return action + '?' + urlencode({html.unescape(k): html.unescape(v) for k, v in inputs}) if inputs else ''


def validate_video(file_obj, *, enforce_size_limit=True):
    file_obj.seek(0, 2)
    size = file_obj.tell()
    file_obj.seek(0)
    header = file_obj.read(32)
    file_obj.seek(0)
    if not size:
        raise VideoImportError('Video files must be non-empty.')
    if enforce_size_limit and size > MAX_VIDEO_BYTES:
        raise VideoImportError('Video files must be non-empty and no larger than 300 MB.')
    # ISO-BMFF (MP4/MOV), WebM/Matroska, Ogg. A URL ending .mp4 is not evidence.
    if not (header[4:8] in (b'ftyp', b'moov', b'mdat') or header.startswith((b'\x1aE\xdf\xa3', b'OggS'))):
        raise VideoImportError('The source did not return a video file. Upload the original MP4 or use a downloadable file link.')
    return size


@contextmanager
def download_video(value):
    url = download_url(value)
    if youtube_url(url):
        from .youtube_download import download_youtube
        with download_youtube(url) as downloaded:
            validate_video(downloaded, enforce_size_limit=False)
            yield downloaded
        return
    deadline = time.monotonic() + 1200
    with tempfile.TemporaryFile() as target:
        for attempt in range(2):
            with public_response(url) as response:
                content_type = response.headers.get('Content-Type', '').lower()
                if 'text/html' in content_type or 'application/xhtml' in content_type:
                    page = response.read(256 * 1024).decode('utf-8', 'replace')
                    confirmed = _drive_confirmation(page) if urlsplit(url).hostname == 'drive.google.com' else ''
                    if attempt == 0 and confirmed:
                        url = confirmed
                        continue
                    raise VideoImportError('This link opens a sign-in or viewing page. Share a downloadable video file or upload its MP4.')
                size = 0
                while chunk := response.read(256 * 1024):
                    if time.monotonic() > deadline:
                        raise VideoImportError('The video download timed out. Retry or upload its MP4.')
                    size += len(chunk)
                    if size > MAX_VIDEO_BYTES:
                        raise VideoImportError('The source video exceeds the 300 MB upload limit.')
                    target.write(chunk)
                validate_video(target)
                yield target
                return
