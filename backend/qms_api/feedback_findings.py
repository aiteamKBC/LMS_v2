"""Live QA findings derived from completed Neutral and Negative feedback."""

import json
from datetime import date

from django.db import IntegrityError, transaction
from django.http import JsonResponse

from engagement_api.feedback import QUALITY_DASHBOARD_HIDDEN_FORM_TITLE_PATTERN
from engagement_api.feedback_analytics import question_analytics
from login.permissions import staff_only

from .models import FeedbackFindingState


def _source_rows():
    report = question_analytics(
        None, dashboard=True,
        excluded_form_title_pattern=QUALITY_DASHBOARD_HIDDEN_FORM_TITLE_PATTERN,
    )
    return {
        row['responseId']: row
        for row in report['insights']['classification']['responses']
        if row['classification'] in {'negative', 'neutral'}
    }


def _serialize(row, state=None):
    return {
        'id': row['responseId'],
        'formId': row['formId'],
        'formTitle': row['formTitle'],
        'formType': row['formType'],
        'title': row.get('contextTitle') or row['formTitle'],
        'category': row['formTitle'],
        'severity': 'Critical' if row['classification'] == 'negative' else 'Major',
        'classification': row['classification'],
        'status': state.status if state else 'Open',
        'raisedBy': 'Feedback response',
        'respondent': row['respondent'],
        'groupName': row.get('groupName') or '',
        'submittedAt': row['submittedAt'],
        'score': row['score'],
        'version': state.version if state else 0,
        'actionPlan': state.action_plan if state else '',
        'owner': state.owner if state else '',
        'dueDate': state.due_date.isoformat() if state and state.due_date else None,
        'updatedBy': state.updated_by if state else '',
        'updatedAt': state.updated_at.isoformat() if state else None,
    }


@staff_only()
def feedback_findings(request):
    if request.method != 'GET':
        return JsonResponse({'error': 'Method not allowed.'}, status=405)
    rows = _source_rows()
    states = FeedbackFindingState.objects.in_bulk(rows.keys(), field_name='response_id')
    findings = [_serialize(row, states.get(identifier)) for identifier, row in rows.items()]
    return JsonResponse({'findings': findings})


@staff_only()
def feedback_finding_detail(request, response_id):
    if request.method != 'PATCH':
        return JsonResponse({'error': 'Method not allowed.'}, status=405)
    row = _source_rows().get(response_id)
    if row is None:
        return JsonResponse({'error': 'Feedback finding not found.'}, status=404)
    try:
        body = json.loads(request.body or b'{}')
    except (TypeError, ValueError):
        return JsonResponse({'error': 'The request body must be valid JSON.'}, status=400)
    if not isinstance(body, dict) or set(body) - {'expectedVersion', 'status', 'actionPlan', 'owner', 'dueDate'}:
        return JsonResponse({'error': 'Invalid finding fields.'}, status=400)
    if type(body.get('expectedVersion')) is not int or body['expectedVersion'] < 0 or len(body) < 2:
        return JsonResponse({'error': 'A version and a change are required.'}, status=400)
    if 'status' in body and body['status'] not in {'In Progress', 'Resolved'}:
        return JsonResponse({'error': 'Invalid finding status.'}, status=400)
    if 'actionPlan' in body and (not isinstance(body['actionPlan'], str) or len(body['actionPlan']) > 10000):
        return JsonResponse({'error': 'Action plan must be at most 10000 characters.'}, status=400)
    if 'owner' in body and (not isinstance(body['owner'], str) or len(body['owner']) > 255):
        return JsonResponse({'error': 'Owner must be at most 255 characters.'}, status=400)
    parsed_due = None
    if 'dueDate' in body and body['dueDate'] is not None:
        due = body['dueDate']
        try:
            if not isinstance(due, str) or len(due) != 10:
                raise ValueError
            parsed_due = date.fromisoformat(due)
        except ValueError:
            return JsonResponse({'error': 'Due date must be YYYY-MM-DD or null.'}, status=400)

    try:
        with transaction.atomic():
            state = FeedbackFindingState.objects.select_for_update().filter(response_id=response_id).first()
            if body['expectedVersion'] != (state.version if state else 0):
                return JsonResponse({'error': 'Finding changed. Reload and try again.'}, status=409)
            if state is None:
                state = FeedbackFindingState(response_id=response_id)
            if 'status' in body:
                allowed = {'Open': 'In Progress', 'In Progress': 'Resolved'}
                if body['status'] != allowed.get(state.status):
                    return JsonResponse({'error': 'Invalid finding status transition.'}, status=409)
                state.status = body['status']
            if 'actionPlan' in body:
                state.action_plan = body['actionPlan'].strip()
            if 'owner' in body:
                state.owner = body['owner'].strip()
            if 'dueDate' in body:
                state.due_date = parsed_due
            account = getattr(request, 'login_account', None)
            state.updated_by = str(getattr(account, 'display_name', None) or getattr(account, 'email', None) or 'QA staff')[:255]
            state.version += 1
            state.save()
    except IntegrityError:
        return JsonResponse({'error': 'Finding changed. Reload and try again.'}, status=409)
    return JsonResponse({'finding': _serialize(row, state)})
