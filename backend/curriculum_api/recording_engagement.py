"""Read-only video insights; never change learning hours or completion evidence."""
import hashlib
import logging
import math
from datetime import timedelta

from django.core.cache import cache
from django.utils import timezone

from .bunny_stream import BunnyStream, playback_url
from .recording_views import FULL_WATCH_SLACK_RATIO, FULL_WATCH_SLACK_SECONDS, _recording_identity
from .session_bunny_policy import bunny_recording
from .session_results import read

log = logging.getLogger(__name__)


def _bunny_statistics(saved):
    if not saved:
        return {'state': 'not-applicable'}
    library, video = saved.get('libraryId'), saved.get('videoId')
    try:
        playback_url(library, video)  # Never accidentally request library-wide statistics.
    except Exception:
        return {'state': 'unavailable'}
    now = timezone.now()
    key = 'video-insights:v1:' + hashlib.sha256(f'{library}:{video}:{now.date()}'.encode()).hexdigest()
    try:
        cached = cache.get(key)
        if cached is not None:
            return cached
    except Exception:
        log.warning('Video insights cache is unavailable.')
    try:
        result = BunnyStream(library).request('GET', '/statistics', params={
            'videoGuid': video, 'dateFrom': (now - timedelta(days=30)).isoformat(),
            'dateTo': now.isoformat(), 'hourly': 'false'}, timeout=(3, 8))
        chart = result.get('viewsChart')
        if not isinstance(chart, dict) or len(chart) > 64:
            raise ValueError('Invalid video statistics.')
        daily = []
        for day, value in sorted(chart.items()):
            if not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
                raise ValueError('Invalid view count.')
            daily.append({'date': str(day), 'views': int(value)})
        score = result.get('engagementScore')
        data = {'state': 'available', 'periodDays': 30, 'views': sum(item['views'] for item in daily),
                'dailyViews': daily, 'engagementScore': score if isinstance(score, (int, float)) and 0 <= score <= 100 else None,
                'updatedAt': now.isoformat()}
    except Exception:
        # An unavailable provider is not zero views. It cannot hide the local evidence.
        data = {'state': 'unavailable'}
        log.warning('Bunny video insights could not be read.')
    try:
        cache.set(key, data, 300 if data['state'] == 'available' else 30)
    except Exception:
        log.warning('Video insights could not be cached.')
    return data


def recording_engagement(series_id, recording, *, learner_view):
    artifacts = read('''SELECT a.* FROM curriculum.live_session_artifacts a
        JOIN curriculum.live_session_occurrences o ON o.id=a.occurrence_id
        WHERE o.live_session_id=%s AND a.occurrence_id=%s AND a.artifact_type='recording' ''',
        [series_id, recording['occurrence_id']])
    source = next((row for row in artifacts if row['id'] == recording['artifact_id']), None)
    if source is None:
        return None
    bunny = bunny_recording(source.get('metadata'))
    def same_video(row):
        other = bunny_recording(row.get('metadata'))
        return ((other.get('libraryId'), other.get('videoId')) == (bunny.get('libraryId'), bunny.get('videoId'))
                if bunny.get('libraryId') and bunny.get('videoId') else _recording_identity(row) == _recording_identity(source))
    aliases = [row['id'] for row in artifacts if same_video(row)]
    # The table is populated by the existing authorised learner player, not staff previews.
    rows = read('''SELECT learner_kind,learner_id,watched_seconds,duration_seconds,last_heartbeat_at
        FROM curriculum.live_session_recording_views
        WHERE live_session_id=%s AND occurrence_id=%s AND artifact_id=ANY(%s)''',
        [series_id, recording['occurrence_id'], aliases])
    people = {}
    for row in rows:
        watched, duration = max(0, int(row.get('watched_seconds') or 0)), max(0, int(row.get('duration_seconds') or 0))
        if watched <= 0:
            continue
        identity = (row['learner_kind'], str(row['learner_id']))
        previous = people.setdefault(identity, {'watched': 0, 'finished': False})
        previous['watched'] = max(previous['watched'], watched)
        # Same saved-watch tolerance as the existing recording rule. No attendance inference.
        previous['finished'] |= duration > 0 and watched + max(FULL_WATCH_SLACK_SECONDS, duration * FULL_WATCH_SLACK_RATIO) >= duration
    watched, finished = len(people), sum(person['finished'] for person in people.values())
    if learner_view:
        # Suppress small counts on the server as well as in the UI. Never return staff detail.
        return {'audience': 'learner', 'highlights': {
            'watched': watched if watched >= 10 else None,
            'finished': finished if finished >= 5 else None}}
    return {'audience': 'staff', 'learners': watched, 'finished': finished,
            'completionPercent': round(finished * 100 / watched) if watched else None,
            'watchedSeconds': sum(person['watched'] for person in people.values()),
            'updatedAt': timezone.now().isoformat(), 'provider': _bunny_statistics(bunny)}
