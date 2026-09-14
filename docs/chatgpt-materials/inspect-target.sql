-- Read-only queries for the project owner's Neon SQL Editor.
-- Replace REPLACE_WITH_VERIFIED_MODULE_ID before the target queries.
-- This file creates no records and changes no schema.
BEGIN READ ONLY;

SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'curriculum'
  AND table_name IN (
    'programmes', 'modules', 'weeks', 'components',
    'week_templates', 'week_template_components', 'ksb_mappings',
    'quizzes', 'quiz_questions', 'quiz_answers',
    'quiz_component_links', 'quiz_course_links',
    'free_courses', 'free_course_weeks', 'free_programme_components'
  )
ORDER BY table_name, ordinal_position;

SELECT programme_id, name, structure_type, status
FROM curriculum.programmes
WHERE deleted_at IS NULL
ORDER BY name
LIMIT 100;

-- Choose the destination by exact ID. A title alone is not sufficient.
-- Add a programme/group filter if the catalogue is large.
SELECT m.module_catalogue_id, m.title AS module_title,
       m.programme_id, p.name AS programme_name,
       m.cohort_id, m.cohort_name, m.group_id, m.group_name
FROM curriculum.modules m
LEFT JOIN curriculum.programmes p ON p.programme_id = m.programme_id
WHERE m.deleted_at IS NULL AND NOT coalesce(m.is_programme_deleted, false)
ORDER BY p.name, m.title, m.module_catalogue_id
LIMIT 200;

SELECT module_catalogue_id, programme_id, title, group_id,
       deleted_at, is_programme_deleted
FROM curriculum.modules
WHERE module_catalogue_id = 'REPLACE_WITH_VERIFIED_MODULE_ID';

SELECT w.id AS week_id, w.week_number, w.title AS week_title,
       w.deleted_at AS week_deleted_at,
       c.id AS component_id, c.type, c.title AS component_title,
       c.deleted_at AS component_deleted_at,
       c.settings_json ->> 'uploadedFileUrl' AS uploaded_file_url,
       c.settings_json ->> 'presentationUrl' AS presentation_url,
       c.settings_json ->> 'resourceUrl' AS resource_url,
       c.settings_json ->> 'podcastUrl' AS podcast_url,
       c.settings_json ->> 'videoUrl' AS video_url,
       c.settings_json ->> 'assignmentFileUrl' AS assignment_file_url,
       c.settings_json ->> 'linkedQuizId' AS linked_quiz_id
FROM curriculum.weeks w
LEFT JOIN curriculum.components c
  ON c.week_id = w.id AND c.module_catalogue_id = w.module_catalogue_id
WHERE w.module_catalogue_id = 'REPLACE_WITH_VERIFIED_MODULE_ID'
ORDER BY w.display_order, w.id, c.display_order, c.id;

SELECT q.id AS quiz_id, q.title, q.status, q.week_id,
       link.component_id,
       (SELECT count(*) FROM curriculum.quiz_questions question
        WHERE question.quiz_id = q.id AND NOT question.is_archived) AS active_questions
FROM curriculum.quiz_component_links link
JOIN curriculum.quizzes q ON q.id = link.quiz_id
JOIN curriculum.components c ON c.id = link.component_id
WHERE c.module_catalogue_id = 'REPLACE_WITH_VERIFIED_MODULE_ID'
ORDER BY q.id, link.component_id;

ROLLBACK;
