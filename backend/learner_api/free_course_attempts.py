"""Canonical Free Course quiz history and idempotent saves; never awards hours."""
import json
from contextlib import contextmanager
from uuid import UUID, uuid5, NAMESPACE_URL

from django.db import connections, transaction

from .free_course_progress import save_completion
from django.utils import timezone

from .free_course_hours import MAPPINGS_SQL

HISTORY_SQL = '''SELECT a.id,a.score_percent,a.passed,a.completed,a.submitted_at
 FROM "Learner".subject_activity_attempts a
 WHERE a.learner_id=%s AND (a.submitted_at IS NOT NULL OR (
   a.free_component_ref IS NOT NULL AND a.kind='quiz' AND a.completed IS TRUE
   AND a.definition->>'source_system'='old_lms'
   AND a.definition->'historical_import'='true'::jsonb)) AND
 (a.free_component_ref=%s OR (a.free_component_ref IS NULL AND EXISTS (
   SELECT 1 FROM (''' + MAPPINGS_SQL + ''') m
   JOIN "Learner".learner_activity_sources s
     ON s.canonical_progress_id=m.old_progress_id AND s.learner_id=m.learner_id
   WHERE m.learner_id=a.learner_id AND m.free_component_id=%s
     AND s.source_catalog_activity_id=a.source_activity_fk)))
 ORDER BY a.submitted_at DESC NULLS LAST,a.id DESC LIMIT 50'''


def history(learner_id, component_id):
    with connections['enrolment'].cursor() as cursor:
        cursor.execute(HISTORY_SQL, [learner_id, component_id, component_id])
        return [dict(attemptId=str(row[0]), grade=float(row[1]) if row[1] is not None else None,
                     passed=row[2], completed=row[3], submittedAt=row[4]) for row in cursor.fetchall()]


def submission_id(value, learner_id, component_id, quiz_id, answers):
    if value is not None:
        return str(UUID(str(value)))
    # Older clients have no retry key: identical payloads replay the saved result.
    # Updated clients send a fresh UUID only for a deliberate new attempt.
    return str(uuid5(NAMESPACE_URL, json.dumps(
        [learner_id, component_id, quiz_id, answers], sort_keys=True, separators=(',', ':'))))


@contextmanager
def active_learner_write(learner_id):
    """Serialize writes with withdrawal; a prior request-level read is insufficient."""
    with transaction.atomic(using='enrolment'), connections['enrolment'].cursor() as cursor:
        cursor.execute('''SELECT id FROM "Learner".learners WHERE id=%s
          AND lower(trim(coalesce(lifecycle_status,''))) <> 'withdrawn'
          AND lower(trim(coalesce(programme_status,''))) <> 'withdrawn'
          FOR UPDATE''', [learner_id])
        if cursor.fetchone() is None:
            raise LookupError('Activity not found or learner withdrawn.')
        yield cursor


def save(learner_id, course_id, component_id, attempt_id, quiz, answers, result):
    """Serialize enrollment/archive checks, attempt persistence and completion.

    A retry returns its original saved result; it never replays historical rows
    into current progress or adds an hours entry. Legacy identity fields stay NULL.
    """
    with active_learner_write(learner_id) as cursor:
        cursor.execute('''SELECT a.id FROM curriculum.free_programme_components a
          JOIN curriculum.free_course_weeks w ON w.id=a.free_module_id
          WHERE a.id=%s AND w.course_id=%s AND a.deleted_at IS NULL
          AND w.deleted_at IS NULL AND w.status='active' AND EXISTS (
            SELECT 1 FROM "Learner".learner_free_courses e WHERE e.learner_id=%s AND e.free_course_ref=w.course_id)''',
          [component_id, course_id, learner_id])
        if cursor.fetchone() is None:
            raise LookupError('Activity is no longer available.')
        cursor.execute('''SELECT learner_id,free_component_ref,answers,definition,submitted_at
          FROM "Learner".subject_activity_attempts WHERE id=%s FOR UPDATE''', [attempt_id])
        saved = cursor.fetchone()
        if saved:
            definition = saved[3] if isinstance(saved[3], dict) else json.loads(saved[3])
            stored_answers = saved[2] if isinstance(saved[2], dict) else json.loads(saved[2] or '{}')
            if (saved[0] != learner_id or saved[1] != component_id or stored_answers != answers
                    or saved[4] is None or not definition.get('freeCourseResult')):
                raise ValueError('Submission identity is already in use. Start a new attempt.')
            return definition['freeCourseResult']
        result = dict(result, attemptId=attempt_id)
        definition = {'catalogue_kind': 'free_course_quiz', 'quiz': quiz, 'freeCourseResult': result}
        snapshot = {'free_component_ref': component_id, 'free_course_ref': course_id, 'quiz_id': quiz['id']}
        cursor.execute('''INSERT INTO "Learner".subject_activity_attempts
          (id,learner_id,free_component_ref,source_activity_snapshot,kind,definition,
           answers,score_percent,passed,completed,submitted_at)
          VALUES (%s,%s,%s,%s::jsonb,'quiz',%s::jsonb,%s::jsonb,%s,%s,%s,CURRENT_TIMESTAMP)''',
          [attempt_id, learner_id, component_id, json.dumps(snapshot), json.dumps(definition),
           json.dumps(answers), result['grade'], result['passed'], result['passed']])
        if result['passed'] and not save_completion(learner_id, component_id, course_id, timezone.now()):
            # Propagate out of atomic so the attempt cannot survive a failed completion.
            raise LookupError('This activity completion is withdrawn.')
        return result


def activity_times(learner_id, course_ids):
    """Resume from saved learner work, never from content/migration timestamps."""
    if not course_ids:
        return {}
    with connections['enrolment'].cursor() as cursor:
        cursor.execute('''SELECT w.course_id,a.id,max(events.at)
          FROM curriculum.free_programme_components a
          JOIN curriculum.free_course_weeks w ON w.id=a.free_module_id
          JOIN (
            SELECT component_ref AS component_id,completed_at AS at FROM "Learner".learner_free_course_progress
            WHERE learner_id=%s AND status='active' AND deleted_at IS NULL AND is_completed IS TRUE
            UNION ALL
            SELECT free_component_ref,submitted_at FROM "Learner".subject_activity_attempts
            WHERE learner_id=%s AND free_component_ref IS NOT NULL AND submitted_at IS NOT NULL
          ) events ON events.component_id=a.id
          WHERE w.course_id=ANY(%s) AND a.deleted_at IS NULL AND w.deleted_at IS NULL AND w.status='active'
          AND EXISTS (SELECT 1 FROM "Learner".learner_free_courses e WHERE e.learner_id=%s AND e.free_course_ref=w.course_id)
          AND NOT EXISTS (SELECT 1 FROM "Learner".learner_free_course_progress p WHERE p.learner_id=%s
            AND p.component_ref=a.id AND (p.status<>'active' OR p.deleted_at IS NOT NULL))
          GROUP BY w.course_id,a.id''', [learner_id, learner_id, list(course_ids), learner_id, learner_id])
        return {(row[0],row[1]): row[2] for row in cursor.fetchall() if row[2] is not None}
