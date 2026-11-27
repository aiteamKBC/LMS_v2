"""Live-session imports using the existing durable Bunny journal and worker.

Microsoft is the only transfer source. Existing Azure references are retained
for rollback, but neither transfer nor Bunny playback reads those files.
"""
import hashlib
import json
import os
import uuid
import logging
import re
from time import sleep, time
from urllib.parse import quote, parse_qs, urlsplit
from zoneinfo import ZoneInfo

from django.db import connections, transaction

from .bunny_stream import BunnyStream, VideoImportError, VideoUploadConflict, playback_url, video_title
from .models import CurriculumVideoImport
from .session_bunny_policy import BUNNY_CONTAINER, bunny_recording, signed_embed
from .session_recording_source import download_recording, resolve_recording_download
from .session_results_policy import instant
from .session_transfer_progress import TransferProgress
from .live_recording_routing import new_recording_library

log = logging.getLogger(__name__)


def _find_import(asset, client):
    retired = asset.scope.get('interrupted_upload_ids', [])
    return (client.find_import(asset.id, exclude_video_ids=retired) if retired
            else client.find_import(asset.id))


def _transient_bunny_error(failure):
    return ('could not be reached' in str(failure)
            or any(f'HTTP {status}.' in str(failure) for status in (408, 429, 500, 502, 503, 504)))


def _retire_empty_failed_upload(asset, video):
    """Retain a confirmed empty failed GUID and replace only its upload identity.

    Bunny refuses another PUT to an identity that has already received an
    interrupted upload. Never replace processing, playable or nonempty media.
    Save the old GUID before another create so a lost response remains recoverable.
    """
    if (not asset.video_id or video.get('guid') != asset.video_id or video.get('status') != 6
            or video.get('storageSize') != 0 or video.get('length') != 0):
        return False
    retired = list(asset.scope.get('interrupted_upload_ids') or [])
    if len(retired) >= 3:
        raise VideoImportError('Repeated Bunny uploads failed. Review the saved import before retrying.')
    if asset.video_id not in retired:
        retired.append(asset.video_id)
    asset.scope = {**asset.scope, 'interrupted_upload_ids': retired}
    asset.scope.pop('bunny_fetch_requested_at', None)
    asset.video_id = ''
    asset.save(update_fields=['scope', 'video_id', 'updated_at'])
    return True


def _prepare_and_upload(asset, client, stream):
    """Keep downloaded bytes during transient Bunny failures; reuse the GUID."""
    for attempt in range(3):
        try:
            if not asset.video_id:
                from .bunny_stream import live_library_id
                if asset.library_id == live_library_id() and asset.library_id != os.environ.get('BUNNY_STREAM_LIBRARY_ID', '798153'):
                    from .live_recording_transfer import create_video_once
                    created = create_video_once(asset, client)
                else:
                    recovered = _find_import(asset, client) if attempt or asset.scope.get('interrupted_upload_ids') else None
                    created = recovered or client.create(asset.id, asset.title, asset.collection_id, scope=asset.scope)
                if created['guid'] in asset.scope.get('interrupted_upload_ids', []):
                    raise VideoImportError('Bunny returned a previously failed upload. Review the saved import.')
                asset.video_id = created['guid']
                playback_url(asset.library_id, asset.video_id)
                asset.save(update_fields=['video_id', 'updated_at'])
            if attempt:
                # An accepted upload can outlive its response. Do not send its
                # bytes again while Bunny is already processing the same GUID.
                remote = client.video(asset.video_id)
                if remote.get('status') in (1, 2, 3, 4):
                    return
            client.metadata(asset.video_id, asset.scope, asset.title)
            stream.seek(0)
            client.upload(asset.video_id, stream)
            return
        except VideoUploadConflict:
            remote = client.video(asset.video_id)
            if remote.get('status') in (1, 2, 3, 4):
                return  # the accepted upload outlived its response
            if attempt == 2 or not _retire_empty_failed_upload(asset, remote):
                raise
        except VideoImportError as failure:
            if not _transient_bunny_error(failure) or attempt == 2:
                raise
            sleep(2 ** attempt)


def _queue_remote_fetch(asset, client, source, token, artifact):
    """Request one provider-to-provider copy; recover ambiguous POSTs by marker."""
    requested = asset.scope.get('bunny_fetch_requested_at')
    if not requested:
        download = resolve_recording_download(source, token)
        if not download:
            from .session_cloud_archive import matched_recording_download
            from coach_api.views import get_graph_settings, microsoft_graph_request
            try:
                matched = matched_recording_download(artifact, artifact.get('organizer_email'), source, token,
                    graph_get=microsoft_graph_request, graph_base=get_graph_settings()['base_url'])
            except Exception as failure:
                log.warning('SharePoint fetch source for recording %s unavailable (%s).', asset.component_id, type(failure).__name__)
                matched = None
            if not matched:
                return False
            download = matched[0]
        asset.scope = {**asset.scope, 'bunny_fetch_requested_at': time()}
        # Record the attempt before POST. A lost response must not create a
        # second copy while the first fetch is still waiting to appear.
        asset.save(update_fields=['scope', 'updated_at'])
        try:
            client.request('POST', '/videos/fetch', params={'collectionId': asset.collection_id},
                json={'url': download, 'headers': {}, 'title': video_title(asset.id, asset.title, asset.scope)})
        except VideoImportError as failure:
            if not _transient_bunny_error(failure):
                asset.scope.pop('bunny_fetch_requested_at', None)
                asset.save(update_fields=['scope', 'updated_at'])
                raise
            # It may have been accepted. Poll by the stable marker; do not POST again.
    recovered = _find_import(asset, client)
    if recovered:
        asset.video_id = recovered['guid']
        playback_url(asset.library_id, asset.video_id)
        asset.save(update_fields=['video_id', 'updated_at'])
        client.metadata(asset.video_id, asset.scope, asset.title)
    elif time() - asset.scope['bunny_fetch_requested_at'] > 10 * 60:
        raise VideoImportError('Bunny fetch could not be confirmed. Review the saved import before retrying.')
    asset.status = 'processing'
    return True


def source_identity(series, occurrence, artifact):
    from .views import teams_online_meeting_owner_id
    own_join = str(occurrence.get('join_url') or '').strip()
    series_join = str(series.get('join_url') or '').strip()
    meeting = occurrence.get('online_meeting_id') or (
        series.get('online_meeting_id') if not own_join or own_join == series_join else '')
    owner = teams_online_meeting_owner_id(series.get('organizer_email'), own_join or series_join)
    if not meeting or not owner or not artifact.get('graph_artifact_id'):
        raise VideoImportError('The stored Microsoft recording identity is incomplete.')
    path = '/'.join(quote(str(value), safe='') for value in (
        owner, 'onlineMeetings', meeting, 'recordings', artifact['graph_artifact_id'], 'content'))
    return 'https://graph.microsoft.com/v1.0/users/' + path


def enqueue_recording(series, occurrence, artifact, module):
    from .video_imports import enabled
    source = source_identity(series, occurrence, artifact)
    scope = {key: str(module.get(key) or '') for key in (
        'programme_id', 'programme_name', 'cohort_id', 'cohort_name', 'group_id', 'group_name')}
    scope.update(module_id=series['module_catalogue_id'], module_title=series.get('module_title') or module.get('title') or '',
                 series_id=series['id'], occurrence_id=occurrence['id'], artifact_id=artifact['id'],
                 graph_artifact_id=artifact['graph_artifact_id'], session_number=occurrence.get('session_number'),
                 content_correlation_id=str(artifact.get('content_correlation_id') or ''),
                 call_id=str(artifact.get('call_id') or ''))
    # Reuse the authored IDs; do not infer a week from a session's list index.
    from .session_results import read
    components = read('''SELECT id,week_id FROM curriculum.components
        WHERE module_catalogue_id=%s AND deleted_at IS NULL AND NOT coalesce(is_programme_deleted,false)
          AND coalesce(library_state,'')<>'library'
          AND (settings_json->>'teamsOccurrenceId'=%s OR
               (settings_json->>'teamsLiveSessionId'=%s AND settings_json->>'teamsSessionNumber'=%s))''',
        [series['module_catalogue_id'], occurrence['id'], series['id'], str(occurrence.get('session_number') or '')])
    scope['component_ids'] = ','.join(sorted(row['id'] for row in components))
    scope['week_ids'] = ','.join(sorted({row['week_id'] for row in components if row.get('week_id')}))
    content_identity = (scope['content_correlation_id'] + '|' + scope['call_id']) if scope['content_correlation_id'] else artifact['id']
    identity = hashlib.sha256(json.dumps([series['id'], occurrence['id'], content_identity,
        scope['programme_id'], scope['cohort_id'], scope['group_id']], separators=(',', ':')).encode()).hexdigest()
    scope['recording_identity'] = identity
    existing = CurriculumVideoImport.objects.filter(fingerprint=identity, target_kind='live_session').first()
    if not enabled():
        # Re-publish an already completed copy even if this worker cannot start
        # new transfers. A missing runtime flag must not strand saved playback.
        saved = CurriculumVideoImport.objects.filter(
            fingerprint=identity, target_kind='live_session', status='ready').first()
        if saved:
            return saved
        raise VideoImportError('Bunny recording imports are disabled; no Azure fallback was used.')
    start = instant(occurrence.get('scheduled_start'))
    day = start.astimezone(ZoneInfo('Europe/London')).date().isoformat() if start else ''
    title = ' — '.join(str(value) for value in (scope['cohort_name'], scope['group_name'],
                      f"Recording · Session {occurrence.get('session_number') or ''}", day) if value)
    asset, created = CurriculumVideoImport.objects.get_or_create(fingerprint=identity, defaults={
        'id': uuid.uuid5(uuid.NAMESPACE_URL, 'lms-live-recording:' + identity),
        'target_kind': 'live_session', 'target_id': series['id'], 'component_id': artifact['id'],
        'title': title, 'source_url': source, 'source_at_start': source, 'scope': scope,
        # A single-owner cutover changes only new imports. Historical ready or
        # in-flight identities retain their saved library and player reference.
        'library_id': existing.library_id if existing else new_recording_library(), 'status': 'queued',
    })
    if asset.scope.get('live_replacement_import_id'):
        from .live_recording_migration import replacement_import
        asset = replacement_import(asset)
    if not created and asset.status == 'failed':
        CurriculumVideoImport.objects.filter(pk=asset.pk, status='failed').update(status='queued', error='')
        asset.refresh_from_db()
    return asset


def transfer_recording(asset, *, lease_id=None):
    """Called after the existing video worker has claimed its normal lease."""
    from coach_api.views import microsoft_graph_token
    from .session_results import read
    rows = read('''SELECT a.*,o.scheduled_start,o.join_url AS occurrence_join_url,
        o.online_meeting_id AS occurrence_meeting_id,s.* FROM curriculum.live_session_artifacts a
        JOIN curriculum.live_session_occurrences o ON o.id=a.occurrence_id
        JOIN curriculum.live_sessions s ON s.id=o.live_session_id
        JOIN curriculum.modules m ON m.module_catalogue_id=s.module_catalogue_id
        WHERE a.id=%s AND a.occurrence_id=%s AND s.id=%s AND a.artifact_type='recording'
          AND s.module_catalogue_id=%s AND coalesce(m.programme_id,'')=%s
          AND coalesce(m.cohort_id,'')=%s AND coalesce(m.group_id,'')=%s
          AND m.deleted_at IS NULL AND NOT coalesce(m.is_programme_deleted,false)
          AND s.status NOT IN ('deleted','cancelled','superseded','failed')
          AND o.status NOT IN ('deleted','cancelled','superseded')''',
        [asset.component_id, asset.scope['occurrence_id'], asset.target_id, asset.scope['module_id'],
         asset.scope['programme_id'], asset.scope['cohort_id'], asset.scope['group_id']])
    if not rows:
        raise VideoImportError('This recording is no longer linked to the requested live session.')
    row = rows[0]
    occurrence = {'join_url': row.get('occurrence_join_url'), 'online_meeting_id': row.get('occurrence_meeting_id')}
    source = source_identity(row, occurrence, row)
    if source != asset.source_at_start or source != asset.source_url:
        raise VideoImportError('The Microsoft recording identity changed; refresh the session before retrying.')
    from .shared_recordings import is_reference, use_reference
    if is_reference(asset):
        use_reference(asset)
        return
    client = BunnyStream(asset.library_id)
    from .bunny_stream import live_library_id
    live_video = None
    if asset.library_id == live_library_id() and asset.library_id != os.environ.get('BUNNY_STREAM_LIBRARY_ID', '798153'):
        from .live_recording_routing import require_live_credentials, find_existing_recording, matches_source
        require_live_credentials()
        if asset.video_id and (asset.scope.get('verified_peer_recording_identity') or
                asset.scope.get('adopted_existing_live_video') == asset.video_id):
            live_video = client.video(asset.video_id)
            if not matches_source(live_video, asset.scope):
                raise VideoImportError('The mapped LiveSessions video does not match this recording source.')
        elif not asset.video_id:
            live_video = _find_import(asset, client)
            if live_video:
                asset.scope.pop('live_video_create_pending', None)
            if live_video is None and os.environ.get('BUNNY_RECORDING_DIRECT_FETCH_ENABLED', '').lower() not in ('true', '1', 'yes'):
                live_video = find_existing_recording(client, asset.scope)
                if live_video:
                    asset.scope = {**asset.scope, 'adopted_existing_live_video': live_video['guid']}
            if live_video:
                asset.video_id = live_video['guid']
                playback_url(asset.library_id, asset.video_id)
                asset.save(update_fields=['video_id', 'scope', 'updated_at'])
        if live_video:
            if live_video.get('status') in (5, 6):
                raise VideoImportError('The existing LiveSessions recording needs review; no second copy was uploaded.')
            client.metadata(asset.video_id, asset.scope, asset.title, existing_tags=live_video.get('metaTags') or [])
    from .bunny_module_collections import recording_collection
    recording_collection(asset, client)
    if live_video and (asset.scope.get('verified_peer_recording_identity') or
            asset.scope.get('adopted_existing_live_video') == asset.video_id) and live_video.get('status') != 4:
        # A peer's existing GUID may still be uploading/encoding. Never PUT
        # bytes into that GUID or create another original while it is pending.
        asset.status = 'processing'
        return
    if not asset.video_id:
        recovered = _find_import(asset, client)
        if recovered:
            asset.video_id = recovered['guid']
            playback_url(asset.library_id, asset.video_id)
            asset.save(update_fields=['video_id', 'updated_at'])
            client.metadata(asset.video_id, asset.scope, asset.title)
    video = live_video or (client.video(asset.video_id) if asset.video_id else None)
    if (asset.library_id == live_library_id()
            and os.environ.get('BUNNY_RECORDING_DIRECT_FETCH_ENABLED', '').lower() in ('true', '1', 'yes')):
        from .live_recording_routing import uploads_enabled
        from .recording_direct_fetch import transfer_direct
        if video is None or video.get('status') in (0, 5, 6):
            if not uploads_enabled():
                raise VideoImportError('The original recording uploader cutover is not enabled.')
            video = transfer_direct(asset, client, source, row)
        asset.status = 'ready' if video and video.get('status') == 4 else 'processing'
        if asset.status == 'ready':
            from .live_recording_migration import verify_live_playback
            verify_live_playback(asset, client)
        return
    if video is not None and _retire_empty_failed_upload(asset, video):
        video = None
    if asset.library_id == live_library_id() and asset.library_id != os.environ.get('BUNNY_STREAM_LIBRARY_ID', '798153'):
        from .live_recording_routing import uploads_enabled
        if (video is None or video.get('status') in (0, 5, 6)) and not uploads_enabled():
            raise VideoImportError('LiveSessions original uploads are waiting for the single-uploader cutover; historical playback is retained.')
        if video is None or video.get('status') in (0, 5, 6):
            from .live_recording_transfer import transfer_original
            video = transfer_original(asset, client, source, row, lease_id=lease_id)
            asset.status = 'ready' if video and video.get('status') == 4 else 'processing'
            if asset.status == 'ready':
                from .live_recording_migration import verify_live_playback
                verify_live_playback(asset, client)
            return
    if video is None:
        if _queue_remote_fetch(asset, client, source, microsoft_graph_token(), row):
            video = client.video(asset.video_id) if asset.video_id else None
            if video is None:
                return
    if video is not None and video.get('status') == 0 and asset.scope.get('bunny_fetch_requested_at'):
        if time() - asset.scope['bunny_fetch_requested_at'] > 60 * 60:
            raise VideoImportError('Bunny has not completed its recording fetch. Review the saved import before retrying.')
        asset.status = 'processing'
        return
    if video is not None and video.get('status') in (5, 6) and asset.scope.get('bunny_fetch_requested_at'):
        # A confirmed remote fetch failure can safely reuse its GUID through
        # the bounded Microsoft upload path, without creating another video.
        asset.scope = {key: value for key, value in asset.scope.items() if key != 'bunny_fetch_requested_at'}
        asset.save(update_fields=['scope', 'updated_at'])
    if video is None or video.get('status') in (0, 5, 6):
        progress = TransferProgress(asset.target_id, asset.component_id, lease_id)
        with download_recording(source, microsoft_graph_token(), progress) as stream:
            progress.update('uploading', 0, stream.seek(0, 2), force=True)
            stream.seek(0)
            _prepare_and_upload(asset, client, stream)
        progress.update('finalizing')
        video = client.video(asset.video_id)
    if video.get('status') == 5:
        raise VideoImportError('Bunny could not encode this recording. Retry the saved import.')
    asset.status = 'ready' if video.get('status') == 4 else 'processing'
    if asset.library_id == live_library_id() and asset.library_id != os.environ.get('BUNNY_STREAM_LIBRARY_ID', '798153'):
        from .live_recording_migration import verify_live_playback
        verify_live_playback(asset, client)


def publish_outcome(asset):
    """Small atomic projection for existing session readers; no schema change.

    Never overwrite an existing Azure reference: old deployed readers can keep
    using it until the reviewed Bunny player is deployed.
    """
    from .shared_recordings import is_reference, reference_owner
    reference_owner(asset)
    from .live_recording_migration import checked_previous, replacement_import
    previous = checked_previous(asset)
    if previous is not None and asset.status != 'ready':
        # A pending/failed migration cannot replace a playable historical ref.
        asset = previous
    elif asset.scope.get('live_replacement_import_id'):
        asset = replacement_import(asset, include_pending=False)
    from .bunny_stream import live_library_id
    if asset.status == 'ready' and (is_reference(asset) or (
            asset.library_id == live_library_id() and asset.library_id != os.environ.get('BUNNY_STREAM_LIBRARY_ID', '798153'))):
        if (asset.scope.get('live_playback_verified_video_id') != asset.video_id or
                asset.scope.get('live_playback_verified_library_id') != asset.library_id):
            raise VideoImportError('LiveSessions playback must be verified before changing the saved player reference.')
    state = 'ready' if asset.status == 'ready' else 'failed' if asset.status == 'failed' else 'pending'
    payload = {'state': state, 'libraryId': asset.library_id, 'videoId': asset.video_id,
               'collectionId': asset.collection_id, 'importId': str(asset.pk)}
    with transaction.atomic(), connections['default'].cursor() as cursor:
        cursor.execute('''UPDATE curriculum.live_session_artifacts a
            SET metadata=jsonb_set(coalesce(a.metadata::jsonb,'{}'::jsonb),'{lmsBunnyRecording}',%s::jsonb),updated_at=now()
            FROM curriculum.live_session_occurrences o
            JOIN curriculum.live_sessions s ON s.id=o.live_session_id
            JOIN curriculum.modules m ON m.module_catalogue_id=s.module_catalogue_id
            WHERE a.occurrence_id=o.id AND a.occurrence_id=%s AND a.artifact_type='recording'
              AND s.id=%s AND s.module_catalogue_id=%s AND coalesce(m.programme_id,'')=%s
              AND coalesce(m.cohort_id,'')=%s AND coalesce(m.group_id,'')=%s
              AND m.deleted_at IS NULL AND NOT coalesce(m.is_programme_deleted,false)
              AND s.status NOT IN ('deleted','cancelled','superseded','failed')
              AND o.status NOT IN ('deleted','cancelled','superseded')
              AND ((a.id=%s AND a.graph_artifact_id=%s) OR
                   (%s<>'' AND a.content_correlation_id=%s AND (a.call_id=%s OR a.call_id='' OR %s='')))
            RETURNING a.id''',
            [json.dumps(payload), asset.scope['occurrence_id'], asset.target_id, asset.scope['module_id'],
             asset.scope['programme_id'], asset.scope['cohort_id'], asset.scope['group_id'],
             asset.component_id, asset.scope['graph_artifact_id'],
             asset.scope.get('content_correlation_id', ''), asset.scope.get('content_correlation_id', ''),
             asset.scope.get('call_id', ''), asset.scope.get('call_id', '')])
        artifact_ids = [row[0] for row in cursor.fetchall()]
        if asset.component_id not in artifact_ids:
            raise VideoImportError('The recording changed while Bunny was processing it.')
        for artifact_id in artifact_ids:
            cursor.execute('''INSERT INTO curriculum.session_result_archive
                (artifact_id,occurrence_id,container,blob_name,status,last_error)
                VALUES (%s,%s,%s,%s,%s,%s) ON CONFLICT(artifact_id) DO UPDATE
                SET container=EXCLUDED.container,status=EXCLUDED.status,
                    blob_name=EXCLUDED.blob_name,last_error=EXCLUDED.last_error,updated_at=now()
                WHERE session_result_archive.container=%s
                   OR (%s<>'' AND session_result_archive.blob_name=%s)''',
                [artifact_id, asset.scope['occurrence_id'], BUNNY_CONTAINER,
                 asset.library_id + '/' + asset.video_id, state, asset.error, BUNNY_CONTAINER,
                 asset.video_id, asset.library_id + '/' + asset.video_id])


def recording_player(row, *, download=False, referrer=''):
    saved = bunny_recording(row.get('metadata'))
    if saved.get('state') != 'ready':
        raise VideoImportError('This Bunny recording is still being processed.')
    url = signed_embed(saved.get('libraryId'), saved.get('videoId'))
    if not download:
        return url
    query = parse_qs(urlsplit(url).query)
    data = BunnyStream(saved['libraryId']).request('GET', f"/videos/{saved['videoId']}/play",
        # The protected play-data endpoint validates the signed embed as its
        # player referrer, just as a real Bunny iframe does. LMS authorization
        # has already occurred before this server-only request.
        headers={'Referer': url},
        params={'token': query['token'][0], 'expires': query['expires'][0]})
    source = data.get('originalUrl') or data.get('fallbackUrl') or ''
    if not data.get('originalUrl') and data.get('enableMP4Fallback') is False:
        raise VideoImportError('Bunny provides protected playback for this recording. Use the staff original-file download.')
    parsed = urlsplit(source)
    if not data.get('originalUrl') and parsed.path.endswith('/play_'):
        # Play-data returns an MP4 prefix, not a complete downloadable URL.
        video = data.get('video') or {}
        heights = [int(value) for value in re.findall(r'(\d+)p', str(video.get('availableResolutions') or ''))
                   if 0 < int(value) <= 1080]
        if not video.get('hasMP4Fallback') or not heights:
            raise VideoImportError('A downloadable Bunny file is not available for this recording.')
        parsed = parsed._replace(path=parsed.path + str(max(heights)) + 'p.mp4')
        source = parsed.geturl()
    if (parsed.scheme != 'https' or not (parsed.hostname or '').endswith('.b-cdn.net')
            or parsed.username or parsed.password):
        raise VideoImportError('A downloadable Bunny file is not available for this recording.')
    return source


def check_saved_recording(artifact_id, saved):
    """Verify Bunny media independently of the historical Azure reference."""
    client = BunnyStream(saved['libraryId'])
    missing_remote = False
    try:
        video = client.video(saved['videoId'])
    except VideoImportError as failure:
        # Transient/authentication failures must not invalidate a ready recording.
        if 'HTTP 404.' not in str(failure):
            raise
        missing_remote = True
        video = {'status': 6}
    if video.get('status') == 4:
        return True
    if video.get('status') not in (5, 6):
        return True  # encoding/replication still in progress
    asset = CurriculumVideoImport.objects.get(pk=saved['importId'], target_kind='live_session')
    if asset.component_id != artifact_id:
        from .session_results import read
        aliases = read('''SELECT id FROM curriculum.live_session_artifacts WHERE id=%s AND occurrence_id=%s
            AND metadata::jsonb->'lmsBunnyRecording'->>'importId'=%s''',
            [artifact_id, asset.scope['occurrence_id'], str(asset.pk)])
        if not aliases:
            raise VideoImportError('The Bunny recording reference no longer matches this occurrence.')
    # An absent remote identity must not be recreated under the old GUID.
    if missing_remote:
        asset.video_id = ''
    asset.status, asset.error = 'queued', ''
    asset.save(update_fields=['video_id', 'status', 'error', 'updated_at'])
    publish_outcome(asset)
    return False
