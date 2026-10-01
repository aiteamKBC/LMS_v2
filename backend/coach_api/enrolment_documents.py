"""The case file's Enrolment Documents tab: a coach views, downloads and signs
their learner's enrolment review documents.

    GET  coach/learners/<id>/enrolment-documents                    the learner's review documents
    GET  coach/learners/<id>/enrolment-documents/<event_key>        one document, in full
    POST coach/learners/<id>/enrolment-documents/<event_key>/sign   sign it with the saved signature

<id> is the coach's LearnerProfile id, as for the rest of the case file. Every
learner route resolves it through fetch_case_file_shell, which only returns a
learner on the signed-in coach's own caseload; anyone else's is a 404, the same
as an unknown id.

The coach signs the review's staff ("admin") sign-off — shown as the coach signature — with their saved
signature — enrolment."Staff_users"."Saved_signature", which they create once
through the shared signature pad (login.saved_signature, PUT
/login_api/me/signature/) — through the same
record_signature path the board and the learner use — so a coach's signature
can complete onboarding exactly as the enrolment team's does. A signature is
never replaced or withdrawn here: a review whose staff sign-off is already
given is refused, so an earlier signature (the enrolment team's, or the coach's
own) stays as it was.
"""
import logging
from types import SimpleNamespace

from django.db import DatabaseError
from django.http import JsonResponse
from django.views.decorators.http import require_GET, require_POST

from coach_api.auth import _find_coach_staff, authenticated_coach_email, coach_access_required
from learner_api.models import EnrolmentReview
from learner_api.review_form import (
    lookup_review,
    record_signature,
    review_document_rows,
    serialize_review_form,
)

logger = logging.getLogger(__name__)


def _error(message, status):
    return JsonResponse({"error": message}, status=status)


def _s(value):
    return "" if value is None else str(value).strip()


def _coach_staff(request):
    """The effective coach's Staff_users row (the viewed coach under view-as)."""
    return _find_coach_staff(authenticated_coach_email(request))


def _saved_signature(staff):
    """The coach's saved signature (PNG data URL), or ''."""
    from login.models import SUBJECT_STAFF
    from login.saved_signature import read_saved_signature

    if staff is None:
        return ""
    signature, _saved_at = read_saved_signature(SimpleNamespace(subject_type=SUBJECT_STAFF, subject_id=staff.id))
    return _s(signature)


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
        staff = _coach_staff(request)
    except DatabaseError:
        logger.exception("coach_enrolment_documents: lookup failed")
        return _error("Could not load the enrolment documents.", 503)
    return JsonResponse({
        "documents": review_document_rows(rows),
        # Whether the coach has a signature to sign with — not the image itself.
        "signature": {"saved": bool(_saved_signature(staff)), "name": _s(getattr(staff, "username", ""))},
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


@coach_access_required
@require_POST
def coach_sign_enrolment_document(request, learner_id, event_key):
    try:
        kind, enrolment_id = _enrolment_learner(request, learner_id)
        if enrolment_id is None:
            return _not_found()
        learner, review, event, failure = lookup_review(kind, enrolment_id, event_key)
        staff = _coach_staff(request)
    except DatabaseError:
        logger.exception("coach_sign_enrolment_document: lookup failed")
        return _error("Could not load the document.", 503)
    if failure is not None:
        return failure
    if staff is None:
        return _error("Coach account not found.", 404)

    if not review.form_completed:
        return _error("This review can only be signed once the form is completed.", 400)
    if _s(review.admin_signature):
        return _error("This document already has a coach signature.", 409)
    try:
        signature = _saved_signature(staff)
    except DatabaseError:
        logger.exception("coach_sign_enrolment_document: signature lookup failed")
        return _error("Could not load your signature.", 503)
    if not signature:
        return _error("Create your signature first.", 400)

    try:
        promoted = record_signature(review, "admin", signature, _s(staff.username) or authenticated_coach_email(request))
    except DatabaseError:
        logger.exception("coach_sign_enrolment_document: save failed")
        return _error("Could not save the signature.", 502)

    payload = serialize_review_form(review, learner, event)
    if promoted:
        payload["programmeStatusChangedTo"] = promoted
    return JsonResponse(payload)
