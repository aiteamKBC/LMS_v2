"""Persist device videos for LMS playback before copying them to Bunny."""
import hashlib
import json
import re
from contextlib import contextmanager

from django.db import connection, transaction
from django.utils.text import get_valid_filename

from . import upload_storage
from .bunny_stream import VideoImportError
from .video_sources import source_url


from curriculum_api.catalogue.infrastructure.video_paths import (
    UPLOAD_ROOT,
    VIDEO_PATH,
    stored_video_path,
)


@contextmanager
def stored_video(source):
    relative = stored_video_path(source)
    if not relative:
        raise VideoImportError('The saved LMS video path is invalid.')
    path, cleanup = upload_storage.local_copy(relative)
    try:
        if path is None:
            raise VideoImportError('The LMS video file is unavailable. Upload the MP4 again.')
        with path.open('rb') as handle:
            yield handle
    finally:
        cleanup()


def save_mp4(kind, target_id, component, scope, uploaded, *, title='', expected_revision=None, on_saved=None):
    """Return the durable import and a narrow settings patch for the editor.

    Storage IO happens before locking the component. A source/scope changed in
    the meantime is a conflict; unrelated settings are read again under the lock.
    Source persistence and queue creation commit together. Bunny IO happens later.
    """
    from . import video_imports as imports
    from .learning_storage import course

    if kind not in ('module', 'template', 'free_course') or not all(
        re.fullmatch(r'[\w-]+', value, re.ASCII) for value in (target_id, component['id'])
    ):
        raise VideoImportError('The video component identity is invalid.')
    digest = hashlib.sha256()
    for chunk in uploaded.chunks():
        digest.update(chunk)
    uploaded.seek(0)
    relative = f'{UPLOAD_ROOT}/videos/{kind}/{target_id}/{component["id"]}/{digest.hexdigest()}.mp4'
    try:
        # Identical file retries reuse the durable source and import fingerprint.
        if not upload_storage.exists(relative):
            relative = upload_storage.store(uploaded, relative, 'video/mp4')
    except Exception:
        raise VideoImportError('The MP4 could not be saved for LMS playback. Retry the upload.') from None
    url = upload_storage.UPLOAD_URL_PREFIX + relative.removeprefix(f'{UPLOAD_ROOT}/')
    updates = {
        'videoUrl': url, 'sourceType': 'HTML (MP4)', 'provider': 'Upload file',
        'embedCode': '', 'legacyUnsupportedSource': False, 'legacySourceType': '',
        'uploadedFileUrl': url, 'uploadedFileName': get_valid_filename(uploaded.name or 'video.mp4'),
        'uploadedFileSize': uploaded.size, 'uploadedFileContentType': 'video/mp4',
        'uploadSource': 'Device upload',
    }
    views = imports._views()
    with transaction.atomic():
        # Lock the physical owner before resolving the component. This also
        # serializes a native course conversion against attaching the file.
        owner = course(target_id, lock=True) if kind == 'module' else None
        if kind == 'free_course':
            from curriculum_api.catalogue.api.free_course_videos import check_revision
            check_revision(target_id, expected_revision)
            table_sql = views.authoring_table_name('free_programme_components')
            weeks_sql = views.authoring_table_name('free_course_weeks')
            where = f'id = %s AND deleted_at IS NULL AND free_module_id IN (SELECT id FROM {weeks_sql} WHERE course_id = %s AND deleted_at IS NULL)'
            identity = [component['id'], target_id]
        elif owner is not None:
            table_sql = views.authoring_table_name('free_programme_components')
            weeks_sql = views.authoring_table_name('free_course_weeks')
            where = f'content_ref = %s AND free_module_id IN (SELECT id FROM {weeks_sql} WHERE course_id = %s)'
            identity = [component['id'], owner['id']]
        else:
            table = views.AUTHORING_COMPONENTS_TABLE if kind == 'module' else views.WEEK_TEMPLATE_COMPONENTS_TABLE
            table_sql = views.authoring_table_name(table)
            parent = 'module_catalogue_id' if kind == 'module' else 'week_template_id'
            where = f'id = %s AND {parent} = %s'
            identity = [component['id'], target_id]
        with connection.cursor() as cursor:
            lock = ' FOR UPDATE' if connection.vendor == 'postgresql' else ''
            cursor.execute(f'SELECT settings_json FROM {table_sql} WHERE {where}{lock}', identity)
            row = cursor.fetchone()
            _, rows, current_scope = imports.target(kind, target_id)
            current = next((r for r in rows if r['id'] == component['id']), None)
            if row is None or current is None or any(
                current_scope.get(key) != scope.get(key) for key in ('programme_id', 'cohort_id', 'group_id')
            ):
                raise VideoImportError('The video scope changed during upload. Refresh before retrying.')
            settings = imports._settings({'settings_json': row[0]})
            if source_url(settings) not in (source_url(imports._settings(component)), url):
                raise VideoImportError('The video source changed during upload. Refresh before retrying.')
            saved = {**settings, **updates}
            cursor.execute(f'UPDATE {table_sql} SET settings_json = %s WHERE {where}', [json.dumps(saved), *identity])
            asset = imports.enqueue(kind, target_id, {**current, 'settings_json': saved}, current_scope, title=title)
            if asset.status == 'failed':
                asset.status, asset.error = 'queued', ''
                asset.save(update_fields=['status', 'error', 'updated_at'])
        transaction.on_commit(views.invalidate_curriculum_cache)
        if on_saved is not None:
            from curriculum_api.catalogue.api.free_course_authoring import course_document
            on_saved(course_document(target_id, read_snapshot=False))
    uploaded.seek(0)
    return asset, updates
