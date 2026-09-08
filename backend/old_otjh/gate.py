"""The same gate for normal requests and middleware-free batch dispatch."""
import re

from django.db import DatabaseError
from django.http import JsonResponse

from . import service

_READ_PATHS = frozenset({
    '/audit_api/last-audit/cohort/',
    '/audit_api/last-audit/manual/summary',
    '/audit_api/last-audit/manual/rows',
    '/audit_api/last-audit/manual/finalization',
})


def is_transition_path(path):
    return (path.startswith('/audit_api/old-otjh/') or path in _READ_PATHS
            or bool(re.fullmatch(r'/audit_api/learners/[0-9]+/signoff/', path)))


def refusal(path, account):
    if not service.enabled() or not account or account.role != 'learner':
        return None
    # Enrolment and shared support/account routes remain available. Every LMS
    # learning API is checked, including direct GETs and batch subrequests.
    if not path.startswith(('/learner_api/', '/curriculum_api/', '/engagement_api/', '/quiz_api/')):
        return None
    # The authenticated account object is request-local. Batch subrequests use
    # this same object, avoiding repeated remote queries within one request.
    if hasattr(account, '_old_otjh_refusal'):
        return account._old_otjh_refusal
    try:
        learner = service.resolve_authenticated_learner(account)
        if not learner['aptem_id'] or service.summary(learner)['can_access_lms']:
            account._old_otjh_refusal = None
            return None
        body, status = {'error': service.SUPPORT, 'code': 'transition_required'}, 403
    except service.ServiceError as error:
        body, status = {'error': str(error), 'code': error.code}, error.status
    except DatabaseError:
        body, status = {'error': 'Previous record review is temporarily unavailable. Please try again.',
                        'code': 'records_unavailable'}, 503
    response = JsonResponse(body, status=status)
    response['Cache-Control'] = 'private, no-store'
    account._old_otjh_refusal = response
    return response
