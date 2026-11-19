"""Invalidate only derived Activities summaries after committed source changes."""
import logging
import re

from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from learner_api.models import LearnerProfile, LearnerProgressEntry, EnrolmentUser
from .activity_plan_snapshots import mark_dirty, mark_sources_dirty

log = logging.getLogger(__name__)


@receiver([post_save, post_delete], sender=LearnerProgressEntry, dispatch_uid='activity_plan_progress_changed')
def progress_changed(sender, instance, using, **kwargs):
    mark_dirty([instance.learner_id], using=using)


@receiver([post_save, post_delete], sender=LearnerProfile, dispatch_uid='activity_plan_profile_changed')
def profile_changed(sender, instance, using, **kwargs):
    mark_dirty([instance.pk], using=using)


@receiver([post_save, post_delete], sender=EnrolmentUser, dispatch_uid='activity_plan_source_changed')
def source_changed(sender, instance, using, **kwargs):
    try:
        mark_sources_dirty([instance.pk], using=using)
    except Exception:
        log.warning('activity_plan_source_invalidation_failed', exc_info=True)


class ActivityPlanInvalidationMiddleware:
    """Raw SQL/bulk write paths do not emit Django's model-save signals."""
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        if request.method in ('GET', 'HEAD', 'OPTIONS') or not 200 <= response.status_code < 300:
            return response
        try:
            match = re.match(r'^/learner_api/(?:[^/]+/)*?(?:commercial|apprenticeship)/(\d+)(?:/|$)', request.path)
            plan = re.match(r'^/learner_api/learning-plan/(\d+)(?:/|$)', request.path)
            if match or plan:
                mark_sources_dirty([int((match or plan)[1])])
            elif getattr(request, 'curriculum_changed', False) or request.path.startswith('/quiz_api/quizzes/'):
                # CurriculumChangeLogMiddleware sets this only after an actual
                # committed catalogue change. Telemetry and read-only POSTs
                # must not queue every learner again. Imported progress writes
                # are detected per learner by the revision reconciler.
                mark_dirty()
        except Exception:
            log.warning('activity_plan_request_invalidation_failed', exc_info=True)
        return response
