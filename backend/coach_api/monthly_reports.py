"""Coach view of the monthly reports their learners have submitted.

Read-only by design. A monthly report is the learner's own signed declaration
about their month; the coach reads it alongside the marking queue, but there is
no accept/reject here — nothing in the report is awaiting a decision.

Scoping mirrors the marking queue exactly (coach_api.views.coach_marking_queue):
"Learner".learner_monthly_reports.learner_id holds the str() of an
enrolment."Created_users".id, which is LearnerProfile.enrolment_id — NOT
LearnerProfile.id. The two are disjoint primary-key spaces, so filtering on the
wrong one silently matches nothing.
"""

import logging

from django.db import DatabaseError, connections
from django.db.models.functions import Lower, Trim
from django.http import JsonResponse
from django.views.decorators.http import require_GET

from coach_api.auth import authenticated_coach_email, coach_access_required
from coach_api.errors import coach_error
from learner_api.models import LearnerProfile
from learner_api.monthly_reports import (
    MONTH_KEY_RE,
    SELECT_COLUMNS,
    _row_to_report,
)

logger = logging.getLogger(__name__)


def _normalize_email(value):
    return str(value or "").strip().lower()


def _allowed_learner_ids(owner_email):
    """The enrolment ids of the learners on this coach's caseload."""
    return [
        str(learner_id)
        for learner_id in (
            LearnerProfile.objects.annotate(coach_email_key=Lower(Trim("coach_email")))
            .filter(coach_email_key=_normalize_email(owner_email))
            .values_list("enrolment_id", flat=True)
        )
        if learner_id is not None
    ]


def _summary_row(report):
    """A report without the heavy fields, for the list.

    The signature is up to 400k characters and the activity snapshot up to 2000
    entries, so a caseload's worth of full rows would be megabytes of JSON for a
    table that shows neither. The detail endpoint serves those when a coach
    opens one report.
    """
    metrics = report.get("summaryMetrics") or {}
    return {
        "id": report["id"],
        "learnerKind": report["learnerKind"],
        "learnerId": report["learnerId"],
        "learnerName": report["learnerName"],
        "programmeName": report["programmeName"],
        "monthKey": report["monthKey"],
        "monthLabel": report["monthLabel"],
        "status": report["status"],
        "learnedSummary": report["learnedSummary"],
        "selectedKsbs": report["selectedKsbs"],
        "attachments": report["attachments"],
        "summaryMetrics": metrics,
        # Whether it was signed, not the signature itself.
        "signed": bool(report.get("signature")),
        "signedName": report["signedName"],
        "signedAt": report["signedAt"],
        "submittedAt": report["submittedAt"],
        "updatedAt": report["updatedAt"],
        "activityCount": len(report.get("activitySnapshot") or []),
    }


@require_GET
@coach_access_required
def coach_monthly_reports(request):
    """Every monthly report the coach's learners have submitted."""
    owner_email = authenticated_coach_email(request)
    allowed = _allowed_learner_ids(owner_email)
    if not allowed:
        return JsonResponse({"items": [], "months": [], "learners": []})

    month = str(request.GET.get("month") or "").strip()
    if month and not MONTH_KEY_RE.match(month):
        return coach_error(
            request,
            code="invalid_month",
            message="Select a valid month.",
            status=400,
        )
    learner = str(request.GET.get("learner") or "").strip()
    search = str(request.GET.get("search") or "").strip()[:200]

    clauses = ["learner_id = any(%s)"]
    params = [allowed]
    if month:
        clauses.append("month_key = %s")
        params.append(month)
    if learner:
        clauses.append("learner_id = %s")
        params.append(learner)
    if search:
        clauses.append("(learner_name ilike %s or learned_summary ilike %s)")
        params.extend([f"%{search}%"] * 2)

    where = " and ".join(clauses)
    try:
        with connections["enrolment"].cursor() as cur:
            cur.execute(
                f"""
                select {SELECT_COLUMNS}
                  from "Learner".learner_monthly_reports
                 where {where}
                 order by learner_name asc nulls last, month_key desc
                """,
                params,
            )
            rows = cur.fetchall()
            # The filter options describe the whole caseload, not the filtered
            # view — otherwise picking a month empties the month dropdown.
            cur.execute(
                """
                select distinct month_key, month_label
                  from "Learner".learner_monthly_reports
                 where learner_id = any(%s)
                 order by month_key desc
                """,
                [allowed],
            )
            months = [{"monthKey": row[0], "monthLabel": row[1]} for row in cur.fetchall()]
            cur.execute(
                """
                select distinct learner_id, learner_name
                  from "Learner".learner_monthly_reports
                 where learner_id = any(%s)
                 order by learner_name asc nulls last
                """,
                [allowed],
            )
            learners = [{"learnerId": row[0], "learnerName": row[1]} for row in cur.fetchall()]
    except DatabaseError:
        logger.exception("Could not load coach monthly reports.")
        return coach_error(
            request,
            code="monthly_reports_unavailable",
            message="Could not load the monthly reports.",
            status=502,
        )

    return JsonResponse(
        {
            "items": [_summary_row(_row_to_report(row)) for row in rows],
            "months": months,
            "learners": learners,
        }
    )


@require_GET
@coach_access_required
def coach_monthly_report_detail(request, report_id):
    """One report in full — the reflection, activity record and signature."""
    owner_email = authenticated_coach_email(request)
    allowed = _allowed_learner_ids(owner_email)
    if not allowed:
        return JsonResponse({"detail": "Report not found."}, status=404)

    try:
        with connections["enrolment"].cursor() as cur:
            cur.execute(
                f"""
                select {SELECT_COLUMNS}
                  from "Learner".learner_monthly_reports
                 where id = %s and learner_id = any(%s)
                """,
                [str(report_id), allowed],
            )
            row = cur.fetchone()
    except DatabaseError:
        logger.exception("Could not load a coach monthly report.")
        return coach_error(
            request,
            code="monthly_reports_unavailable",
            message="Could not load the monthly report.",
            status=502,
        )

    if not row:
        # 404 whether it does not exist or belongs to another coach's learner:
        # the id must not confirm a report the coach may not read.
        return JsonResponse({"detail": "Report not found."}, status=404)

    return JsonResponse({"item": _row_to_report(row)})
