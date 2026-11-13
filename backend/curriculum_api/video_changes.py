"""Turn committed database source-change events into existing Bunny imports."""
import logging
from datetime import timedelta

from django.db import connection, transaction
from django.utils import timezone

from .bunny_stream import VideoImportError, is_bunny_url
from .models import CurriculumVideoChange, CurriculumVideoImport
from .video_sources import source_url

logger = logging.getLogger(__name__)


def _enqueue_change(change):
    from . import video_imports as imports

    source = source_url(change.settings)
    if not source or is_bunny_url(source) or source == source_url(change.previous_settings):
        return
    _, rows, scope = imports.target(change.target_kind, change.target_id)
    component = next((row for row in rows if row['id'] == change.component_id), None)
    if component is None or source_url(imports._settings(component)) != source:
        # Deleted/retyped/replaced while the worker was offline. A newer source
        # has its own event; never restore the earlier source or upload it now.
        return
    if scope.get('free_course_module_id'):
        if not str(scope.get('free_course_name') or '').strip():
            raise VideoImportError('Save a name for this free course before automatic storage. The worker will retry.')
    elif not (scope.get('programme_id') or scope.get('programme_name')):
        # External importers may create the component and assign its programme
        # in separate transactions. Retain detection until routing is possible.
        raise VideoImportError('Assign a programme to this video before automatic storage. The worker will retry.')
    existing = CurriculumVideoImport.objects.filter(
        target_kind=change.target_kind, target_id=change.target_id,
        component_id=change.component_id,
    )
    if existing.filter(requested_at__gte=change.created_at).exists():
        # The normal API already queued this save, or a newer MP4 upload/import
        # took its place. Do not make an old event become the newest request.
        return
    imports.enqueue(change.target_kind, change.target_id, component, scope)


def capture_pending(limit=20):
    """Acknowledge only with a durable import; failed events stay retryable.

    Lock individual events, never components. There is no remote IO in this
    transaction and SKIP LOCKED lets multiple workers drain independent events.
    """
    from .video_imports import enabled

    if not enabled():
        return 0
    checked = 0
    for _ in range(max(0, limit)):
        with transaction.atomic():
            events = CurriculumVideoChange.objects.filter(available_at__lte=timezone.now()).order_by('id')
            if connection.features.has_select_for_update_skip_locked:
                events = events.select_for_update(skip_locked=True)
            else:
                events = events.select_for_update()
            change = events.first()
            if change is None:
                break
            try:
                # Roll back any partial journal write before recording a retry.
                with transaction.atomic():
                    _enqueue_change(change)
            except Exception as exc:
                change.attempts += 1
                change.error = str(exc) if isinstance(exc, VideoImportError) else (
                    'Video change could not be queued. The worker will retry.')
                change.available_at = timezone.now() + timedelta(seconds=min(60 * change.attempts, 300))
                change.save(update_fields=['attempts', 'error', 'available_at'])
                logger.warning('Curriculum video change %s could not be queued; retry retained.', change.id)
            else:
                change.delete()
            checked += 1
    return checked
