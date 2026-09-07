"""Learner-scoped pilot view over the historical Last_audit activity mirror."""

from django.db import DatabaseError
from django.http import JsonResponse
from django.views.decorators.http import require_GET

from audit_api.last_audit_ledger_views import _connection
from audit_api.learner_exclusions import is_excluded_learner
from login.permissions import learner_self_or_staff

from .learner_detail import SOURCE_MODELS
from .student_activity_data import read_student_activity
from .student_activity_pilot import student_activity_available


def _error(message, status):
    return JsonResponse({"error": message}, status=status)


@require_GET
@learner_self_or_staff(kwarg="pk")
def student_activity(request, kind, pk):
    """Return LMS activities for the requested learner, never for a client id.

    This deliberately resolves Aptem identity from enrolment.Created_users.
    The caller supplies only the learner record id already protected by the
    ownership gate, which prevents changing a query string to inspect another
    learner's audit history.
    """
    model = SOURCE_MODELS.get(kind)
    if model is None:
        return _error("Learner not found.", 404)

    try:
        source = model.all_learners.only("id", "aptem_id").get(pk=pk)
    except model.DoesNotExist:
        return _error("Learner not found.", 404)
    except DatabaseError:
        return _error("Could not read the learner record.", 503)

    try:
        aptem_id = int(str(source.aptem_id or "").strip())
    except (TypeError, ValueError):
        return _error("This learner is not linked to Aptem.", 404)
    if not student_activity_available(aptem_id):
        return _error("Student activity is not enabled for this learner yet.", 404)

    # Never forward client filters or Aptem ids into the historical reader.
    try:
        with _connection().cursor() as cursor:
            payload = read_student_activity(cursor, aptem_id)
    except DatabaseError:
        return _error("Could not read Last_audit activities. Please try again.", 503)
    if payload is None or is_excluded_learner(aptem_id, payload["learner_name"]):
        return _error("No audit activity record is linked to this learner.", 404)
    return JsonResponse(payload)
