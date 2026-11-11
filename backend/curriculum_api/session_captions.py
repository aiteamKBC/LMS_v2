"""Attach saved lecture captions through the existing session worker.

The import's JSON journal owns the lease and receipt. No new scheduler, public
callback, transcription service, video upload or schema is required.
"""
import hashlib
import logging
import uuid
from time import monotonic

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from .bunny_stream import BunnyStream, VideoImportError
from .caption_tracks import recording_captions
from .models import CurriculumVideoImport

log = logging.getLogger(__name__)
LABEL = 'English (LMS transcript)'
JOURNAL = 'lmsEnglishCaptions'


def _waiting(asset_id, video_id):
    with transaction.atomic():
        asset = CurriculumVideoImport.objects.select_for_update().get(pk=asset_id)
        previous = asset.scope.get(JOURNAL, {})
        now = timezone.now().timestamp()
        if (asset.status != 'ready' or asset.video_id != video_id
                or previous.get('state') in ('ready', 'retained') or previous.get('retryAfter', 0) > now):
            return
        asset.scope = {**asset.scope, JOURNAL: {'state': 'waiting', 'videoId': video_id,
            'libraryId': asset.library_id, 'retryAfter': now + 300, 'updatedAt': timezone.now().isoformat()}}
        asset.save(update_fields=['scope', 'updated_at'])


def sync_pending_captions(*, limit=10, series_ids=()):
    """Bounded work on each existing worker pass, independent of Graph sync age."""
    from .session_results import read
    pending = CurriculumVideoImport.objects.filter(target_kind='live_session', status='ready').filter(
        Q(scope__lmsEnglishCaptions__state__isnull=True) | ~Q(scope__lmsEnglishCaptions__state__in=['ready', 'retained']))
    pending = pending.filter(Q(scope__lmsEnglishCaptions__retryAfter__isnull=True)
                             | Q(scope__lmsEnglishCaptions__retryAfter__lte=timezone.now().timestamp()))
    if series_ids:
        pending = pending.filter(target_id__in=series_ids)
    candidates = list(pending.order_by('updated_at')[:max(0, min(limit, 50))])
    checked = 0
    deadline = monotonic() + 20
    for asset in candidates:
        if monotonic() >= deadline:
            break
        if asset.scope.get(JOURNAL, {}).get('retryAfter', 0) > timezone.now().timestamp():
            continue
        artifacts = read('''SELECT a.* FROM curriculum.live_session_artifacts a
            JOIN curriculum.live_session_occurrences o ON o.id=a.occurrence_id
            JOIN curriculum.live_sessions s ON s.id=o.live_session_id
            JOIN curriculum.modules m ON m.module_catalogue_id=s.module_catalogue_id
            WHERE o.live_session_id=%s AND o.id=%s AND s.module_catalogue_id=%s
              AND m.deleted_at IS NULL AND NOT coalesce(m.is_programme_deleted,false)
              AND s.status NOT IN ('deleted','cancelled','superseded','failed')
              AND o.status NOT IN ('deleted','cancelled','superseded')''',
            [asset.target_id, asset.scope.get('occurrence_id'), asset.scope.get('module_id')])
        if artifacts:
            sync_series_captions(asset.target_id, artifacts)
        # Rotate unavailable or not-yet-published transcripts as well; an old
        # recording without a transcript must not starve later ready videos.
        _waiting(asset.pk, asset.video_id)
        checked += 1
    return checked


def _claim(asset_id, digest, video_id, *, expected_scope=None):
    now = timezone.now().timestamp()
    with transaction.atomic():
        asset = CurriculumVideoImport.objects.select_for_update().get(pk=asset_id)
        previous = asset.scope.get(JOURNAL, {})
        if expected_scope and any(asset.scope.get(key) != expected_scope.get(key) for key in
                ('series_id', 'occurrence_id', 'graph_artifact_id', 'module_id', 'programme_id', 'cohort_id', 'group_id')):
            return None
        if asset.status != 'ready' or asset.video_id != video_id:
            return None
        if (previous.get('digest') == digest and previous.get('videoId') == video_id
                and previous.get('libraryId') == asset.library_id):
            if previous.get('state') in ('ready', 'retained') or previous.get('retryAfter', 0) > now:
                return None
        if previous.get('state') == 'processing' and previous.get('retryAfter', 0) > now:
            return None
        claim = {'state': 'processing', 'videoId': video_id, 'libraryId': asset.library_id, 'digest': digest,
                 'lease': uuid.uuid4().hex, 'retryAfter': now + 300, 'updatedAt': timezone.now().isoformat()}
        asset.scope = {**asset.scope, JOURNAL: claim}
        asset.save(update_fields=['scope', 'updated_at'])
        return asset, claim


def _finish(asset_id, claim, state):
    with transaction.atomic():
        asset = CurriculumVideoImport.objects.select_for_update().get(pk=asset_id)
        if (asset.status != 'ready' or asset.video_id != claim['videoId'] or asset.library_id != claim['libraryId']
                or asset.scope.get(JOURNAL, {}).get('lease') != claim['lease']):
            return
        receipt = {**claim, 'state': state, 'updatedAt': timezone.now().isoformat(),
                   'retryAfter': timezone.now().timestamp() + 300 if state == 'failed' else 0}
        asset.scope = {**asset.scope, JOURNAL: receipt}
        asset.save(update_fields=['scope', 'updated_at'])


def sync_series_captions(series_id, artifacts):
    """Best effort per-video jobs. Failure never marks a playable video failed."""
    recordings = {row['id']: row for row in artifacts if row.get('artifact_type') == 'recording'}
    if not recordings or not any(row.get('artifact_type') == 'transcript' for row in artifacts):
        return
    assets = CurriculumVideoImport.objects.filter(target_kind='live_session', target_id=series_id, status='ready')
    for asset in assets.iterator():
        recording = recordings.get(asset.component_id)
        if (not recording or asset.scope.get('series_id') != series_id
                or asset.scope.get('occurrence_id') != recording.get('occurrence_id')
                or asset.scope.get('graph_artifact_id') != recording.get('graph_artifact_id')):
            continue
        siblings = [row for row in artifacts if row.get('occurrence_id') == recording['occurrence_id']]
        content = recording_captions(recording, siblings)
        if not content:
            _waiting(asset.pk, asset.video_id)
            continue
        digest = hashlib.sha256(content.encode('utf-8')).hexdigest()
        claimed = _claim(asset.pk, digest, asset.video_id, expected_scope=asset.scope)
        if not claimed:
            continue
        current, claim = claimed
        try:
            client = BunnyStream(current.library_id)
            remote = client.video(current.video_id, timeout=(3, 8))
            if remote.get('guid') != current.video_id:
                raise VideoImportError('The caption video identity could not be verified.')
            existing = [row for row in remote.get('captions', []) if row.get('srclang') == 'en']
            if any(row.get('label') != LABEL for row in existing):
                _finish(current.pk, claim, 'retained')
                continue
            client.caption(current.video_id, content, label=LABEL)
            _finish(current.pk, claim, 'ready')
        except Exception as failure:
            _finish(current.pk, claim, 'failed')
            log.warning('English captions for import %s will retry (%s).', asset.pk, type(failure).__name__)
