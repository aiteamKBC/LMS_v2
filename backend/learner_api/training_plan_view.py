"""Learner-scoped view over the Aptem training plan (``Audit.learner_match``).

The month-by-month Aptem training plan lives in ``Audit.learner_match``
(``aptem_training_plan`` JSON), on the ``enrolment`` Neon database — the same DB
``learner_api`` already uses (see ``audit_api/learner_match_ledger_views.py``).

Identity is resolved SERVER-SIDE and never trusted from the client: the caller
supplies only the ownership-gated learner record id, we read that learner's
``aptem_id`` from ``enrolment.Created_users``, and the matched ``learner_match``
row is confirmed by email as a second key. This mirrors ``student_activity``.
"""

import json

from django.db import DatabaseError, connections
from django.http import JsonResponse
from django.views.decorators.http import require_GET

from login.permissions import learner_self_or_staff

from .learner_detail import SOURCE_MODELS


def _error(message, status):
    return JsonResponse({"error": message}, status=status)


# The `json` column comes back as raw text under the A22 psycopg3 loader
# (learner_api/pg_json_compat.py), so it must be parsed rather than trusted to
# already be a list.
def _as_month_list(value):
    if value is None:
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except (TypeError, ValueError):
            return []
        return parsed if isinstance(parsed, list) else []
    return []


PLAN_SQL = '''
    SELECT aptem_training_plan, learner_name, learner_email, programme_name
    FROM "Audit".learner_match
    WHERE aptem_id = %s
    LIMIT 1
'''


@require_GET
@learner_self_or_staff(kwarg="pk")
def training_plan(request, kind, pk):
    """Return the learner's Aptem training-plan months, resolved server-side."""
    model = SOURCE_MODELS.get(kind)
    if model is None:
        return _error("Learner not found.", 404)

    try:
        source = model.all_learners.only("id", "aptem_id", "email").get(pk=pk)
    except model.DoesNotExist:
        return _error("Learner not found.", 404)
    except DatabaseError:
        return _error("Could not read the learner record.", 503)

    try:
        aptem_id = int(str(source.aptem_id or "").strip())
    except (TypeError, ValueError):
        return _error("This learner is not linked to Aptem.", 404)
    if aptem_id <= 0:
        return _error("This learner is not linked to Aptem.", 404)

    try:
        with connections["enrolment"].cursor() as cursor:
            cursor.execute(PLAN_SQL, [aptem_id])
            row = cursor.fetchone()
    except DatabaseError:
        return _error("Could not read the training plan. Please try again.", 503)

    if row is None:
        return _error("No training plan is linked to this learner.", 404)

    plan, learner_name, learner_email, programme_name = row

    # Second key: the matched row's email must equal the enrolment record's, so a
    # stale/re-used aptem_id can never surface another learner's plan.
    source_email = (source.email or "").strip().lower()
    match_email = (learner_email or "").strip().lower()
    if source_email and match_email and source_email != match_email:
        return _error("No training plan is linked to this learner.", 404)

    response = JsonResponse({
        "source": "Audit.learner_match",
        "aptem_id": aptem_id,
        "learner_name": learner_name,
        "programme_name": programme_name,
        "months": _as_month_list(plan),
    })
    response["Cache-Control"] = "private, no-store"
    return response
