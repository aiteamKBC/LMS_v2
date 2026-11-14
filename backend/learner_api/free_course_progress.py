"""Completion reads/writes that also understand incomplete and archived rows.

The JSON metadata checks work before and after migration 0027. They let the
reviewed application deploy before the new columns without inferring completion
from the mere existence of an imported progress row.
"""
from django.db import connections, transaction

from .models import LearnerFreeCourseProgress


def completed_component_refs(learner_id):
    manager = LearnerFreeCourseProgress.objects
    database = connections[manager.db]
    if database.vendor != 'postgresql':
        return set(manager.filter(learner_id=learner_id, completed_at__isnull=False)
                   .values_list('component_ref', flat=True))
    with database.cursor() as cursor:
        cursor.execute('''SELECT p.component_ref FROM "Learner".learner_free_course_progress p
            WHERE p.learner_id=%s AND p.completed_at IS NOT NULL
              AND coalesce(to_jsonb(p)->>'status', 'active')='active'
              AND to_jsonb(p)->>'deleted_at' IS NULL''', [learner_id])
        return {row[0] for row in cursor.fetchall()}


def save_completion(learner_id, component_ref, free_course_ref, completed_at):
    """Complete an active placeholder once; retain prior dates and archive state.

    False means an archived record or a conflicting owner prevented the write.
    A caller must not report successful completion in that case.
    """
    if completed_at is None:
        raise ValueError('A free-course completion must have a recorded completion time.')
    manager = LearnerFreeCourseProgress.objects
    database = connections[manager.db]
    if database.vendor != 'postgresql':
        with transaction.atomic(using=manager.db):
            row, _ = manager.get_or_create(learner_id=learner_id, component_ref=component_ref,
                defaults={'free_course_ref': free_course_ref, 'completed_at': completed_at})
            if row.free_course_ref not in (None, free_course_ref):
                return False
            if row.completed_at is None:
                manager.filter(pk=row.pk, completed_at__isnull=True).update(completed_at=completed_at)
            return True
    with database.cursor() as cursor:
        cursor.execute('''INSERT INTO "Learner".learner_free_course_progress AS previous
                (learner_id, component_ref, free_course_ref, completed_at)
            VALUES (%s,%s,%s,%s)
            ON CONFLICT (learner_id, component_ref) DO UPDATE SET
                completed_at=coalesce(previous.completed_at, EXCLUDED.completed_at),
                free_course_ref=coalesce(previous.free_course_ref, EXCLUDED.free_course_ref)
            WHERE coalesce(to_jsonb(previous)->>'status', 'active')='active'
              AND to_jsonb(previous)->>'deleted_at' IS NULL
              AND (previous.free_course_ref IS NULL
                   OR previous.free_course_ref IS NOT DISTINCT FROM EXCLUDED.free_course_ref)
            RETURNING id''', [learner_id, component_ref, free_course_ref, completed_at])
        return cursor.fetchone() is not None
