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
import subprocess
import sys
import tempfile
import time
from contextlib import contextmanager

from .bunny_stream import VideoImportError

DOWNLOAD_TIMEOUT = 1200


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


def _run_download(url, directory, max_bytes):
    if not all(importlib.util.find_spec(name) for name in ('yt_dlp', 'imageio_ffmpeg')):
        raise VideoImportError('YouTube import dependencies are missing. Install the backend requirements.')
    node = shutil.which('node')
    if not node:
        raise VideoImportError('YouTube imports need Node.js 22 or newer on the backend worker.')
    # Do not pass database, Bunny or Microsoft credentials to the downloader.
    child_env = {k: v for k, v in os.environ.items() if k.upper() in {
        'PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL',
        'SSL_CERT_FILE', 'SSL_CERT_DIR', 'REQUESTS_CA_BUNDLE',
    }}
    command = [sys.executable, '-m', 'curriculum_api.youtube_download',
               url, str(directory), str(max_bytes), node]
    options = {'creationflags': subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP} if os.name == 'nt' else {'start_new_session': True}
    process = subprocess.Popen(command, cwd=Path(__file__).resolve().parents[1], env=child_env,
                               stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                               stderr=subprocess.DEVNULL, **options)
    try:
        process.wait(timeout=DOWNLOAD_TIMEOUT)
    except subprocess.TimeoutExpired:
        _stop_process(process)
        raise VideoImportError('YouTube download timed out. Retry or upload the MP4.') from None
    finally:
        _stop_process(process)
    result_file = directory / 'result.json'
    if process.returncode or not result_file.exists():
        raise VideoImportError('The YouTube downloader could not finish. Retry or upload the MP4.')
    result = json.loads(result_file.read_text(encoding='utf-8'))
    if result.get('error'):
        raise VideoImportError(result['error'])
    media = directory / result.get('file', '')
    if media.resolve().parent != directory.resolve() or not media.is_file() or media.is_symlink():
        raise VideoImportError('YouTube did not return a downloadable video file.')
    return media


@contextmanager
def download_youtube(url, max_bytes):
    with tempfile.TemporaryDirectory(prefix='lms-youtube-') as temporary:
        directory = Path(temporary)
        media = _run_download(url, directory, max_bytes)
        if not 0 < media.stat().st_size <= max_bytes:
            raise VideoImportError('The source video exceeds the 300 MB upload limit or is empty.')
        with media.open('rb') as stream:
            yield stream


def _worker(url, directory, max_bytes, node):
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
        # Before merging, separate audio/video and partial downloads share the
        # same limit. Merging itself may briefly need another copy on disk.
        size = sum(p.stat().st_size for p in directory.glob('video.*') if p.is_file())
        if size > max_bytes:
            raise VideoImportError('The source video exceeds the 300 MB upload limit.')

    def allow_video(info, *, incomplete=False):
        if info.get('is_live') or info.get('live_status') in ('is_live', 'is_upcoming'):
            raise VideoImportError('Wait until the YouTube livestream has finished before importing it.')
        return None

    options = {
        'format': 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
        'merge_output_format': 'mp4', 'outtmpl': str(directory / 'video.%(ext)s'),
        'noplaylist': True, 'cachedir': False, 'quiet': True, 'no_warnings': True,
        'logger': QuietLog(), 'socket_timeout': 30, 'retries': 2, 'fragment_retries': 2,
        'extractor_retries': 2, 'skip_unavailable_fragments': False, 'max_filesize': max_bytes,
        'progress_hooks': [guard], 'match_filter': allow_video,
        'js_runtimes': {'node': {'path': node}}, 'remote_components': [],
        'ffmpeg_location': imageio_ffmpeg.get_ffmpeg_exe(),
    }
    try:
        canonical = youtube_url(url)
        if not canonical:
            raise VideoImportError('Use a YouTube video link.')
        with yt_dlp.YoutubeDL(options) as downloader:
            downloader.extract_info(canonical, download=True, ie_key='Youtube')
        files = [p for p in directory.glob('video.*') if p.suffix in ('.mp4', '.webm', '.mkv')]
        if len(files) != 1:
            raise VideoImportError('YouTube did not return a complete video within the 300 MB limit.')
        result = {'file': files[0].name}
    except VideoImportError as exc:
        result = {'error': str(exc)}
    except Exception as exc:
        # Interpret known failures, but never expose provider text or signed URLs.
        message = str(exc).lower()
        if any(word in message for word in ('sign in', 'not a bot', '429', 'rate-limit')):
            error = 'YouTube refused automated downloading from this server. Retry later or upload the MP4.'
        elif any(word in message for word in ('private video', 'unavailable', 'removed', 'members-only')):
            error = 'This YouTube video is unavailable or requires access. Upload its MP4 instead.'
        elif 'too large' in message or 'max-filesize' in message:
            error = 'The source video exceeds the 300 MB upload limit.'
        else:
            error = 'YouTube could not provide the video. Retry later or upload its MP4.'
        result = {'error': error}
    (directory / 'result.json').write_text(json.dumps(result), encoding='utf-8')


if __name__ == '__main__':
    _worker(sys.argv[1], Path(sys.argv[2]), int(sys.argv[3]), sys.argv[4])
