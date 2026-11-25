"""File KBC-ingested LiveSessions videos by their canonical LMS occurrence.

This worker moves metadata only. It never uploads a second copy, rewrites a
learner player reference or infers a module from a title. A durable page cursor
recovers older unfiled videos while each pass also checks the newest page.
"""
import hashlib
import logging
import os
import uuid

from django.db import transaction

from .bunny_stream import BunnyStream, VideoImportError, live_library_id
from .bunny_module_collections import ensure_collection, queue_module
from .models import CurriculumVideoImport

log = logging.getLogger(__name__)
SCAN_KIND = 'live_scan'


def _owners(occurrence_ids):
    if not occurrence_ids:
        return {}
    from .session_results import read
    rows = read('''SELECT o.id AS occurrence_id,s.id AS series_id,
        m.module_catalogue_id,m.title,m.deleted_at,m.is_programme_deleted,m.source_type
        FROM curriculum.live_session_occurrences o
        JOIN curriculum.live_sessions s ON s.id=o.live_session_id
        JOIN curriculum.modules m ON m.module_catalogue_id=s.module_catalogue_id
        WHERE o.id=ANY(%s)''', [sorted(occurrence_ids)])
    return {row['occurrence_id']: row for row in rows}


def _page(client, page):
    data = client.request('GET', '/videos', params={'page': page, 'itemsPerPage': 100, 'orderBy': 'date'})
    items = data.get('items')
    if not isinstance(items, list) or any(not isinstance(row, dict) or not isinstance(row.get('guid'), str)
                                          for row in items):
        raise VideoImportError('The LiveSessions video inventory is unreadable; organization will retry.')
    try:
        for row in items:
            uuid.UUID(row['guid'])
    except ValueError:
        raise VideoImportError('The LiveSessions video inventory contains an invalid identity.') from None
    return items


def _occurrence(video):
    tags = video.get('metaTags') or []
    if not isinstance(tags, list):
        return ''
    values = {tag.get('value') for tag in tags
              if isinstance(tag, dict) and tag.get('property') == 'kbc_lms_occurrence_id'
              and isinstance(tag.get('value'), str) and tag['value']}
    return next(iter(values)) if len(values) == 1 else ''


def organize_ready_recordings(limit=20, client=None):
    if os.environ.get('BUNNY_STREAM_ENABLED', '').lower() not in ('true', '1', 'yes'):
        return 0
    library = live_library_id()
    client = client or BunnyStream(library)
    if str(client.library_id) != library:
        raise VideoImportError('The recording organizer must use the LiveSessions library.')
    limit = max(1, min(limit, 100))
    fingerprint = hashlib.sha256(('bunny-live-collection-scan:' + library).encode()).hexdigest()
    scan, _ = CurriculumVideoImport.objects.get_or_create(fingerprint=fingerprint, defaults={
        'id': uuid.uuid5(uuid.NAMESPACE_URL, fingerprint), 'target_kind': SCAN_KIND,
        'target_id': library, 'component_id': '', 'title': 'LiveSessions collection organization',
        'library_id': library, 'status': 'ready', 'scope': {'next_page': 2},
    })
    if scan.target_kind != SCAN_KIND or scan.library_id != library or scan.video_id:
        raise VideoImportError('The LiveSessions scan identity conflicts with another import.')
    cursor = max(2, int(scan.scope.get('next_page') or 2))
    pages = [(1, _page(client, 1))]
    if len(pages[0][1]) == 100:
        pages.append((cursor, _page(client, cursor)))
    candidates = {}
    for _, videos in pages:
        for video in videos:
            # Preserve folders already chosen by an operator. Historical data
            # backfills review and verify all explicit destinations separately.
            occurrence = _occurrence(video)
            if video.get('status') == 4 and not video.get('collectionId') and occurrence:
                candidates[video['guid']] = (video, occurrence)
    owners = _owners({occurrence for _, occurrence in candidates.values()})
    eligible = []
    for video, occurrence in candidates.values():
        owner = owners.get(occurrence)
        if not owner:
            log.warning('Unfiled LiveSessions video has no canonical occurrence owner; review required.')
        elif not owner.get('deleted_at') and not owner.get('is_programme_deleted') and owner.get('source_type') != 'free_course':
            eligible.append((video, occurrence, owner))
    moved = 0
    needs_retry = False
    for video, occurrence, owner in eligible[:limit]:
        try:
            job = queue_module(owner, library_id=library, wake=False)
            if job is None:
                continue
            destination = ensure_collection(job, client)
            client.move_to_collection(video['guid'], destination)
            with transaction.atomic():
                locked = CurriculumVideoImport.objects.select_for_update().get(pk=job.pk)
                bindings = dict(locked.scope.get('existing_recording_bindings') or {})
                bindings[video['guid']] = {**bindings.get(video['guid'], {}),
                                          'occurrence_id': occurrence, 'series_id': owner['series_id']}
                locked.scope = {**locked.scope, 'existing_recording_bindings': bindings}
                locked.save(update_fields=['scope', 'updated_at'])
            moved += 1
        except VideoImportError as failure:
            needs_retry = True
            log.warning('LiveSessions folder placement needs retry (%s).', type(failure).__name__)
    if not needs_retry and len(eligible) <= limit:
        next_page = cursor + 1 if len(pages) > 1 and len(pages[-1][1]) == 100 else 2
        with transaction.atomic():
            locked = CurriculumVideoImport.objects.select_for_update().get(pk=scan.pk)
            if max(2, int(locked.scope.get('next_page') or 2)) == cursor:
                locked.scope = {**locked.scope, 'next_page': next_page}
                locked.save(update_fields=['scope', 'updated_at'])
    return moved
