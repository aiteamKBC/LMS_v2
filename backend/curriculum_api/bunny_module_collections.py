"""Live-only module destinations, provisioned before the first recording.

Container jobs reuse the durable import journal, but never create videos. A
committed create claim makes an ambiguous HTTP response discoverable on retry.
No database transaction is held across a provider request.
"""
import hashlib
import logging
import os
import uuid
from datetime import timedelta

from django.db import connections, transaction
from django.db.models import Q
from django.utils import timezone

from .bunny_stream import BunnyStream, MissingProgrammeCollection, VideoImportError
from .models import CurriculumVideoImport

KIND = 'live_collection'
ORGANIZATION = 'bunny_live_collection_module'
PENDING = 'bunny_module_collection_pending'
log = logging.getLogger(__name__)


def collection_name(module_id, title):
    title = ' '.join(str(title or '').split())
    if not module_id or not title:
        raise VideoImportError('A saved module and its title are required for the live collection.')
    marker = hashlib.sha256(str(module_id).encode()).hexdigest()[:16]
    return f'{title[:220]} [Module:{marker}]'


def queue_module(row, *, library_id=None, wake=True):
    """Queue a destination from an authoritative saved module row; no HTTP."""
    if os.environ.get('BUNNY_STREAM_ENABLED', '').lower() not in ('true', '1', 'yes'):
        return None
    if row.get('deleted_at') or row.get('is_programme_deleted'):
        return None
    if row.get('source_type') == 'free_course':
        return None
    module_id = str(row.get('module_catalogue_id') or '').strip()
    title = row.get('title')
    name = collection_name(module_id, title)
    library = str(library_id or os.environ.get('BUNNY_STREAM_LIBRARY_ID', '798153'))
    fingerprint = hashlib.sha256(f'bunny-live-collection:{library}:{module_id}'.encode()).hexdigest()
    job, created = CurriculumVideoImport.objects.get_or_create(fingerprint=fingerprint, defaults={
        'id': uuid.uuid5(uuid.NAMESPACE_URL, fingerprint), 'target_kind': KIND, 'target_id': module_id,
        'component_id': '', 'title': title, 'library_id': library,
        'scope': {'module_id': module_id, 'module_title': title, 'collection_name': name},
    })
    if job.target_kind != KIND or job.target_id != module_id or job.library_id != library:
        raise VideoImportError('The saved module collection identity conflicts with another destination.')
    if created and wake:
        from .video_imports import wake_worker
        transaction.on_commit(wake_worker)
    return job


def ensure_collection(job, client):
    """Return this module's persistent collection GUID, including lost-POST recovery."""
    if job.target_kind != KIND or job.scope.get('module_id') != job.target_id or job.video_id:
        raise VideoImportError('Invalid module collection job.')
    if str(client.library_id) != str(job.library_id):
        raise VideoImportError('The module collection belongs to another library.')
    job.refresh_from_db()
    if job.collection_id:
        return job.collection_id
    name = job.scope['collection_name']
    try:
        destination = client.collection('LMS-MODULE:' + job.target_id, name)
    except MissingProgrammeCollection:
        destination = ''
    claim = ''
    if not destination:
        with transaction.atomic():
            locked = CurriculumVideoImport.objects.select_for_update().get(pk=job.pk)
            if locked.collection_id:
                return locked.collection_id
            if locked.scope.get(PENDING):
                raise VideoImportError('Module collection creation is awaiting confirmation; the worker will check again.')
            claim = str(uuid.uuid4())
            locked.scope = {**locked.scope, PENDING: claim}
            locked.save(update_fields=['scope', 'updated_at'])
        try:
            destination = client.create_programme_collection('LMS-MODULE:' + job.target_id, name)
        except VideoImportError as failure:
            if failure.status_code is not None and 400 <= failure.status_code < 500 and failure.status_code != 408:
                with transaction.atomic():
                    locked = CurriculumVideoImport.objects.select_for_update().get(pk=job.pk)
                    if locked.scope.get(PENDING) == claim:
                        locked.scope.pop(PENDING)
                        locked.save(update_fields=['scope', 'updated_at'])
            raise
    with transaction.atomic():
        locked = CurriculumVideoImport.objects.select_for_update().get(pk=job.pk)
        if locked.collection_id and locked.collection_id != destination:
            raise VideoImportError('Bunny returned conflicting module collections. Administrator review is needed.')
        locked.collection_id = destination
        locked.scope.pop(PENDING, None)
        locked.status, locked.error, locked.lease_until = 'ready', '', None
        locked.save(update_fields=['collection_id', 'scope', 'status', 'error', 'lease_until', 'updated_at'])
    job.refresh_from_db()
    return destination


def process_collection(job, client=None):
    try:
        ensure_collection(job, client or BunnyStream(job.library_id))
    except Exception as failure:
        # A stale failing request must never downgrade a concurrent success.
        error = str(failure) if isinstance(failure, VideoImportError) else 'The module live collection needs retry.'
        CurriculumVideoImport.objects.filter(pk=job.pk, collection_id='').update(
            status='queued', error=error, lease_until=timezone.now() + timedelta(minutes=1), updated_at=timezone.now())
        log.warning('Module live collection needs retry (%s).', type(failure).__name__)
    job.refresh_from_db()
    return job


def recording_collection(asset, client):
    if asset.target_kind != 'live_session':
        raise VideoImportError('Only live recordings can use a module live collection.')
    job = queue_module({'module_catalogue_id': asset.scope.get('module_id'),
                        'title': asset.scope.get('module_title')}, library_id=asset.library_id, wake=False)
    if job is None:
        raise VideoImportError('Module live collections are disabled.')
    destination = ensure_collection(job, client)
    if asset.collection_id != destination and asset.video_id:
        client.move_to_collection(asset.video_id, destination)
    if asset.collection_id != destination or asset.scope.get(ORGANIZATION) != asset.scope.get('module_id'):
        asset.collection_id = destination
        asset.scope = {**asset.scope, ORGANIZATION: asset.scope['module_id']}
        # Old programme destination claims must not be reused for material videos.
        asset.scope.pop('bunny_programme_collection_key', None)
        asset.scope.pop('bunny_programme_collection_pending', None)
        asset.save(update_fields=['collection_id', 'scope', 'updated_at'])
    return destination


def capture_modules(limit=20):
    """Recover saves from SQL writers or a temporarily unavailable web queue."""
    connection = connections['default']
    if connection.vendor != 'postgresql':
        return 0
    library = os.environ.get('BUNNY_STREAM_LIBRARY_ID', '798153')
    with connection.cursor() as cursor:
        cursor.execute('''SELECT m.module_catalogue_id,m.title FROM curriculum.modules m
            WHERE m.deleted_at IS NULL AND NOT coalesce(m.is_programme_deleted,false)
              AND coalesce(m.source_type,'')<>'free_course' AND coalesce(m.title,'')<>''
              AND NOT EXISTS (SELECT 1 FROM curriculum_video_import j
                  WHERE j.target_kind=%s AND j.target_id=m.module_catalogue_id AND j.library_id=%s)
            ORDER BY m.module_catalogue_id LIMIT %s''', [KIND, library, max(1, min(limit, 100))])
        rows = [{'module_catalogue_id': row[0], 'title': row[1]} for row in cursor.fetchall()]
    for row in rows:
        queue_module(row, library_id=library, wake=False)
    return len(rows)


def run_pending_collections(limit=20):
    if os.environ.get('BUNNY_STREAM_ENABLED', '').lower() not in ('true', '1', 'yes'):
        return 0
    capture_modules(limit)
    jobs = CurriculumVideoImport.objects.filter(target_kind=KIND, status__in=['queued', 'processing']).filter(
        Q(lease_until__isnull=True) | Q(lease_until__lte=timezone.now())).order_by('updated_at')[:limit]
    for job in list(jobs):
        process_collection(job)
    return len(jobs)
