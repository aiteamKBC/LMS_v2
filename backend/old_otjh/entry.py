"""Student entry status, using the existing previous-record signing service.

The session's historical-record hint is not proof of classification or signing.
This read always resolves Created_users, and never accepts a browser identity.
"""
from django.db import DatabaseError
from django.http import JsonResponse
from django.views.decorators.http import require_GET

from login.permissions import login_required
from . import repository as repo, service


def entry_state(account):
    if account.role != 'learner':
        return {'classification': 'not_applicable', 'required': False, 'canAccess': True}
    if account.subject_type != 'learner' or not account.is_active:
        raise service.ServiceError('Learner access is required.', 'forbidden', 403)
    # Even when signing is disabled, a missing/unreadable profile is an error.
    record = repo.student(account.subject_id)
    if not record or 'aptem_id' not in record:
        raise service.ServiceError('We could not verify your learner profile. Please try again.',
                                   'profile_unavailable', 503)
    existing = bool(str(record['aptem_id'] or '').strip())
    enabled = service.enabled()
    state = {'classification': 'existing' if existing else 'new',
             'enabled': enabled, 'required': False, 'canAccess': True,
             'reviewHref': '/old-otjh/months', 'supportHref': '/messages'}
    if existing and enabled:
        learner = service.resolve_authenticated_learner(account)
        summary = service.summary(learner)
        allowed = summary['can_access_lms'] is True
        state.update(required=not allowed, canAccess=allowed,
                     completedMonths=summary.get('completed_months', 0),
                     totalMonths=summary.get('total_months', 0),
                     document={'title': 'Previous learning record', 'version': repo.VERSION,
                               'through': f'{repo.CUTOFF}-31'},
                     completedAt=summary.get('completed_at'))
    return state


@login_required
@require_GET
def entry_status(request):
    try:
        response = JsonResponse(entry_state(request.login_account))
    except service.ServiceError as error:
        response = JsonResponse({'error': str(error), 'code': error.code}, status=error.status)
    except DatabaseError:
        response = JsonResponse({'error': 'We could not verify your learner profile and signatures. Please try again.',
                                 'code': 'records_unavailable'}, status=503)
    response['Cache-Control'] = 'private, no-store'
    response['Vary'] = 'Cookie'
    if response.status_code == 503:
        response['Retry-After'] = '5'
    return response
