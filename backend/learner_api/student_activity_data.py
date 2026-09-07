"""Read-only, unpaginated Last_audit activities for a server-resolved Aptem id.

Separate from the mixed attendance/audit feed so pagination cannot silently
drop modules and attendance/assignment hours cannot inflate activity totals.
"""

from audit_api.last_audit_ledger_views import _activity_payload, _dict_rows


ACTIVITY_SQL = '''
    SELECT r.group_id, r.learner_id, l.aptem_id, l.learner_name,
           g.group_name, r.activity_id,
           COALESCE(a.activity_type, r.activity_type) AS activity_type,
           a.title, a.activity_date, a.reading_type, a.reading_iframe_url,
           a.quiz_id, a.quiz_questions, r.status,
           r.video_started, r.video_completed, r.reading_viewed,
           r.quiz_attempted, r.quiz_passed, r.quiz_score, r.quiz_maximum_score,
           r.mapped_seconds, r.mapped_hours,
           ph.planned_hours AS otjh_planned, ah.actual_hours AS otjh_actual
    FROM "Last_audit".learners l
    JOIN "Last_audit".activity_results r ON r.learner_id = l.learner_id
    JOIN "Last_audit".activities a ON a.activity_id = r.activity_id
    LEFT JOIN "Last_audit".groups g ON g.group_id = r.group_id
    LEFT JOIN "Last_audit".activity_planned_hours ph
      ON ph.learner_id = r.learner_id AND ph.aptem_id = l.aptem_id
     AND ph.ref = r.activity_id::text
     AND ph.kind = CASE lower(COALESCE(a.activity_type, r.activity_type))
         WHEN 'video' THEN 'video' WHEN 'audio' THEN 'audio'
         WHEN 'reading+quiz' THEN 'reading_quiz' END
    LEFT JOIN "Last_audit".activity_actual_hours ah
      ON ah.learner_id = r.learner_id AND ah.aptem_id = l.aptem_id
     AND ah.ref = r.activity_id::text
     AND ah.kind = CASE lower(COALESCE(a.activity_type, r.activity_type))
         WHEN 'video' THEN 'video' WHEN 'audio' THEN 'audio'
         WHEN 'reading+quiz' THEN 'reading_quiz' END
    WHERE l.aptem_id = %s
    ORDER BY a.activity_date NULLS LAST, g.group_name, a.title, r.group_id, r.activity_id
'''

ITEM_FIELDS = (
    "activity_id", "source_activity_id", "group_id", "group_name", "date",
    "category", "activity", "status", "completed", "actual", "planned",
    "hours_mapped", "quiz_score", "quiz_maximum_score",
)


def summarize_activities(items):
    # Results are per group; OTJH is per learner/activity, regardless of group.
    # Keep placements visible but count the same recorded hours only once.
    unique = {}
    for item in items:
        previous = unique.setdefault(item["source_activity_id"], dict(item))
        # A reserved-hours fallback may be populated on only one placement.
        for flag, value in (("hours_mapped", "actual"), ("planned_hours_mapped", "planned")):
            if item[flag] and not previous[flag]:
                previous[flag] = True
                previous[value] = item[value]
    mapped = [item for item in unique.values() if item["hours_mapped"]]
    planned = [item for item in unique.values() if item["planned_hours_mapped"]]
    return {
        "count": len(items),
        "unique_activity_count": len(unique),
        "module_count": len({item["group_id"] for item in items}),
        "completed_count": sum(bool(item["completed"]) for item in items),
        "mapped_count": len(mapped),
        "planned_mapped_count": len(planned),
        "actual_total": round(sum(item["actual"] for item in mapped), 4) if mapped else None,
        "planned_total": round(sum(item["planned"] for item in planned), 4) if planned else None,
        "activities": items,
    }


def read_student_activity(cursor, aptem_id):
    cursor.execute('''
        SELECT learner_id, learner_name FROM "Last_audit".learners WHERE aptem_id = %s
    ''', [aptem_id])
    learner = cursor.fetchone()
    if learner is None:
        return None
    cursor.execute(ACTIVITY_SQL, [aptem_id])
    items = []
    for row in _dict_rows(cursor):
        normalized = _activity_payload(row)
        item = {key: normalized[key] for key in ITEM_FIELDS}
        item["planned_hours_mapped"] = row["otjh_planned"] is not None
        items.append(item)
    return {
        "source": "Last_audit",
        "aptem_id": aptem_id,
        "learner_name": learner[1],
        **summarize_activities(items),
    }
