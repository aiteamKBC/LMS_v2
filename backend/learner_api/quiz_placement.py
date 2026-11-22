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


def read_labelled_quiz_records(module_id, learners):
    """Find passed attempts whose saved module and week identify one live slot."""
    if not learners or connections['enrolment'].vendor != 'postgresql':
        return []
    with connections['enrolment'].cursor() as cursor:
        cursor.execute(f'''
            WITH module_slots AS (
                SELECT c.id, c.module_catalogue_id, c.week_id, link.quiz_ref,
                       lower(btrim(m.title)) AS module_label, lower(btrim(w.title)) AS week_label
                {SLOT_FROM}
                WHERE c.module_catalogue_id=%s AND link.quiz_ref IS NOT NULL AND {ACTIVE_SLOT}
            ), candidates AS (
                SELECT p.*, s.id AS matched_quiz_component
                FROM "Learner".learner_progress_entries p
                JOIN module_slots s ON s.quiz_ref=p.quiz_ref
                  AND (s.module_label=lower(btrim(p.module_title)) OR s.module_catalogue_id=btrim(p.module_title))
                  AND s.week_label=lower(btrim(p.week_title))
                  AND (nullif(btrim(p.week_ref),'') IS NULL OR s.week_id=p.week_ref)
                WHERE p.learner_id=ANY(%s) AND p.kind='quiz' AND p.passed IS TRUE
                  AND p.submitted_at IS NOT NULL AND p.deleted_at IS NULL
                  AND nullif(btrim(p.component_ref),'') IS NULL
                  AND nullif(btrim(p.curriculum_component_ref),'') IS NULL
                  AND nullif(btrim(p.module_ref),'') IS NULL
                  AND nullif(btrim(p.module_title),'') IS NOT NULL
                  AND nullif(btrim(p.week_title),'') IS NOT NULL
            )
            SELECT a.* FROM candidates a
            WHERE NOT EXISTS (
                SELECT 1 {SLOT_FROM}
                WHERE c.id<>a.matched_quiz_component AND link.quiz_ref=a.quiz_ref
                  AND (lower(btrim(m.title))=lower(btrim(a.module_title)) OR m.module_catalogue_id=btrim(a.module_title))
                  AND lower(btrim(w.title))=lower(btrim(a.week_title))
                  AND (nullif(btrim(a.week_ref),'') IS NULL OR c.week_id=a.week_ref)
                  AND {ACTIVE_SLOT}
            )
        ''', [module_id, sorted(set(learners))])
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
