"""Concrete catalogue placement command composition bindings.

Owns HTTP/decorator and runtime capability composition. Application operations,
domain policies, SQL and transaction behavior remain in their existing owners.
Public signatures and response contracts are unchanged."""
from curriculum_api import calendar_holidays
from curriculum_api.catalogue.api.adapters import group_tutor_assignment_delivery_day_error
from curriculum_api.catalogue.api.adapters import permanent_delete_reference_refusal
from curriculum_api.catalogue.api.adapters import requested_expected_revision
from curriculum_api.catalogue.api.adapters import tutor_conflict_error
from curriculum_api.catalogue.api.cache_lifecycle import invalidate_curriculum_cache
from curriculum_api.catalogue.api.delivery_composition import curriculum_groups
from curriculum_api.catalogue.api.responses import json_body
from curriculum_api.catalogue.api.responses import json_error
from curriculum_api.catalogue.api.responses import record_conflict_response
from curriculum_api.catalogue.api.staffing_composition import notify_staff_assignment_change
from curriculum_api.catalogue.application.delivery_schedules import build_group_schedule
from curriculum_api.catalogue.domain.hierarchy_dates import apprenticeship_end_override_sent
from curriculum_api.catalogue.domain.hierarchy_dates import cohort_apprenticeship_end_date
from curriculum_api.catalogue.domain.hierarchy_dates import cohort_practical_end_date
from curriculum_api.catalogue.domain.hierarchy_dates import parse_epa_months
from curriculum_api.catalogue.domain.hierarchy_dates import payload_apprenticeship_end_override
from curriculum_api.catalogue.domain.hierarchy_dates import payload_epa_months
from curriculum_api.catalogue.domain.hierarchy_values import parse_notes_id_list
from curriculum_api.catalogue.domain.read_contracts import RESTORE_NULLABLE_COLUMNS
from curriculum_api.catalogue.domain.row_values import curriculum_name_only_patch
from curriculum_api.catalogue.domain.row_values import require_fields
from curriculum_api.catalogue.domain.tutor_conflicts import tutor_conflict_override_requested
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.domain.values import format_date
from curriculum_api.catalogue.domain.values import normalise
from curriculum_api.catalogue.domain.values import parse_int
from curriculum_api.catalogue.domain.values import parse_json_value
from curriculum_api.catalogue.infrastructure.authoring_runtime import authoring_fetch_all
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import COHORT_AUTHORING_DETAILS_TABLE
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import GROUPS_TABLE
from curriculum_api.catalogue.infrastructure.authoring_storage import update_authoring_rows
from curriculum_api.catalogue.infrastructure.authoring_storage import update_rows
from curriculum_api.catalogue.infrastructure.cache_composition import log_curriculum_decision
from curriculum_api.catalogue.infrastructure.catalogue_sources import canonical_staff_assignment_name
from curriculum_api.catalogue.infrastructure.catalogue_sources import get_holiday_rows
from curriculum_api.catalogue.infrastructure.cohort_calendar_composition import cohort_authoring_detail_rows
from curriculum_api.catalogue.infrastructure.cohort_calendar_composition import unique_cohort_id
from curriculum_api.catalogue.infrastructure.cohort_persistence_composition import persist_cohort_authoring_detail
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_MODULES_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import has_column
from curriculum_api.catalogue.infrastructure.hierarchy_composition import archived_cohort_learners
from curriculum_api.catalogue.infrastructure.hierarchy_composition import archived_group_learners
from curriculum_api.catalogue.infrastructure.hierarchy_composition import canonical_group_coaches
from curriculum_api.catalogue.infrastructure.hierarchy_composition import canonical_programme_id
from curriculum_api.catalogue.infrastructure.hierarchy_persistence import persist_group_authoring_detail
from curriculum_api.catalogue.infrastructure.hierarchy_persistence import repair_curriculum_parent_links
from curriculum_api.catalogue.infrastructure.hierarchy_persistence import resync_group_module_delivery_counts
from curriculum_api.catalogue.infrastructure.hierarchy_persistence import unassign_authoring_modules_from_group
from curriculum_api.catalogue.infrastructure.hierarchy_persistence import update_cohort_fields
from curriculum_api.catalogue.infrastructure.hierarchy_persistence import update_group_fields
from curriculum_api.catalogue.infrastructure.lifecycle_persistence import archived_parent_programme
from curriculum_api.catalogue.infrastructure.lifecycle_persistence import authoring_soft_delete
from curriculum_api.catalogue.infrastructure.lifecycle_persistence import restore_rows_via_parent
from curriculum_api.catalogue.infrastructure.lifecycle_runtime import archived_authoring_ids
from curriculum_api.catalogue.infrastructure.lifecycle_runtime import curriculum_row_is_archived
from curriculum_api.catalogue.infrastructure.lifecycle_runtime import request_wants_permanent_delete
from curriculum_api.catalogue.infrastructure.lifecycle_runtime import restore_soft_delete_payload
from curriculum_api.catalogue.infrastructure.placement_runtime import cohort_conflict_record
from curriculum_api.catalogue.infrastructure.placement_runtime import cohort_record_revision
from curriculum_api.catalogue.infrastructure.placement_runtime import curriculum_cohort_from_authoring_detail
from curriculum_api.catalogue.infrastructure.placement_runtime import curriculum_group_from_authoring_detail
from curriculum_api.catalogue.infrastructure.placement_runtime import fetch_cohort_row
from curriculum_api.catalogue.infrastructure.placement_runtime import fetch_group_row
from curriculum_api.catalogue.infrastructure.placement_runtime import group_authoring_detail_rows
from curriculum_api.catalogue.infrastructure.placement_runtime import group_conflict_record
from curriculum_api.catalogue.infrastructure.placement_runtime import group_record_revision
from curriculum_api.catalogue.infrastructure.placement_runtime import resolve_cohort_row
from curriculum_api.catalogue.infrastructure.placement_runtime import resolve_group_row
from curriculum_api.catalogue.infrastructure.placement_runtime import title_case_status
from curriculum_api.catalogue.infrastructure.placement_runtime import unique_group_id
from curriculum_api.catalogue.infrastructure.placement_runtime import with_group_coaches
from curriculum_api.catalogue.infrastructure.revision_runtime import lock_record_row
from curriculum_api.catalogue.infrastructure.row_queries import json_db_value
from curriculum_api.catalogue.infrastructure.row_queries import safe_authoring_module_rows
from curriculum_api.catalogue.infrastructure.runtime_config import logger
from curriculum_api.catalogue.infrastructure.session_plan_persistence import persist_group_module_session_dates
from curriculum_api.catalogue.infrastructure.tutor_availability_composition import group_tutor_assignment_conflict
from curriculum_api.catalogue.infrastructure.write_composition import delete_rows
from curriculum_api.meetings.infrastructure.tracking_queries import stale_teams_calendar_modules
from datetime import datetime
from django.db import DatabaseError
from django.db import IntegrityError
from django.db import transaction
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt


def create_curriculum_cohort(payload):
    from curriculum_api.catalogue.api.cohort_commands import create_curriculum_cohort as implementation
    def policy_write(*args, **kwargs):
        from curriculum_api.catalogue.infrastructure.delivery_calendar_runtime import policy_write as operation
        return operation(*args, **kwargs)
    return implementation(
        payload,
        COHORT_AUTHORING_DETAILS_TABLE=COHORT_AUTHORING_DETAILS_TABLE,
        JsonResponse=JsonResponse,
        apprenticeship_end_override_sent=apprenticeship_end_override_sent,
        archived_authoring_ids=archived_authoring_ids,
        canonical_programme_id=canonical_programme_id,
        clean_str=clean_str,
        cohort_apprenticeship_end_date=cohort_apprenticeship_end_date,
        cohort_authoring_detail_rows=cohort_authoring_detail_rows,
        cohort_practical_end_date=cohort_practical_end_date,
        curriculum_cohort_from_authoring_detail=curriculum_cohort_from_authoring_detail,
        fetch_cohort_row=fetch_cohort_row,
        format_date=format_date,
        get_holiday_rows=get_holiday_rows,
        invalidate_curriculum_cache=invalidate_curriculum_cache,
        json_db_value=json_db_value,
        json_error=json_error,
        log_curriculum_decision=log_curriculum_decision,
        normalise=normalise,
        parse_epa_months=parse_epa_months,
        parse_int=parse_int,
        parse_notes_id_list=parse_notes_id_list,
        payload_apprenticeship_end_override=payload_apprenticeship_end_override,
        payload_epa_months=payload_epa_months,
        persist_cohort_authoring_detail=persist_cohort_authoring_detail,
        policy_write=policy_write,
        require_fields=require_fields,
        restore_soft_delete_payload=restore_soft_delete_payload,
        title_case_status=title_case_status,
        unique_cohort_id=unique_cohort_id,
        update_authoring_rows=update_authoring_rows,
        update_cohort_fields=update_cohort_fields,
    )


@csrf_exempt
def curriculum_cohort_collection(request):
    from curriculum_api.catalogue.api.cohort_commands import curriculum_cohort_collection as implementation
    return implementation(
        request,
        create_curriculum_cohort=create_curriculum_cohort,
        json_body=json_body,
        json_error=json_error,
    )


@csrf_exempt
def curriculum_cohort_detail(request, identifier):
    from curriculum_api.catalogue.api.cohort_commands import curriculum_cohort_detail as implementation
    def cohort_rename_bindings():
        from curriculum_api.cohort_rename import CohortRenameConflict, propagate_cohort_name
        return CohortRenameConflict, propagate_cohort_name
    def policy_write(*args, **kwargs):
        from curriculum_api.catalogue.infrastructure.delivery_calendar_runtime import policy_write as operation
        return operation(*args, **kwargs)
    return implementation(
        request, identifier,
        AUTHORING_MODULES_TABLE=AUTHORING_MODULES_TABLE,
        COHORT_AUTHORING_DETAILS_TABLE=COHORT_AUTHORING_DETAILS_TABLE,
        GROUPS_TABLE=GROUPS_TABLE,
        JsonResponse=JsonResponse,
        apprenticeship_end_override_sent=apprenticeship_end_override_sent,
        authoring_fetch_all=authoring_fetch_all,
        authoring_soft_delete=authoring_soft_delete,
        canonical_programme_id=canonical_programme_id,
        clean_str=clean_str,
        cohort_apprenticeship_end_date=cohort_apprenticeship_end_date,
        cohort_conflict_record=cohort_conflict_record,
        cohort_practical_end_date=cohort_practical_end_date,
        cohort_record_revision=cohort_record_revision,
        cohort_rename_bindings=cohort_rename_bindings,
        curriculum_name_only_patch=curriculum_name_only_patch,
        fetch_cohort_row=fetch_cohort_row,
        format_date=format_date,
        invalidate_curriculum_cache=invalidate_curriculum_cache,
        json_body=json_body,
        json_db_value=json_db_value,
        json_error=json_error,
        lock_record_row=lock_record_row,
        log_curriculum_decision=log_curriculum_decision,
        parse_int=parse_int,
        parse_json_value=parse_json_value,
        parse_notes_id_list=parse_notes_id_list,
        payload_apprenticeship_end_override=payload_apprenticeship_end_override,
        payload_epa_months=payload_epa_months,
        permanent_cohort_delete_response=permanent_cohort_delete_response,
        policy_write=policy_write,
        record_conflict_response=record_conflict_response,
        request_wants_permanent_delete=request_wants_permanent_delete,
        requested_expected_revision=requested_expected_revision,
        resolve_cohort_row=resolve_cohort_row,
        title_case_status=title_case_status,
        transaction=transaction,
        unassign_authoring_modules_from_group=unassign_authoring_modules_from_group,
        update_authoring_rows=update_authoring_rows,
        update_cohort_fields=update_cohort_fields,
    )


def create_curriculum_group(payload):
    from curriculum_api.catalogue.api.group_commands import create_curriculum_group as implementation
    return implementation(
        payload,
        GROUPS_TABLE=GROUPS_TABLE,
        JsonResponse=JsonResponse,
        archived_authoring_ids=archived_authoring_ids,
        build_group_schedule=build_group_schedule,
        canonical_group_coaches=canonical_group_coaches,
        clean_str=clean_str,
        curriculum_group_from_authoring_detail=curriculum_group_from_authoring_detail,
        fetch_group_row=fetch_group_row,
        group_authoring_detail_rows=group_authoring_detail_rows,
        invalidate_curriculum_cache=invalidate_curriculum_cache,
        json_error=json_error,
        log_curriculum_decision=log_curriculum_decision,
        normalise=normalise,
        notify_staff_assignment_change=notify_staff_assignment_change,
        parse_notes_id_list=parse_notes_id_list,
        persist_group_authoring_detail=persist_group_authoring_detail,
        require_fields=require_fields,
        resolve_cohort_row=resolve_cohort_row,
        restore_soft_delete_payload=restore_soft_delete_payload,
        safe_authoring_module_rows=safe_authoring_module_rows,
        unique_group_id=unique_group_id,
        update_authoring_rows=update_authoring_rows,
        update_group_fields=update_group_fields,
    )


@csrf_exempt
def curriculum_group_collection(request):
    from curriculum_api.catalogue.api.group_commands import curriculum_group_collection as implementation
    return implementation(
        request,
        create_curriculum_group=create_curriculum_group,
        curriculum_groups=curriculum_groups,
        json_body=json_body,
        json_error=json_error,
        with_group_coaches=with_group_coaches,
    )


@csrf_exempt
def curriculum_cohort_group_collection(request, cohort_id):
    from curriculum_api.catalogue.api.group_commands import curriculum_cohort_group_collection as implementation
    return implementation(
        request, cohort_id,
        create_curriculum_group=create_curriculum_group,
        json_body=json_body,
        json_error=json_error,
        with_group_coaches=with_group_coaches,
    )


@csrf_exempt
def curriculum_group_detail(request, identifier):
    from curriculum_api.catalogue.api.group_commands import curriculum_group_detail as implementation
    def propagate_group_name_to_learners(*args, **kwargs):
        from curriculum_api.placement_rename import propagate_group_name_to_learners as operation
        return operation(*args, **kwargs)
    return implementation(
        request, identifier,
        AUTHORING_MODULES_TABLE=AUTHORING_MODULES_TABLE,
        GROUPS_TABLE=GROUPS_TABLE,
        JsonResponse=JsonResponse,
        authoring_fetch_all=authoring_fetch_all,
        authoring_soft_delete=authoring_soft_delete,
        canonical_group_coaches=canonical_group_coaches,
        canonical_programme_id=canonical_programme_id,
        canonical_staff_assignment_name=canonical_staff_assignment_name,
        clean_str=clean_str,
        curriculum_name_only_patch=curriculum_name_only_patch,
        datetime=datetime,
        group_conflict_record=group_conflict_record,
        group_record_revision=group_record_revision,
        group_tutor_assignment_conflict=group_tutor_assignment_conflict,
        group_tutor_assignment_delivery_day_error=group_tutor_assignment_delivery_day_error,
        invalidate_curriculum_cache=invalidate_curriculum_cache,
        json_body=json_body,
        json_db_value=json_db_value,
        json_error=json_error,
        lock_record_row=lock_record_row,
        log_curriculum_decision=log_curriculum_decision,
        notify_staff_assignment_change=notify_staff_assignment_change,
        permanent_group_delete_response=permanent_group_delete_response,
        persist_group_module_session_dates=persist_group_module_session_dates,
        propagate_group_name_to_learners=propagate_group_name_to_learners,
        record_conflict_response=record_conflict_response,
        repair_curriculum_parent_links=repair_curriculum_parent_links,
        request_wants_permanent_delete=request_wants_permanent_delete,
        requested_expected_revision=requested_expected_revision,
        resolve_cohort_row=resolve_cohort_row,
        resolve_group_row=resolve_group_row,
        resync_group_module_delivery_counts=resync_group_module_delivery_counts,
        safe_authoring_module_rows=safe_authoring_module_rows,
        stale_teams_calendar_modules=stale_teams_calendar_modules,
        transaction=transaction,
        tutor_conflict_error=tutor_conflict_error,
        tutor_conflict_override_requested=tutor_conflict_override_requested,
        unassign_authoring_modules_from_group=unassign_authoring_modules_from_group,
        update_authoring_rows=update_authoring_rows,
        update_group_fields=update_group_fields,
        with_group_coaches=with_group_coaches,
    )


ARCHIVE_MODULE_REATTACH_NOTE = (
    'Modules were detached when it was archived, so they have to be attached again by hand.'
)


@csrf_exempt
def curriculum_cohort_restore(request, identifier):
    from curriculum_api.catalogue.api.cohort_commands import curriculum_cohort_restore as implementation
    return implementation(
        request, identifier,
        ARCHIVE_MODULE_REATTACH_NOTE=ARCHIVE_MODULE_REATTACH_NOTE,
        COHORT_AUTHORING_DETAILS_TABLE=COHORT_AUTHORING_DETAILS_TABLE,
        GROUPS_TABLE=GROUPS_TABLE,
        JsonResponse=JsonResponse,
        RESTORE_NULLABLE_COLUMNS=RESTORE_NULLABLE_COLUMNS,
        archived_parent_programme=archived_parent_programme,
        clean_str=clean_str,
        curriculum_row_is_archived=curriculum_row_is_archived,
        fetch_cohort_row=fetch_cohort_row,
        has_column=has_column,
        invalidate_curriculum_cache=invalidate_curriculum_cache,
        json_error=json_error,
        log_curriculum_decision=log_curriculum_decision,
        resolve_cohort_row=resolve_cohort_row,
        restore_rows_via_parent=restore_rows_via_parent,
        restore_soft_delete_payload=restore_soft_delete_payload,
        title_case_status=title_case_status,
        transaction=transaction,
        update_rows=update_rows,
    )


@csrf_exempt
def curriculum_group_restore(request, identifier):
    from curriculum_api.catalogue.api.group_commands import curriculum_group_restore as implementation
    return implementation(
        request, identifier,
        ARCHIVE_MODULE_REATTACH_NOTE=ARCHIVE_MODULE_REATTACH_NOTE,
        GROUPS_TABLE=GROUPS_TABLE,
        JsonResponse=JsonResponse,
        RESTORE_NULLABLE_COLUMNS=RESTORE_NULLABLE_COLUMNS,
        clean_str=clean_str,
        curriculum_row_is_archived=curriculum_row_is_archived,
        fetch_cohort_row=fetch_cohort_row,
        fetch_group_row=fetch_group_row,
        invalidate_curriculum_cache=invalidate_curriculum_cache,
        json_error=json_error,
        log_curriculum_decision=log_curriculum_decision,
        resolve_group_row=resolve_group_row,
        restore_soft_delete_payload=restore_soft_delete_payload,
        transaction=transaction,
        update_rows=update_rows,
    )


def permanent_cohort_delete_response(cohort_row):
    from curriculum_api.catalogue.api.cohort_commands import permanent_cohort_delete_response as implementation
    return implementation(
        cohort_row,
        AUTHORING_MODULES_TABLE=AUTHORING_MODULES_TABLE,
        COHORT_AUTHORING_DETAILS_TABLE=COHORT_AUTHORING_DETAILS_TABLE,
        DatabaseError=DatabaseError,
        GROUPS_TABLE=GROUPS_TABLE,
        IntegrityError=IntegrityError,
        JsonResponse=JsonResponse,
        archived_cohort_learners=archived_cohort_learners,
        authoring_fetch_all=authoring_fetch_all,
        calendar_holidays=calendar_holidays,
        clean_str=clean_str,
        curriculum_row_is_archived=curriculum_row_is_archived,
        delete_rows=delete_rows,
        invalidate_curriculum_cache=invalidate_curriculum_cache,
        json_error=json_error,
        log_curriculum_decision=log_curriculum_decision,
        logger=logger,
        permanent_delete_reference_refusal=permanent_delete_reference_refusal,
        transaction=transaction,
        unassign_authoring_modules_from_group=unassign_authoring_modules_from_group,
        update_authoring_rows=update_authoring_rows,
    )


def permanent_group_delete_response(group_row):
    from curriculum_api.catalogue.api.group_commands import permanent_group_delete_response as implementation
    return implementation(
        group_row,
        DatabaseError=DatabaseError,
        GROUPS_TABLE=GROUPS_TABLE,
        IntegrityError=IntegrityError,
        JsonResponse=JsonResponse,
        archived_group_learners=archived_group_learners,
        clean_str=clean_str,
        curriculum_row_is_archived=curriculum_row_is_archived,
        delete_rows=delete_rows,
        invalidate_curriculum_cache=invalidate_curriculum_cache,
        json_error=json_error,
        log_curriculum_decision=log_curriculum_decision,
        logger=logger,
        permanent_delete_reference_refusal=permanent_delete_reference_refusal,
        transaction=transaction,
        unassign_authoring_modules_from_group=unassign_authoring_modules_from_group,
    )
