"""Reversible, journaled adoption of historical live recordings only."""
import hashlib
import json
import os
import re
import uuid
from datetime import timedelta
from urllib.parse import parse_qs, urlsplit

from django.db import transaction
from django.core.exceptions import ValidationError
from django.db.models import Q
from django.utils import timezone

from .bunny_stream import VideoImportError, live_library_id
from .live_recording_routing import require_live_credentials, recording_inventory, select_existing_recording, uploads_enabled
from .models import CurriculumVideoImport
from .session_bunny_policy import signed_embed

PREVIOUS = 'previous_live_import_id'
REPLACEMENT = 'live_replacement_import_id'
OWNER_FIELDS = ('module_id', 'series_id', 'occurrence_id', 'programme_id', 'cohort_id', 'group_id', 'graph_artifact_id')


def checked_previous(asset):
    previous_id = asset.scope.get(PREVIOUS)
    if not previous_id:
        return None
    try:
        previous = CurriculumVideoImport.objects.get(pk=previous_id, target_kind='live_session')
    except (CurriculumVideoImport.DoesNotExist, ValueError, ValidationError, TypeError):
        raise VideoImportError('The historical recording reference could not be verified.') from None
    if (asset.target_kind != 'live_session' or asset.library_id != live_library_id()
            or previous.target_id != asset.target_id or previous.component_id != asset.component_id
            or previous.source_at_start != asset.source_at_start or previous.source_url != asset.source_url
            or any(previous.scope.get(key) != asset.scope.get(key) for key in OWNER_FIELDS)):
        raise VideoImportError('The replacement recording does not belong to this historical source.')
    return previous


def replacement_import(asset, *, include_pending=True):
    replacement_id = asset.scope.get(REPLACEMENT)
    if not replacement_id:
        return asset
    try:
        replacement = CurriculumVideoImport.objects.get(pk=replacement_id, target_kind='live_session')
    except (CurriculumVideoImport.DoesNotExist, ValueError, ValidationError, TypeError):
        raise VideoImportError('The replacement recording identity could not be verified.') from None
    previous = checked_previous(replacement)
    if previous is None or previous.pk != asset.pk or replacement.scope.get(REPLACEMENT):
        raise VideoImportError('The replacement recording points to a different historical import.')
    if replacement.status == 'superseded':
        raise VideoImportError('The replacement recording was superseded; historical playback is retained.')
    return replacement if include_pending or replacement.status == 'ready' else asset


def queue_migration(asset, *, peer_mapping=None):
    """Queue only. The normal AWS worker owns downloads/uploads and playback switch."""
    library = require_live_credentials()
    if asset.target_kind != 'live_session' or asset.library_id == library or asset.status != 'ready':
        raise VideoImportError('Only a ready historical live recording can be queued for this migration.')
    if not asset.video_id or not asset.scope.get('graph_artifact_id'):
        raise VideoImportError('The historical recording has no complete source identity.')
    mapping = peer_mapping or {}
    if mapping and (mapping.get('graph_artifact_id') != asset.scope['graph_artifact_id']
            or not mapping.get('peer_recording_identity') or not mapping.get('video_id')):
        raise VideoImportError('A peer recording mapping must identify the exact Microsoft recording.')
    if mapping:
        try:
            uuid.UUID(str(mapping['video_id']))
        except ValueError:
            raise VideoImportError('The mapped Bunny recording identity is invalid.') from None
        if mapping.get('source_content_sha256') and not re.fullmatch(r'[0-9a-f]{64}', str(mapping['source_content_sha256'])):
            raise VideoImportError('The reviewed source content hash is invalid.')
    identity = hashlib.sha256(('live-library-migration-v1:' + str(asset.pk) + ':' + library).encode()).hexdigest()
    scope = {**asset.scope, PREVIOUS: str(asset.pk),
        'recording_identity': asset.scope.get('recording_identity') or asset.fingerprint}
    scope.pop(REPLACEMENT, None)
    if mapping:
        scope.update(verified_peer_recording_identity=str(mapping['peer_recording_identity']),
            verified_peer_graph_artifact_id=str(mapping['graph_artifact_id']))
        if mapping.get('source_content_sha256'):
            scope['source_content_sha256'] = mapping['source_content_sha256']
    with transaction.atomic():
        previous = CurriculumVideoImport.objects.select_for_update().get(pk=asset.pk)
        if previous.scope.get(REPLACEMENT):
            return replacement_import(previous)
        if previous.status != 'ready' or previous.video_id != asset.video_id or previous.source_at_start != asset.source_at_start:
            raise VideoImportError('The historical recording changed while migration was being planned.')
        replacement, created = CurriculumVideoImport.objects.get_or_create(fingerprint=identity, defaults={
            'id': uuid.uuid5(uuid.NAMESPACE_URL, identity), 'target_kind': 'live_session',
            'target_id': asset.target_id, 'component_id': asset.component_id,
            'title': asset.title, 'source_url': asset.source_url, 'source_at_start': asset.source_at_start,
            'scope': scope, 'library_id': library, 'video_id': str(mapping.get('video_id') or ''),
            'status': 'queued',
        })
        if checked_previous(replacement).pk != previous.pk:
            raise VideoImportError('A different import owns this migration identity.')
        if mapping and (replacement.video_id != str(mapping['video_id']) or
                replacement.scope.get('verified_peer_recording_identity') != str(mapping['peer_recording_identity'])):
            raise VideoImportError('This migration was already queued with a different peer mapping.')
        previous.scope = {**previous.scope, REPLACEMENT: str(replacement.pk)}
        previous.save(update_fields=['scope', 'updated_at'])
    return replacement


def verify_live_playback(asset, client):
    """Verify protected play-data before changing any historical LMS player ref."""
    if asset.library_id != live_library_id() or asset.status != 'ready':
        return
    require_live_credentials()
    if (asset.scope.get('live_playback_verified_video_id') == asset.video_id
            and asset.scope.get('live_playback_verified_library_id') == asset.library_id):
        return
    url = signed_embed(asset.library_id, asset.video_id)
    query = parse_qs(urlsplit(url).query)
    data = client.request('GET', f'/videos/{asset.video_id}/play', headers={'Referer': url},
        params={'token': query['token'][0], 'expires': query['expires'][0]})
    video = data.get('video')
    if not isinstance(video, dict) or video.get('guid') != asset.video_id:
        raise VideoImportError('LiveSessions protected playback has not been verified; historical playback is retained.')
    if video.get('videoLibraryId') is not None and str(video['videoLibraryId']) != asset.library_id:
        raise VideoImportError('The protected player returned a different library.')
    if client.verify_embed(url, referrer=os.environ.get('APP_URL') or os.environ.get('FRONTEND_URL') or '') is not True:
        raise VideoImportError('The signed LiveSessions player could not be verified.')
    asset.scope = {**asset.scope, 'live_playback_verified_video_id': asset.video_id,
        'live_playback_verified_library_id': asset.library_id}
    asset.save(update_fields=['scope', 'updated_at'])


def plan_migrations(assets, client, mappings=None):
    """Read-only source matching. Return private operational IDs, never URLs/keys."""
    mappings = mappings or {}
    rows = []
    inventory = None
    for asset in assets:
        row = {'import_id': str(asset.pk), 'series_id': asset.target_id,
            'module_id': asset.scope.get('module_id'), 'artifact_id': asset.component_id,
            'graph_artifact_id': asset.scope.get('graph_artifact_id'),
            'previous_library': asset.library_id, 'previous_video_id': asset.video_id,
            'source_fingerprint': asset.fingerprint,
            'source_at_start_sha256': hashlib.sha256(asset.source_at_start.encode()).hexdigest(),
            'source_url_sha256': hashlib.sha256(asset.source_url.encode()).hexdigest()}
        if asset.scope.get(REPLACEMENT):
            replacement = replacement_import(asset)
            rows.append({**row, 'action': 'already_queued', 'replacement_import_id': str(replacement.pk)})
            continue
        if asset.target_kind != 'live_session' or asset.status != 'ready' or asset.library_id == live_library_id():
            rows.append({**row, 'action': 'blocked', 'reason': 'Only ready historical live recordings can be migrated.'})
            continue
        scope = {**asset.scope, 'recording_identity': asset.scope.get('recording_identity') or asset.fingerprint}
        mapping = mappings.get(str(asset.pk))
        if mapping:
            if mapping.get('graph_artifact_id') != asset.scope.get('graph_artifact_id'):
                rows.append({**row, 'action': 'blocked', 'reason': 'The source mapping identifies a different Microsoft recording.'})
                continue
            scope.update(verified_peer_graph_artifact_id=mapping.get('graph_artifact_id'),
                         verified_peer_recording_identity=mapping.get('peer_recording_identity'))
            if mapping.get('source_content_sha256'):
                scope['source_content_sha256'] = mapping['source_content_sha256']
        if inventory is None:
            inventory = recording_inventory(client)
        try:
            existing = select_existing_recording(inventory, scope)
            if existing and existing.get('status') in (5, 6):
                raise VideoImportError('The existing LiveSessions source video needs review; no second copy was queued.')
            if mapping and (existing is None or existing['guid'] != mapping.get('video_id')):
                raise VideoImportError('The reviewed peer mapping does not match the existing source video.')
            rows.append({**row, 'action': 'adopt_existing' if existing else 'upload_original_after_cutover',
                'video_id': existing['guid'] if existing else '',
                'peer_mapping': mapping or {}, 'provider_status': existing.get('status') if existing else None})
        except VideoImportError as error:
            rows.append({**row, 'action': 'blocked', 'reason': str(error)})
    # A source/API failure aborts selection; blocked rows are not silently skipped.
    plan = {'library_id': live_library_id(), 'imports': rows}
    return plan


def plan_fingerprint(plan):
    return hashlib.sha256(json.dumps(plan, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def apply_migration_plan(plan, assets, expected_fingerprint):
    if expected_fingerprint != plan_fingerprint(plan):
        raise VideoImportError('The recording migration plan changed; review the current plan.')
    require_live_credentials()
    if any(row['action'] == 'blocked' for row in plan['imports']):
        raise VideoImportError('The migration plan contains unresolved source identities; no imports were queued.')
    if any(row['action'] == 'upload_original_after_cutover' for row in plan['imports']) and not uploads_enabled():
        raise VideoImportError('Original uploads require the agreed single-uploader cutover; no imports were queued.')
    by_id = {str(asset.pk): asset for asset in assets}
    queued = []
    with transaction.atomic():
        for row in plan['imports']:
            if row['action'] == 'already_queued':
                continue
            original = by_id[row['import_id']]
            if (original.fingerprint != row['source_fingerprint'] or original.video_id != row['previous_video_id']
                    or original.library_id != row['previous_library']
                    or hashlib.sha256(original.source_at_start.encode()).hexdigest() != row['source_at_start_sha256']
                    or hashlib.sha256(original.source_url.encode()).hexdigest() != row['source_url_sha256']):
                raise VideoImportError('A recording source changed after its migration plan was reviewed.')
            candidate = queue_migration(original, peer_mapping=row.get('peer_mapping') or None)
            queued.append(str(candidate.pk))
    return queued


def run_pending_migrations(limit=10):
    """Called by the scheduled AWS worker, never a second transfer scheduler."""
    from .video_imports import enabled
    if not enabled():
        return 0
    library = live_library_id()
    now = timezone.now()
    pending = CurriculumVideoImport.objects.filter(target_kind='live_session', library_id=library,
        scope__has_key=PREVIOUS).filter(Q(status__in=['queued', 'processing', 'uploading']) |
        Q(status='failed', updated_at__lte=now - timedelta(minutes=1))).filter(
        Q(lease_until__isnull=True) | Q(lease_until__lte=now)).order_by('updated_at')
    ids = list(pending.values_list('id', flat=True)[:max(1, min(limit, 100))])
    if ids:
        require_live_credentials()
        from .video_imports import process
        for import_id in ids:
            process(import_id)
    return len(ids)


def original_source_owner(asset, content_hash=None):
    """One journal owner per exact original bytes and authorized occurrence scope."""
    if asset.target_kind != 'live_session' or asset.library_id != live_library_id() or not all(
            asset.scope.get(key) for key in ('module_id', 'series_id', 'occurrence_id')):
        raise VideoImportError('An original source claim requires a saved LiveSessions recording scope.')
    content_hash = content_hash or asset.scope.get('source_content_sha256')
    if not content_hash or not re.fullmatch(r'[0-9a-f]{64}', str(content_hash)):
        raise VideoImportError('The original recording byte identity is not available.')
    owner_fields = ('module_id', 'series_id', 'occurrence_id', 'programme_id', 'cohort_id', 'group_id')
    fingerprint = hashlib.sha256(json.dumps(['live-source-v1', asset.library_id, content_hash,
        *[asset.scope.get(key) for key in owner_fields]], separators=(',', ':')).encode()).hexdigest()
    with transaction.atomic():
        anchor, _ = CurriculumVideoImport.objects.get_or_create(fingerprint=fingerprint, defaults={
            'id': uuid.uuid5(uuid.NAMESPACE_URL, fingerprint), 'target_kind': 'live_source',
            'target_id': str(asset.scope['occurrence_id']), 'component_id': '',
            'title': 'LiveSessions original source identity', 'library_id': asset.library_id, 'status': 'ready',
            'scope': {**{key: asset.scope.get(key) for key in owner_fields},
                      'owner_import_id': str(asset.pk), 'source_content_sha256': content_hash},
        })
        if (anchor.target_kind != 'live_source' or anchor.library_id != asset.library_id
                or anchor.scope.get('source_content_sha256') != content_hash
                or any(anchor.scope.get(key) != asset.scope.get(key) for key in owner_fields)):
            raise VideoImportError('The original source identity belongs to another recording scope.')
        try:
            owner = CurriculumVideoImport.objects.get(pk=anchor.scope.get('owner_import_id'), target_kind='live_session')
        except (CurriculumVideoImport.DoesNotExist, ValueError, ValidationError, TypeError):
            raise VideoImportError('The original recording owner could not be verified; no second copy was created.') from None
        if (owner.library_id != asset.library_id or any(owner.scope.get(key) != asset.scope.get(key) for key in owner_fields)
                or owner.scope.get('source_content_sha256') != content_hash):
            raise VideoImportError('The original recording owner does not match this source identity.')
        current = CurriculumVideoImport.objects.select_for_update().get(pk=asset.pk)
        if current.scope.get('source_content_sha256') != content_hash:
            raise VideoImportError('The original source hash changed while ownership was being confirmed.')
        current.scope = {**current.scope, 'live_source_claim_id': str(anchor.pk),
                         'live_source_owner_import_id': str(owner.pk)}
        current.save(update_fields=['scope', 'updated_at'])
        asset.scope, asset.video_id = dict(current.scope), current.video_id
    return owner


def remember_content_hash(asset, content_hash):
    with transaction.atomic():
        current = CurriculumVideoImport.objects.select_for_update().get(pk=asset.pk)
        if (current.source_at_start != asset.source_at_start or current.source_url != asset.source_url
                or current.library_id != asset.library_id):
            raise VideoImportError('The original source changed while it was being verified.')
        previous = current.scope.get('source_content_sha256')
        if previous and previous != content_hash:
            raise VideoImportError('The original recording bytes changed; the saved source was retained for review.')
        current.scope = {**current.scope, 'source_content_sha256': content_hash}
        current.save(update_fields=['scope', 'updated_at'])
        asset.scope, asset.video_id = dict(current.scope), current.video_id
