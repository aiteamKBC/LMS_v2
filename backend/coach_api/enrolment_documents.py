"""Read-only, caseload-scoped enrolment review documents for Coach Case File."""
import logging

from django.db import DatabaseError
from django.http import JsonResponse
from django.views.decorators.http import require_GET

from coach_api.auth import authenticated_coach_email, coach_access_required
from learner_api.models import EnrolmentReview
from learner_api.review_form import (
    lookup_review,
    review_document_rows,
    serialize_review_form,
)

logger = logging.getLogger(__name__)


def _error(message, status):
    return JsonResponse({"error": message}, status=status)


def _s(value):
    return "" if value is None else str(value).strip()


def _enrolment_learner(request, learner_id):
    """(kind, enrolment id) for a learner on this coach's caseload, or (None, None)."""
    # Imported here: coach_api.views is large and imports this app's neighbours.
    from coach_api.views import fetch_case_file_shell

    profile, source = fetch_case_file_shell(authenticated_coach_email(request), learner_id)
    if profile is None or not profile.enrolment_id:
        return None, None
    kind = _s(getattr(source, "learner_type", "") or getattr(profile, "learner_type", "")).lower()
    return ("commercial" if kind == "commercial" else "apprenticeship"), int(profile.enrolment_id)


def _not_found():
    # Ownership failures look exactly like an unknown learner.
    return JsonResponse({"detail": "Learner not found."}, status=404)


@coach_access_required
@require_GET
def coach_enrolment_documents(request, learner_id):
    try:
        kind, enrolment_id = _enrolment_learner(request, learner_id)
        if enrolment_id is None:
            return _not_found()
        rows = list(
            EnrolmentReview.objects.filter(learner_id=enrolment_id)
            .exclude(status=EnrolmentReview.STATUS_CANCELLED)
            .order_by("scheduled_date", "review_type")
        )
    except DatabaseError:
        logger.exception("coach_enrolment_documents: lookup failed")
        return _error("Could not load the enrolment documents.", 503)
    return JsonResponse({
        "documents": review_document_rows(rows),
    })


@coach_access_required
@require_GET
def coach_enrolment_document(request, learner_id, event_key):
    try:
        kind, enrolment_id = _enrolment_learner(request, learner_id)
        if enrolment_id is None:
            return _not_found()
        learner, review, event, failure = lookup_review(kind, enrolment_id, event_key)
    except DatabaseError:
        logger.exception("coach_enrolment_document: lookup failed")
        return _error("Could not load the document.", 503)
    if failure is not None:
        return failure
    return JsonResponse(serialize_review_form(review, learner, event))
