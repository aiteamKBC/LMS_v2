"""Learner Extra Activity validation and native-store listing."""
from decimal import Decimal
from uuid import UUID
from zoneinfo import ZoneInfo
from django.utils import timezone
from django.db import DatabaseError
from django.http import JsonResponse
from learner_api.identity_placement.public import learner_self_or_staff
from old_otjh.service import ServiceError
from .monthly_assignment import assignment_checks, mapping, text
from .extra_activity_month import valid_activity_month

EXTRA_CHECK_KEYS = {'answer', 'learning', 'evidence', 'ksbs', 'planned', 'declarations', 'hours'}


def prepare_extra_activity(payload):
    identifier = text(payload.get('activityId'))
    if not identifier.startswith('extra:'):
        raise ValueError('A valid extra activity identifier is required.')
    try:
        UUID(identifier[6:])
    except ValueError:
        raise ValueError('A valid extra activity identifier is required.')
    current = timezone.now().astimezone(ZoneInfo('Europe/London'))
    monthly = mapping(payload.get('monthlyAssignment'))
    month = monthly.get('month', current.strftime('%Y-%m'))
    if not valid_activity_month(month):
        raise ValueError('Choose a valid activity month (YYYY-MM).')
    return {**payload, 'monthlyAssignment': {**monthly, 'month': month, 'timeEntries': monthly.get('timeEntries', [])},
            'dateCompleted': current.date().isoformat(), 'plannedOtjh': ''}


def extra_activity_checks(payload, **dependencies):
    prepared = prepare_extra_activity(payload)
    checks = assignment_checks(prepared, meeting_booked=True, **dependencies)
    checks = [check for check in checks if check['key'] in EXTRA_CHECK_KEYS]
    return [{'key': 'title', 'label': 'Give your extra activity a title', 'passed': bool(text(payload.get('activityTitle')))}, *checks]


@learner_self_or_staff(query_param='learnerId')
def list_extra_activities(request):
    kind, learner_id = request.GET.get('learnerKind'), request.GET.get('learnerId')
    if kind not in ('commercial', 'apprenticeship') or not str(learner_id or '').isdigit():
        return JsonResponse({'error': 'A valid learner is required.'}, status=400)
    try:
        from .extra_activity_store import API_STATUS, document, list_rows
        rows = list_rows(int(learner_id), kind)
    except ServiceError as exc:
        return JsonResponse({'error': str(exc)}, status=exc.status)
    except DatabaseError:
        return JsonResponse({'error': 'Could not load extra activities. Please retry.'}, status=503)
    result = []
    for row in rows:
        data = document(row)
        submitted, reviewed = row.get('submitted_at'), row.get('reviewed_at')
        selected_month = mapping(data.get('monthlyAssignment')).get('month')
        month = (selected_month if valid_activity_month(selected_month) else
                 row['activity_date'].strftime('%Y-%m'))
        if request.GET.get('month') and (row['status'] == 'draft' or month != request.GET['month']):
            continue
        result.append({'activityId': f"extra:{row['id']}", 'title': row['title'],
                       'status': API_STATUS.get(row['status'], row['status']),
                       'submittedAt': submitted.isoformat() if submitted else None, 'month': month,
                       'answer': data.get('assignmentAnswer', ''), 'reflection': data.get('whatYouLearned', ''),
                       'ksbs': data.get('ksbCodes', []),
                       'hours': str(Decimal(row['requested_minutes']) / Decimal(60)),
                       'coachFeedback': row.get('review_note') or '',
                       'reviewedBy': row.get('reviewed_by') or '',
                       'addedBy': mapping(data.get('coachCreation')).get('name') if data.get('submissionOrigin') == 'coach' else None,
                       'reviewedAt': reviewed.isoformat() if reviewed else None})
    return JsonResponse({'activities': result})
