"""Discover committed LMS completions, with persisted-source reconciliation."""
from django.conf import settings
from django.db import DatabaseError, transaction
from django.db.models.signals import post_save
from django.dispatch import receiver

from coach_api.models import ImportedReviewInstance

from . import review_feedback


@receiver(post_save, sender=ImportedReviewInstance, dispatch_uid='feedback_imported_review_completed')
def imported_review_saved(sender, instance, using, raw=False, update_fields=None, **kwargs):
    if (raw or instance.status != ImportedReviewInstance.STATUS_COMPLETED
            or (update_fields is not None and 'status' not in update_fields)
            or not (settings.DEBUG or (settings.LEARNER_FEEDBACK_ENABLED
                                      and settings.LEARNER_NON_LECTURE_FEEDBACK_ENABLED))):
        return
    # Family cannot rule out EPA: its trigger is the persisted review_name.
    # Reconcile after commit and let the verified source/name checks select a
    # published form. Unrelated reviews still produce no assignments.

    def reconcile():
        try:
            review_feedback.sync_completed_overlay(instance)
        except DatabaseError:
            # Completion is already committed. Its persisted source is retried
            # by the learner page or sync_review_feedback command, not lost in
            # an in-memory callback. Do not leak database errors into logs.
            review_feedback.logger.warning('Review feedback reconciliation pending after LMS completion')

    transaction.on_commit(reconcile, using=using)
