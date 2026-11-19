"""Download one YouTube video into temporary backend storage, never a playlist.

The subprocess has no Django startup, database connection or storage credentials.
Its temporary media are removed after the caller uploads them, including errors.
"""
from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import time
from contextlib import contextmanager

from .bunny_stream import VideoImportError

DOWNLOAD_TIMEOUT = 1200
CHECK_TIMEOUT = 60
MAX_COOKIE_BYTES = 1024 * 1024


def _prepare_cookies(directory):
    """Copy an administrator's YouTube-only export into this job's private dir.

    yt-dlp can update its cookie jar on exit. Never give it the shared original,
    or pass browser sessions from other sites to the downloader.
    """
    configured = os.environ.get('YOUTUBE_COOKIES_FILE', '').strip()
    secret_text = os.environ.get('YOUTUBE_COOKIES_TEXT', '')
    if configured and secret_text:
        raise VideoImportError('Configure only one YouTube session source: YOUTUBE_COOKIES_FILE or YOUTUBE_COOKIES_TEXT.')
    if not configured and not secret_text:
        return None
    invalid = 'The YouTube session file is invalid. Ask an administrator to supply a YouTube-only Netscape cookies file.'
    try:
        if secret_text:
            # ECS can inject a Secrets Manager plaintext export. Never forward
            # this environment variable to the child or bake it into the image.
            if len(secret_text) > MAX_COOKIE_BYTES:
                raise VideoImportError(invalid)
            raw = secret_text.encode('utf-8')
        else:
            source = Path(configured)
            if not source.is_absolute():
                raise VideoImportError('YOUTUBE_COOKIES_FILE must be an absolute path outside the application folder.')
            source = source.resolve(strict=True)
            # The backend folder (curriculum_api/..). parents[2] was the repo root
            # on the VPS but "/" in the container (/app/curriculum_api), which
            # rejected every path there.
            if source.is_relative_to(Path(__file__).resolve().parents[1]):
                raise VideoImportError('Keep the YouTube session file outside the application folder.')
            if not source.is_file():
                raise VideoImportError(invalid)
            with source.open('rb') as stream:
                info = os.fstat(stream.fileno())
                if not stat.S_ISREG(info.st_mode):
                    raise VideoImportError(invalid)
                if sys.platform != 'win32' and info.st_mode & 0o077:
                    raise VideoImportError('The YouTube session file must be private to the worker account (chmod 600).')
                raw = stream.read(MAX_COOKIE_BYTES + 1)
        if len(raw) > MAX_COOKIE_BYTES:
            raise VideoImportError(invalid)
        lines = raw.decode('utf-8-sig').splitlines()
        if not lines or lines[0] not in ('# Netscape HTTP Cookie File', '# HTTP Cookie File'):
            raise VideoImportError(invalid)
        cookies = []
        usable = False
        for line in lines[1:]:
            if not line or (line.startswith('#') and not line.startswith('#HttpOnly_')):
                continue
            record = line.removeprefix('#HttpOnly_')
            fields = record.split('\t')
            if len(fields) != 7:
                raise VideoImportError(invalid)
            domain, subdomains, path, secure, expires, name, value = fields
            domain = domain.lower()
            host = domain.removeprefix('.')
            if host != 'youtube.com' and not host.endswith('.youtube.com'):
                raise VideoImportError(invalid)
            if (subdomains not in ('TRUE', 'FALSE') or secure not in ('TRUE', 'FALSE')
                    or (subdomains == 'TRUE') != domain.startswith('.')
                    or not path.startswith('/') or not name
                    or (expires and (not expires.isascii() or not expires.isdigit()))):
                raise VideoImportError(invalid)
            if not expires or int(expires) == 0 or int(expires) > time.time():
                usable = usable or bool(value)
            cookies.append(line)
        if not cookies:
            raise VideoImportError(invalid)
        if not usable:
            raise VideoImportError('The configured YouTube session has expired. Ask an administrator to refresh it.')
        destination = directory / 'youtube.cookies.txt'
        # The parent TemporaryDirectory is private too. Strip export comments:
        # they are not needed by yt-dlp and can contain browser/profile details.
        with os.fdopen(os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600),
                       'w', encoding='utf-8', newline='\n') as stream:
            stream.write('# Netscape HTTP Cookie File\n' + '\n'.join(cookies) + '\n')
        return destination
    except (OSError, UnicodeError, ValueError):
        raise VideoImportError('The YouTube session file could not be read. Ask an administrator to check its path, permissions and format.') from None


def _stop_process(process):
    if process.poll() is not None:
        return
    if os.name == 'nt':
        subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                       creationflags=subprocess.CREATE_NO_WINDOW, timeout=15, check=False)
    else:
        os.killpg(process.pid, signal.SIGKILL)
    process.wait(timeout=15)


def _run_download(url, directory, *, check_only=False):
    if not all(importlib.util.find_spec(name) for name in ('yt_dlp', 'imageio_ffmpeg')):
        raise VideoImportError('YouTube import dependencies are missing. Install the backend requirements.')
    node = shutil.which('node')
    if not node:
        raise VideoImportError('YouTube imports need Node.js 22 or newer on the backend worker.')
    cookie_file = _prepare_cookies(directory)
    # Do not pass database, Bunny or Microsoft credentials to the downloader.
    child_env = {k: v for k, v in os.environ.items() if k.upper() in {
        'PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL',
        'SSL_CERT_FILE', 'SSL_CERT_DIR', 'REQUESTS_CA_BUNDLE',
    }}
    command = [sys.executable, '-m', 'curriculum_api.youtube_download',
               url, str(directory), node]
    if cookie_file or check_only:
        command.append(str(cookie_file) if cookie_file else '')
    if check_only:
        command.append('--check')
    options = {'creationflags': subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP} if os.name == 'nt' else {'start_new_session': True}
    process = subprocess.Popen(command, cwd=Path(__file__).resolve().parents[1], env=child_env,
                               stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                               stderr=subprocess.DEVNULL, **options)
    try:
        process.wait(timeout=CHECK_TIMEOUT if check_only else DOWNLOAD_TIMEOUT)
    except subprocess.TimeoutExpired:
        _stop_process(process)
        if check_only:
            raise VideoImportError('The YouTube metadata check timed out. No video was downloaded.') from None
        raise VideoImportError('YouTube download timed out. Retry or upload the MP4.') from None
    finally:
        _stop_process(process)
    result_file = directory / 'result.json'
    if process.returncode or not result_file.exists():
        raise VideoImportError('The YouTube downloader could not finish. Retry or upload the MP4.')
    result = json.loads(result_file.read_text(encoding='utf-8'))
    if result.get('error'):
        raise VideoImportError(result['error'])
    if check_only:
        if result.get('checked') is not True:
            raise VideoImportError('YouTube did not return video metadata. No video was downloaded.')
        return None
    media = directory / result.get('file', '')
    if media.resolve().parent != directory.resolve() or not media.is_file() or media.is_symlink():
        raise VideoImportError('YouTube did not return a downloadable video file.')
    return media


@contextmanager
def download_youtube(url):
    with tempfile.TemporaryDirectory(prefix='lms-youtube-') as temporary:
        directory = Path(temporary)
        media = _run_download(url, directory)
        if media.stat().st_size == 0:
            raise VideoImportError('The source video is empty.')
        with media.open('rb') as stream:
            yield stream


def _worker(url, directory, node, cookie_file=None, *, check_only=False):
    import imageio_ffmpeg
    import yt_dlp
    from .video_sources import youtube_url

    deadline = time.monotonic() + DOWNLOAD_TIMEOUT - 30

    class QuietLog:
        def debug(self, *_): pass
        def warning(self, *_): pass
        def error(self, *_): pass

    def guard(_):
        if time.monotonic() > deadline:
            raise VideoImportError('YouTube download timed out. Retry or upload the MP4.')

    def allow_video(info, *, incomplete=False):
        if info.get('is_live') or info.get('live_status') in ('is_live', 'is_upcoming'):
            raise VideoImportError('Wait until the YouTube livestream has finished before importing it.')
        return None

    options = {
        'format': 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
        'merge_output_format': 'mp4', 'outtmpl': str(directory / 'video.%(ext)s'),
        'noplaylist': True, 'cachedir': False, 'quiet': True, 'no_warnings': True,
        'logger': QuietLog(), 'socket_timeout': 30, 'retries': 2, 'fragment_retries': 2,
        'extractor_retries': 2, 'skip_unavailable_fragments': False,
        'progress_hooks': [guard], 'match_filter': allow_video,
        'js_runtimes': {'node': {'path': node}}, 'remote_components': [],
        'ffmpeg_location': imageio_ffmpeg.get_ffmpeg_exe(),
    }
    if cookie_file:
        options['cookiefile'] = str(cookie_file)
    if check_only:
        options.update({'simulate': True, 'check_formats': False})
    try:
        canonical = youtube_url(url)
        if not canonical:
            raise VideoImportError('Use a YouTube video link.')
        with yt_dlp.YoutubeDL(options) as downloader:
            info = downloader.extract_info(canonical, download=not check_only, ie_key='Youtube')
        if check_only:
            if not isinstance(info, dict) or not info.get('id'):
                raise VideoImportError('YouTube did not return video metadata. No video was downloaded.')
            result = {'checked': True}
        else:
            files = [p for p in directory.glob('video.*') if p.suffix in ('.mp4', '.webm', '.mkv')]
            if len(files) != 1:
                raise VideoImportError('YouTube did not return a complete video file.')
            result = {'file': files[0].name}
    except VideoImportError as exc:
        result = {'error': str(exc)}
    except Exception as exc:
        # Interpret known failures, but never expose provider text or signed URLs.
        message = str(exc).lower()
        if any(word in message for word in ('429', 'rate-limit', 'too many requests')):
            error = 'YouTube is limiting download requests. Wait before retrying or upload the MP4.'
        elif 'not a bot' in message:
            error = ('YouTube still requires verification. Ask an administrator to refresh the YouTube session or check server access.'
                     if cookie_file else
                     'YouTube requires verification. Ask an administrator to configure a YouTube session, or upload the MP4.')
        elif 'sign in' in message:
            error = 'This YouTube video requires sign-in. Ask an administrator to check the YouTube session and video access.'
        elif any(word in message for word in ('private video', 'unavailable', 'removed', 'members-only')):
            error = 'This YouTube video is unavailable or requires access. Upload its MP4 instead.'
        else:
            error = 'YouTube could not provide the video. Retry later or upload its MP4.'
        result = {'error': error}
    (directory / 'result.json').write_text(json.dumps(result), encoding='utf-8')


def main(args=None):
    args = sys.argv[1:] if args is None else args
    if len(args) == 2 and args[0] == '--check':
        # Standalone: never load Django/.env, connect to a database or wake a
        # worker. Use the session already injected into this process environment.
        from .video_sources import youtube_url
        try:
            canonical = youtube_url(args[1])
            if not canonical:
                raise VideoImportError('Use a YouTube video link.')
            with tempfile.TemporaryDirectory(prefix='lms-youtube-check-') as temporary:
                _run_download(canonical, Path(temporary), check_only=True)
        except VideoImportError as exc:
            print(str(exc))
            return 1
        print('YouTube metadata accessible. No video downloaded or uploaded; media transfer is not verified by this check.')
        return 0
    if len(args) in (3, 4) or (len(args) == 5 and args[4] == '--check'):
        _worker(args[0], Path(args[1]), args[2],
                args[3] if len(args) > 3 else None, check_only=len(args) == 5)
        return 0
    print('Usage: python -m curriculum_api.youtube_download --check YOUTUBE_URL')
    return 0 if args in (['--help'], ['-h']) else 2


if __name__ == '__main__':
    sys.exit(main())
