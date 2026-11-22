"""Resolve an authored quiz slot within verified module identities."""
from django.db import connections


SLOT_FROM = '''
    FROM curriculum.components c
    JOIN curriculum.modules m ON m.module_catalogue_id=c.module_catalogue_id
    JOIN curriculum.weeks w ON w.id=c.week_id AND w.module_catalogue_id=c.module_catalogue_id
    CROSS JOIN LATERAL (
        SELECT CASE WHEN c.settings_json::jsonb ? 'linkedQuizId'
            THEN btrim(c.settings_json->>'linkedQuizId')
            ELSE (SELECT min(l.quiz_id)::text FROM curriculum.quiz_component_links l
                  WHERE l.component_id=c.id HAVING count(DISTINCT l.quiz_id)=1)
            END AS quiz_ref
    ) link
'''
ACTIVE_SLOT = '''
    c.type='quiz' AND c.deleted_at IS NULL AND w.deleted_at IS NULL
    AND m.deleted_at IS NULL AND NOT coalesce(m.is_programme_deleted,false)
'''


def read_placements(module_ids, quiz_refs):
    if not module_ids or not quiz_refs:
        return []
    with connections['enrolment'].cursor() as cursor:
        cursor.execute(f'''
            SELECT c.id, c.module_catalogue_id, c.week_id, m.title, w.title, link.quiz_ref
            {SLOT_FROM}
            WHERE c.module_catalogue_id=ANY(%s) AND link.quiz_ref=ANY(%s)
              AND {ACTIVE_SLOT}
        ''', [sorted(set(module_ids)), sorted(set(quiz_refs))])
        return [dict(zip(('componentId', 'moduleId', 'weekId', 'module', 'week', 'quizRef'), row))
                for row in cursor.fetchall()]


# Resolve explicit evidence first. An old title alone can be stale, but a live
# exact match elsewhere must not also earn completion for the fallback slot.
# For the remaining attempts, use the same saved/cleared/explicit/inherited
# plan rules as learning_plan._effective_plan_ids, only for candidate learners.
UNPLACED_QUIZ_SQL = f'''
    WITH requested(module_id) AS (VALUES (%s::text)),
    target_refs AS MATERIALIZED (
        SELECT DISTINCT link.quiz_ref {SLOT_FROM}
        WHERE c.module_catalogue_id=(SELECT module_id FROM requested)
          AND {ACTIVE_SLOT} AND link.quiz_ref IS NOT NULL
    ), attempts AS MATERIALIZED (
        SELECT p.id, p.learner_id, p.quiz_ref, nullif(btrim(p.week_ref),'') AS week_ref,
               nullif(lower(btrim(p.week_title)),'') AS week_label,
               nullif(btrim(p.module_title),'') AS module_hint
        FROM "Learner".learner_progress_entries p JOIN target_refs t ON t.quiz_ref=p.quiz_ref
        WHERE p.learner_id=ANY(%s) AND p.kind='quiz' AND p.passed IS TRUE
          AND p.submitted_at IS NOT NULL AND p.deleted_at IS NULL
          AND nullif(btrim(p.component_ref),'') IS NULL
          AND nullif(btrim(p.curriculum_component_ref),'') IS NULL
          AND nullif(btrim(p.module_ref),'') IS NULL
          AND (nullif(btrim(p.week_ref),'') IS NOT NULL OR nullif(btrim(p.week_title),'') IS NOT NULL)
    ), slots AS MATERIALIZED (
        SELECT c.id, c.module_catalogue_id AS module_id, c.week_id, link.quiz_ref,
               lower(btrim(m.title)) AS module_label, lower(btrim(w.title)) AS week_label
        {SLOT_FROM}
        JOIN target_refs t ON t.quiz_ref=link.quiz_ref
        WHERE {ACTIVE_SLOT}
    ), exact_matches AS (
        SELECT a.id, min(s.id) AS component_id, min(s.module_id) AS module_id
        FROM attempts a JOIN slots s ON s.quiz_ref=a.quiz_ref AND s.week_label=a.week_label
          AND (s.module_label=lower(a.module_hint) OR s.module_id=a.module_hint)
          AND (a.week_ref IS NULL OR s.week_id=a.week_ref)
        GROUP BY a.id HAVING count(*)=1
    ), unresolved AS MATERIALIZED (
        SELECT a.* FROM attempts a LEFT JOIN exact_matches e ON e.id=a.id WHERE e.id IS NULL
    ), candidate_learners AS (
        SELECT DISTINCT learner_id FROM unresolved
    ), plan_context AS MATERIALIZED (
        SELECT cl.learner_id, coalesce(btrim(u."Programme"),'') AS programme,
               nullif(btrim(u."Group"),'') AS group_name,
               placement.group_id,
               CASE WHEN jsonb_typeof(u."Training_plan")='array' THEN u."Training_plan"
                    WHEN jsonb_typeof(u."Learning_plan")='array' THEN u."Learning_plan" END AS plan
        FROM candidate_learners cl JOIN "Learner".learners l ON l.id=cl.learner_id
        JOIN enrolment."Created_users" u ON u.id=l.enrolment_id
        LEFT JOIN LATERAL (
            SELECT CASE WHEN count(DISTINCT nullif(btrim(lp.group_id),''))=1
                        THEN min(nullif(btrim(lp.group_id),'')) END AS group_id
            FROM "Learner".learners lp WHERE lp.enrolment_id=u.id
        ) placement ON true
        -- JSON stored as a string needs the existing Python decoder. Without a
        -- verified plan, leave the attempt unresolved rather than guess.
        WHERE jsonb_typeof(u."Training_plan") IS DISTINCT FROM 'string'
          AND (jsonb_typeof(u."Training_plan")='array'
               OR jsonb_typeof(u."Learning_plan") IS DISTINCT FROM 'string')
    ), plan_entries AS MATERIALIZED (
        SELECT pc.learner_id, nullif(btrim(e.value->>'moduleId'),'') AS module_id,
               e.value->>'assignmentMode' AS assignment_mode
        FROM plan_context pc CROSS JOIN LATERAL jsonb_array_elements(pc.plan) e(value)
        WHERE jsonb_typeof(e.value)='object'
    ), inherited AS MATERIALIZED (
        SELECT pc.learner_id, preset.module_ids
        FROM plan_context pc
        JOIN LATERAL (
            SELECT g.module_ids FROM curriculum.groups g
            WHERE g.deleted_at IS NULL AND NOT coalesce(g.is_programme_deleted,false)
              AND (g.group_id=pc.group_id OR (pc.group_id IS NULL AND g.group_name=pc.group_name
                   AND (g.programme_name=pc.programme OR g.programme_id=pc.programme)))
            -- Same legacy name tiebreak as learning_plan.GROUP_PRESET_SQL.
            ORDER BY jsonb_array_length(CASE WHEN jsonb_typeof(g.module_ids)='array'
                          THEN g.module_ids ELSE '[]'::jsonb END) DESC,
                     g.updated_at DESC NULLS LAST, g.created_at DESC NULLS LAST, g.group_id
            LIMIT 1
        ) preset ON true
        WHERE pc.plan IS NULL OR (
            EXISTS(SELECT 1 FROM plan_entries e WHERE e.learner_id=pc.learner_id AND e.module_id IS NOT NULL)
            AND NOT EXISTS(SELECT 1 FROM plan_entries e WHERE e.learner_id=pc.learner_id AND e.assignment_mode='explicit')
        )
    ), effective_plan AS MATERIALIZED (
        SELECT e.learner_id, e.module_id FROM plan_entries e WHERE e.module_id IS NOT NULL
          AND NOT EXISTS(SELECT 1 FROM inherited i WHERE i.learner_id=e.learner_id
                         AND jsonb_typeof(i.module_ids)='string')
        UNION
        SELECT i.learner_id, m.module_catalogue_id
        FROM inherited i CROSS JOIN LATERAL jsonb_array_elements_text(
            CASE WHEN jsonb_typeof(i.module_ids)='array' THEN i.module_ids ELSE '[]'::jsonb END) e(module_id)
        JOIN curriculum.modules m ON m.module_catalogue_id=btrim(e.module_id)
        WHERE coalesce(m.learner_roster_mode,'inherited')<>'manual'
    ), plan_matches AS (
        SELECT a.id, min(s.id) AS component_id, min(s.module_id) AS module_id
        FROM unresolved a JOIN slots s ON s.quiz_ref=a.quiz_ref
        JOIN effective_plan ep ON ep.learner_id=a.learner_id AND ep.module_id=s.module_id
        WHERE (s.week_id=a.week_ref OR (a.week_ref IS NULL AND s.week_label=a.week_label))
          AND (s.module_id=a.module_hint
               OR NOT EXISTS(SELECT 1 FROM curriculum.modules m WHERE m.module_catalogue_id=a.module_hint))
        GROUP BY a.id HAVING count(*)=1
    ), attributed AS (
        SELECT * FROM exact_matches UNION ALL SELECT * FROM plan_matches
    )
    SELECT p.*, a.component_id AS matched_quiz_component
    FROM attributed a JOIN "Learner".learner_progress_entries p ON p.id=a.id
    WHERE a.module_id=(SELECT module_id FROM requested)
'''


def read_unplaced_quiz_records(module_id, learners):
    """Recover unlinked passes for the module's roster in one database read."""
    if not learners or connections['enrolment'].vendor != 'postgresql':
        return []
    with connections['enrolment'].cursor() as cursor:
        cursor.execute(UNPLACED_QUIZ_SQL, [module_id, sorted(set(learners))])
        columns = [column[0] for column in cursor.description]
        return [dict(zip(columns, row)) for row in cursor.fetchall()]


def submission_placement(source, quiz_id, *, module, week):
    """Use route context only to narrow slots from this learner's current plan."""
    from .learning_plan import effective_training_plan

    module = module.strip() if isinstance(module, str) else ''
    week = week.strip().casefold() if isinstance(week, str) else ''
    if not (module or week):
        # Direct and standalone callers have no curriculum context.
        return None
    modules = [row['moduleId'] for row in effective_training_plan(source)
               if isinstance(row, dict) and row.get('moduleId')]
    matches = [row for row in read_placements(modules, [str(quiz_id)])
               if (not module or row['moduleId'] == module
                   or (row['module'] or '').strip().casefold() == module.casefold())
               and (not week or (row['week'] or '').strip().casefold() == week)]
    if len(matches) == 1:
        return {key: matches[0][key] for key in ('componentId', 'moduleId', 'weekId')}
    return None
