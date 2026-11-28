"""One immutable Microsoft file, separate authorised LMS occurrence references.

Only the recording worker calls these helpers, after validating its own current
meeting/occurrence. File size, edge bytes and version are proved before claim().
Sharing bytes never shares a coach's calendar, learner access or attendance.
"""
import hashlib
import json
import os
import uuid

from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Q

from .bunny_stream import BunnyStream, VideoImportError, live_library_id
from .models import CurriculumVideoImport
from .session_bunny_policy import signed_embed

KIND = 'recording_media'
SOURCE = 'shared_recording_source_id'
OWNER = 'shared_recording_owner_id'
BINDING = 'shared_recording_binding'
KINDS = ('live_session', 'coach_recording')


def _digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


def _libraries():
    values = {live_library_id(), os.environ.get('BUNNY_COACH_STREAM_LIBRARY_ID', '').strip()}
    return {value for value in values if value.isdigit()
            and value != os.environ.get('BUNNY_STREAM_LIBRARY_ID', '798153').strip()}


def _identity(value):
    if (not isinstance(value, dict) or set(value) != {'drive', 'item', 'version', 'size'}
            or not all(isinstance(value[key], str) and 0 < len(value[key]) <= 2048
                       for key in ('drive', 'item', 'version'))
            or type(value['size']) is not int or value['size'] <= 0):
        raise VideoImportError('The shared Microsoft recording identity is incomplete.')
    return value


def _fingerprint(identity):
    return _digest(['shared-recording-source-v1', identity['drive'], identity['item']])


def _binding(asset):
    fields = ('owner_email', 'event_key', 'evidence_job', 'context', 'microsoft_base', 'graph_artifact_id') if (
        asset.target_kind == 'coach_recording') else (
        'module_id', 'series_id', 'occurrence_id', 'programme_id', 'cohort_id', 'group_id', 'graph_artifact_id')
    return _digest([asset.target_kind, asset.target_id, asset.component_id, asset.source_at_start,
                    asset.scope.get('direct_source'), asset.scope.get(SOURCE), asset.scope.get(OWNER),
                    {field: asset.scope.get(field) for field in fields}])


def is_reference(asset):
    return bool(asset.scope.get(OWNER) and asset.scope[OWNER] != str(asset.pk))


def claim(asset, identity, *, preferred=None):
    """A global file claim serialises copies across coaches and both libraries."""
    identity = _identity(identity)
    if asset.target_kind not in KINDS or asset.library_id not in _libraries():
        return preferred or asset  # Historical Materials imports are unchanged.
    if asset.source_url != asset.source_at_start:
        raise VideoImportError('The shared recording source changed before its claim.')
    fingerprint = _fingerprint(identity)
    with transaction.atomic():
        # Reuse an existing proved copy or in-flight original before choosing a
        # new uploader. Exact Graph URLs also let a known tutor import own the
        # lecture before its first transfer; its own handler still validates it.
        candidates = list(CurriculumVideoImport.objects.filter(target_kind__in=KINDS,
            library_id__in=_libraries()).filter(Q(scope__direct_source=identity)
            | Q(source_url=asset.source_url)).order_by('created_at', 'id'))
        candidates = [row for row in candidates if not is_reference(row)
                      and row.source_url == row.source_at_start
                      and (not row.scope.get('direct_source') or row.scope['direct_source'] == identity)]
        copied = [row for row in candidates if row.video_id and row.scope.get('direct_source') == identity]
        pending = [row for row in candidates if row.scope.get('direct_fetch_requested_at')
                   and row.scope.get('direct_source') == identity]
        live = [row for row in candidates if row.target_kind == 'live_session'
                and row.status not in ('superseded', 'awaiting_file')]
        pool = copied or pending or live or ([preferred] if preferred else []) or [asset]
        selected = sorted(pool, key=lambda row: (row.status != 'ready', row.target_kind != 'live_session',
                                                row.created_at, str(row.pk)))[0]
        anchor, _ = CurriculumVideoImport.objects.get_or_create(fingerprint=fingerprint, defaults={
            'id': uuid.uuid5(uuid.NAMESPACE_URL, fingerprint), 'target_kind': KIND,
            'target_id': '', 'component_id': '', 'library_id': selected.library_id,
            'title': 'Verified shared recording source', 'status': 'ready',
            'scope': {'source': identity, 'owner_import_id': str(selected.pk)},
        })
        anchor = CurriculumVideoImport.objects.select_for_update().get(pk=anchor.pk)
        if anchor.target_kind != KIND or anchor.scope.get('source') != identity:
            raise VideoImportError('The shared Microsoft recording version changed. The original was retained.')
        owner = CurriculumVideoImport.objects.get(pk=anchor.scope['owner_import_id'])
        if owner.target_kind not in KINDS or owner.library_id not in _libraries() or is_reference(owner):
            raise VideoImportError('The shared recording uploader identity is invalid.')
        current = CurriculumVideoImport.objects.select_for_update().get(pk=asset.pk)
        if (current.scope.get('direct_source') not in (None, identity)
                or current.source_url != asset.source_url or current.source_at_start != asset.source_at_start
                or (current.scope.get(SOURCE) and current.scope[SOURCE] != str(anchor.pk))):
            raise VideoImportError('The shared recording changed while its source was claimed.')
        if current.video_id and owner.pk != current.pk and (
                current.video_id != owner.video_id or current.library_id != owner.library_id):
            raise VideoImportError('An existing original cannot be replaced by another shared recording.')
        current.scope = {**current.scope, 'direct_source': identity, SOURCE: str(anchor.pk), OWNER: str(owner.pk)}
        current.scope[BINDING] = _binding(current)
        current.save(update_fields=['scope', 'updated_at'])
        asset.scope = dict(current.scope)
        return owner


def reference_owner(asset):
    """Validate a reference against the global receipt AND its own access scope."""
    if not is_reference(asset):
        return None
    try:
        identity = _identity(asset.scope.get('direct_source'))
        anchor = CurriculumVideoImport.objects.get(pk=asset.scope[SOURCE], target_kind=KIND,
            fingerprint=_fingerprint(identity))
        owner = CurriculumVideoImport.objects.get(pk=asset.scope[OWNER], target_kind__in=KINDS)
    except (CurriculumVideoImport.DoesNotExist, KeyError, ValueError, TypeError, ValidationError):
        raise VideoImportError('The shared recording reference could not be verified.') from None
    if (asset.target_kind not in KINDS or asset.source_url != asset.source_at_start
            or asset.scope.get(BINDING) != _binding(asset) or anchor.scope.get('source') != identity
            or anchor.scope.get('owner_import_id') != str(owner.pk) or is_reference(owner)
            or owner.library_id not in _libraries()
            or (owner.scope.get('direct_source') and owner.scope['direct_source'] != identity)
            or (asset.video_id and (asset.video_id != owner.video_id or asset.library_id != owner.library_id))):
        raise VideoImportError('The shared recording no longer matches this authorised occurrence.')
    return owner


def use_reference(asset):
    """Read/verify the original; never move it, retag it or upload another copy."""
    owner = reference_owner(asset)
    if owner is None:
        raise VideoImportError('A verified shared recording reference is required.')
    if owner.video_id and not owner.scope.get('direct_source'):
        raise VideoImportError('The existing shared original needs immutable source-identity reconciliation. No second copy was uploaded.')
    if not owner.video_id or owner.scope.get('direct_source') != asset.scope['direct_source']:
        asset.status = 'processing'
        return None
    client = BunnyStream(owner.library_id)
    video = client.video(owner.video_id)
    if (video.get('guid') != owner.video_id or video.get('collectionId') != owner.collection_id
            or video.get('status') in (5, 6)):
        raise VideoImportError('The shared original needs repair. No second video was uploaded.')
    if video.get('status') != 4:
        asset.status = 'processing'
        return None
    if owner.target_kind == 'coach_recording':
        resolutions = str(video.get('availableResolutions') or '').split(',')
        if len(resolutions) != 1 or resolutions[0].strip() not in ('240p', '360p', '480p', '720p'):
            raise VideoImportError('The shared coaching original must retain one resolution up to 720p.')
    if client.verify_embed(signed_embed(owner.library_id, owner.video_id),
            referrer=os.environ.get('APP_URL') or 'https://lms.kentbusinesscollege.org/') is not True:
        raise VideoImportError('Protected playback of the shared recording could not be verified.')
    asset.library_id, asset.collection_id, asset.video_id = owner.library_id, owner.collection_id, owner.video_id
    asset.status = 'ready'
    verified = ({'playback_verified_video_id': owner.video_id} if asset.target_kind == 'coach_recording' else {
        'live_playback_verified_video_id': owner.video_id, 'live_playback_verified_library_id': owner.library_id})
    asset.scope = {**asset.scope, **verified}
    asset.save(update_fields=['library_id', 'collection_id', 'video_id', 'status', 'scope', 'updated_at'])
    return video
