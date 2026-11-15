"""Learners still placed in a cohort or group, whatever their lifecycle status.

The archive's delete guard needs this, not ``active_learner_delivery_counts``:
that one counts ``lifecycle_status = 'active'`` only, so a group holding only
learners in delivery, onboarding or on break showed "0 learners" and offered a
permanent delete the database then refused (``"Learner".learners.group_id`` is
an ON DELETE RESTRICT reference, whatever the status).

Counts are keyed by canonical id, the same shape ``delivery_learner_count``
reads. Where learners do not link placements by id (SQLite tests, an older
schema) or the read fails, the existing active-only counts are returned, so the
guard is never weaker than it was.
"""
import logging
from collections import Counter

from django.db import connection

from . import views

logger = logging.getLogger(__name__)


def placed_learner_counts():
    """``(cohort_counts, group_counts)``: every learner row placed by id."""
    if connection.vendor != 'postgresql':
        return views.active_learner_delivery_counts()
    try:
        if not views.learner_relation_exists('learners') or not views.learners_link_placement_by_id():
            return views.active_learner_delivery_counts()
        with connection.cursor() as cursor:
            cursor.execute(
                "select coalesce(cohort_id::text, ''), coalesce(group_id::text, ''), count(*) "
                'from "Learner"."learners" group by 1, 2'
            )
            rows = cursor.fetchall()
    except Exception as exc:  # The guard falls back; it never reports a false zero by failing open.
        logger.warning('Could not count placed learners for the archive: %s', exc)
        return views.active_learner_delivery_counts()
    cohorts, groups = Counter(), Counter()
    for cohort_id, group_id, count in rows:
        cohort_id, group_id = views.clean_str(cohort_id), views.clean_str(group_id)
        if cohort_id:
            cohorts[cohort_id] += int(count or 0)
        if group_id:
            groups[group_id] += int(count or 0)
    return dict(cohorts), dict(groups)
