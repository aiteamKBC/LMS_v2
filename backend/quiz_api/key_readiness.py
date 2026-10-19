"""The draft label does not mean a quiz is unused by learners."""
from django.db import connection


LINKED_QUIZ_IDS_SQL = """
SELECT btrim(c.settings_json->>'linkedQuizId') AS quiz_ref
FROM curriculum.components c
JOIN curriculum.modules m ON m.module_catalogue_id=c.module_catalogue_id
WHERE c.deleted_at IS NULL AND NOT coalesce(c.is_programme_deleted,false)
  AND m.deleted_at IS NULL
UNION
SELECT l.quiz_id::text FROM curriculum.quiz_component_links l
JOIN curriculum.components c ON c.id=l.component_id
JOIN curriculum.modules m ON m.module_catalogue_id=c.module_catalogue_id
WHERE c.deleted_at IS NULL AND NOT coalesce(c.is_programme_deleted,false)
  AND m.deleted_at IS NULL
UNION
SELECT l.quiz_id::text FROM curriculum.quiz_course_links l
JOIN curriculum.modules m ON m.module_catalogue_id=l.module_catalogue_id
WHERE m.deleted_at IS NULL
UNION
SELECT q.id::text FROM curriculum.quizzes q
JOIN curriculum.weeks w ON w.id=q.week_id
JOIN curriculum.modules m ON m.module_catalogue_id=w.module_catalogue_id
WHERE w.deleted_at IS NULL AND NOT coalesce(w.is_programme_deleted,false)
  AND m.deleted_at IS NULL
UNION
SELECT btrim(settings_json->>'linkedQuizId')
FROM curriculum.week_template_components
"""


def linked_quiz_ids(cursor):
    """Read all explicit authoring routes, including week templates and metadata."""
    cursor.execute(LINKED_QUIZ_IDS_SQL)
    return {int(row[0]) for row in cursor.fetchall() if str(row[0] or '').isdigit()}


def quiz_requires_valid_key(quiz):
    if quiz.status == 'published':
        return True
    if quiz.package_type == 'scorm':
        return False
    with connection.cursor() as cursor:
        cursor.execute('SELECT EXISTS(SELECT 1 FROM (' + LINKED_QUIZ_IDS_SQL +
                       ') linked WHERE quiz_ref=%s)', [str(quiz.pk)])
        return bool(cursor.fetchone()[0])
