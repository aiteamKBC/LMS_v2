"""Verified transcript reads for one authorised occurrence. No writes or AI."""
from hashlib import sha256
import json
import logging
from time import monotonic
from urllib import request as http
from urllib.parse import quote
from urllib.parse import urlsplit

from django.db import connections, router
from django.utils import timezone

from curriculum_api.session_graph import collection
from curriculum_api.recordings_external import RecordingRedirect
from .models import CoachCalendarEvent
from .recording_archive import ARTIFACTS_RELATION
from .recordings_calendar_media import calendar_context
from .recordings_media import session_window, in_session_window
from .recordings_saved_evidence import online_identity
from .recordings_cache import recent_read
from .recordings_errors import calendar_failure
from .recordings_parts import occurrence_parts, artifact_metadata

MAX_BYTES = 2 * 1024 * 1024
log = logging.getLogger(__name__)


def local_transcript(record):
    window = session_window(record)
    database = router.db_for_read(CoachCalendarEvent) or 'default'
    with connections[database].cursor() as cursor:
        cursor.execute(f'''SELECT graph_artifact_id,COALESCE(NULLIF(transcript_vtt,''),transcript_text),
            created_datetime,end_datetime,transcript_fetched_at FROM {ARTIFACTS_RELATION}
            WHERE owner_email=%s AND graph_event_id=%s AND artifact_type='transcript'
            AND created_datetime<%s AND end_datetime>%s
            ORDER BY created_datetime,graph_artifact_id LIMIT 21''',
            [record.owner_email, record.graph_event_id, window[1], window[0]])
        rows = cursor.fetchall()
    if len(rows) > 20:
        raise ValueError('Transcript scope exceeds the limit.')
    parts = list(dict.fromkeys(text for _, text, begin, end, _ in rows
        if text and in_session_window(begin, end, window) is True))
    return {'content': '\n\n'.join(parts), 'durationSeconds': None, 'updatedAt': None,
            'source': 'lms'} if parts else None


def _context(record, job):
    start, end = session_window(record)
    context = calendar_context(record.owner_email, record.graph_event_id, start, end)
    if not job or job.context != context or not online_identity(job):
        raise ValueError('A verified occurrence identity is required.')
    return context, job.result['base']


def _cache_identity(record, job):
    from .views import get_graph_settings
    context, base = _context(record, job)
    return [get_graph_settings(), context, base]


def _key(identity):
    # Same environment/tenant/owner/occurrence isolation as the read caches.
    from django.conf import settings
    return 'coach-transcript:v1:' + sha256(json.dumps([settings.DATABASES, identity],
        sort_keys=True, default=str).encode()).hexdigest()


def cached_microsoft_transcript(record, job):
    from django.core.cache import cache
    try:
        value = cache.get(_key(_cache_identity(record, job)))
        return value.get('transcript') if value else None
    except (ValueError, KeyError, TypeError):
        return None
    except Exception:
        log.warning('Coaching transcript cache unavailable; saved evidence remains usable.')
        return None


def _content(base, artifact_id):
    from .views import get_graph_settings, microsoft_graph_token
    graph = get_graph_settings()['base_url'].rstrip('/')
    if urlsplit(graph).scheme != 'https' or urlsplit(graph).hostname != 'graph.microsoft.com':
        raise ValueError('Microsoft transcript transport is unavailable.')
    target = f"{graph}/{base}/transcripts/{quote(artifact_id, safe='')}/content"
    request = http.Request(target, headers={'Authorization': f'Bearer {microsoft_graph_token()}',
        'Accept': 'text/vtt'}, method='GET')
    with http.build_opener(RecordingRedirect()).open(request, timeout=15) as response:
        content = response.read(MAX_BYTES + 1)
    if len(content) > MAX_BYTES:
        raise ValueError('Transcript exceeds the limit.')
    text = content.decode('utf-8-sig')
    if not text.lstrip().startswith('WEBVTT'):
        raise ValueError('Microsoft returned an invalid transcript format.')
    return text


def microsoft_transcript(record, job):
    """Explicit transcript action only. Reopening/downloading reuses cached text."""
    from django.core.cache import cache
    try:
        context, base = _context(record, job)
        if session_window(record)[1] > timezone.now():
            raise ValueError('The meeting has not ended.')
        identity = _cache_identity(record, job)
    except (ValueError, KeyError, TypeError):
        return {'state': 'unavailable', 'code': 'meeting_identity_pending', 'transcript': None}

    def read():
        from .views import get_graph_settings, microsoft_graph_request
        deadline, calls = monotonic() + 30, 0
        def get(method, path):
            nonlocal calls
            if method != 'GET' or not path.startswith(base + '/transcripts'):
                raise ValueError('Transcript pagination changed meeting identity.')
            if calls >= 4 or monotonic() >= deadline:
                raise TimeoutError('Transcript metadata budget exceeded.')
            calls += 1
            return microsoft_graph_request(method, path)
        try:
            rows = collection(get, base + '/transcripts', get_graph_settings()['base_url'])
            window = session_window(record)
            rows = occurrence_parts(rows, window, anchors=[artifact_metadata(row)
                for row in job.result.get('artifacts',[])])
            if not rows:
                return {'state': 'missing', 'code': 'no_transcript', 'transcript': None}
            if len(rows) > 20:
                raise ValueError('Too many transcript parts.')
            parts = []
            for row in sorted(rows, key=lambda item: item['createdDateTime']):
                if monotonic() >= deadline:
                    raise TimeoutError('Transcript read budget exceeded.')
                parts.append(recent_read('transcript-part', [get_graph_settings(),base,row['id'],
                    row.get('createdDateTime'),row.get('endDateTime')],
                    lambda row=row: _content(base, row['id']), timeout=600))
                if sum(len(part.encode('utf8')) for part in parts)>8*MAX_BYTES:
                    raise ValueError('Combined transcript exceeds the limit.')
            return {'state': 'available', 'code': 'verified', 'transcript': {
                'content': '\n\n'.join(dict.fromkeys(parts)), 'durationSeconds': None,
                'updatedAt': timezone.now().isoformat(), 'source': 'microsoft', 'partCount':len(set(parts))}}
        except Exception as error:
            failure = calendar_failure(error)
            codes = {'calendar_access_denied': 'microsoft_access_denied',
                     'calendar_throttled': 'microsoft_throttled', 'calendar_timeout': 'microsoft_timeout'}
            return {'state': 'unavailable', 'code': codes.get(failure['code'], 'microsoft_unavailable'), 'transcript': None}
    # A provider denial/timeout must not make the explicit Retry button replay
    # the same failure after Microsoft has recovered. Successful/missing reads
    # still share their short cache and verified content keeps its own cache.
    value = recent_read('transcript-provider-v2', identity, read,
                        cache_if=lambda result: result['state'] != 'unavailable', timeout=60)
    if value['state'] == 'available':
        try:
            # A failed additional check must not erase already verified text
            # that the drawer and PDF download can still use.
            cache.set(_key(identity), value, timeout=600)
        except Exception:
            log.warning('Coaching transcript cache unavailable; returning the verified read.')
    return value
