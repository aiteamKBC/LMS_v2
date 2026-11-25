"""Read-only Coach Monthly Logs projections; no profile/detail hydration."""
import re

from django.http import JsonResponse
from django.middleware.csrf import get_token
from django.utils import timezone

from learner_api import canonical_learning as canonical
from learner_api.canonical_hours import pending_hour_records, STORED_REPORTING_MONTH_SQL
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


def year_activities(owner):
    from learner_api.canonical_hours import full_hour_projection_ids

    # Retakes, local legacy timers and transfers need the same reconciliation
    # as the learner ledger and the coach's OTJH chart. Attendance is already
    # included in that projection, so do not supplement it again.
    if int(owner['id']) in full_hour_projection_ids([owner]):
        months = {}
        for entry in canonical.entries_for(owner, lineage_only=True):
            for record in canonical.allocations(entry):
                month = record.get('reporting_month')
                row = months.setdefault(month, {'month': month, 'activities': 0, 'accepted_hours': 0,
                                                 'unallocated_activities': []})
                row['activities'] += 1
                hours = canonical.recorded_seconds(record) / 3600
                if record.get('accepted') is True:
                    row['accepted_hours'] += hours
                if not month:
                    row['unallocated_activities'].append({'id': record['id'],
                        'title': record.get('component_title'), 'actual_hours': hours,
                        'actual_hours_recorded': record.get('actual_seconds') is not None})
        return list(months.values())

    # Stored allocations remain authoritative. Supplement empty direct saves
    # with the same read projection as the learner and Case File totals.
    # Group all months once: the two summary cards remain programme-wide.
    activities = query(f'''SELECT reporting_month AS month,count(*) AS activities,
        coalesce(sum(greatest(coalesce(actual_seconds,0),0))
          FILTER (WHERE accepted IS TRUE),0) / 3600.0 AS accepted_hours,
        jsonb_agg(jsonb_build_object('id',id,'title',component_title,
            'actual_hours',greatest(coalesce(actual_seconds,0),0) / 3600.0,
            'actual_hours_recorded',actual_seconds IS NOT NULL) ORDER BY id)
          FILTER (WHERE nullif(reporting_month,'') IS NULL) AS unallocated_activities
        FROM (SELECT id,component_title,actual_seconds,accepted,
            {STORED_REPORTING_MONTH_SQL} AS reporting_month
            FROM "Learner".learner_progress_entries
            WHERE learner_id=%s AND deleted_at IS NULL) p
        GROUP BY reporting_month''', [owner['id']])
    # The PostgreSQL JSON text loader also handles aggregates. Decode before
    # iterating, preserving undated activities and their stored hours.
    for row in activities:
        row['unallocated_activities'] = logs.sources.decoded(row.get('unallocated_activities'), [])
    by_month = {row['month']: dict(row) for row in activities}
    unallocated = {str(item['id']): item for row in activities
                   for item in row.get('unallocated_activities') or []}
    pending = pending_hour_records([owner])[owner['id']]
    for record in (allocation for entry in pending
                   for allocation in canonical.allocations(entry)):
        month = record.get('reporting_month')
        if month:
            unallocated.pop(str(record.get('id')), None)
        row = by_month.setdefault(month, {'month': month, 'activities': 0, 'accepted_hours': 0})
        # Native saves are already counted by SQL; standalone extras have no
        # progress row and contribute one activity, including pending review.
        if record.get('actual_basis') == 'extra_activity_input':
            row['activities'] += 1
        if record.get('accepted') is True:
            row['accepted_hours'] = float(row['accepted_hours']) + canonical.recorded_seconds(record) / 3600
    from learner_api.attendance_otjh import read_bulk, monthly_deltas
    facts = read_bulk([owner], query)[int(owner['id'])]
    for month, delta in monthly_deltas(facts, pending).items():
        row = by_month.setdefault(month, {'month': month, 'activities': 0, 'accepted_hours': 0})
        row['activities'] += delta['activities']
        row['accepted_hours'] = float(row['accepted_hours']) + delta['hours']
    for row in by_month.values():
        if not row['month']:
            row['unallocated_activities'] = list(unallocated.values())
    return list(by_month.values())


def project_year(learner, year):
    owner = learner['_canonical_profile']
    activities = year_activities(owner)
    unallocated = {str(item['id']): item for row in activities
                   for item in row.get('unallocated_activities') or []}
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
            'months': months, 'unallocatedActivities': list(unallocated.values())}


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
