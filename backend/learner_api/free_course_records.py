
"""Native free-course assignment and completion records.

The completion table retains activity state and completion dates. The progress
ledger remains the authority for attempts, evidence and actual hours; writing
this index never awards hours a second time.
"""

from django.db import connections, transaction

from .models import LearnerFreeCourse


def profile_progress_enabled(database=None):
    database = database or connections['enrolment']

    if database.vendor != 'postgresql':
        return False

    with database.cursor() as cursor:
        cursor.execute("""
            SELECT EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conrelid = to_regclass(
                    '"Learner".learner_free_course_progress'
                )
                AND conname = 'learner_free_course_progress_learner_fk'
            )
        """)

        return cursor.fetchone()[0] is True


def progress_owner(source):
    """Read old installations safely until their identity migration commits."""

    if not profile_progress_enabled():
        return source.pk

    from .identity import learner_profile_for_source

    profile = learner_profile_for_source(source, heal=False)

    return profile.pk if profile else None


def replace_assignments(learner, assignments, *, plan=None):
    """Keep stable assignment IDs while syncing canonical selections.

    ``plan`` remains accepted for inactive compatibility callers, but normal
    Learning Plan module IDs are never treated as Free Course identities.
    """

    selected = {
        str(item['freeCourseId']): item
        for item in assignments or []
        if isinstance(item, dict) and item.get('freeCourseId')
    }

    alias = LearnerFreeCourse.objects.db

    with transaction.atomic(using=alias):
        # Assignment sync may run from both activation and the staff editor.
        # Serialize on the shared learner row instead of deleting/recreating
        # assignment IDs, so concurrent saves cannot create duplicate records.

        from .models import LearnerProfile

        LearnerProfile.objects.using(alias).select_for_update().get(
            pk=learner.pk
        )

        for position, (reference, item) in enumerate(selected.items(), 1):
            LearnerFreeCourse.objects.update_or_create(
                learner_id=learner.pk,
                free_course_ref=reference,
                defaults={'position': position},
            )

        LearnerFreeCourse.objects.filter(
            learner_id=learner.pk
        ).exclude(
            free_course_ref__in=selected
        ).delete()


def record_completion(learner, progress):
    """Do not infer canonical Free Course progress from normal module progress.

    Canonical Free Course completions are written by the ownership-gated
    endpoints in ``free_courses_view``. Normal progress has no valid identity
    mapping to ``free_programme_components`` in the current schema, so this
    retained hook intentionally performs no read or write.
    """

    return None
