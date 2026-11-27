"""Retry the same recording import independently of meeting discovery.

The existing worker drains this queue. Retry state lives with the import so a
process restart retains both its delay and its original Microsoft/Bunny identity.
No maximum attempt count can strand an otherwise recoverable recording.
"""
from datetime import timedelta, timezone as datetime_timezone
import logging

from django.db.models import Q
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from .models import CurriculumVideoImport

KINDS = ('coach_recording', 'live_session')
STATES = ('queued', 'processing', 'uploading', 'failed')
logger = logging.getLogger(__name__)


def clock():
    return timezone.now()


def _stamp(value):
    return value.astimezone(datetime_timezone.utc).isoformat(timespec='microseconds')


def due(asset, now=None):
    """Recheck under the import lock; another entry point must respect backoff."""
    state = asset.scope.get('recording_retry') or {}
    try:
        next_at = parse_datetime(state.get('next_at') or '')
    except (TypeError, ValueError, AttributeError):
        next_at = None
    return not next_at or timezone.is_naive(next_at) or next_at <= (now or clock())


def schedule(asset):
    """Persist only retry metadata, leaving source, destination and GUID intact."""
    scope = dict(asset.scope)
    previous = scope.get('recording_retry') or {}
    if asset.status in ('ready', 'superseded'):
        scope.pop('recording_retry', None)
    else:
        try:
            failures = max(0, int(previous.get('failures', 0)))
        except (TypeError, ValueError, AttributeError):
            failures = 0
        if asset.status == 'failed':
            failures += 1
            delay = min(3600, 60 * 2 ** min(failures - 1, 6))
        else:
            # Encoding is polled, not uploaded again. Transient failure backoff
            # remains bounded at one hour, even after many worker restarts.
            delay = 60
        scope['recording_retry'] = {
            'failures': failures,
            'next_at': _stamp(clock() + timedelta(seconds=delay)),
        }
    asset.scope = scope


def run_pending(limit=10, *, kinds=KINDS, series_ids=()):
    from .video_imports import process

    kinds = tuple(kind for kind in kinds if kind in KINDS)
    if not kinds:
        return 0
    now = clock()
    rows = CurriculumVideoImport.objects.filter(target_kind__in=kinds, status__in=STATES).filter(
        Q(lease_until__isnull=True) | Q(lease_until__lte=now),
    ).filter(Q(scope__recording_retry__next_at__isnull=True)
             | Q(scope__recording_retry__next_at__lte=_stamp(now)))
    if series_ids:
        rows = rows.filter(target_kind='live_session', target_id__in=series_ids)
    ids = list(rows.order_by('updated_at', 'id').values_list('pk', flat=True)[:max(1, min(limit, 100))])
    for import_id in ids:
        try:
            process(import_id)
        except Exception as failure:
            # Database outages leave the durable record/lease for the next run.
            # Never log upstream exception text, signed URLs or bearer tokens.
            logger.warning('Recording import %s needs retry (%s).', import_id, type(failure).__name__)
    return len(ids)
