"""Owned, read-only contracts issued in LMS; no imported contract reads."""
import logging

from django.db import DatabaseError
from django.http import JsonResponse
from django.views.decorators.http import require_GET
from login.permissions import employer_or_staff

from . import employer_portal as portal

log = logging.getLogger(__name__)


@require_GET
@employer_or_staff()
def employer_learner_contracts(request, employer_id, kind, learner_id):
    learner, error = portal._owned_learner(employer_id, kind, learner_id)
    if error is not None:
        return error
    contracts, sources = [], {'lms': 'ready'}
    try:
        for document in portal._document_signing_rows(kind, learner.pk, strict_read=True):
            contracts.append({'id': document['id'], 'source': 'lms', 'label': document['label'],
                              'date': document['generatedAt'], 'signed': document['signed'],
                              'available': True, 'document': document})
    except DatabaseError:
        sources['lms'] = 'error'
        log.exception('Employer LMS contract read failed')
    response = JsonResponse({'contracts': contracts, 'sources': sources})
    response['Cache-Control'] = 'private, no-store'
    return response
