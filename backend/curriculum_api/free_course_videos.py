"""Canonical Free Course identities using the shared durable Bunny pipeline."""
from django.db import DatabaseError, transaction
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_protect
from django.views.decorators.http import require_http_methods

from learner_api.constants import ACCESS_CURRICULUM, ACCESS_FREE_COURSE_AUTHORING
from login.permissions import require_access, require_all_access

from . import free_course_authoring as documents, free_course_catalogue as catalogue
from .bunny_stream import FREE_COURSE_COLLECTION, VideoImportError
from .free_course_authoring_mutations import MutationError, _check_revision, _expected
from .free_course_writer_mode import CANONICAL, FreeCourseWriterDisabled, _catalogue_lock, require_mode


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
    from . import video_imports as imports

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


def check_revision(course_id, expected):
    """Called inside the upload's transaction, after file storage and before SQL."""
    _catalogue_lock()
    require_mode(CANONICAL)
    document = documents.course_document(course_id, read_snapshot=False)
    _check_revision(expected, document['revision'], scope='course')
    if document['integrity']['status'] == 'blocked':
        raise MutationError('free_course_integrity_blocked', 'Resolve Free Course integrity issues before uploading.', status=409)


@require_all_access(ACCESS_CURRICULUM, ACCESS_FREE_COURSE_AUTHORING)
def _write(request, course_id, component_id):
    from .video_imports import _component_video

    expected = _expected(request.POST.dict())
    require_mode(CANONICAL)
    if request.FILES.get('file'):
        # save_mp4 checks the revision under the catalogue lock after storage IO.
        return _component_video(request, 'free_course', course_id, component_id, expected_revision=expected)
    with transaction.atomic():
        check_revision(course_id, expected)
        return _component_video(request, 'free_course', course_id, component_id)


@csrf_protect
@require_access(ACCESS_CURRICULUM)
@require_http_methods(['GET', 'POST'])
def component_video(request, course_id, component_id):
    from .video_imports import _component_video

    try:
        if request.method == 'POST':
            response = _write(request, course_id, component_id)
        else:
            response = _component_video(request, 'free_course', course_id, component_id)
    except MutationError as exc:
        response = JsonResponse({'error': str(exc), 'code': exc.code, **exc.details}, status=exc.status)
    except FreeCourseWriterDisabled:
        response = JsonResponse({'error': 'Free Course authoring is disabled.', 'code': 'free_course_writer_disabled'}, status=503)
    except documents.FreeCourseNotFound:
        response = JsonResponse({'error': 'Free Course not found.'}, status=404)
    except DatabaseError:
        response = JsonResponse({'error': 'Free Course video storage is temporarily unavailable.'}, status=503)
    response['Cache-Control'] = 'private, no-store'
    return response
