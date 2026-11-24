"""Canonical Free Course state, independent of timestamps and archive lifecycle."""
from django.db.models.functions import Coalesce

from .models import FREE_PROGRESS_ACTIVE, LearnerFreeCourseProgress


ACTIVITY_STATES = frozenset({"not_started", "reading_viewed", "completed"})


def active_progress(learner_id):
    return LearnerFreeCourseProgress.objects.filter(
        learner_id=learner_id, status=FREE_PROGRESS_ACTIVE, deleted_at__isnull=True)


def completed_component_refs(learner_id):
    return set(active_progress(learner_id).filter(is_completed=True)
               .values_list('component_ref', flat=True))


def save_activity_state(learner_id, component_ref, free_course_ref, activity_state, completed_at=None):
    """Write after the endpoint validates enrollment and component ownership.

    Unique learner/component identity prevents duplicate inserts. Conditional
    updates prevent races from downgrading completion or reactivating archives.
    A repeated completion never fills an unknown historical completion date.
    False means archived or conflicting course ownership, never success.
    """
    if activity_state not in ACTIVITY_STATES:
        raise ValueError('Unknown Free Course activity state.')
    if activity_state == 'completed' and completed_at is None:
        raise ValueError('A new completion event requires its actual timestamp.')
    manager = LearnerFreeCourseProgress.objects
    row, created = manager.get_or_create(
        learner_id=learner_id, component_ref=component_ref,
        defaults={'free_course_ref': free_course_ref,
                  'completed_at': completed_at if activity_state == 'completed' else None,
                  'status': FREE_PROGRESS_ACTIVE,
                  'is_completed': activity_state == 'completed', 'activity_state': activity_state})
    if created:
        return True
    if (row.status != FREE_PROGRESS_ACTIVE or row.deleted_at is not None
            or row.free_course_ref != free_course_ref):
        return False
    if row.is_completed or activity_state == 'not_started':
        return True
    eligible = active_progress(learner_id).filter(
        component_ref=component_ref, free_course_ref=free_course_ref)
    if activity_state == 'completed':
        eligible.filter(is_completed=False).update(
            is_completed=True, activity_state='completed',
            completed_at=Coalesce('completed_at', completed_at))
    else:
        eligible.filter(is_completed=False, activity_state='not_started').update(
            activity_state='reading_viewed', is_completed=False)
    # A concurrent archive/course change must not be reported as saved.
    return eligible.exists()


def save_completion(learner_id, component_ref, free_course_ref, completed_at):
    return save_activity_state(learner_id, component_ref, free_course_ref, 'completed', completed_at)
