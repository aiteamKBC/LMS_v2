"""Provider-to-provider recording copies using the existing import journal.

Only bounded Microsoft byte probes reach this process. File IDs and versions
are durable; preauthenticated URLs and Microsoft credentials are never stored
or passed together to Bunny. Ambiguous fetches never cause another POST.
"""
import hashlib
import json
import re
import uuid
from urllib.parse import unquote, urlsplit

from django.db import transaction
from django.utils import timezone

from .bunny_stream import VideoImportError, playback_url, video_title
from .models import CurriculumVideoImport

PENDING = 'direct_fetch_requested_at'


def resolve_source(source, token, artifact):
    from coach_api.views import get_graph_settings, microsoft_graph_request
    from .session_cloud_archive import matched_recording_download
    organizer = artifact.get('organizer_email')
    # The verified recording URL already names the Teams owner. Calendar SMTP
    # aliases may not resolve through /users/{alias}/drive even for that account.
    # File identity, version and edge-byte verification still run below.
    parsed = urlsplit(source)
    if (parsed.scheme == 'https' and parsed.netloc == 'graph.microsoft.com'
            and not parsed.query and not parsed.fragment):
        owner = re.fullmatch(r'/v1\.0/users/([^/]+)/onlineMeetings/[^/]+/recordings/[^/]+/content', parsed.path)
        if owner:
            identity = unquote(owner[1])
            try:
                organizer = str(uuid.UUID(identity))
            except ValueError:
                pass
    try:
        matched = matched_recording_download(artifact, organizer, source, token,
            graph_get=microsoft_graph_request, graph_base=get_graph_settings()['base_url'], include_identity=True)
    except Exception:
        raise VideoImportError('The Microsoft file identity could not be verified. No second copy was requested.') from None
    if not matched:
        raise VideoImportError('A unique Microsoft file is not available for direct transfer yet.')
    return matched


def source_owner(asset, identity):
    """Aliases of the same physical file share one owner, within one occurrence."""
    if not isinstance(identity, dict) or not all(identity.get(k) for k in ('drive', 'item', 'version', 'size')):
        raise VideoImportError('The immutable Microsoft source identity is incomplete.')
    fields = ('owner_email', 'event_key') if asset.target_kind == 'coach_recording' else (
        'module_id', 'series_id', 'occurrence_id', 'programme_id', 'cohort_id', 'group_id')
    boundary = {key: asset.scope.get(key, '') for key in fields}
    fingerprint = hashlib.sha256(json.dumps(['direct-recording-source-v1', asset.library_id,
        asset.target_kind, boundary, identity['drive'], identity['item']], sort_keys=True).encode()).hexdigest()
    with transaction.atomic():
        anchor, _ = CurriculumVideoImport.objects.get_or_create(fingerprint=fingerprint, defaults={
            'id': uuid.uuid5(uuid.NAMESPACE_URL, fingerprint), 'target_kind': 'recording_source',
            'target_id': asset.target_id, 'component_id': '', 'library_id': asset.library_id,
            'status': 'ready', 'scope': {'boundary': boundary, 'source': identity, 'owner_import_id': str(asset.pk)},
        })
        if (anchor.target_kind != 'recording_source' or anchor.library_id != asset.library_id
                or anchor.scope.get('boundary') != boundary or anchor.scope.get('source') != identity):
            raise VideoImportError('The Microsoft source changed. The saved recording was retained for review.')
        owner = CurriculumVideoImport.objects.filter(pk=anchor.scope.get('owner_import_id'),
            target_kind=asset.target_kind, library_id=asset.library_id).first()
        if owner is None or any(owner.scope.get(key, '') != value for key, value in boundary.items()):
            raise VideoImportError('The original recording owner no longer matches this occurrence.')
        current = CurriculumVideoImport.objects.select_for_update().get(pk=asset.pk)
        previous = current.scope.get('direct_source')
        if previous and previous != identity:
            raise VideoImportError('The recording source changed while its transfer was pending.')
        source_key = hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()
        current.scope = {**current.scope, 'direct_source': identity, 'direct_source_key': source_key,
                         'direct_owner_import_id': str(owner.pk)}
        current.save(update_fields=['scope', 'updated_at'])
        asset.scope = dict(current.scope)
    return owner


def transfer_direct(asset, client, source, artifact):
    """Return this saved GUID or its alias owner's GUID, without local media."""
    if str(client.library_id) != asset.library_id or not asset.collection_id:
        raise VideoImportError('The recording destination has not been verified.')
    recovered = client.video(asset.video_id) if asset.video_id else client.find_import(asset.pk)
    if recovered:
        return _remember(asset, client, recovered)
    if asset.scope.get(PENDING):
        # A provider's accepted POST can outlive its response or search index.
        # Time alone never authorizes creating a second video.
        raise VideoImportError('The direct transfer awaits confirmation. No second video was created.')
    if asset.scope.get('direct_owner_import_id') and asset.scope['direct_owner_import_id'] != str(asset.pk):
        owner = source_owner(asset, asset.scope.get('direct_source'))
        asset.status = 'processing'
        return _remember(asset, client, client.video(owner.video_id)) if owner.video_id else None
    from coach_api.views import microsoft_graph_token
    download, identity = resolve_source(source, microsoft_graph_token(), artifact)
    owner = source_owner(asset, identity)
    if owner.pk != asset.pk:
        if owner.video_id:
            return _remember(asset, client, client.video(owner.video_id))
        asset.status = 'processing'
        return None
    if asset.target_kind == 'live_session':
        from .live_recording_routing import find_existing_recording
        existing = find_existing_recording(client, asset.scope)
        if existing:
            return _remember(asset, client, existing)
    with transaction.atomic():
        current = CurriculumVideoImport.objects.select_for_update().get(pk=asset.pk)
        if current.video_id:
            asset.video_id = current.video_id
            return None
        if current.scope.get(PENDING):
            raise VideoImportError('Another worker already requested this recording. Confirmation is pending.')
        if current.scope.get('live_video_create_pending') or current.scope.get('bunny_fetch_requested_at'):
            raise VideoImportError('A previous transfer awaits confirmation. No new copy was requested.')
        current.scope = {**current.scope, PENDING: timezone.now().isoformat()}
        current.save(update_fields=['scope', 'updated_at'])
        asset.scope = dict(current.scope)
    client.request('POST', '/videos/fetch', params={'collectionId': asset.collection_id},
        json={'url': download, 'headers': {}, 'title': video_title(asset.pk, asset.title, asset.scope)})
    recovered = client.find_import(asset.pk)
    asset.status = 'processing'
    return _remember(asset, client, recovered) if recovered else None


def _remember(asset, client, video):
    guid = video.get('guid')
    playback_url(asset.library_id, guid)
    if asset.video_id and asset.video_id != guid:
        raise VideoImportError('The recording has conflicting video identities. Review is required.')
    # A confirmed failure keeps its GUID. A retry must never create another.
    asset.video_id = guid
    asset.save(update_fields=['video_id', 'updated_at'])
    if video.get('status') in (5, 6):
        raise VideoImportError('The saved Bunny transfer failed. Repair this video before retrying.')
    if video.get('status') == 0 and not asset.scope.get(PENDING):
        raise VideoImportError('An earlier uploader owns this empty video. Review its saved transfer before retrying.')
    if video.get('collectionId') != asset.collection_id:
        video = client.move_to_collection(guid, asset.collection_id)
    provenance = {key: value for key, value in asset.scope.items() if key != 'microsoft_captions_vtt'}
    client.metadata(guid, provenance, asset.title, existing_tags=video.get('metaTags') or [])
    return video
