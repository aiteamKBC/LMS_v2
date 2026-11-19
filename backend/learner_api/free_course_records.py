"""Native free-course assignment and completion records.

The completion table retains activity state and completion dates. The progress
ledger remains the authority for attempts, evidence and actual hours; writing
this index never awards hours a second time.
"""
from django.db import connections, transaction

from curriculum_api.learning_storage import enabled
from .models import LearnerFreeCourse, LearnerFreeCourseProgress
from .free_course_progress import save_completion
from .progress_rules import progress_counts_as_achieved


def profile_progress_enabled(database=None):
    database = database or connections['enrolment']
    if database.vendor != 'postgresql':
        return False
    with database.cursor() as cursor:
        cursor.execute("""SELECT EXISTS (SELECT 1 FROM pg_constraint
            WHERE conrelid=to_regclass('"Learner".learner_free_course_progress')
              AND conname='learner_free_course_progress_learner_fk')""")
        return cursor.fetchone()[0] is True


def progress_owner(source):
    """Read old installations safely until their identity migration commits."""
    if not profile_progress_enabled():
        return source.pk
    from .identity import learner_profile_for_source
    profile = learner_profile_for_source(source, heal=False)
    return profile.pk if profile else None


def replace_assignments(learner, assignments, *, plan=None):
    """Keep stable assignment IDs while syncing legacy and Builder selections."""
    from .free_course_catalogue import builder_free_courses
    selected = {str(item['freeCourseId']): item for item in assignments or []
                if isinstance(item, dict) and item.get('freeCourseId')}
    identifiers = [item.get('moduleId') for item in plan or []
                   if isinstance(item, dict) and item.get('moduleId')]
    for course in builder_free_courses(identifiers, include_content=False):
        selected[course['freeCourseId']] = course
    alias = LearnerFreeCourse.objects.db
    with transaction.atomic(using=alias):
        # Assignment sync may run from both activation and the staff editor.
        # Serialize on the shared learner row instead of deleting/recreating
        # assignment IDs, so concurrent saves cannot create duplicate records.
        from .models import LearnerProfile
        LearnerProfile.objects.using(alias).select_for_update().get(pk=learner.pk)
        for position, (reference, item) in enumerate(selected.items(), 1):
            LearnerFreeCourse.objects.update_or_create(learner_id=learner.pk, free_course_ref=reference,
                defaults={'position': position, 'free_course_title': item.get('courseName') or ''})
        LearnerFreeCourse.objects.filter(learner_id=learner.pk).exclude(free_course_ref__in=selected).delete()


def record_completion(learner, progress):
    """Index a successful free-course completion within the ledger transaction."""
    database = connections['enrolment']
    if not enabled(database) or not progress_counts_as_achieved(progress.kind, progress.passed):
        return
    with database.cursor() as cursor:
        cursor.execute('''SELECT c.id, f.id FROM curriculum.free_programme_components c
            JOIN curriculum.free_course_weeks w ON w.id=c.free_module_id
            JOIN curriculum.free_courses f ON f.id=w.course_id
            WHERE c.content_ref=%s AND f.converted_at IS NULL AND f.storage_version=2''',
            [progress.component_ref])
        owner = cursor.fetchone()
    if not owner:
        return
    completed_at = progress.submitted_at or progress.declared_completed_at
    if completed_at is None:
        raise ValueError('A free-course completion must have a recorded completion time.')
    return save_completion(learner.pk, owner[0], owner[1], completed_at)
