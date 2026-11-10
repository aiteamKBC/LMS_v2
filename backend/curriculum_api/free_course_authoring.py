"""Course-scoped editing through the same versioned writer as Module Builder.

The free-course tables retain catalogue identity; their module/week/component
links identify the existing authoring records. Never rewrite the free library.
"""
import copy
import json
import logging
from urllib.parse import quote
from uuid import uuid4

from django.db import DatabaseError, transaction
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_protect
from django.views.decorators.http import require_GET

from login.permissions import require_role
from . import views as v
from .module_collaboration import collaboration_configuration
from .video_imports import tracked_save

logger = logging.getLogger(__name__)
_save_structure = tracked_save(v.curriculum_module_structure, 'module')
_metadata = {'expectedRevision', 'collaboration'}
_week_fields = {'title', 'summary', 'learningOutcomes', 'ksbMappings'}
_component_fields = {
    'type', 'title', 'description', 'expectedOtjh', 'points', 'reflectionRequired',
    'reflectionQuestion', 'workplaceEvidenceRequired', 'tutorValidationRequired', 'settings', 'ksbMappings',
}


def _course(course_id):
    rows = v.free_programme_fetch_all(v.FREE_COURSES_TABLE, 'id = %s', [course_id],
        columns=['id', 'module_catalogue_id', 'deleted_at', 'converted_at'])
    if not rows or rows[0].get('deleted_at') or rows[0].get('converted_at'):
        return None
    return rows[0]


def _active_module(course):
    row = v.authoring_module_exists(course.get('module_catalogue_id'))
    return bool(row and row.get('source_type') == 'free_course'
                and not v.curriculum_row_effectively_deleted(row))


def _reply(data, *, status=200):
    response = JsonResponse(data, status=status)
    response['Cache-Control'] = 'no-store'
    return response


@require_role('admin', 'staff')
@require_GET
def catalogue(request):
    """Expose free-course IDs and their canonical Builder identities to clients."""
    try:
        rows = v.free_programme_fetch_all(v.FREE_COURSES_TABLE,
            'deleted_at is null and converted_at is null', order_sql='display_order, course_name, id',
            columns=['id', 'course_name', 'module_catalogue_id', 'week_count', 'component_count'])
        active = {row['module_catalogue_id'] for row in v.authoring_fetch_all(
            v.AUTHORING_MODULES_TABLE, "source_type = 'free_course' and deleted_at is null",
            columns=['module_catalogue_id', 'is_programme_deleted'])
            if not v.curriculum_row_effectively_deleted(row)}
        results = [{**row, 'courseId': row['id'], 'courseName': row['course_name'],
                    'moduleCatalogueId': row.get('module_catalogue_id'),
                    'editable': row.get('module_catalogue_id') in active,
                    'structureUrl': '/curriculum_api/curriculum/free-courses/' + quote(row['id'], safe='') + '/structure/'}
                   for row in rows]
        return _reply({'results': results, 'count': len(results)})
    except DatabaseError:
        logger.exception('Unable to read the free-course authoring catalogue.')
        return v.json_error('The free-course catalogue could not be read. Retry shortly.', status=503)


def _forward_save(request, module_id, payload):
    # Keep the authenticated request/session and CSRF decision. Only adapt the
    # body to the shared, guarded structure writer; never issue another HTTP call.
    forwarded = copy.copy(request)
    forwarded.method = 'PATCH'
    forwarded._body = json.dumps(payload).encode('utf-8')
    forwarded.META = {**request.META, 'CONTENT_TYPE': 'application/json',
                      'CONTENT_LENGTH': str(len(forwarded._body))}
    return _save_structure(forwarded, module_catalogue_id=module_id)


def _delta(stored, kind, item_id, payload, method):
    """Change exactly one item; keep the latest order and all unnamed fields."""
    weeks = stored.get('weekStructure') or []
    week_by_id = {week['id']: week for week in weeks}
    components = {c['id']: c for week in weeks for c in week.get('components') or []}
    fields = _component_fields if kind == 'component' else _week_fields
    allowed = fields | _metadata | ({'weekId'} if method == 'POST' and kind == 'component' else set())
    if set(payload) - allowed:
        raise ValueError('Unsupported fields: ' + ', '.join(sorted(set(payload) - allowed)))
    if method == 'DELETE' and set(payload) - _metadata:
        raise ValueError('A delete only accepts expectedRevision and collaboration metadata.')
    if 'settings' in payload and not isinstance(payload['settings'], dict):
        raise ValueError('settings must be an object; clear an individual setting explicitly.')
    if 'ksbMappings' in payload and not isinstance(payload['ksbMappings'], list):
        raise ValueError('ksbMappings must be a list.')
    delta = {'weekOrder': list(week_by_id),
             'componentOrder': {w['id']: [c['id'] for c in w.get('components') or []] for w in weeks},
             'weeks': {}, 'components': {}}
    table = components if kind == 'component' else week_by_id
    if method == 'POST':
        if not payload.get('title') or (kind == 'component' and not payload.get('type')):
            raise ValueError('A title and, for a component, a type are required.')
        item_id = ('COMP-' if kind == 'component' else 'WEEK-') + uuid4().hex.upper()
        if kind == 'component':
            week_id = payload.get('weekId')
            if week_id not in week_by_id:
                raise LookupError('Week not found in this free course.')
            delta['componentOrder'][week_id].append(item_id)
            current = {'id': item_id, 'weekId': week_id, 'settings': {}, 'ksbMappings': []}
        else:
            delta['weekOrder'].append(item_id)
            delta['componentOrder'][item_id] = []
            current = {'id': item_id, 'weekNumber': len(weeks) + 1}
    else:
        if item_id not in table:
            raise LookupError('Item not found in this free course.')
        current = table[item_id]
    if method == 'DELETE':
        if kind == 'component':
            for ids in delta['componentOrder'].values():
                if item_id in ids:
                    ids.remove(item_id)
        else:
            delta['weekOrder'].remove(item_id)
            del delta['componentOrder'][item_id]
    else:
        changed = {**current, **{key: value for key, value in payload.items() if key in fields}, 'id': item_id}
        if 'settings' in payload:
            changed['settings'] = {**(current.get('settings') or {}), **payload['settings']}
        if kind == 'week':
            changed.pop('components', None)
        delta['components' if kind == 'component' else 'weeks'][item_id] = changed
    body = {key: value for key, value in stored.items() if key not in {'weeks', 'weekStructure'}}
    body.update({key: value for key, value in payload.items() if key in _metadata})
    body.update(saveMode='partial', structureDelta=delta)
    return body, item_id


@require_role('admin', 'staff')
@csrf_protect
def authoring(request, course_id, *, kind='structure', item_id=None):
    methods = {'GET', 'PATCH'} if kind == 'structure' else {'GET'} if kind == 'collaboration' else (
        {'GET', 'PATCH', 'DELETE'} if item_id else {'POST'})
    if request.method not in methods:
        return v.json_error('Method not allowed.', status=405)
    payload = v.json_body(request) if request.method != 'GET' else {}
    if not isinstance(payload, dict):
        return v.json_error('Invalid JSON body.', status=400)
    try:
        course = _course(course_id)
        if not course:
            return v.json_error('Free course not found.', status=404)
        module_id = course.get('module_catalogue_id')
        if not module_id:
            return v.json_error('This legacy course needs adoption into Module Builder before concurrent editing.',
                                status=409, code='free_course_adoption_required')
        with transaction.atomic():
            # The same lock as Builder, conversion and field reservations.
            # Recheck type after locking: conversion must not race a free edit.
            v.lock_module_structure_row(module_id)
            if not _active_module(course):
                return v.json_error('Free course not found or already converted.', status=404)
            if kind == 'collaboration':
                return collaboration_configuration(request, module_id)
            if request.method != 'GET':
                refused = v.refuse_stale_module_write(request, payload, module_id)
                if refused is not None:
                    return refused
            stored = v.read_module_structure_with_revision(module_id)
            if not stored:
                return v.json_error('Free course not found.', status=404)
            if request.method == 'GET':
                if kind == 'structure':
                    return _reply({**stored, 'courseId': course_id, 'moduleCatalogueId': module_id})
                items = stored.get('weekStructure') or []
                if kind == 'component':
                    items = [c for w in items for c in w.get('components') or []]
                item = next((item for item in items if item['id'] == item_id), None)
                if item is None:
                    return v.json_error('Item not found in this free course.', status=404)
                return _reply({kind: item, 'courseId': course_id, 'moduleCatalogueId': module_id,
                               'structureRevision': stored['structureRevision']})
            if kind == 'structure':
                body = {**payload, 'expectedRevision': v.requested_expected_revision(request, payload)}
            else:
                payload = {**payload, 'expectedRevision': v.requested_expected_revision(request, payload)}
                body, item_id = _delta(stored, kind, item_id, payload, request.method)
            response = _forward_save(request, module_id, body)
            if response.status_code >= 300:
                return response
            saved = json.loads(response.content)
            return _reply({**saved, 'courseId': course_id, 'moduleCatalogueId': module_id,
                           **({'itemId': item_id} if item_id else {}),
                           **({'deleted': True, 'permanent': False} if request.method == 'DELETE' else {})},
                          status=201 if request.method == 'POST' else 200)
    except LookupError as exc:
        return v.json_error(str(exc), status=404)
    except (ValueError, TypeError) as exc:
        return v.json_error(str(exc), status=400)
    except DatabaseError:
        logger.exception('Unable to edit a free course.')
        return v.json_error('The course could not be checked or saved. Your changes have not been applied.', status=503)
