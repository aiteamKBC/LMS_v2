"""Attribute existing ledger seconds; never award or copy Free Course hours.

The reviewed migration tables are identity bridges, not hours authorities.
The original ledger remains the sole source for acceptance and actual seconds.
"""
from django.db import DatabaseError, connections


INCLUSION_COURSES = frozenset(
    f'FREECOURSE-KBC-INC-M{number:02d}-20260917' for number in range(1, 8))

ADDITIONAL_COURSES = frozenset([
    'FREECOURSE-MM-MOD-20260822CF33C7A02E36',
    'FREECOURSE-MM-MOD-202608225900AF6B327D',
    'FREECOURSE-20260922115607960821CBC54E8162BF',
    'FREECOURSE-MM-MOD-20260822E35A9F7DFC21',
    'FREECOURSE-MBA-MOD-20260822899D822C193B',
    'FREECOURSE-MBA-MOD-2026082202DCF4E837EF',
    'FREECOURSE-MM-MOD-202608220A19E33C5552',
])
REMAINING_COURSES = frozenset({'FREECOURSE-MM-MOD-202608229EA79025AB55'})
# Retained for historical audit tooling; runtime scopes to assigned canonical IDs.
SUPPORTED_COURSES = INCLUSION_COURSES | ADDITIONAL_COURSES | REMAINING_COURSES

MAPPINGS_SQL = '''SELECT old_progress_id,learner_id,free_course_id,free_component_id
    FROM "Learner".free_course_hours_migration
    UNION
    SELECT old_progress_id,learner_id,free_course_id,free_component_id
    FROM "Learner".free_course_hours_migration_additional
    UNION
    SELECT old_progress_id,learner_id,free_course_id,free_component_id
    FROM "Learner".free_course_hours_migration_remaining'''

HOURS_SQL = f'''SELECT m.free_course_id,m.free_component_id,p.actual_seconds,p.id,m.identity_count
    FROM (
        SELECT old_progress_id,learner_id,free_course_id,free_component_id,
            count(*) OVER (PARTITION BY old_progress_id) AS identity_count
        FROM ({MAPPINGS_SQL}) identities
    ) m
    JOIN "Learner".learner_progress_entries p
      ON p.id=m.old_progress_id AND p.learner_id=m.learner_id
    JOIN curriculum.free_programme_components component
      ON component.id=m.free_component_id AND component.deleted_at IS NULL
    JOIN curriculum.free_course_weeks week
      ON week.id=component.free_module_id AND week.course_id=m.free_course_id
      AND week.deleted_at IS NULL AND week.status='active'
    WHERE m.learner_id=%s AND m.free_course_id=ANY(%s)
      AND p.deleted_at IS NULL AND p.accepted IS TRUE
      AND p.actual_seconds IS NOT NULL
      AND EXISTS (SELECT 1 FROM "Learner".learner_free_courses enrollment
          WHERE enrollment.learner_id=m.learner_id
            AND enrollment.free_course_ref=m.free_course_id)
    ORDER BY m.old_progress_id'''


def accepted_activity_seconds(learner_id, course_ids):
    """Read assigned canonical activities once, independent of completion flags.

    All assigned canonical courses are eligible for bridge attribution. Courses
    without mapped ledger entries contribute no hours; no catalogue ID allowlist.
    """
    selected = sorted(set(course_ids))
    if not selected:
        return {}
    with connections['enrolment'].cursor() as cursor:
        cursor.execute(HOURS_SQL, [learner_id, selected])
        return activity_seconds(cursor.fetchall())


def activity_seconds(rows):
    """Sum distinct ledger entries; reject reuse or conflicting attribution."""
    result = {}
    seen = set()
    for course_id, component_id, seconds, progress_id, identity_count in rows:
        key = (course_id, component_id)
        if identity_count != 1 or seconds < 0:
            raise DatabaseError('Ambiguous or invalid Free Course hours attribution.')
        if progress_id in seen:
            raise DatabaseError('Repeated ledger identity in Free Course hours attribution.')
        seen.add(progress_id)
        result[key] = result.get(key, 0) + int(seconds)
    return result
