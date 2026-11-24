"""Bulk marking reads for the Coach Dashboard."""

from __future__ import annotations

from typing import TYPE_CHECKING

from django.db import connections

if TYPE_CHECKING:
    from coach_api.services.dashboard.context import CoachDashboardContext


def dashboard_marking_projection(context: CoachDashboardContext) -> dict:
    """Return one marking summary row per learner."""
    if not context.rows:
        return {"summary": {"pendingItems": 0}, "items": []}

    ownership = [(row.id, row.learner_type) for row in context.rows]
    placeholders = ','.join(['(%s,%s)'] * len(ownership))

    sql = """
        SELECT learner_id,
               MIN(learner_name) AS learner_name,
               COUNT(*) AS pending_count,
               MIN(submitted_at) AS oldest_pending,
               MAX(submitted_at) AS latest_pending
          FROM "Learner".learning_reflection_submissions
         WHERE (learner_id,learner_kind) IN (""" + placeholders + """)
           AND status IN ('submitted_for_tutor_review', 'escalated')
         GROUP BY learner_id
         ORDER BY oldest_pending, learner_id
    """
    with connections["enrolment"].cursor() as cursor:
        cursor.execute(sql, [value for pair in ownership for value in pair])
        rows = cursor.fetchall()

    profile_by_id = {
        str(row.id): row
        for row in context.rows
        if getattr(row, "enrolment_id", None)
    }
    items = []
    total = 0
    for learner_id, learner_name, count, oldest, latest in rows:
        profile = profile_by_id.get(str(learner_id))
        if profile is None:
            continue
        count = int(count or 0)
        total += count
        items.append({
            "id": str(profile.id),
            "learnerId": str(profile.id),
            "learner": learner_name or getattr(profile, "full_name", "") or "Learner",
            "programme": getattr(profile, "programme", "") or "--",
            "group": getattr(profile, "group_name", "") or "--",
            "pendingEvidence": count,
            "submittedAt": oldest.isoformat() if oldest else None,
            "lastSubmissionIso": latest.isoformat() if latest else None,
        })
    return {"summary": {"pendingItems": total}, "items": items}
