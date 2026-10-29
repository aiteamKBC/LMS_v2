"""Read-only coach caseload for reviewing learner-submitted extra activities."""
import functools

from django.db import DatabaseError
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_protect

from old_otjh.repository import query
from old_otjh.service import ServiceError, normalize
from .auth import coach_access_required


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


def caseload(email):
    return query('''SELECT l.enrolment_id AS id,l.learner_type AS kind,l.full_name AS name,l.programme
        FROM "Learner".learners l JOIN enrolment."Created_users" u ON u.id=l.enrolment_id
        WHERE lower(btrim(l.coach_email))=%s AND lower(btrim(l.email))=lower(btrim(u."Email"))
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
    statuses = {'all': [], 'pending': ['submitted_for_tutor_review', 'escalated'],
                'accepted': ['accepted', 'partial'], 'referred': ['referred', 'rejected']}
    if status not in statuses:
        raise ServiceError('Choose a valid activity status.')
    clauses = ["s.activity_type='extra_activity'", "s.status<>'draft'", 'lower(btrim(l.coach_email))=%s']
    params = [normalize(request.coach_email)]
    if request.GET.get('learner'):
        clauses.append('s.learner_id=%s'); params.append(request.GET['learner'])
    if request.GET.get('month'):
        from learner_api.extra_activity_month import valid_activity_month
        if not valid_activity_month(request.GET['month']):
            raise ServiceError('Choose a valid month.')
        clauses.append("s.full_submission->'monthlyAssignment'->>'month'=%s"); params.append(request.GET['month'])
    if statuses[status]:
        clauses.append('s.status=ANY(%s)'); params.append(statuses[status])
    source = '''FROM "Learner".learning_reflection_submissions s JOIN "Learner".learners l
        ON l.enrolment_id::text=s.learner_id AND l.learner_type=s.learner_kind WHERE ''' + ' AND '.join(clauses)
    count = query('SELECT count(*) AS count ' + source, params)[0]['count']
    rows = query('''SELECT s.id,s.learner_id AS "learnerId",s.learner_kind AS "learnerKind",
        s.learner_name AS learner,s.activity_title AS title,s.status,s.actual_time_hours AS hours,
        s.reviewed_by AS "reviewedBy",s.submitted_at AS "submittedAt",
        s.full_submission->'monthlyAssignment'->>'month' AS month,
        s.full_submission->'coachCreation'->>'name' AS "addedBy"
        ''' + source + ' ORDER BY s.submitted_at DESC,s.id LIMIT 25 OFFSET %s', [*params, (page - 1) * 25])
    return JsonResponse({'items': rows, 'total': count, 'page': page, 'hasNext': page * 25 < count})
