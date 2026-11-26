"""Hash an original before upload; one durable owner shares the result with aliases."""
from contextlib import contextmanager, ExitStack
import hashlib
import uuid

from django.db import transaction

from .bunny_stream import VideoImportError, playback_url
from .live_recording_migration import original_source_owner, remember_content_hash
from .live_recording_routing import find_existing_recording
from .session_recording_source import download_recording
from .session_transfer_progress import TransferProgress
from .models import CurriculumVideoImport

CREATE_PENDING = 'live_video_create_pending'


@contextmanager
def original_stream(source, token, artifact, progress):
    with ExitStack() as stack:
        try:
            stream = stack.enter_context(download_recording(source, token, progress))
        except VideoImportError as failure:
            if not any(code in str(failure) for code in ('HTTP 404', 'HTTP 410')):
                raise
            from coach_api.views import get_graph_settings, microsoft_graph_request
            from .session_cloud_archive import matched_recording_download
            try:
                matched = matched_recording_download(artifact, artifact.get('organizer_email'), source, token,
                    graph_get=microsoft_graph_request, graph_base=get_graph_settings()['base_url'])
            except Exception:
                raise VideoImportError('The Microsoft original could not be resolved; no recording was uploaded.') from None
            if not matched:
                raise
            # Only the preauthenticated Microsoft URL is read here. The Graph
            # application token is never sent to SharePoint or another provider.
            stream = stack.enter_context(download_recording(matched[0], '', progress, _sharepoint_source=True))
        # Exceptions in the upload consumer cannot be mistaken for a failed
        # Graph download and must never trigger a second stream/upload attempt.
        yield stream


def _adopt_owned(asset, owner, client):
    if not owner.video_id:
        return None
    video = client.video(owner.video_id)
    if video.get('guid') != owner.video_id or video.get('status') in (5, 6):
        raise VideoImportError('The original source owner needs repair; no second copy was created.')
    asset.video_id = owner.video_id
    playback_url(asset.library_id, asset.video_id)
    asset.scope = {**asset.scope, 'adopted_existing_live_video': asset.video_id}
    asset.save(update_fields=['video_id', 'scope', 'updated_at'])
    from .bunny_module_collections import recording_collection
    recording_collection(asset, client)
    client.metadata(asset.video_id, asset.scope, asset.title, existing_tags=video.get('metaTags') or [])
    return video


def transfer_original(asset, client, source, artifact, *, lease_id=None):
    """Returns ready/processing media or None while the existing owner is busy."""
    from coach_api.views import microsoft_graph_token
    from .session_bunny import _prepare_and_upload
    if asset.scope.get('source_content_sha256'):
        owner = original_source_owner(asset)
        if owner.pk != asset.pk:
            return _adopt_owned(asset, owner, client)
    progress = TransferProgress(asset.target_id, asset.component_id, lease_id)
    with original_stream(source, microsoft_graph_token(), artifact, progress) as stream:
        digest = hashlib.sha256()
        stream.seek(0)
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
        content_hash = digest.hexdigest()
        remember_content_hash(asset, content_hash)
        # A library listing may briefly lag a newly created GUID. The unique
        # database claim also prevents simultaneous aliases from uploading it.
        existing = find_existing_recording(client, asset.scope)
        owner = original_source_owner(asset, content_hash)
        if owner.pk != asset.pk:
            return _adopt_owned(asset, owner, client)
        if existing:
            asset.video_id = existing['guid']
            asset.save(update_fields=['video_id', 'updated_at'])
            return _adopt_owned(asset, asset, client)
        progress.update('uploading', 0, stream.seek(0, 2), force=True)
        stream.seek(0)
        _prepare_and_upload(asset, client, stream)
        progress.update('finalizing')
        video = client.video(asset.video_id)
        if video.get('status') in (5, 6):
            raise VideoImportError('The original video could not be encoded; retry its saved import.')
        return video


def create_video_once(asset, client):
    """Commit creation intent before POST, including a lost/ambiguous response."""
    from .session_bunny import _find_import
    recovered = _find_import(asset, client)
    claim = ''
    with transaction.atomic():
        current = CurriculumVideoImport.objects.select_for_update().get(pk=asset.pk)
        if current.video_id:
            asset.video_id, asset.scope = current.video_id, dict(current.scope)
            return {'guid': current.video_id}
        if recovered and recovered['guid'] not in current.scope.get('interrupted_upload_ids', []):
            playback_url(current.library_id, recovered['guid'])
            current.video_id = recovered['guid']
            current.scope.pop(CREATE_PENDING, None)
            current.save(update_fields=['video_id', 'scope', 'updated_at'])
            asset.video_id, asset.scope = current.video_id, dict(current.scope)
            return recovered
        if current.scope.get(CREATE_PENDING):
            raise VideoImportError('Live recording creation awaits confirmation; no second original was created.')
        claim = str(uuid.uuid4())
        current.scope = {**current.scope, CREATE_PENDING: claim}
        current.save(update_fields=['scope', 'updated_at'])
    try:
        created = client.create(asset.id, asset.title, asset.collection_id, scope=asset.scope)
    except VideoImportError as error:
        if error.status_code is not None and 400 <= error.status_code < 500 and error.status_code != 408:
            with transaction.atomic():
                current = CurriculumVideoImport.objects.select_for_update().get(pk=asset.pk)
                if current.scope.get(CREATE_PENDING) == claim:
                    current.scope.pop(CREATE_PENDING)
                    current.save(update_fields=['scope', 'updated_at'])
        raise
    playback_url(asset.library_id, created['guid'])
    with transaction.atomic():
        current = CurriculumVideoImport.objects.select_for_update().get(pk=asset.pk)
        if current.video_id and current.video_id != created['guid']:
            raise VideoImportError('Conflicting original video identities require review.')
        if not current.video_id and current.scope.get(CREATE_PENDING) != claim:
            raise VideoImportError('The original video creation owner changed; review is required.')
        current.video_id = created['guid']
        current.scope.pop(CREATE_PENDING, None)
        current.save(update_fields=['video_id', 'scope', 'updated_at'])
        asset.video_id, asset.scope = current.video_id, dict(current.scope)
    return created
