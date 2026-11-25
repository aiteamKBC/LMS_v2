"""Free Course HTTP composition and existing public read exports."""
from __future__ import annotations
import copy
import json
import logging
from urllib.parse import quote
from django.db import DatabaseError
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_protect
from django.views.decorators.http import require_GET
from login.permissions import require_role
from curriculum_api.catalogue.infrastructure import free_course_rows as free_course_catalogue
from curriculum_api import schema_gate
from curriculum_api.catalogue.api.module_command_composition import curriculum_module_structure
from curriculum_api.catalogue.api.responses import json_body
from curriculum_api.catalogue.api.responses import json_error
from ..application import free_course_structure_edits as edits
from curriculum_api.module_collaboration import collaboration_configuration
from curriculum_api.catalogue.infrastructure.revision_runtime import lock_module_structure_row
from curriculum_api.catalogue.api.structure_composition import read_module_structure_with_revision
from curriculum_api.catalogue.api.revision_adapters import refuse_stale_module_write
from curriculum_api.catalogue.api.adapters import requested_expected_revision
from ..domain.free_course_structure_edits import _delta
from ..infrastructure.free_course_structure_reads import _course, _active_module
from curriculum_api.video_imports import tracked_save
from curriculum_api.catalogue.application import free_course_queries as _queries
from curriculum_api.catalogue.infrastructure import free_course_document_reads as _reads
from curriculum_api.catalogue.domain.free_course_integrity import FreeCourseNotFound
from curriculum_api.catalogue.domain.free_course_integrity import InvalidFreeCourseId
from curriculum_api.catalogue.domain.free_course_integrity import normalize_course_id
from curriculum_api.catalogue.domain.free_course_integrity import _decode_settings
from curriculum_api.catalogue.domain.free_course_integrity import _linked_quiz_id
from curriculum_api.catalogue.domain.free_course_integrity import _issue
from curriculum_api.catalogue.domain.free_course_integrity import _quiz_reference
from curriculum_api.catalogue.domain.free_course_integrity import _integrity_status
from curriculum_api.catalogue.domain.free_course_integrity import _duplicate_order_issues
from curriculum_api.catalogue.domain.free_course_integrity import _decode_components
from curriculum_api.catalogue.domain.free_course_integrity import FREE_COURSE_PROGRAMME_MARKER
from curriculum_api.catalogue.domain.free_course_revisions import _plain_decimal
from curriculum_api.catalogue.domain.free_course_revisions import canonical_value
from curriculum_api.catalogue.domain.free_course_revisions import canonical_json_bytes
from curriculum_api.catalogue.domain.free_course_revisions import _revision
from curriculum_api.catalogue.domain.free_course_revisions import catalogue_revision
from curriculum_api.catalogue.domain.free_course_revisions import _row_values
from curriculum_api.catalogue.domain.free_course_revisions import course_revision
from curriculum_api.catalogue.domain.free_course_revisions import CATALOGUE_SCHEMA_VERSION
from curriculum_api.catalogue.domain.free_course_revisions import CATALOGUE_REVISION_PREFIX
from curriculum_api.catalogue.domain.free_course_revisions import COURSE_REVISION_PREFIX
from curriculum_api.catalogue.domain.free_course_revisions import COURSE_REVISION_COLUMNS
from curriculum_api.catalogue.domain.free_course_revisions import WEEK_REVISION_COLUMNS
from curriculum_api.catalogue.domain.free_course_revisions import COMPONENT_REVISION_COLUMNS
from curriculum_api.catalogue.domain.free_course_revisions import QUIZ_REVISION_COLUMNS
from curriculum_api.catalogue.domain.free_course_revisions import QUIZ_LINK_REVISION_COLUMNS
from curriculum_api.catalogue.application.free_course_documents import _public_course
from curriculum_api.catalogue.application.free_course_documents import _catalogue_from_rows
from curriculum_api.catalogue.application.free_course_documents import _assemble_course_document
from curriculum_api.catalogue.infrastructure.free_course_document_reads import _quote_ident
from curriculum_api.catalogue.infrastructure.free_course_document_reads import _table_name
from curriculum_api.catalogue.infrastructure.free_course_document_reads import _dict_rows
from curriculum_api.catalogue.infrastructure.free_course_document_reads import _quiz_rows
from curriculum_api.catalogue.infrastructure.free_course_document_reads import _quiz_link_rows
from curriculum_api.catalogue.infrastructure.free_course_document_reads import _current_quiz_link_clause
from curriculum_api.catalogue.infrastructure.free_course_document_reads import _read_snapshot
from curriculum_api.catalogue.infrastructure.free_course_document_reads import _require_course_tables
from curriculum_api.catalogue.infrastructure.free_course_document_reads import _quiz_link_rows_for_courses
from curriculum_api.catalogue.infrastructure.free_course_document_reads import QUIZZES_TABLE
from curriculum_api.catalogue.infrastructure.free_course_document_reads import QUIZ_LINKS_TABLE


def catalogue_document(*, read_snapshot=True):
    return _queries.catalogue_document(reads=_reads, read_snapshot=read_snapshot)


def catalogue_with_documents():
    return _queries.catalogue_with_documents(reads=_reads)


def course_document(course_id, *, read_snapshot=True):
    return _queries.course_document(course_id, reads=_reads, read_snapshot=read_snapshot)


def course_documents(course_rows):
    return _queries.course_documents(course_rows, reads=_reads)


# ---------------------------------------------------------------------------
# CRUD HTTP views â€” catalogue listing and course-structure editing
# ---------------------------------------------------------------------------

logger = logging.getLogger(__name__)
_save_structure = tracked_save(curriculum_module_structure, 'module')


def _reply(data, *, status=200):
    response = JsonResponse(data, status=status)
    response['Cache-Control'] = 'no-store'
    return response


@require_role('admin', 'staff')
@require_GET
def catalogue(request):
    """Compatibility catalogue backed by canonical Free Course identities."""
    try:
        rows = free_course_catalogue.courses(columns=[
            'id', 'course_name', 'week_count', 'component_count',
        ])
        results = [{**row, 'courseId': row['id'], 'courseName': row['course_name'],
                    # Retained response keys only; there is no module relation.
                    'moduleCatalogueId': None,
                    'editable': True,
                    'structureUrl': '/curriculum_api/curriculum/free-courses/'
                                    + quote(row['id'], safe='') + '/authoring/'}
                   for row in rows]
        return _reply({'results': results, 'count': len(results)})
    except DatabaseError:
        logger.exception('Unable to read the free-course authoring catalogue.')
        return json_error('The free-course catalogue could not be read. Retry shortly.', status=503)


def _forward_save(request, module_id, payload):
    # Keep the authenticated request/session and CSRF decision. Only adapt the
    # body to the shared, guarded structure writer; never issue another HTTP call.
    forwarded = copy.copy(request)
    forwarded.method = 'PATCH'
    forwarded._body = json.dumps(payload).encode('utf-8')
    forwarded.META = {**request.META, 'CONTENT_TYPE': 'application/json',
                      'CONTENT_LENGTH': str(len(forwarded._body))}
    return _save_structure(forwarded, module_catalogue_id=module_id)


@require_role('admin', 'staff')
@csrf_protect
def authoring(request, course_id, *, kind='structure', item_id=None):
    methods = {'GET', 'PATCH'} if kind == 'structure' else {'GET'} if kind == 'collaboration' else (
        {'GET', 'PATCH', 'DELETE'} if item_id else {'POST'})
    if request.method not in methods:
        return json_error('Method not allowed.', status=405)
    payload = json_body(request) if request.method != 'GET' else {}
    if not isinstance(payload, dict):
        return json_error('Invalid JSON body.', status=400)
    try:
        course = _course(course_id)
        if not course:
            return json_error('Free course not found.', status=404)
        module_id = course.get('module_catalogue_id')
        if not module_id:
            return json_error('This legacy course needs adoption into Module Builder before concurrent editing.',
                                status=409, code='free_course_adoption_required')
        with transaction.atomic():
            # The same lock as Builder, conversion and field reservations.
            # Recheck type after locking: conversion must not race a free edit.
            return edits.edit_structure(request.method, course_id, course, module_id, kind, item_id, payload,
                lock_module_structure_row=lock_module_structure_row, _active_module=_active_module,
                collaboration_configuration=lambda ident: collaboration_configuration(request, ident),
                refuse_stale_module_write=lambda data, ident: refuse_stale_module_write(request, data, ident),
                read_module_structure_with_revision=read_module_structure_with_revision,
                requested_expected_revision=lambda data: requested_expected_revision(request, data),
                forward_save=lambda ident, data: _forward_save(request, ident, data), reply=_reply, json_error=json_error,
                save_failed=lambda response: response.status_code >= 300,
                saved_payload=lambda response: json.loads(response.content))
    except LookupError as exc:
        return json_error(str(exc), status=404)
    except (ValueError, TypeError) as exc:
        return json_error(str(exc), status=400)
    except DatabaseError:
        logger.exception('Unable to edit a free course.')
        return json_error('The course could not be checked or saved. Your changes have not been applied.', status=503)
