"""Persistence and API translation for ``Learner.extra_activities``."""
import json
from datetime import date
from decimal import Decimal, InvalidOperation
from uuid import UUID

from django.core.serializers.json import DjangoJSONEncoder
from django.db import connections, transaction
from django.http import JsonResponse
from django.utils import timezone

from old_otjh.service import ServiceError
from . import canonical_learning
from .assignment_attempts import submission_attempts


API_STATUS = {
    'draft': 'draft',
    'pending': 'submitted_for_tutor_review',
    'approved': 'accepted',
    'returned': 'rejected',
}


def _json(value):
    return json.dumps(value, cls=DjangoJSONEncoder, sort_keys=True, separators=(',', ':'))


def _mapping(value):
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (TypeError, ValueError):
            return {}
    return value if isinstance(value, dict) else {}


def _list(value):
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (TypeError, ValueError):
            return []
    return value if isinstance(value, list) else []


def activity_uuid(value):
    raw = str(value or '').strip()
    if raw.startswith('extra:'):
        raw = raw[6:]
    try:
        parsed = UUID(raw)
    except (TypeError, ValueError, AttributeError):
        raise ServiceError('A valid Extra Activity identifier is required.') from None
    return str(parsed)


def _minutes(value, *, allow_zero):
    try:
        minutes = Decimal(str(value or 0)) * Decimal(60)
    except (InvalidOperation, TypeError, ValueError):
        raise ServiceError('Enter a valid activity duration.') from None
    if minutes != minutes.to_integral_value():
        raise ServiceError('Activity duration must use whole minutes.')
    minutes = int(minutes)
    minimum = 0 if allow_zero else 1
    if not minimum <= minutes <= 1440:
        raise ServiceError('Activity duration must be between one minute and 24 hours.'
                           if minimum else 'Activity duration must not exceed 24 hours.')
    return minutes


def _owner(enrolment_id, learner_kind):
    try:
        owner = canonical_learning.require_profile(int(enrolment_id))
    except (TypeError, ValueError):
        raise ServiceError('The canonical learner identity needs review.',
                           'identity_review_required', 409) from None
    if owner.get('learner_type') != learner_kind:
        raise ServiceError('The canonical learner identity needs review.',
                           'identity_review_required', 409)
    return owner


def _row(cursor):
    value = cursor.fetchone()
    return dict(zip((item[0] for item in cursor.description), value)) if value else None


def _locked(cursor, identity, owner_id=None):
    params = [activity_uuid(identity)]
    owner_sql = ''
    if owner_id is not None:
        owner_sql = ' AND learner_id=%s'
        params.append(int(owner_id))
    cursor.execute('''SELECT * FROM "Learner".extra_activities
        WHERE id=%s''' + owner_sql + ' FOR UPDATE', params)
    return _row(cursor)


def document(row):
    payload = _mapping(row.get('reflection_payload'))
    full = payload.get('full_submission')
    return dict(full) if isinstance(full, dict) else dict(payload)


def serialise_submission(row):
    content = document(row)
    status = API_STATUS.get(row['status'], row['status'])
    reviewed_at = row.get('reviewed_at')
    submitted_at = row.get('submitted_at')
    return {
        **content,
        'activityId': f"extra:{row['id']}",
        'activityType': 'extra_activity',
        'activityTitle': row.get('title') or content.get('activityTitle') or '',
        'actualTimeHours': str(Decimal(row.get('requested_minutes') or 0) / Decimal(60)),
        'status': status,
        'coachFeedback': row.get('review_note') or '',
        'reviewedBy': row.get('reviewed_by') or '',
        'reviewedAt': reviewed_at.isoformat() if reviewed_at else None,
        'submittedAt': submitted_at.isoformat() if submitted_at else None,
        'locked': row['status'] == 'approved',
        'submissionAttempts': submission_attempts(
            content, status, submitted_at, row.get('review_note'),
            row.get('reviewed_by'), reviewed_at,
        ),
    }


def get_for_owner(enrolment_id, learner_kind, identity):
    owner = _owner(enrolment_id, learner_kind)
    with connections['enrolment'].cursor() as cursor:
        cursor.execute('''SELECT * FROM "Learner".extra_activities
            WHERE id=%s AND learner_id=%s AND learner_kind=%s''',
                       [activity_uuid(identity), owner['id'], learner_kind])
        row = _row(cursor)
    return serialise_submission(row) if row else None


def _snapshot(payload, owner, status, activity_id, source_reflection_id=None):
    return {
        'id': str(source_reflection_id or activity_id),
        'learner_id': owner['id'],
        'learner_kind': owner['learner_type'],
        'activity_id': f'extra:{activity_id}',
        'activity_type': 'extra_activity',
        'activity_title': str(payload.get('activityTitle') or '').strip(),
        'status': API_STATUS[status],
        'actual_time_hours': str(payload.get('actualTimeHours') or '0'),
        'date_completed': payload.get('dateCompleted'),
        'submitted_at': timezone.now().isoformat() if status == 'pending' else None,
        'full_submission': payload,
    }


def save_submission(payload):
    learner_kind = str(payload.get('learnerKind') or '').strip()
    if learner_kind not in {'commercial', 'apprenticeship'}:
        raise ServiceError('A valid learnerKind is required.')
    owner = _owner(payload.get('learnerId'), learner_kind)
    identity = activity_uuid(payload.get('activityId'))
    mode = 'draft' if str(payload.get('submissionMode') or '').strip().lower() == 'draft' else 'submit'
    status = 'draft' if mode == 'draft' else 'pending'
    if status == 'pending':
        from .extra_activities import extra_activity_checks
        missing = [item['label'] for item in extra_activity_checks(payload) if not item['passed']]
        if missing:
            raise ServiceError('Complete the outstanding submission requirements: ' +
                               ', '.join(missing) + '.')
    requested = _minutes(payload.get('actualTimeHours'), allow_zero=status == 'draft')
    try:
        activity_date = date.fromisoformat(str(payload.get('dateCompleted') or ''))
    except ValueError:
        raise ServiceError('dateCompleted must use YYYY-MM-DD format.') from None
    title = str(payload.get('activityTitle') or '').strip()
    description = str(payload.get('whatYouLearned') or payload.get('assignmentAnswer') or '').strip()
    monthly = _mapping(payload.get('monthlyAssignment'))
    now = timezone.now()

    with transaction.atomic(using='enrolment'), connections['enrolment'].cursor() as cursor:
        cursor.execute('SELECT id FROM "Learner".learners WHERE id=%s FOR UPDATE', [owner['id']])
        if cursor.fetchone() is None:
            raise ServiceError('The canonical learner identity needs review.',
                               'identity_review_required', 409)
        current = _locked(cursor, identity, owner['id'])
        if current and current['learner_kind'] != learner_kind:
            raise ServiceError('The canonical learner identity needs review.',
                               'identity_review_required', 409)
        if current and current['status'] in {'approved', 'pending'}:
            message = ('This Extra Activity has been approved and can no longer be changed.'
                       if current['status'] == 'approved'
                       else 'This Extra Activity has already been submitted for review.')
            raise ServiceError(message, 'record_locked', 409)
        effective_date = current['activity_date'] if current else activity_date
        source_reflection_id = current.get('source_reflection_id') if current else None
        snapshot = {**(_mapping(current.get('reflection_payload')) if current else {}),
                    **_snapshot(payload, owner, status, identity, source_reflection_id)}
        saved_files = (monthly.get('evidence') if isinstance(monthly.get('evidence'), list)
                       else _list(current.get('files')) if current else [])
        event = [{'event': 'learner_saved' if status == 'draft' else 'learner_submitted',
                  'at': now.isoformat(), 'from': current.get('status') if current else None,
                  'to': status,
                  **({'prior_review_note': current.get('review_note') or '',
                      'prior_reviewed_by': current.get('reviewed_by') or '',
                      'prior_reviewed_at': current['reviewed_at'].isoformat()
                          if current.get('reviewed_at') else None,
                      'prior_approved_minutes': current.get('approved_minutes')}
                     if current and current.get('status') == 'returned' else {})}]
        if current:
            cursor.execute('''UPDATE "Learner".extra_activities SET
                    title=%s,description=%s,activity_date=%s,requested_minutes=%s,
                    approved_minutes=NULL,status=%s,review_note='',reviewed_by='',reviewed_at=NULL,
                    submitted_at=CASE WHEN %s='pending' THEN %s ELSE submitted_at END,
                    files=%s::jsonb,history=history || %s::jsonb,
                    reflection_payload=%s::jsonb,version=version+1,updated_at=%s
                WHERE id=%s AND learner_id=%s RETURNING *''', [
                    title, description, effective_date, requested, status, status, now,
                    _json(saved_files), _json(event), _json(snapshot), now, identity, owner['id'],
                ])
        else:
            cursor.execute('''INSERT INTO "Learner".extra_activities (
                    id,learner_id,learner_kind,title,description,activity_type,activity_date,
                    requested_minutes,approved_minutes,status,review_note,reviewed_by,reviewed_at,
                    submitted_at,files,history,reflection_payload)
                VALUES (%s,%s,%s,%s,%s,'other',%s,%s,NULL,%s,'','',NULL,
                    CASE WHEN %s='pending' THEN %s ELSE NULL END,%s::jsonb,%s::jsonb,%s::jsonb)
                RETURNING *''', [
                    identity, owner['id'], learner_kind, title, description, effective_date,
                    requested, status, status, now, _json(saved_files), _json(event), _json(snapshot),
                ])
        saved = _row(cursor)
        if saved.get('progress_entry_id'):
            from .extra_activity_progress import sync_locked_activity
            sync_locked_activity(cursor, saved, owner)
    return serialise_submission(saved)


def save_response(payload):
    saved = save_submission(payload)
    return JsonResponse({
        'id': saved['activityId'][6:],
        'status': saved['status'],
        'submissionAttempts': saved['submissionAttempts'],
    }, status=201)


def get_response(enrolment_id, learner_kind, identity):
    saved = get_for_owner(enrolment_id, learner_kind, identity)
    return JsonResponse({'submission': saved})


def list_rows(enrolment_id, learner_kind):
    owner = _owner(enrolment_id, learner_kind)
    with connections['enrolment'].cursor() as cursor:
        cursor.execute('''SELECT * FROM "Learner".extra_activities
            WHERE learner_id=%s AND learner_kind=%s ORDER BY submitted_at DESC NULLS LAST,created_at DESC,id''',
                       [owner['id'], learner_kind])
        columns = [item[0] for item in cursor.description]
        return [dict(zip(columns, row)) for row in cursor.fetchall()]
