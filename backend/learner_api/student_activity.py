"""Learner-scoped pilot view over the historical Last_audit activity mirror."""

import json

from django.db import DatabaseError
from django.http import JsonResponse
from django.views.decorators.http import require_GET

from audit_api.last_audit_ledger_views import activities as last_audit_activities
from login.permissions import learner_self_or_staff

from .learner_detail import SOURCE_MODELS


PILOT_APTEM_IDS = {92}


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
    if aptem_id not in PILOT_APTEM_IDS:
        return _error("Student activity is not enabled for this learner yet.", 404)

    # Reuse the normalized Last_audit projection used by the audit workspace,
    # but force the server-resolved Aptem id. Client-supplied filters cannot
    # change whose records are returned.
    original_query = request.GET
    query = original_query.copy()
    query["aptem_id"] = str(aptem_id)
    query["limit"] = "20000"
    query["offset"] = "0"
    query.pop("category", None)
    query.pop("month", None)
    query.pop("search", None)
    request.GET = query
    try:
        response = last_audit_activities(request)
    finally:
        request.GET = original_query

    if response.status_code != 200:
        return response

    payload = json.loads(response.content)
    # The shared audit feed also includes attendance. This pilot is explicitly
    # the activities + activity_results view, whose stable ids start with la:.
    items = [
        item for item in payload.get("activities", [])
        if str(item.get("activity_id", "")).startswith("la:")
    ]
    payload["activities"] = items
    payload["count"] = len(items)
    payload["module_count"] = len({item.get("group_id") for item in items})
    payload["completed_count"] = sum(bool(item.get("completed")) for item in items)
    return JsonResponse(payload)
