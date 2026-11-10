"""Bunny recording routing and signed playback, without database or network I/O."""
import hashlib
import json
import os
import re
import time
from datetime import datetime, timezone
from urllib.parse import urlencode

from .bunny_stream import VideoImportError
from .session_results_policy import instant

BUNNY_CONTAINER = 'bunny-stream'
CUTOVER = datetime(2026, 11, 5, tzinfo=timezone.utc)


def recording_uses_bunny(occurrence, artifact):
    # The date belongs to the lecture, not the day a delayed file is discovered.
    start = instant(occurrence.get('scheduled_start'))
    return artifact.get('artifact_type') == 'recording' and start is not None and start >= CUTOVER


def bunny_recording(metadata):
    if isinstance(metadata, str):
        try:
            metadata = json.loads(metadata)
        except ValueError:
            return {}
    value = (metadata or {}).get('lmsBunnyRecording') if isinstance(metadata, dict) else None
    return value if isinstance(value, dict) else {}


def signed_embed(library_id, video_id, *, now=None):
    key = os.environ.get('BUNNY_STREAM_TOKEN_KEY', '').strip()
    if not key:
        raise VideoImportError('Bunny playback security key is not configured.')
    if not str(library_id).isdigit() or not re.fullmatch(r'[0-9a-fA-F-]{36}', str(video_id)):
        raise VideoImportError('The saved Bunny video identity is invalid.')
    expires = int(time.time() if now is None else now) + 4 * 60 * 60
    token = hashlib.sha256(f'{key}{video_id}{expires}'.encode()).hexdigest()
    query = urlencode({'token': token, 'expires': expires, 'autoplay': 'false', 'preload': 'false', 'captions': 'en'})
    return f'https://player.mediadelivery.net/embed/{library_id}/{video_id}?{query}'
