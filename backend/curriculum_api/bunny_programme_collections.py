"""Provision programme destinations once, using the existing durable import journal.

Only collection discovery/creation is coordinated here. Downloads, video creation
and uploads retain their existing per-recording identity and worker lease.
"""
import hashlib
import uuid
from contextlib import contextmanager

from django.db import connections, transaction

from .bunny_stream import MissingProgrammeCollection, VideoImportError, programme_collection_name
from .models import CurriculumVideoImport

KEY = 'bunny_programme_collection_key'
PENDING = 'bunny_programme_collection_pending'


@contextmanager
def _anchor(asset, key):
    with transaction.atomic():
        connection = connections['default']
        if connection.vendor == 'postgresql':
            # A library lock also covers two programme IDs with the same name.
            # It ends before any HTTP request; the committed claim protects POST.
            lock = int.from_bytes(hashlib.sha256(('bunny-programme:' + str(asset.library_id)).encode()).digest()[:8],
                                  'big', signed=True)
            with connection.cursor() as cursor:
                cursor.execute('SELECT pg_advisory_xact_lock(%s)', [lock])
        rows = CurriculumVideoImport.objects.select_for_update().filter(library_id=asset.library_id)
        anchor = rows.filter(**{'scope__' + KEY: key}).order_by('created_at', 'id').first()
        if anchor is None:
            programme = rows.filter(scope__programme_id=asset.scope['programme_id']).order_by('created_at', 'id')
            anchor = programme.exclude(collection_id='').first() or programme.first()
        if anchor is None:
            raise VideoImportError('The programme collection requires a saved video import.')
        if anchor.scope.get(KEY) != key:
            if anchor.scope.get(PENDING):
                raise VideoImportError('The original programme collection is still awaiting confirmation.')
            anchor.scope = {**anchor.scope, KEY: key}
            anchor.save(update_fields=['scope', 'updated_at'])
        yield anchor


def programme_collection(asset, client):
    """Reuse a destination or create it automatically, without duplicate POSTs.

The create claim commits before contacting Bunny. A crash or lost response is
recovered by discovery, never by blindly creating another collection. A definite
4xx rejection releases the claim so the normal worker can retry after recovery.
"""
    programme_id, name = asset.scope.get('programme_id'), asset.scope.get('programme_name')
    key = programme_collection_name(programme_id, name).casefold()
    with _anchor(asset, key) as anchor:
        cached = anchor.collection_id
    if cached:
        asset.refresh_from_db(fields=['scope'])
        return cached
    try:
        collection = client.collection(programme_id, name)
    except MissingProgrammeCollection:
        collection = ''
    claim = ''
    if not collection:
        with _anchor(asset, key) as anchor:
            if anchor.collection_id:
                collection = anchor.collection_id
            elif anchor.scope.get(PENDING):
                raise VideoImportError('Bunny programme collection creation is awaiting confirmation; the worker will check again.')
            else:
                claim = str(uuid.uuid4())
                anchor.scope = {**anchor.scope, PENDING: claim}
                anchor.save(update_fields=['scope', 'updated_at'])
        if claim:
            try:
                collection = client.create_programme_collection(programme_id, name)
            except VideoImportError as failure:
                status = failure.status_code
                if status is not None and 400 <= status < 500 and status != 408:
                    with _anchor(asset, key) as anchor:
                        if anchor.scope.get(PENDING) == claim:
                            anchor.scope = {k: v for k, v in anchor.scope.items() if k != PENDING}
                            anchor.save(update_fields=['scope', 'updated_at'])
                raise
    with _anchor(asset, key) as anchor:
        if anchor.collection_id and anchor.collection_id != collection:
            raise VideoImportError('Bunny returned conflicting programme collections. Administrator review is needed.')
        anchor.collection_id = collection
        anchor.scope = {k: v for k, v in anchor.scope.items() if k != PENDING}
        anchor.save(update_fields=['collection_id', 'scope', 'updated_at'])
    asset.refresh_from_db(fields=['scope'])
    return collection
