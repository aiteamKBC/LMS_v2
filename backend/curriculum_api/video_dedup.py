"""Reuse source identities across authoring contexts, retaining per-context jobs.

Only authoring videos participate. Meeting recordings keep their own transfer
identity and publishing flow. No remote title, metadata or collection is changed
when another course refers to an already uploaded video.
"""
import hashlib
import json
import re

from .bunny_stream import VideoImportError
from .models import CurriculumVideoSource
from .video_sources import youtube_url

AUTHORING_KINDS = frozenset(('module', 'template', 'free_course'))
STORED_HASH = re.compile(r'^/curriculum_api/curriculum/uploads/videos/(?:module|template|free_course)/[\w-]+/[\w-]+/([a-f0-9]{64})\.mp4$', re.ASCII)


def source_key(asset, file_obj=None):
    if asset.target_kind not in AUTHORING_KINDS:
        return ''
    source = str(asset.source_url or '').strip()
    if source:
        try:
            youtube = youtube_url(source)
        except VideoImportError:
            return ''  # The normal processor will report the invalid source.
        uploaded = STORED_HASH.fullmatch(source)
        identity = ('youtube', youtube) if youtube else ('sha256', uploaded[1]) if uploaded else ('url', source)
    elif file_obj is not None:
        digest = hashlib.sha256()
        file_obj.seek(0)
        while chunk := file_obj.read(1024 * 1024):
            digest.update(chunk)
        file_obj.seek(0)
        identity = ('sha256', digest.hexdigest())
    else:
        return ''
    return hashlib.sha256(json.dumps([str(asset.library_id), *identity], separators=(',', ':')).encode()).hexdigest()


def upload_owner(asset, file_obj=None):
    key = source_key(asset, file_obj)
    if not key:
        if asset.target_kind in AUTHORING_KINDS and asset.video_id and not asset.source_url:
            # Legacy immediate MP4 imports have no durable URL after the first
            # request. Their shared remote ID still identifies the upload owner.
            source = CurriculumVideoSource.objects.filter(
                library_id=asset.library_id, owner_import__video_id=asset.video_id,
            ).first()
            if source:
                return source.owner_import
        return asset
    # The unique source key resolves concurrent first saves. The owner's existing
    # row lease serializes downloads/uploads; no SQL transaction spans remote IO.
    # Keep that owner permanently so lost create responses recover its LMS marker.
    source, _ = CurriculumVideoSource.objects.get_or_create(
        source_key=key, defaults={'library_id': asset.library_id, 'owner_import': asset},
    )
    return source.owner_import if source.owner_import_id != asset.pk else asset


def reuse_owner(asset, owner, *, process, client, matches_current_source, file_obj=None):
    """Wait for/advance the canonical job, then copy only its remote reference."""
    owner = process(owner.pk, file_obj=file_obj if not owner.source_url else None)
    if not owner.video_id:
        asset.status = 'failed' if owner.status == 'failed' else 'queued'
        asset.error = owner.error if asset.status == 'failed' else ''
        return
    # Verify availability rather than reporting a deleted/inaccessible copy as
    # saved. Never manufacture a replacement copy on a failed lookup.
    video = client.video(owner.video_id)
    status = video.get('status')
    if status == 5:
        raise VideoImportError('Bunny could not encode the existing video. Retry its original import.')
    if owner.status == 'failed' and status in (0, 6):
        asset.status, asset.error = 'failed', owner.error
        return
    asset.video_id, asset.collection_id = owner.video_id, owner.collection_id
    asset.save(update_fields=['video_id', 'collection_id', 'updated_at'])
    asset.error = ''
    asset.status = ('ready' if matches_current_source(asset) else 'superseded') if status == 4 else 'processing'
