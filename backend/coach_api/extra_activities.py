"""Coach caseload and decisions for native learner Extra Activities."""
import functools
import json

from django.db import DatabaseError, connections, transaction
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_protect

from learner_api.learner_coach_columns import learner_coach_sql
from old_otjh import repository
from old_otjh.repository import query
from old_otjh.service import ServiceError, normalize
from .auth import attributed_write_view, coach_access_required, is_coach_view_as
from .feedback_format import feedback_plain_text, sanitize_feedback


def endpoint(view):
    @coach_access_required
    @csrf_protect
    @functools.wraps(view)
    def wrapped(request, *args, **kwargs):
        try:
            response = view(request, *args, **kwargs)
        except ServiceError as exc:
            response = JsonResponse({'detail': str(exc), 'code': exc.code}, status=exc.status)
        except (ValueError, TypeError, UnicodeDecodeError):
            response = JsonResponse({'detail': 'Check the activity details and try again.'}, status=400)
        except DatabaseError:
            response = JsonResponse({'detail': 'Extra activities are temporarily unavailable. Please retry.'}, status=503)
        response['Cache-Control'] = 'private, no-store'
        return response
    return wrapped


def _coach_email_sql():
    return learner_coach_sql('l', 'email', repository._query_alias.get() or repository.DB)


def caseload(email):
    # programme: the learner's programme name by programme_id (the copied
    # name column is gone on the canonical schema), as LearnerProfile.programme.
    return query(f'''SELECT l.enrolment_id AS id,l.learner_type AS kind,l.full_name AS name,
        (SELECT p.name FROM curriculum.programmes p WHERE p.programme_id=l.programme_id) AS programme
        FROM "Learner".learners l JOIN enrolment."Created_users" u ON u.id=l.enrolment_id
        WHERE lower(btrim({_coach_email_sql()}))=%s AND lower(btrim(l.email))=lower(btrim(u."Email"))
          AND l.learner_type IN ('commercial','apprenticeship')
        ORDER BY l.full_name,l.id''', [normalize(email)])


@endpoint
def learners(request):
    if request.method != 'GET':
        return JsonResponse({'detail': 'Method not allowed.'}, status=405, headers={'Allow': 'GET'})
    return JsonResponse({'learners': caseload(request.coach_email)})


@endpoint
def activities(request):
    if request.method != 'GET':
        return JsonResponse({'detail': 'Method not allowed.'}, status=405, headers={'Allow': 'GET'})
    page = int(request.GET.get('page', '1'))
    if page < 1:
        raise ServiceError('Choose a valid page.')
    status = request.GET.get('status', 'all')
    statuses = {'all': [], 'pending': ['pending'],
                'accepted': ['approved'], 'referred': ['returned']}
    if status not in statuses:
        raise ServiceError('Choose a valid activity status.')
    month_sql = "coalesce(nullif(e.reflection_payload->'full_submission'->'monthlyAssignment'->>'month',''),to_char(e.activity_date,'YYYY-MM'))"
    clauses = ["e.status<>'draft'", f'lower(btrim({_coach_email_sql()}))=%s']
    params = [normalize(request.coach_email)]
    if request.GET.get('learner'):
        try:
            learner_id = int(request.GET['learner'])
        except ValueError:
            raise ServiceError('Choose a valid learner.') from None
        clauses.append('l.enrolment_id=%s'); params.append(learner_id)
    if request.GET.get('month'):
        from learner_api.extra_activity_month import valid_activity_month
        if not valid_activity_month(request.GET['month']):
            raise ServiceError('Choose a valid month.')
        clauses.append(month_sql + '=%s'); params.append(request.GET['month'])
    if statuses[status]:
        clauses.append('e.status=ANY(%s)'); params.append(statuses[status])
    source = '''FROM "Learner".extra_activities e JOIN "Learner".learners l
        ON l.id=e.learner_id AND l.learner_type=e.learner_kind WHERE ''' + ' AND '.join(clauses)
    count = query('SELECT count(*) AS count ' + source, params)[0]['count']
    rows = query('''SELECT e.id,l.enrolment_id AS "learnerId",e.learner_kind AS "learnerKind",
        l.full_name AS learner,e.title,
        CASE e.status WHEN 'approved' THEN 'accepted' WHEN 'pending' THEN 'submitted_for_tutor_review'
             WHEN 'returned' THEN 'rejected' ELSE e.status END AS status,
        (e.requested_minutes::numeric/60)::text AS hours,e.reviewed_by AS "reviewedBy",
        e.submitted_at AS "submittedAt",''' + month_sql + ''' AS month,
        e.reflection_payload->'full_submission'->'coachCreation'->>'name' AS "addedBy"
        ''' + source + ' ORDER BY e.submitted_at DESC NULLS LAST,e.created_at DESC,e.id LIMIT 25 OFFSET %s',
        [*params, (page - 1) * 25])
    return JsonResponse({'items': rows, 'total': count, 'page': page, 'hasNext': page * 25 < count})


def _owned_activity(cursor, identity, coach_email, *, lock=False):
    from learner_api.extra_activity_store import activity_uuid
    cursor.execute(f'''SELECT e.*,l.enrolment_id,l.full_name AS learner_name,
            (SELECT p.name FROM curriculum.programmes p WHERE p.programme_id=l.programme_id) AS programme
        FROM "Learner".extra_activities e JOIN "Learner".learners l
          ON l.id=e.learner_id AND l.learner_type=e.learner_kind
        WHERE e.id=%s AND lower(btrim({_coach_email_sql()}))=%s''' +
        (' FOR UPDATE OF e,l' if lock else ''), [activity_uuid(identity), normalize(coach_email)])
    value = cursor.fetchone()
    return dict(zip((item[0] for item in cursor.description), value)) if value else None


@endpoint
@attributed_write_view
def activity_detail(request, activity_id):
    from learner_api.extra_activity_store import API_STATUS
    if request.method == 'GET':
        with connections['enrolment'].cursor() as cursor:
            row = _owned_activity(cursor, activity_id, request.coach_email)
        if not row or row['status'] == 'draft':
            return JsonResponse({'detail': 'Extra Activity not found.'}, status=404)
        from learner_api.extra_activity_store import serialise_submission
        item = serialise_submission(row)
        item.update(id=str(row['id']), learnerId=str(row['enrolment_id']),
                    learnerKind=row['learner_kind'], learner=row['learner_name'],
                    programme=row.get('programme') or '')
        return JsonResponse({'item': item})
    if request.method != 'PATCH':
        return JsonResponse({'detail': 'Method not allowed.'}, status=405,
                            headers={'Allow': 'GET, PATCH'})
    try:
        payload = json.loads(request.body or b'{}')
    except (TypeError, ValueError, UnicodeDecodeError):
        raise ValueError('Request body must be valid JSON.') from None
    if not isinstance(payload, dict):
        raise ValueError('Request body must be a JSON object.')
    decision = str(payload.get('decision') or '').strip().lower()
    if decision not in {'accepted', 'rejected', 'referred'}:
        raise ValueError('Choose a valid Extra Activity decision.')
    feedback = sanitize_feedback(str(payload.get('feedback') or '').strip())
    if not feedback_plain_text(feedback):
        raise ValueError('Feedback is required for this decision.')
    coach = getattr(request, 'coach_staff', None)
    coach_name = str(getattr(coach, 'username', '') or getattr(coach, 'email', '')
                     or 'Progress Coach').strip()
    reviewed_by = coach_name[:255]
    if is_coach_view_as(request):
        admin = getattr(request, 'coach_view_as_admin', None)
        admin_name = str(getattr(admin, 'username', '') or getattr(admin, 'email', '')
                         or 'Administrator').strip()
        reviewed_by = f'{admin_name} (for {coach_name})'[:255]

    with transaction.atomic(using='enrolment'), connections['enrolment'].cursor() as cursor:
        row = _owned_activity(cursor, activity_id, request.coach_email, lock=True)
        if not row or row['status'] == 'draft':
            return JsonResponse({'detail': 'Extra Activity not found.'}, status=404)
        if row['status'] == 'returned' and decision == 'accepted':
            raise ServiceError('The learner must resubmit this Extra Activity before approval.',
                               'resubmission_required', 409)
        enrolment_id = int(row['enrolment_id'])
        if decision == 'accepted':
            raw_minutes = payload.get('approvedMinutes', row['requested_minutes'])
            if type(raw_minutes) is not int or not 1 <= raw_minutes <= int(row['requested_minutes']):
                raise ValueError('Approved minutes must be a whole number within the submitted duration.')
            status, approved_minutes = 'approved', raw_minutes
        else:
            status, approved_minutes = 'returned', None
        no_op = (row['status'] == status and row.get('approved_minutes') == approved_minutes
                 and (status != 'approved' or row.get('progress_entry_id') is not None))
        if not no_op:
            now = timezone.now()
            event = [{'event': 'coach_approved' if status == 'approved' else 'coach_returned',
                      'at': now.isoformat(), 'from': row['status'], 'to': status,
                      'reviewed_by': reviewed_by, 'feedback': feedback,
                      'approved_minutes': approved_minutes}]
            cursor.execute('''UPDATE "Learner".extra_activities SET
                    status=%s,approved_minutes=%s,review_note=%s,reviewed_by=%s,reviewed_at=%s,
                    history=history || %s::jsonb,version=version+1,updated_at=%s
                WHERE id=%s AND learner_id=%s RETURNING *''', [
                    status, approved_minutes, feedback, reviewed_by, now,
                    json.dumps(event), now, row['id'], row['learner_id'],
                ])
            saved = cursor.fetchone()
            row = dict(zip((item[0] for item in cursor.description), saved))
        from learner_api import canonical_learning
        owner = canonical_learning.require_profile(enrolment_id)
        from learner_api.extra_activity_progress import sync_locked_activity
        result = sync_locked_activity(cursor, row, owner)
    return JsonResponse({'id': str(row['id']), 'status': API_STATUS[status],
                         'progressEntryId': result['progress_entry_id']})
