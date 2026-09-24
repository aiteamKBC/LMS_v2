"""Recover original questions by exact exported course/activity lineage."""
import json

from .subject_content import as_list, quiz_definition


def imported_quiz(cursor, group_id, quiz_id):
    cursor.execute('''WITH export AS (
        SELECT CASE WHEN jsonb_typeof(curriculum)='string'
          THEN (curriculum #>> '{}')::jsonb ELSE curriculum END AS payload
        FROM "MBA".course_curriculum WHERE course_id=%s)
        SELECT material FROM export
        CROSS JOIN LATERAL jsonb_array_elements(payload->'sections') section
        CROSS JOIN LATERAL jsonb_array_elements(section->'materials') material
        WHERE material->>'source_component_id'=%s''', [int(group_id), str(quiz_id)])
    candidates = []
    for (material,) in cursor.fetchall():
        # Django's PostgreSQL cursor returns JSONB as text; direct psycopg
        # cursors may already decode it. Support both without changing loaders.
        if isinstance(material, str):
            try:
                material = json.loads(material)
            except ValueError:
                return None
        if not isinstance(material, dict):
            return None
        definition = material.get('quiz_definition') or {}
        if not isinstance(definition, dict):
            return None
        raw_questions = as_list(definition.get('questions'))
        quiz = {'quiz_id': quiz_id, 'quiz_body': material.get('content_html') or '',
                'configured_questions': definition.get('question_count'),
                'maximum_score': 100, 'passing_score': material.get('passing_grade_percent'),
                'questions': [], 'solutions': []}
        for raw in raw_questions:
            if not isinstance(raw, dict):
                return None
            quiz['questions'].append({'question_id': raw.get('question_id'),
                'question_body': raw.get('body_html') or raw.get('question_text') or raw.get('title') or '',
                'question_type': raw.get('question_type'), 'options': raw.get('answer_options')})
            quiz['solutions'].append({'question_id': raw.get('question_id'),
                                      'correct_answer': raw.get('correct_answers')})
        if not quiz_definition(quiz)['ready']:
            return None
        if quiz not in candidates:
            candidates.append(quiz)
    # Conflicting placements must be reviewed, never chosen arbitrarily.
    return candidates[0] if len(candidates) == 1 else None
