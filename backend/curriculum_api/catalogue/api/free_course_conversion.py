"""Place an existing standalone course without replacing content or learner history."""
import logging

from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_POST

from login.permissions import require_role
from curriculum_api.catalogue.api.structure_composition import get_authoring_structure_payload
from curriculum_api.catalogue.domain.staff_identity import is_blank_staff_assignment
from curriculum_api.catalogue.api.responses import json_body
from curriculum_api.catalogue.api.responses import json_error
from curriculum_api.catalogue.infrastructure.calendar_runtime import module_schedule_view
from curriculum_api.catalogue.api.adapters import tutor_assignment_delivery_day_error
from curriculum_api.catalogue.api.adapters import tutor_conflict_error
from curriculum_api.catalogue.infrastructure.tutor_availability_composition import tutor_schedule_conflicts_created
from ..application import free_course_conversion as workflow
from ..infrastructure import free_course_conversion as storage
from .cache_lifecycle import invalidate_curriculum_cache
from curriculum_api.module_collaboration import announce_saved
from curriculum_api.module_collaboration import check_structure_save

logger = logging.getLogger(__name__)


def destination(payload):
    return workflow.destination(payload, storage=storage)


@require_role('admin', 'staff')
@require_POST
def convert_free_course(request, module_catalogue_id):
    payload = json_body(request)
    if not isinstance(payload, dict):
        return json_error('Invalid JSON body.', status=400)
    tutor_identifier = payload.get('tutor')
    if not isinstance(tutor_identifier, str) or is_blank_staff_assignment(tutor_identifier):
        return json_error('Choose a Tutor before moving this course.', fields=['tutor'], status=400)
    try:
        return workflow.convert_free_course(module_catalogue_id, payload, tutor_identifier,
            storage=storage, clock=timezone.now, reply=JsonResponse, reject=json_error,
            check_structure_save=lambda ident, current, candidate, data: check_structure_save(request, ident, current, candidate, data),
            announce_saved=announce_saved, invalidate_curriculum_cache=invalidate_curriculum_cache,
            get_authoring_structure_payload=get_authoring_structure_payload,
            module_schedule_view=module_schedule_view,
            tutor_assignment_delivery_day_error=tutor_assignment_delivery_day_error,
            tutor_schedule_conflicts_created=tutor_schedule_conflicts_created,
            tutor_conflict_error=tutor_conflict_error)
    except ValueError as exc:
        return json_error(str(exc), status=400)
    except Exception:
        logger.exception('Unable to convert standalone course %s.', module_catalogue_id)
        return json_error('The course could not be moved. No changes were applied; please try again.', status=500)
