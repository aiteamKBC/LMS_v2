"""Learner-scoped view over the historical Last_audit activity mirror."""

import io
import json
from uuid import UUID, uuid4

from django.db import DatabaseError, connections
from django.core.files.base import ContentFile
from django.http import JsonResponse
from django.middleware.csrf import get_token
from django.views.decorators.http import require_GET, require_POST

from audit_api.last_audit_ledger_views import _connection
from audit_api.learner_exclusions import is_excluded_learner
from login.permissions import learner_self_or_staff, learner_self_only, staff_only
from login.sessions import authenticate_request

from .learner_detail import SOURCE_MODELS
from .student_activity_data import read_student_activity, read_student_material
from .student_activity_access import student_activity_available
from .student_activity_data import summarize_activities
from . import subject_store
from .subject_content import (ContentUnavailable, material_schema, build_material, public_quiz, as_list)
from .subject_dates import activity_schedule

CURRENT_SUBJECTS_SQL = '''
    SELECT DISTINCT cm.module_catalogue_id,cm.title
    FROM "Learner".learners l
    JOIN "Learner".learner_training_plan_modules m ON m.learner_id=l.id
    JOIN curriculum.modules cm ON cm.module_catalogue_id=coalesce(m.curriculum_module_id,nullif(m.module_ref,''))
    LEFT JOIN curriculum.groups g ON g.group_id=cm.group_id
    LEFT JOIN curriculum.cohorts ch ON ch.cohort_id=cm.cohort_id
    LEFT JOIN curriculum.programmes p ON p.programme_id=cm.programme_id
    WHERE l.enrolment_id=%s AND cm.deleted_at IS NULL AND NOT coalesce(cm.is_programme_deleted,false)
      AND (g.group_id IS NULL OR (g.deleted_at IS NULL AND NOT coalesce(g.is_programme_deleted,false)))
      AND (ch.cohort_id IS NULL OR (ch.deleted_at IS NULL AND NOT coalesce(ch.is_programme_deleted,false)))
      AND (p.programme_id IS NULL OR (p.deleted_at IS NULL AND NOT coalesce(p.is_archived,false)))
'''

CURRENT_DATES_SQL = '''
    SELECT c.id,c.title,c.created_at FROM curriculum.components c
    JOIN curriculum.weeks w ON w.id=c.week_id
    WHERE c.module_catalogue_id=ANY(%s)
      AND c.deleted_at IS NULL AND NOT coalesce(c.is_programme_deleted,false)
      AND w.deleted_at IS NULL AND NOT coalesce(w.is_programme_deleted,false)
'''


def _error(message, status):
    return JsonResponse({"error": message}, status=status)


@require_GET
@learner_self_or_staff(kwarg="pk")
def student_activity(request, kind, pk):
    """Return LMS activities for the requested learner, never for a client id.

    This deliberately resolves Aptem identity from enrolment.Created_users.
    The caller supplies only the learner record id already protected by the
    ownership gate, which prevents changing a query string to inspect another
    learner's audit history.
    """
    model = SOURCE_MODELS.get(kind)
    if model is None:
        return _error("Learner not found.", 404)

    try:
        source = model.all_learners.only("id", "aptem_id", "email").get(pk=pk)
    except model.DoesNotExist:
        return _error("Learner not found.", 404)
    except DatabaseError:
        return _error("Could not read the learner record.", 503)

    try:
        aptem_id = int(str(source.aptem_id or "").strip())
    except (TypeError, ValueError):
        return _error("This learner is not linked to Aptem.", 404)
    if not student_activity_available(aptem_id):
        return _error("This learner is not linked to Aptem.", 404)

    # Never forward client filters or Aptem ids into the historical reader.
    try:
        with _connection().cursor() as cursor:
            if request.GET.get("activity_id") is not None:
                try:
                    activity_id = int(request.GET["activity_id"])
                    group_id = int(request.GET.get("group_id", ""))
                except (ValueError, TypeError):
                    return _error("Invalid activity reference.", 400)
                payload = read_student_material(cursor, aptem_id, group_id, activity_id, include_source=True)
            else:
                payload = read_student_activity(cursor, aptem_id)
    except DatabaseError:
        return _error("Could not read Last_audit activities. Please try again.", 503)
    if payload is None or is_excluded_learner(aptem_id, payload["learner_name"]):
        return _error("No audit activity record is linked to this learner.", 404)
    audit_email = payload.pop('_identity_email', '') or payload.get('_source', {}).get('learner_email', '')
    if not _emails_match(getattr(source, 'email', ''), audit_email):
        return _error('The previous learning identity could not be verified.', 404)
    if '_source' in payload:
        return _material_response(request, pk, aptem_id, payload)
    try:
        saved = subject_store.state(pk, aptem_id)
    except DatabaseError:
        return _error('Could not load your latest progress. Please try again.', 503)
    payload.update(summarize_activities(subject_store.overlay_progress(payload['activities'], saved['progress'])))
    payload['module_count'] = len(payload.get('subjects') or []) or payload['module_count']
    payload['persistence_ready'] = saved['ready']
    allowed = {f"legacy:{item['group_id']}" for item in payload['activities']}
    payload['covers'] = {key: _cover_url(value) for key, value in saved['covers'].items() if key in allowed}
    account = authenticate_request(request)
    payload['can_manage_covers'] = bool(account and account.role in {'admin', 'staff'})
    response = JsonResponse(payload)
    response["Cache-Control"] = "private, no-store"
    return response


def _private(payload, status=200):
    response = JsonResponse(payload, status=status)
    response['Cache-Control'] = 'private, no-store'
    return response


def _emails_match(current, audited):
    current, audited = str(current or '').strip().casefold(), str(audited or '').strip().casefold()
    return not current or not audited or current == audited


def _cover_url(path):
    from curriculum_api.upload_storage import UPLOAD_URL_PREFIX, blob_name_for
    return UPLOAD_URL_PREFIX + blob_name_for(path)


def _definition_for(stored):
    from .media_proxy import _legacy_attachment_upload_path
    try:
        schema = material_schema(stored['_source']['activity_id'])
    except ContentUnavailable:
        schema = None
    def archive_url(reference):
        path = _legacy_attachment_upload_path(reference)
        return '/curriculum_api/curriculum/uploads/' + path if path else ''
    return build_material(stored, schema, attachment_resolver=archive_url)


def _material_response(request, pk, aptem_id, stored):
    row = stored['_source']
    definition = _definition_for(stored)
    try:
        saved = subject_store.state(pk, aptem_id, row['activity_id'])
    except DatabaseError:
        return _error('Could not load your attempt history. Please try again.', 503)
    account = authenticate_request(request)
    historical_answers = []
    for answer in as_list(row.get('quiz_answers')):
        if not isinstance(answer, dict):
            continue
        # Historical learner answers are reviewable; never forward their grading
        # keys as an indirect answer key for an open retake.
        historical_answers.append({key: answer.get(key) for key in (
            'question_id', 'question_body', 'question_type', 'learner_answer', 'is_correct',
        )})
    payload = {**definition, 'quiz': public_quiz(definition['quiz']),
               'learner_name': stored['learner_name'], 'history': saved['history'],
               'historical': {'score': row.get('quiz_score'), 'maximum_score': row.get('result_maximum_score'),
                              'passed': row.get('quiz_passed'), 'attempt_number': row.get('quiz_attempt_number'),
                              'answers': historical_answers, 'status': row.get('status')},
               'persistence_ready': saved['ready'],
               'can_attempt': bool(account and account.role == 'learner' and int(account.subject_id) == pk and saved['ready']),
               'csrf_token': get_token(request)}
    return _private(payload)


def _owned_material(kind, pk, group_id, activity_id):
    model = SOURCE_MODELS.get(kind)
    if model is None:
        raise LookupError('Learner not found.')
    try:
        source = model.all_learners.only('id', 'aptem_id', 'email').get(pk=pk)
    except model.DoesNotExist as error:
        raise LookupError('Learner not found.') from error
    if not student_activity_available(source.aptem_id):
        raise LookupError('No previous learning is linked to this learner.')
    aptem_id = int(str(source.aptem_id).strip())
    with _connection().cursor() as cursor:
        stored = read_student_material(cursor, aptem_id, group_id, activity_id, include_source=True)
    if stored is None or is_excluded_learner(aptem_id, stored['learner_name']):
        raise LookupError('Activity not found.')
    if not _emails_match(getattr(source, 'email', ''), stored['_source'].get('learner_email', '')):
        raise LookupError('The previous learning identity could not be verified.')
    return aptem_id, stored


@require_POST
@learner_self_only(kwarg='pk')
def start_subject_attempt(request, kind, pk, group_id, activity_id):
    try:
        aptem_id, stored = _owned_material(kind, pk, group_id, activity_id)
        definition = _definition_for(stored)
        if definition.get('quiz') and not definition['quiz']['ready']:
            return _error(definition['quiz']['message'], 409)
        if not definition['available']:
            return _error('No activity content is available yet.', 409)
        attempt_id = subject_store.start(pk, aptem_id, group_id, activity_id, definition)
        return _private({'attempt_id': attempt_id, 'definition': {**definition, 'quiz': public_quiz(definition['quiz'])}}, 201)
    except LookupError as error:
        return _error(str(error), 404)
    except (ContentUnavailable, subject_store.StoreUnavailable) as error:
        return _error(str(error), 503)
    except DatabaseError:
        return _error('Could not start this attempt. Please try again.', 503)


@require_POST
@learner_self_only(kwarg='pk')
def submit_subject_attempt(request, kind, pk, group_id, activity_id, attempt_id):
    try:
        if len(request.body) > 256 * 1024:
            return _error('The submitted answers are too large.', 413)
        payload = json.loads(request.body)
        if not isinstance(payload, dict):
            raise ValueError('Invalid submission.')
        UUID(str(attempt_id))
        aptem_id, _stored = _owned_material(kind, pk, group_id, activity_id)
        result = subject_store.finish(pk, aptem_id, group_id, activity_id, str(attempt_id),
                                      payload.get('answers', {}), payload.get('reading_confirmed') is True)
        return _private(result)
    except LookupError as error:
        return _error(str(error), 404)
    except subject_store.StoreUnavailable as error:
        return _error(str(error), 503)
    except (ValueError, TypeError) as error:
        return _error(str(error) if not isinstance(error, json.JSONDecodeError) else 'Invalid submission.', 400)
    except DatabaseError:
        return _error('Could not save your attempt. Please try again.', 503)


def _subject_exists(subject_ref):
    source, _, reference = subject_ref.partition(':')
    if source == 'legacy' and reference.isdigit():
        with _connection().cursor() as cur:
            cur.execute('SELECT 1 FROM "Last_audit".groups WHERE group_id=%s', [int(reference)])
            return bool(cur.fetchone())
    if source == 'current' and reference and len(reference) <= 160:
        with connections['enrolment'].cursor() as cur:
            cur.execute('SELECT 1 FROM curriculum.modules WHERE module_catalogue_id=%s AND NOT coalesce(is_programme_deleted,false)', [reference])
            return bool(cur.fetchone())
    return False


@require_GET
@learner_self_or_staff(kwarg='pk')
def subject_covers(request, pk):
    refs = list(dict.fromkeys(request.GET.get('refs', '').split(',')))
    if len(refs) > 150 or any(len(ref) > 180 for ref in refs):
        return _error('Invalid subject list.', 400)
    try:
        with connections['enrolment'].cursor() as cur:
            available = subject_store.ready(cur)
            covers = {}
            if available:
                cur.execute(f'SELECT subject_ref,storage_path FROM {subject_store.COVERS} WHERE subject_ref=ANY(%s)', [refs])
                covers = {key: _cover_url(path) for key, path in cur.fetchall()}
            native = [ref[8:] for ref in refs if ref.startswith('current:')]
            if native:
                cur.execute('SELECT module_catalogue_id,cover_image_url FROM curriculum.modules WHERE module_catalogue_id=ANY(%s)', [native])
                from .subject_content import safe_url
                for key, path in cur.fetchall():
                    if path and f'current:{key}' not in covers:
                        covers[f'current:{key}'] = safe_url(path)
            cur.execute(CURRENT_SUBJECTS_SQL, [pk])
            current_subjects = [{'id': module_id, 'title': title} for module_id, title in cur.fetchall()]
            cur.execute(CURRENT_DATES_SQL, [[subject['id'] for subject in current_subjects]])
            dates = {str(component_id): activity_schedule(title, None, created_at) for component_id, title, created_at in cur.fetchall()}
        account = authenticate_request(request)
        return _private({'covers': covers, 'can_manage': bool(account and account.role in {'admin', 'staff'}),
                         'persistence_ready': available, 'csrf_token': get_token(request),
                         'activity_dates': dates, 'current_subjects': current_subjects})
    except DatabaseError:
        return _error('Could not load subject images.', 503)


@require_POST
@staff_only()
def upload_subject_cover(request, subject_ref):
    from PIL import Image, ImageOps, UnidentifiedImageError
    from curriculum_api import upload_storage
    from curriculum_api.views import COMPONENT_UPLOAD_ROOT
    try:
        if not _subject_exists(subject_ref):
            return _error('Subject not found.', 404)
        with connections['enrolment'].cursor() as cur:
            if not subject_store.ready(cur):
                raise subject_store.StoreUnavailable('Uploading subject covers is not enabled yet.')
        upload = request.FILES.get('image')
        if not upload or upload.size > 5 * 1024 * 1024:
            return _error('Choose a JPG, PNG or WebP image smaller than 5 MB.', 400)
        with Image.open(upload) as picture:
            if picture.format not in {'JPEG', 'PNG', 'WEBP'} or picture.width * picture.height > 20_000_000:
                return _error('Choose a JPG, PNG or WebP image up to 20 megapixels.', 400)
            picture.load()
            picture = ImageOps.exif_transpose(picture)
            picture.thumbnail((1600, 1000))
            buffer = io.BytesIO()
            picture.convert('RGB').save(buffer, format='WEBP', quality=88)
        try:
            path = upload_storage.store(ContentFile(buffer.getvalue()), f'{COMPONENT_UPLOAD_ROOT}/_subject_covers/{uuid4().hex}.webp', 'image/webp')
        except Exception:
            return _error('Could not store the image. Please try again.', 503)
        account = authenticate_request(request)
        subject_store.save_cover(subject_ref, path, account.id)
        return _private({'subject_ref': subject_ref, 'url': _cover_url(path)})
    except subject_store.StoreUnavailable as error:
        return _error(str(error), 503)
    except (UnidentifiedImageError, Image.DecompressionBombError, ValueError, OSError):
        return _error('The image could not be uploaded. Choose a valid image and try again.', 400)
    except DatabaseError:
        return _error('Could not save the subject cover. Please try again.', 503)
