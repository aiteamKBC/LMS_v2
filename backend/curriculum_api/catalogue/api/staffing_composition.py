"""Concrete catalogue staffing composition bindings.

Owns HTTP/decorator and runtime capability composition. Application operations,
domain policies, SQL and transaction behavior remain in their existing owners.
Public signatures and response contracts are unchanged."""
from curriculum_api import tutor_notifications
from curriculum_api.catalogue.api.adapters import group_tutor_assignment_delivery_day_error
from curriculum_api.catalogue.api.adapters import tutor_assignment_delivery_day_error
from curriculum_api.catalogue.api.adapters import tutor_conflict_error
from curriculum_api.catalogue.api.cache_lifecycle import invalidate_curriculum_cache
from curriculum_api.catalogue.api.catalogue_endpoints import get_cached_payload
from curriculum_api.catalogue.api.responses import json_body
from curriculum_api.catalogue.api.responses import json_error
from curriculum_api.catalogue.domain.row_values import require_fields
from curriculum_api.catalogue.domain.tutor_conflicts import module_schedule_assignment_changed
from curriculum_api.catalogue.domain.tutor_conflicts import tutor_conflict_override_requested
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.infrastructure.authoring_runtime import authoring_fetch_all
from curriculum_api.catalogue.infrastructure.authoring_storage import authoring_upsert
from curriculum_api.catalogue.infrastructure.authoring_storage import update_authoring_rows
from curriculum_api.catalogue.infrastructure.calendar_runtime import module_schedule_view
from curriculum_api.catalogue.infrastructure.catalogue_sources import canonical_staff_assignment_name
from curriculum_api.catalogue.infrastructure.catalogue_sources import resolve_staff_assignment_email
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_MODULES_TABLE
from curriculum_api.catalogue.infrastructure.hierarchy_composition import canonical_group_coaches
from curriculum_api.catalogue.infrastructure.hierarchy_persistence import update_group_fields
from curriculum_api.catalogue.infrastructure.placement_runtime import resolve_group_row
from curriculum_api.catalogue.infrastructure.placement_runtime import with_group_coaches
from curriculum_api.catalogue.infrastructure.tutor_availability_composition import group_tutor_assignment_conflict
from curriculum_api.catalogue.infrastructure.tutor_availability_composition import tutor_schedule_conflicts_created
from datetime import datetime
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
import re


@csrf_exempt
def curriculum_session_detail(request, identifier):
    from curriculum_api.catalogue.api.calendar_editing import curriculum_session_detail as implementation
    def date_non_delivery_reason(*args, **kwargs):
        from curriculum_api.catalogue.infrastructure.delivery_calendar_runtime import date_non_delivery_reason as operation
        return operation(*args, **kwargs)
    return implementation(
        request, identifier, AUTHORING_MODULES_TABLE=AUTHORING_MODULES_TABLE,
        JsonResponse=JsonResponse, authoring_fetch_all=authoring_fetch_all,
        authoring_upsert=authoring_upsert,
        canonical_staff_assignment_name=canonical_staff_assignment_name, clean_str=clean_str,
        date_non_delivery_reason=date_non_delivery_reason,
        invalidate_curriculum_cache=invalidate_curriculum_cache, json_body=json_body,
        json_error=json_error,
        module_schedule_assignment_changed=module_schedule_assignment_changed,
        module_schedule_view=module_schedule_view, re=re,
        tutor_assignment_delivery_day_error=tutor_assignment_delivery_day_error,
        tutor_conflict_error=tutor_conflict_error,
        tutor_conflict_override_requested=tutor_conflict_override_requested,
        tutor_schedule_conflicts_created=tutor_schedule_conflicts_created,
    )


@csrf_exempt
def curriculum_staffing_collection(request):
    from curriculum_api.catalogue.api.calendar_editing import curriculum_staffing_collection as implementation
    return implementation(
        request, JsonResponse=JsonResponse, get_cached_payload=get_cached_payload,
        json_body=json_body, json_error=json_error, require_fields=require_fields,
        update_staffing_assignment=update_staffing_assignment,
    )


@csrf_exempt
def curriculum_staffing_detail(request, identifier):
    from curriculum_api.catalogue.api.calendar_editing import curriculum_staffing_detail as implementation
    return implementation(
        request, identifier, json_body=json_body, json_error=json_error,
        update_staffing_assignment=update_staffing_assignment,
    )


def update_staffing_assignment(identifier, payload):
    from curriculum_api.catalogue.api.calendar_editing import update_staffing_assignment as implementation
    def read_staffing_module_ids(*args):
        from curriculum_api.catalogue.infrastructure.session_writes import read_staffing_module_ids as operation
        return operation(*args, AUTHORING_MODULES_TABLE=AUTHORING_MODULES_TABLE, authoring_fetch_all=authoring_fetch_all, clean_str=clean_str)
    return implementation(
        identifier, payload,
        AUTHORING_MODULES_TABLE=AUTHORING_MODULES_TABLE, JsonResponse=JsonResponse,
        canonical_group_coaches=canonical_group_coaches,
        canonical_staff_assignment_name=canonical_staff_assignment_name, clean_str=clean_str,
        datetime=datetime, group_tutor_assignment_conflict=group_tutor_assignment_conflict,
        group_tutor_assignment_delivery_day_error=group_tutor_assignment_delivery_day_error,
        invalidate_curriculum_cache=invalidate_curriculum_cache, json_error=json_error,
        notify_staff_assignment_change=notify_staff_assignment_change,
        read_staffing_module_ids=read_staffing_module_ids, resolve_group_row=resolve_group_row,
        resolve_staff_assignment_email=resolve_staff_assignment_email,
        tutor_conflict_error=tutor_conflict_error,
        tutor_conflict_override_requested=tutor_conflict_override_requested,
        update_authoring_rows=update_authoring_rows, update_group_fields=update_group_fields,
        with_group_coaches=with_group_coaches,
    )


def notify_staff_assignment_change():
    """Tell a tutor their assignment changed.

    This is all that is left of the old profile-link sync. Assignments live on
    ``curriculum.modules.tutor_name`` / ``curriculum.groups.coach_name``, and the
    staff themselves live in the directory, so there is no second copy to mirror
    a change into -- but the person still has to hear about it, and every write
    path that moves an assignment calls through here to make sure they do.
    """
    tutor_notifications.schedule_assignment_notifications()
