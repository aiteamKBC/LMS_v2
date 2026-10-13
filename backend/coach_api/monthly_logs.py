"""Read-only Coach Monthly Logs projections; no profile/detail hydration."""
import re

from django.http import JsonResponse
from django.middleware.csrf import get_token
from django.utils import timezone

from learner_api import canonical_learning as canonical
from learner_api import monthly_logs as logs
from old_otjh.repository import query
from old_otjh.service import ServiceError, coach_actor, normalize
from .auth import _requested_view_as_email


def require_coach(request):
    actor = coach_actor(request.login_account)
    if actor['role'] == 'monitor':
        raise ServiceError('Coach access is required.', 'forbidden', 403)
    # These routes always use Coach ownership, even if a caller supplies the
    # learner-preview query parameter understood by the shared journal guard.
    request.GET = request.GET.copy()
    request.GET['perspective'] = 'coach'
    return actor


@logs.endpoint('GET')
def learners(request):
    actor = require_coach(request)
    email = _requested_view_as_email(request) if actor['role'] == 'admin' else actor['email']
    records = logs.sources.learners(normalize(email), '')
    return JsonResponse({'learners': [{**record, 'initials': initials(record['name'])} for record in records]})


def initials(name):
    return ''.join(part[0] for part in str(name or '').split()[:2]).upper() or 'L'


def project_year(learner, year):
    owner = learner['_canonical_profile']
    # The authoritative allocation is the progress row's own month/seconds.
    # Group all months once: the two summary cards remain programme-wide.
    activities = query('''SELECT reporting_month AS month,count(*) AS activities,
        coalesce(sum(greatest(coalesce(actual_seconds,0),0))
          FILTER (WHERE accepted IS TRUE),0) / 3600.0 AS accepted_hours
        FROM "Learner".learner_progress_entries
        WHERE learner_id=%s AND deleted_at IS NULL GROUP BY reporting_month''', [owner['id']])
    targets = canonical.targets_for(owner)
    signs = query('''SELECT report_month AS month,
        bool_or(signer_role='learner') AS learner_signed,
        bool_or(signer_role='coach') AS coach_signed
        FROM "Learner".learner_monthly_signatures
        WHERE learner_id=%s AND review_confirmed IS TRUE GROUP BY report_month''', [owner['id']])
    activity_by_month = {row['month']: row for row in activities if row['month']}
    signs_by_month = {row['month']: row for row in signs}
    current_month = timezone.localdate().strftime('%Y-%m')
    available = sorted(month for month in (activity_by_month.keys() | targets.keys() | signs_by_month.keys())
                       if month <= current_month)
    months = []
    for month in available:
        if not month.startswith(f'{year}-'):
            continue
        activity = activity_by_month.get(month, {})
        signature = signs_by_month.get(month, {})
        months.append({'month': month, 'activities': activity.get('activities', 0),
                       'acceptedOtjhHours': float(activity.get('accepted_hours', 0)),
                       'targetHours': targets.get(month), 'isOpen': month == current_month,
                       'learnerSigned': bool(signature.get('learner_signed')),
                       'coachSigned': bool(signature.get('coach_signed'))})
    closed = [month for month in available if month < current_month]
    return {'learner': {'id': learner['id'], 'name': learner['name'],
                        'initials': initials(learner['name']), 'programme': learner['programme']},
            'year': year, 'years': sorted({int(month[:4]) for month in available} | {year}),
            'summary': {'coachSignatures': {
                'completed': sum(bool(signs_by_month.get(month, {}).get('coach_signed')) for month in closed),
                'total': len(closed)},
                'acceptedOtjhHours': round(sum(float(row['accepted_hours']) for row in activities), 4),
                'trainingPlanHours': round(sum(targets.values()), 4) if targets else None},
            'months': months}


@logs.endpoint('GET')
def learner_year(request, learner_id):
    require_coach(request)
    raw_year = request.GET.get('year', str(timezone.localdate().year))
    if not re.fullmatch(r'[0-9]{4}', raw_year) or not 1 <= int(raw_year) <= 9999:
        raise ServiceError('Choose a valid report year.')
    learner, _ = logs.scope(request, learner_id)
    return JsonResponse(project_year(learner, int(raw_year)))


@logs.endpoint('GET')
def learner_month(request, learner_id, month):
    require_coach(request)
    learner, _ = logs.scope(request, learner_id)
    # Deep report context (including prior signatures used by import/download)
    # is requested only after an explicit month open, never by overview rows.
    return JsonResponse({'summary': {**logs.summary_data(learner, include_open=True),
                                     'csrf_token': get_token(request)},
                         'detail': logs.detail_data(learner, month, include_open=True)})
