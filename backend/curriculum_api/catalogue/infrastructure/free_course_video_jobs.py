"""Canonical video scope and durable enqueue adapter; no HTTP dependency."""
from django.db import transaction
from . import free_course_rows as catalogue
from curriculum_api.bunny_stream import FREE_COURSE_COLLECTION, VideoImportError

def target(course_id):
    courses = catalogue.courses(course_ids=[course_id])
    if not courses:
        raise VideoImportError('This Free Course is no longer available.')
    weeks = catalogue.weeks(course_ids=[course_id], columns=['id'])
    rows = catalogue.components(week_ids=[row['id'] for row in weeks])
    scope = {key: '' for key in ('programme_id', 'programme_name', 'cohort_id', 'cohort_name', 'group_id', 'group_name')}
    scope.update(target_kind='free_course', target_id=course_id,
                 free_course_id=course_id, free_course_module_id=course_id,
                 free_course_name=courses[0]['course_name'], module_id=course_id,
                 module_title=courses[0]['course_name'], course_type='free_course',
                 collection_name=FREE_COURSE_COLLECTION)
    return catalogue.FREE_COMPONENTS_TABLE, [row for row in rows if row['type'] == 'video'], scope


def queue_saved_videos(course_id, before, document, requested_ids=()):
    from curriculum_api import video_imports as imports

    if not imports.enabled():
        return
    previous = {row['id']: imports.source_url(imports._settings(row)) for row in before if row['type'] == 'video'}
    mapping = document.get('clientIdMap', {}).get('components', {})
    requested = {mapping.get(value, value) for value in requested_ids if isinstance(value, str)} if isinstance(requested_ids, list) else set()
    _, rows, scope = target(course_id)
    for row in rows:
        if row['id'] in requested or imports.source_url(imports._settings(row)) != previous.get(row['id'], ''):
            imports.enqueue_saved_video('free_course', course_id, row, scope)
    transaction.on_commit(imports.wake_worker)
