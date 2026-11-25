"""Canonical Free Course identities using the shared durable Bunny pipeline."""
from django.db import DatabaseError, transaction
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_protect
from django.views.decorators.http import require_http_methods

from learner_api.constants import ACCESS_CURRICULUM, ACCESS_FREE_COURSE_AUTHORING
from login.permissions import require_access, require_all_access

from curriculum_api.catalogue.api import free_course_authoring as documents
from curriculum_api.catalogue.infrastructure import free_course_rows as catalogue
from curriculum_api.bunny_stream import FREE_COURSE_COLLECTION
from curriculum_api.bunny_stream import VideoImportError
from curriculum_api.catalogue.domain.free_course_authoring import MutationError
from curriculum_api.catalogue.domain.free_course_authoring import _check_revision
from curriculum_api.catalogue.domain.free_course_authoring import _expected
from curriculum_api.catalogue.infrastructure.free_course_writer_mode import CANONICAL
from curriculum_api.catalogue.infrastructure.free_course_writer_mode import FreeCourseWriterDisabled
from curriculum_api.catalogue.infrastructure.free_course_writer_mode import _catalogue_lock
from curriculum_api.catalogue.infrastructure.free_course_writer_mode import require_mode


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
    from curriculum_api.video_imports import _component_video

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
    from curriculum_api.video_imports import _component_video

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
