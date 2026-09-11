"""Read-only, unpaginated Last_audit activities for a server-resolved Aptem id.

Separate from the mixed attendance/audit feed so pagination cannot silently
drop modules and attendance/assignment hours cannot inflate activity totals.
"""

from audit_api.last_audit_ledger_views import _activity_payload, _dict_rows
from audit_api.last_audit_ledger_views import _json_list
from .subject_dates import activity_schedule, apply_section_placement


CURRICULUM_SCHEDULE_SQL = '''
    WITH exports AS (
        SELECT course_id,
               CASE WHEN jsonb_typeof(curriculum)='string'
                    THEN (curriculum #>> '{}')::jsonb ELSE curriculum END AS payload
        FROM "MBA".course_curriculum WHERE course_id=ANY(%s)
    )
    SELECT e.course_id, material->>'source_component_id' AS activity_id,
           section->>'source_section_id' AS section_id,
           section->>'section_title' AS section_title,
           material->>'created_at_utc' AS original_created_at,
           w.id AS builder_week_id, w.title AS builder_week_title
    FROM exports e
    CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(payload->'sections')='array' THEN payload->'sections' ELSE '[]'::jsonb END
    ) section
    CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(section->'materials')='array' THEN section->'materials' ELSE '[]'::jsonb END
    ) material
    LEFT JOIN curriculum.modules m ON m.source_type='mba-legacy' AND m.source_id=e.course_id::text
        AND m.deleted_at IS NULL AND NOT coalesce(m.is_programme_deleted,false)
    LEFT JOIN curriculum.components c ON c.id=material->>'component_id'
        AND c.module_catalogue_id=m.module_catalogue_id
        AND c.deleted_at IS NULL AND NOT coalesce(c.is_programme_deleted,false)
    LEFT JOIN curriculum.weeks w ON w.id=c.week_id AND w.module_catalogue_id=m.module_catalogue_id
        AND w.deleted_at IS NULL AND NOT coalesce(w.is_programme_deleted,false)
'''


def read_curriculum_schedules(cursor, group_ids):
    """Read scheduling context by exact course/activity ids, never by title.

    The retained export also covers courses not yet in Module Builder. A linked
    Builder component's current week takes precedence over its exported week.
    Only date metadata leaves this query; no content or download tokens do.
    """
    if not group_ids:
        return {}
    cursor.execute(CURRICULUM_SCHEDULE_SQL, [sorted(set(group_ids))])
    candidates = {}
    for row in _dict_rows(cursor):
        try:
            key = (int(row['course_id']), int(row['activity_id']))
        except (TypeError, ValueError):
            continue
        section = {
            'section_id': row.get('builder_week_id') or row.get('section_id'),
            'source_section_id': row.get('section_id'),
            'section_title': unescape(str((row.get('builder_week_title') if row.get('builder_week_id') else row.get('section_title')) or '')),
            'section_source': 'builder_section_title' if row.get('builder_week_id') else 'section_title',
            'exported_section_title': unescape(str(row.get('section_title') or '')),
            'original_created_at': row.get('original_created_at'),
        }
        matches = candidates.setdefault(key, [])
        if section not in matches:
            matches.append(section)
    # Reused activities in different dated sections are ambiguous, not an
    # invitation to select the first section (or silently use an upload date).
    return {key: matches[0] if len(matches) == 1 else {'ambiguous': True}
            for key, matches in candidates.items()}


def apply_curriculum_schedules(items, schedules):
    for item in items:
        context = schedules.get((item['group_id'], item['source_activity_id']))
        if not context:
            continue
        stored_date = item.get('source_date')
        if context.get('ambiguous'):
            schedule = activity_schedule(item['activity'])
            if schedule['date_source'] == 'undated':
                schedule.update(date_source='section_needs_review', date_needs_review=True)
            item.update(schedule, source_date=stored_date)
            continue
        item.update(activity_schedule(
            item['activity'], stored_date, context.get('original_created_at') or (item.get('date') if item.get('date_source') == 'original_created_at' else None),
            section_title=context.get('section_title'), section_source=context['section_source'],
        ))
        item['section_title'] = context.get('section_title') or ''
        apply_section_placement(item, item['group_id'], context.get('source_section_id'))
    return items


ACTIVITY_SQL = '''
    SELECT gl.group_id, l.learner_id, l.aptem_id, l.learner_name,
           g.group_name, ga.activity_id, ga.position,
           COALESCE(a.activity_type, r.activity_type) AS activity_type,
           a.title, a.activity_date, a.reading_type, a.reading_iframe_url,
           a.quiz_id, a.quiz_questions, r.status, r.activity_id IS NOT NULL AS has_result,
           COALESCE(a.raw #>> '{live_lms_component,created_at}',
                    a.raw #>> '{live_lms_quiz,created_at}') AS original_created_at,
           r.video_started, r.video_completed, r.reading_viewed,
           r.quiz_attempted, r.quiz_passed, r.quiz_score,
           COALESCE(r.quiz_maximum_score,a.quiz_maximum_score) AS quiz_maximum_score,
           r.mapped_seconds, r.mapped_hours,
           ph.planned_hours AS otjh_planned, ah.actual_hours AS otjh_actual
    FROM "Last_audit".learners l
    JOIN "Last_audit".group_learners gl ON gl.learner_id = l.learner_id
    JOIN "Last_audit".group_activities ga ON ga.group_id = gl.group_id
    JOIN "Last_audit".activities a ON a.activity_id = ga.activity_id
    LEFT JOIN "Last_audit".activity_results r ON r.learner_id = l.learner_id
      AND r.group_id = gl.group_id AND r.activity_id = ga.activity_id
    LEFT JOIN "Last_audit".groups g ON g.group_id = gl.group_id
    LEFT JOIN "Last_audit".activity_planned_hours ph
      ON ph.learner_id = l.learner_id AND ph.aptem_id = l.aptem_id
     AND ph.ref = ga.activity_id::text
     AND ph.kind = CASE lower(COALESCE(a.activity_type, r.activity_type))
         WHEN 'video' THEN 'video' WHEN 'audio' THEN 'audio'
         WHEN 'reading+quiz' THEN 'reading_quiz' END
    LEFT JOIN "Last_audit".activity_actual_hours ah
      ON ah.learner_id = l.learner_id AND ah.aptem_id = l.aptem_id
     AND ah.ref = ga.activity_id::text
     AND ah.kind = CASE lower(COALESCE(a.activity_type, r.activity_type))
         WHEN 'video' THEN 'video' WHEN 'audio' THEN 'audio'
         WHEN 'reading+quiz' THEN 'reading_quiz' END
    WHERE l.aptem_id = %s
    ORDER BY a.activity_date NULLS LAST, g.group_name, ga.position, ga.activity_id
'''

ITEM_FIELDS = (
    "activity_id", "source_activity_id", "group_id", "group_name", "date",
    "category", "activity", "status", "completed", "actual", "planned",
    "hours_mapped", "quiz_score", "quiz_maximum_score",
)


def read_student_material(cursor, aptem_id, group_id, activity_id, *, include_source=False):
    # Membership must match BOTH activity and group for this learner.
    cursor.execute('''
        SELECT l.learner_name, l.learner_email, a.title, a.video_iframe_url,
               a.reading_iframe_url, a.reading_text_body,
               a.raw #>> '{audio,iframe_url}' AS audio_url,
               a.quiz_body, a.quiz_questions, a.activity_id, a.activity_type,
               a.quiz_id, a.quiz_passing_score, a.quiz_maximum_score,
               r.quiz_answers, r.quiz_score, COALESCE(r.quiz_maximum_score,a.quiz_maximum_score) AS result_maximum_score,
               r.quiz_attempt_number, r.quiz_passed, r.reading_viewed, r.status,
               r.video_completed, a.reading_type, a.raw
        FROM "Last_audit".learners l
        JOIN "Last_audit".group_learners gl ON gl.learner_id = l.learner_id
        JOIN "Last_audit".group_activities ga ON ga.group_id = gl.group_id
        JOIN "Last_audit".activities a ON a.activity_id = ga.activity_id
        LEFT JOIN "Last_audit".activity_results r ON r.learner_id = l.learner_id
          AND r.group_id = gl.group_id AND r.activity_id = ga.activity_id
        WHERE l.aptem_id = %s AND gl.group_id = %s AND ga.activity_id = %s
        LIMIT 1
    ''', [aptem_id, group_id, activity_id])
    rows = _dict_rows(cursor)
    if not rows:
        return None
    row = rows[0]
    # Expose the question and options only, never source grading keys.
    questions = []
    for question in _json_list(row.get("quiz_questions")):
        if not isinstance(question, dict):
            continue
        questions.append({
            "text": question.get("question_body") or "",
            "options": [str(option.get("option_body") or option.get("option_text") or "")
                        for option in _json_list(question.get("options")) if isinstance(option, dict)],
        })
    result = {"learner_name": row["learner_name"], "title": row["title"],
            "video_url": row["video_iframe_url"], "audio_url": row["audio_url"],
            "reading_url": row["reading_iframe_url"], "reading_html": row["reading_text_body"],
            "quiz_description": row["quiz_body"], "questions": questions}
    if include_source:
        result['_source'] = row
    return result


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


def read_audit_hour_totals(cursor, aptem_id):
    """Return the exact whole-programme figures shown in Audit learner search.

    TP Planned is Aptem's programme plan. LMS Actual is the accepted Actual
    total from the employee-arranged monthly ledger. Keeping this query beside
    the historical activity reader lets the learner workspace quote the same
    sources without exposing the audit cohort endpoint to the browser.
    """
    cursor.execute('''
        SELECT l.planned_hours_total,
               COALESCE((
                   SELECT SUM(m.actual_hours) FILTER (WHERE m.accepted)
                   FROM "structured_manual_activities"."manual_learner_activities" m
                   WHERE m.aptem_id = l.aptem_id AND m.deleted_at IS NULL
               ), 0) AS accepted_actual_total
        FROM "Last_audit".learners l
        WHERE l.aptem_id = %s
        LIMIT 1
    ''', [aptem_id])
    row = cursor.fetchone()
    if row is None:
        return {'audit_tp_planned': None, 'audit_lms_actual': None}
    return {
        'audit_tp_planned': round(float(row[0]), 2) if row[0] is not None else None,
        'audit_lms_actual': round(float(row[1]), 2) if row[1] is not None else None,
    }


def read_audit_hour_totals_bulk(cursor, aptem_ids):
    """read_audit_hour_totals for many learners in one query.

    The coach caseload renders a whole caseload in one response, so it cannot
    afford the per-learner round trip the learner workspace makes. Returns
    {aptem_id (int): {'audit_tp_planned': ..., 'audit_lms_actual': ...}} with an
    entry only for the ids that exist in the audit mirror; callers keep their
    existing Active_users figures for anyone missing.
    """
    ids = []
    for value in aptem_ids or []:
        try:
            parsed = int(str(value).strip())
        except (TypeError, ValueError):
            continue
        if parsed > 0:
            ids.append(parsed)
    if not ids:
        return {}
    cursor.execute('''
        SELECT l.aptem_id,
               l.planned_hours_total,
               COALESCE((
                   SELECT SUM(m.actual_hours) FILTER (WHERE m.accepted)
                   FROM "structured_manual_activities"."manual_learner_activities" m
                   WHERE m.aptem_id = l.aptem_id AND m.deleted_at IS NULL
               ), 0) AS accepted_actual_total
        FROM "Last_audit".learners l
        WHERE l.aptem_id = ANY(%s)
    ''', [sorted(set(ids))])
    totals = {}
    for row in cursor.fetchall():
        totals[int(row[0])] = {
            'audit_tp_planned': round(float(row[1]), 2) if row[1] is not None else None,
            'audit_lms_actual': round(float(row[2]), 2) if row[2] is not None else None,
        }
    return totals


def read_evidenced_ksb_counts_bulk(cursor, aptem_ids):
    """Distinct KSB codes evidenced per learner, from the audit KSB mapping.

    KSBs for the monthly audit rows live in
    ``structured_manual_activities.learner_journal_row_ksbs``, joined to the
    same accepted ledger rows the OTJ Actual total comes from -- so a code only
    counts once the row carrying it was accepted.

    A count, not a percentage: the mapping spans several apprenticeship
    standards (71 distinct codes overall, and individual learners reach 60), so
    it carries no per-learner denominator to divide by. The learner's own
    workspace shows this same figure as a count for the same reason, and the
    coach must not show a percentage derived from a different, smaller
    curriculum target -- that would read past 100%.

    Returns {aptem_id (int): count} with an entry only for learners that have
    at least one evidenced code.
    """
    ids = []
    for value in aptem_ids or []:
        try:
            parsed = int(str(value).strip())
        except (TypeError, ValueError):
            continue
        if parsed > 0:
            ids.append(parsed)
    if not ids:
        return {}
    cursor.execute('''
        SELECT j.aptem_id,
               count(DISTINCT e->>'code') AS evidenced_codes
        FROM "structured_manual_activities"."learner_journal_row_ksbs" j
        JOIN "structured_manual_activities"."manual_learner_activities" m
          ON m.id = j.row_id AND m.deleted_at IS NULL AND m.accepted
        CROSS JOIN LATERAL jsonb_array_elements(j.ksbs) e
        WHERE j.aptem_id = ANY(%s)
        GROUP BY 1
    ''', [sorted(set(ids))])
    return {int(row[0]): int(row[1] or 0) for row in cursor.fetchall()}


def read_student_activity(cursor, aptem_id):
    cursor.execute('''
        SELECT learner_id, learner_name, learner_email FROM "Last_audit".learners WHERE aptem_id = %s
    ''', [aptem_id])
    learner = cursor.fetchone()
    if learner is None:
        return None
    cursor.execute('''SELECT g.group_id, g.group_name FROM "Last_audit".group_learners gl
                      JOIN "Last_audit".groups g ON g.group_id=gl.group_id
                      JOIN "Last_audit".learners l ON l.learner_id=gl.learner_id
                      WHERE l.aptem_id=%s ORDER BY g.group_name,g.group_id''', [aptem_id])
    subjects = [{'id': row['group_id'], 'name': row.get('group_name') or 'Unnamed subject'} for row in _dict_rows(cursor)]
    cursor.execute(ACTIVITY_SQL, [aptem_id])
    items = []
    for row in _dict_rows(cursor):
        normalized = _activity_payload(row)
        item = {key: normalized[key] for key in ITEM_FIELDS}
        item["planned_hours_mapped"] = row["otjh_planned"] is not None
        item.update(activity_schedule(row.get('title'), row.get('activity_date'), row.get('original_created_at')))
        item['position'] = row.get('position') or 0
        item['has_result'] = row.get('has_result', True)
        items.append(item)
    return {
        "source": "Last_audit",
        "aptem_id": aptem_id,
        "learner_name": learner[1],
        "_identity_email": learner[2] if len(learner) > 2 else '',
        "subjects": subjects,
        **summarize_activities(items),
    }
