"""New coaching recordings share the existing durable video worker, not another uploader."""
from datetime import date, datetime, time, timedelta
import hashlib
import json
import logging
import os
import re
import uuid
from urllib.parse import quote
from zoneinfo import ZoneInfo

from django.conf import settings
from django.db import router, transaction
from django.db.models import Q
from django.utils import timezone

from curriculum_api.bunny_stream import BunnyStream, MissingProgrammeCollection, VideoImportError, library_secret
from curriculum_api.models import CurriculumVideoImport
from curriculum_api.session_bunny_policy import signed_embed
from .models import CoachingRecordingJob
from .recordings_calendar import _instant
from .recordings_calendar_media import calendar_key, calendar_record, event_context

KIND = 'coach_recording'
COLLECTION_KIND = 'coach_collection'
CUTOVER_DAY = date(2026, 11, 26)
log = logging.getLogger(__name__)


def enabled():
    return os.environ.get('BUNNY_COACH_RECORDING_UPLOADS_ENABLED', '').lower() in ('true', '1', 'yes')


def eligible(context):
    start = _instant(context.get('start'))
    cutoff = datetime.combine(CUTOVER_DAY, time.min, ZoneInfo(settings.TIME_ZONE))
    return start is not None and start >= cutoff


def library_id():
    value = os.environ.get('BUNNY_COACH_STREAM_LIBRARY_ID', '').strip()
    if (not value.isdigit() or value in (os.environ.get('BUNNY_STREAM_LIBRARY_ID', '798153').strip(),
                                       os.environ.get('BUNNY_LIVE_STREAM_LIBRARY_ID', '796471').strip())):
        raise VideoImportError('The separate Coaches library is not configured.')
    if not library_secret(value, 'API_KEY') or not library_secret(value, 'TOKEN_KEY'):
        raise VideoImportError('Coaches library API and playback keys are required.')
    return value


def _digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


def queue_coach(coach):
    owner = str(coach.get('email') or '').strip().casefold()
    if not owner or '@' not in owner:
        raise VideoImportError('A saved coach identity is required.')
    library = library_id()
    fingerprint = _digest(['coach-collection-v1', library, owner])
    name = ' '.join(str(coach.get('name') or owner).split())[:180]
    row, _ = CurriculumVideoImport.objects.get_or_create(fingerprint=fingerprint, defaults={
        'id': uuid.uuid5(uuid.NAMESPACE_URL, fingerprint), 'target_kind': COLLECTION_KIND,
        'target_id': _digest(owner), 'component_id': '', 'library_id': library,
        'title': name, 'scope': {'owner_email': owner, 'collection_name': f'{name} [Coach:{_digest(owner)[:16]}]'},
    })
    if row.target_kind != COLLECTION_KIND or row.scope.get('owner_email') != owner or row.library_id != library:
        raise VideoImportError('The saved coach collection belongs to another identity.')
    return row


def ensure_collection(row, client):
    row.refresh_from_db()
    if row.target_kind != COLLECTION_KIND or str(client.library_id) != row.library_id:
        raise VideoImportError('The coach collection destination is invalid.')
    if row.collection_id:
        return row.collection_id
    name = row.scope['collection_name']
    try:
        destination = client.collection(row.target_id, name)
    except MissingProgrammeCollection:
        destination = ''
    if not destination:
        with transaction.atomic():
            current = CurriculumVideoImport.objects.select_for_update().get(pk=row.pk)
            if current.collection_id:
                return current.collection_id
            if current.scope.get('collection_create_pending'):
                raise VideoImportError('Coach collection creation awaits confirmation; no duplicate was created.')
            current.scope = {**current.scope, 'collection_create_pending': True}
            current.save(update_fields=['scope', 'updated_at'])
        destination = client.create_programme_collection(row.target_id, name)
    with transaction.atomic():
        current = CurriculumVideoImport.objects.select_for_update().get(pk=row.pk)
        if current.collection_id and current.collection_id != destination:
            raise VideoImportError('The coach has conflicting collections. Review is required.')
        current.collection_id, current.status, current.error = destination, 'ready', ''
        current.scope.pop('collection_create_pending', None)
        current.save(update_fields=['collection_id', 'status', 'error', 'scope', 'updated_at'])
    return destination


def enqueue_evidence(job, artifacts):
    """No Microsoft/Bunny calls; retries recover the same import IDs."""
    if not enabled() or not eligible(job.context):
        return artifacts
    from .recordings_parts import occurrence_parts, artifact_metadata
    context = job.context
    base = job.result.get('base') or ''
    if context.get('owner') != job.owner_email or not re.fullmatch(r'users/[^/]+/onlineMeetings/[^/?]+', base):
        raise VideoImportError('The verified coaching meeting identity is missing.')
    window = (_instant(context['start']), _instant(context['end']))
    selected = occurrence_parts([artifact_metadata(item) for item in artifacts], window)
    ids = {item['id'] for item in selected}
    output = []
    for artifact in artifacts:
        if artifact['graph_artifact_id'] not in ids:
            raise VideoImportError('The recording belongs to another coaching occurrence.')
        source = 'https://graph.microsoft.com/v1.0/' + base + '/recordings/' + quote(artifact['graph_artifact_id'], safe='') + '/content'
        event_key = calendar_key(context)
        fingerprint = _digest(['coach-recording-v1', library_id(), event_key, artifact['graph_artifact_id']])
        asset, _ = CurriculumVideoImport.objects.get_or_create(fingerprint=fingerprint, defaults={
            'id': uuid.uuid5(uuid.NAMESPACE_URL, fingerprint), 'target_kind': KIND,
            'target_id': event_key, 'component_id': _digest(artifact['graph_artifact_id']),
            'source_url': source, 'source_at_start': source, 'title': 'Coaching meeting ' + context['start'],
            'library_id': library_id(), 'scope': {'context': context, 'owner_email': job.owner_email,
                'event_key': event_key, 'evidence_job': job.pk, 'microsoft_base': base,
                'graph_artifact_id': artifact['graph_artifact_id']},
        })
        if asset.target_kind != KIND or asset.source_at_start != source or asset.scope.get('context') != context:
            raise VideoImportError('The saved coaching recording scope changed.')
        output.append({**artifact, 'lmsBunnyRecording': projection(asset)})
    return output


def retain_ready(job, artifacts):
    """Microsoft retention must not erase a completed, verified Bunny recording."""
    found = {item['graph_artifact_id'] for item in artifacts}
    retained = []
    for item in job.result.get('artifacts', []):
        saved = item.get('lmsBunnyRecording') or {}
        if item['graph_artifact_id'] in found or saved.get('state') != 'ready':
            continue
        asset = CurriculumVideoImport.objects.filter(pk=saved.get('importId'), target_kind=KIND,
            target_id=calendar_key(job.context), status='ready', video_id=saved.get('videoId'),
            library_id=saved.get('libraryId')).first()
        if (asset and asset.scope.get('context') == job.context and asset.scope.get('evidence_job') == job.pk
                and asset.scope.get('graph_artifact_id') == item['graph_artifact_id']
                and asset.scope.get('playback_verified_video_id') == asset.video_id):
            retained.append({**item, 'sourceAvailable': False})
    return artifacts + retained


def projection(asset):
    return {'state': 'ready' if asset.status == 'ready' else 'failed' if asset.status == 'failed' else 'pending',
            'libraryId': asset.library_id, 'videoId': asset.video_id, 'collectionId': asset.collection_id,
            'importId': str(asset.pk), 'updatedAt': asset.updated_at.isoformat()}


def publish(asset):
    database = router.db_for_write(CoachingRecordingJob) or 'default'
    with transaction.atomic(using=database):
        job = CoachingRecordingJob.objects.select_for_update().get(pk=asset.scope['evidence_job'])
        if job.owner_email != asset.scope['owner_email'] or job.context != asset.scope['context']:
            raise VideoImportError('The coaching evidence owner changed.')
        if not any(item.get('graph_artifact_id') == asset.scope['graph_artifact_id']
                   for item in job.result.get('artifacts', [])):
            raise VideoImportError('The coaching recording is no longer present in its saved occurrence.')
        files = [{**item, 'lmsBunnyRecording': projection(asset)}
                 if item['graph_artifact_id'] == asset.scope['graph_artifact_id'] else item
                 for item in job.result.get('artifacts', [])]
        job.result = {**job.result, 'artifacts': files}
        job.save(update_fields=['result', 'updated_at'])
    # The calendar projection cache is versioned by last_success_at, so evict
    # only this meeting's media entry without changing its discovery timestamp.
    from .recordings_jobs import evict_media
    evict_media(job)


def transfer(asset):
    from .recordings_api import _coaches
    from .recordings_calendar_sync import graph_target
    from .views import microsoft_graph_request
    from curriculum_api.recording_direct_fetch import transfer_direct
    coaches = {item['email']: item for item in _coaches()}
    context = asset.scope['context']
    if not enabled() or not eligible(context) or asset.scope['owner_email'] not in coaches:
        raise VideoImportError('This coaching recording is outside the enabled owner and date scope.')
    if asset.library_id != library_id() or asset.target_id != calendar_key(context):
        raise VideoImportError('The coaching recording destination changed.')
    job = CoachingRecordingJob.objects.get(pk=asset.scope['evidence_job'], owner_email=asset.scope['owner_email'])
    if job.context != context or job.result.get('base') != asset.scope['microsoft_base']:
        raise VideoImportError('The saved coaching meeting identity changed.')
    event = microsoft_graph_request('GET', f'users/{quote(context["owner"], safe="")}/events/{quote(context["event"], safe="")}'
        '?$select=id,start,end,organizer,onlineMeeting,onlineMeetingUrl,body,isCancelled',
        extra_headers={'Prefer': 'outlook.timezone="UTC"'})
    try:
        current_context = event_context(context['owner'], event)
    except (ValueError, TypeError, KeyError):
        raise VideoImportError('The coaching occurrence no longer has its saved schedule.') from None
    if event.get('isCancelled') or current_context['event'] != context['event']:
        raise VideoImportError('The coaching occurrence was cancelled or rescheduled.')
    if current_context != context:
        # A completed call keeps its original occurrence when somebody later
        # moves this same calendar event. Require the previously successful,
        # exact original snapshot; never reinterpret a future/rescheduled slot.
        try:
            original = job.result.get('event') or {}
            historical = (job.last_success_at and not original.get('isCancelled')
                and event_context(context['owner'], original) == context
                and job.last_success_at >= _instant(context['start'])
                and _instant(context['end']) <= timezone.now())
        except (ValueError, TypeError, KeyError):
            historical = False
        if not historical:
            raise VideoImportError('The coaching occurrence was cancelled or rescheduled.')
    base, organizer = graph_target(context, event)
    if base != job.result['base']:
        raise VideoImportError('The coaching Teams meeting changed.')
    artifact = next((item for item in job.result.get('artifacts', [])
                     if item['graph_artifact_id'] == asset.scope['graph_artifact_id']), None)
    if artifact is None or asset.source_url != asset.source_at_start:
        raise VideoImportError('The coaching source recording is no longer linked.')
    from .recordings_parts import occurrence_parts
    current = microsoft_graph_request('GET', base + '/recordings/' + quote(asset.scope['graph_artifact_id'], safe=''))
    window = (_instant(context['start']), _instant(context['end']))
    belongs = current.get('id') == asset.scope['graph_artifact_id'] and occurrence_parts([current], window)
    if current.get('id') == asset.scope['graph_artifact_id'] and not belongs:
        # Early/restarted recording parts can sit outside the timetable. Only a
        # fresh complete Graph list may anchor their shared physical call ID.
        from curriculum_api.session_graph import collection
        from .views import get_graph_settings
        parts = collection(microsoft_graph_request, base + '/recordings', get_graph_settings()['base_url'])
        target = next((part for part in parts if part.get('id') == current['id']), None)
        identity_fields = ('id', 'callId', 'contentCorrelationId', 'createdDateTime', 'endDateTime')
        if target and all(target.get(field) == current.get(field) for field in identity_fields):
            belongs = occurrence_parts([current], window, anchors=parts)
    if not belongs:
        raise VideoImportError('Microsoft no longer associates this recording with the saved coaching occurrence.')
    if current_context != context:
        asset.scope = {**asset.scope, 'original_occurrence_retained': True}
    client = BunnyStream(asset.library_id)
    collection = queue_coach(coaches[asset.scope['owner_email']])
    asset.collection_id = ensure_collection(collection, client)
    asset.save(update_fields=['collection_id', 'scope', 'updated_at'])
    video = transfer_direct(asset, client, asset.source_url, {**artifact, 'organizer_email': organizer})
    asset.status = 'ready' if video and video.get('status') == 4 else 'processing'
    if asset.status == 'ready':
        resolutions = [value.strip() for value in str(video.get('availableResolutions') or '').split(',') if value.strip()]
        if len(resolutions) != 1 or resolutions[0] not in ('240p', '360p', '480p', '720p'):
            raise VideoImportError('Coaches recordings require one encoded resolution, up to 720p. Review this library before publication.')
        client.verify_embed(signed_embed(asset.library_id, asset.video_id),
            referrer='https://lms.kentbusinesscollege.org/')
        asset.scope = {**asset.scope, 'playback_verified_video_id': asset.video_id}
        asset.save(update_fields=['scope', 'updated_at'])
        refresh_captions(asset, job=job, artifact=artifact, client=client)


def refresh_captions(asset, *, job=None, artifact=None, client=None):
    """Late transcripts retry independently; never invalidate a playable video."""
    from .recordings_transcripts import recording_captions
    if asset.scope.get('captions_state') == 'ready':
        return
    try:
        job = job or CoachingRecordingJob.objects.get(pk=asset.scope['evidence_job'])
        if job.context != asset.scope['context'] or job.owner_email != asset.scope['owner_email']:
            raise VideoImportError('The caption occurrence identity changed.')
        artifact = artifact or next(item for item in job.result.get('artifacts', [])
            if item['graph_artifact_id'] == asset.scope['graph_artifact_id'])
        content = asset.scope.get('microsoft_captions_vtt') or recording_captions(calendar_record(job.context), job, artifact)
        if content:
            asset.scope = {**asset.scope, 'microsoft_captions_vtt': content}
            asset.save(update_fields=['scope', 'updated_at'])
            (client or BunnyStream(asset.library_id)).caption(asset.video_id, content, label='English (Microsoft Teams)')
        state = 'ready' if content else 'pending'
    except Exception:
        state = 'failed'
    asset.scope = {**asset.scope, 'captions_state': state,
                   'captions_next_check': (timezone.now() + timedelta(hours=1)).isoformat()}
    asset.save(update_fields=['scope', 'updated_at'])


def saved_transcript(record, job):
    """Read only already verified text for this authorized owner and occurrence."""
    if not job or not any(item.get('lmsBunnyRecording') for item in job.result.get('artifacts', [])):
        return None
    from .recordings_media import session_window
    from .recordings_calendar_media import calendar_context
    start, end = session_window(record)
    context = calendar_context(record.owner_email, record.graph_event_id, start, end)
    if context != job.context or record.event_key != calendar_key(context):
        raise ValueError('The saved transcript occurrence changed.')
    ids = {item['graph_artifact_id'] for item in job.result.get('artifacts', [])}
    rows = CurriculumVideoImport.objects.filter(target_kind=KIND, target_id=record.event_key,
        scope__owner_email=record.owner_email, scope__evidence_job=job.pk).order_by('created_at')
    parts, stamps = [], []
    for asset in rows:
        text = asset.scope.get('microsoft_captions_vtt')
        if (asset.scope.get('context') == context and asset.scope.get('graph_artifact_id') in ids
                and isinstance(text, str) and text.lstrip().startswith('WEBVTT')):
            parts.append(text)
            stamps.append(asset.updated_at)
    if not parts:
        return None
    return {'content': '\n\n'.join(dict.fromkeys(parts)), 'source': 'lms', 'durationSeconds': None,
            'partCount': len(set(parts)), 'updatedAt': max(stamps).isoformat()}


def playback(job, artifact):
    """Called only after the existing endpoint has authorized this occurrence."""
    saved = artifact.get('lmsBunnyRecording') or {}
    if not saved:
        return None
    asset = CurriculumVideoImport.objects.filter(pk=saved.get('importId'), target_kind=KIND,
        target_id=calendar_key(job.context), library_id=saved.get('libraryId'), video_id=saved.get('videoId')).first()
    if (not asset or asset.scope.get('evidence_job') != job.pk or asset.scope.get('context') != job.context
            or asset.scope.get('graph_artifact_id') != artifact['graph_artifact_id']):
        raise VideoImportError('The coaching player belongs to another recording scope.')
    if asset.status != 'ready' or asset.scope.get('playback_verified_video_id') != asset.video_id:
        raise VideoImportError('This coaching recording is still being prepared.')
    return {'kind': 'bunny', 'url': signed_embed(asset.library_id, asset.video_id),
            'libraryId': asset.library_id, 'videoId': asset.video_id}


def run_pending(limit=10):
    """Invoked by the existing session worker; also discovers newly added coaches."""
    if not enabled():
        return 0
    limit = max(1, min(limit, 100))
    from .recordings_api import _coaches
    from .recordings_jobs import ensure_jobs, run_one
    from curriculum_api.recording_retry import run_pending as retry_recordings
    now = timezone.now()
    start = datetime.combine(CUTOVER_DAY, time.min, ZoneInfo(settings.TIME_ZONE))
    # Monthly windows bound Graph scans and include all unobserved days since
    # cutover. Saved jobs continue refreshing, even if nobody opens Quality.
    for coach in _coaches():
        row = queue_coach(coach)
        try:
            ensure_collection(row, BunnyStream(row.library_id))
        except VideoImportError as failure:
            row.error = str(failure)
            row.save(update_fields=['error', 'updated_at'])
        cursor = start
        while cursor <= now:
            end = cursor + timedelta(days=28)
            ensure_jobs([('calendar', {'owner': coach['email'], 'start': cursor.isoformat(), 'end': end.isoformat()})])
            cursor += timedelta(days=28)
    for _ in range(limit):
        if run_one(('calendar', 'evidence')) is None:
            break
    checked = retry_recordings(limit=limit, kinds=(KIND,))
    captions = CurriculumVideoImport.objects.filter(target_kind=KIND, status='ready').exclude(scope__captions_state='ready').filter(
        Q(scope__captions_next_check__isnull=True) | Q(scope__captions_next_check__lte=now.isoformat())).order_by('updated_at')[:limit]
    for row in captions:
        refresh_captions(row)
    return checked
