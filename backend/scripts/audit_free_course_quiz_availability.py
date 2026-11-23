"""Read-only catalogue audit. Never publishes, relinks or changes a quiz."""
import json
from pathlib import Path
from verify_inclusion_canonical_targets import connect_development

SQL = """SELECT a.id AS component_id,f.course_name,a.title AS activity_title,
 a.settings_json->>'linkedQuizId' AS linked_quiz_id,q.status AS quiz_status,
 q.week_id AS legacy_week_id,q.free_course_week_id,
 (SELECT count(*) FROM curriculum.quiz_questions x WHERE x.quiz_id=q.id AND NOT x.is_archived) AS active_questions,
 (SELECT count(*) FROM curriculum.quiz_course_links x WHERE x.quiz_id=q.id
  AND x.free_course_id=w.course_id AND x.free_course_week_id=w.id
  AND x.module_catalogue_id IS NULL AND x.week_id IS NULL) AS exact_free_course_links
 FROM curriculum.free_programme_components a
 JOIN curriculum.free_course_weeks w ON w.id=a.free_module_id
 JOIN curriculum.free_courses f ON f.id=w.course_id
 LEFT JOIN curriculum.quizzes q ON q.id=CASE WHEN a.settings_json->>'linkedQuizId' ~ '^[0-9]+$'
   THEN (a.settings_json->>'linkedQuizId')::bigint END
 WHERE a.type ILIKE '%quiz%' AND a.deleted_at IS NULL AND w.deleted_at IS NULL AND w.status='active'
 AND (q.id IS NULL OR q.status IS DISTINCT FROM 'published') ORDER BY f.course_name,a.id"""


def main():
    conn = connect_development()
    try:
        cur = conn.execute(SQL)
        rows = [dict(zip((c.name for c in cur.description), row)) for row in cur.fetchall()]
        counts = {}
        for row in rows:
            state = row['quiz_status'] or 'unlinked'
            counts[state] = counts.get(state, 0) + 1
            row['required_action'] = {
                'unlinked': 'Author or recover a verified quiz, validate its Free Course/week ownership and answer key, then link it. Publication requires editorial approval.',
                'draft': 'Review content and answer keys, confirm canonical ownership, then obtain editorial approval to publish.',
                'trash': 'Confirm whether retirement was intentional. Restore or replace only with editorial approval; preserve saved attempts and explicitly verify ownership before publication.',
            }.get(state, 'Review publication state and ownership.')
        out = Path(__file__).resolve().parents[2] / 'specs/free-course-state-alignment/quiz-availability-2026-11-23.json'
        out.write_text(json.dumps({'counts':counts,'activities':rows},indent=2,ensure_ascii=False),encoding='utf-8')
        print(json.dumps({'counts':counts,'report':str(out),'changes':0}))
    finally:
        conn.rollback()
        conn.close()


if __name__ == '__main__':
    main()
