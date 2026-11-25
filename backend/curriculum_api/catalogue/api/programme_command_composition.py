"""Concrete catalogue programme command composition bindings.

Owns HTTP/decorator and runtime capability composition. Application operations,
domain policies, SQL and transaction behavior remain in their existing owners.
Public signatures and response contracts are unchanged."""
from curriculum_api import versioning
from curriculum_api.catalogue.api.adapters import curriculum_collection_response
from curriculum_api.catalogue.api.adapters import requested_expected_revision
from curriculum_api.catalogue.api.adapters import tutor_assignment_delivery_day_error
from curriculum_api.catalogue.api.authoring_composition import save_module_authoring_structure
from curriculum_api.catalogue.api.authoring_errors import StaleModuleStructureWrite
from curriculum_api.catalogue.api.authoring_errors import TutorAssignmentDeliveryDayError
from curriculum_api.catalogue.api.authoring_errors import TutorScheduleConflictError
from curriculum_api.catalogue.api.cache_lifecycle import invalidate_curriculum_cache
from curriculum_api.catalogue.api.catalogue_endpoints import curriculum_programmes
from curriculum_api.catalogue.api.catalogue_endpoints import first_programme_response
from curriculum_api.catalogue.api.catalogue_endpoints import get_cached_payload
from curriculum_api.catalogue.api.catalogue_endpoints import programme_response
from curriculum_api.catalogue.api.catalogue_endpoints import rows_for_programme
from curriculum_api.catalogue.api.module_assembly_composition import attachment_week_structure
from curriculum_api.catalogue.api.module_assembly_composition import contentful_catalogue_id_for_attachment
from curriculum_api.catalogue.api.module_assembly_composition import module_attachment_authoring_payload
from curriculum_api.catalogue.api.overview_composition import build_curriculum_payload
from curriculum_api.catalogue.api.placement_command_composition import create_curriculum_cohort
from curriculum_api.catalogue.api.programme_lifecycle_composition import permanent_programme_delete_response
from curriculum_api.catalogue.api.programme_lifecycle_composition import restore_programme_authoring_structure
from curriculum_api.catalogue.api.programme_lifecycle_composition import soft_delete_programme_authoring_structure
from curriculum_api.catalogue.api.responses import json_body
from curriculum_api.catalogue.api.responses import json_error
from curriculum_api.catalogue.api.responses import record_conflict_response
from curriculum_api.catalogue.api.staffing_composition import notify_staff_assignment_change
from curriculum_api.catalogue.api.structure_guard_composition import locked_attachment_structure
from curriculum_api.catalogue.domain.attachment_content import module_cohort_date_error
from curriculum_api.catalogue.domain.authoring_errors import ModuleAuthoringValidationError
from curriculum_api.catalogue.domain.delivery_pattern import schedule_day_part
from curriculum_api.catalogue.domain.delivery_pattern import schedule_time_parts
from curriculum_api.catalogue.domain.delivery_values import attachment_session_count
from curriculum_api.catalogue.domain.hierarchy_dates import module_calendar_end_date
from curriculum_api.catalogue.domain.hierarchy_values import clean_tree_remove_ids
from curriculum_api.catalogue.domain.hierarchy_values import find_programme
from curriculum_api.catalogue.domain.hierarchy_values import matches_curriculum_identifier
from curriculum_api.catalogue.domain.hierarchy_values import parse_required_otjh
from curriculum_api.catalogue.domain.hierarchy_values import payload_required_otjh
from curriculum_api.catalogue.domain.hierarchy_values import programme_config_id
from curriculum_api.catalogue.domain.hierarchy_values import programme_status_is_archived
from curriculum_api.catalogue.domain.hierarchy_values import programme_structure_type
from curriculum_api.catalogue.domain.programme_identity import programme_config_identity
from curriculum_api.catalogue.domain.programme_values import is_archived_program_config
from curriculum_api.catalogue.domain.programme_values import preferred_program_config_by_name
from curriculum_api.catalogue.domain.programme_values import programme_status_from_payload
from curriculum_api.catalogue.domain.row_values import curriculum_name_only_patch
from curriculum_api.catalogue.domain.row_values import require_fields
from curriculum_api.catalogue.domain.tutor_conflicts import module_schedule_assignment_changed
from curriculum_api.catalogue.domain.values import bool_payload
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.domain.values import parse_int
from curriculum_api.catalogue.domain.values import unique
from curriculum_api.catalogue.infrastructure.authoring_runtime import authoring_fetch_all
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import COHORT_AUTHORING_DETAILS_TABLE
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import GROUPS_TABLE
from curriculum_api.catalogue.infrastructure.authoring_storage import insert_row
from curriculum_api.catalogue.infrastructure.authoring_storage import update_authoring_rows
from curriculum_api.catalogue.infrastructure.authoring_storage import update_rows
from curriculum_api.catalogue.infrastructure.cache_composition import log_curriculum_decision
from curriculum_api.catalogue.infrastructure.calendar_runtime import module_schedule_view
from curriculum_api.catalogue.infrastructure.catalogue_sources import get_program_config_rows
from curriculum_api.catalogue.infrastructure.cohort_calendar_composition import serialize_cohort_authoring_detail
from curriculum_api.catalogue.infrastructure.cohort_persistence_composition import save_tree_cohort
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_MODULES_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import has_column
from curriculum_api.catalogue.infrastructure.database_reads import quote_ident
from curriculum_api.catalogue.infrastructure.hierarchy_composition import canonical_group_coaches
from curriculum_api.catalogue.infrastructure.hierarchy_composition import programme_config_by_identifier
from curriculum_api.catalogue.infrastructure.hierarchy_composition import programme_conflict_record
from curriculum_api.catalogue.infrastructure.hierarchy_composition import programme_record_revision
from curriculum_api.catalogue.infrastructure.hierarchy_persistence import persist_group_authoring_detail
from curriculum_api.catalogue.infrastructure.hierarchy_persistence import repair_curriculum_parent_links
from curriculum_api.catalogue.infrastructure.hierarchy_persistence import set_programme_modules_ksb_source
from curriculum_api.catalogue.infrastructure.hierarchy_persistence import unassign_authoring_modules_from_group
from curriculum_api.catalogue.infrastructure.lifecycle_persistence import authoring_soft_delete
from curriculum_api.catalogue.infrastructure.lifecycle_persistence import ensure_program_config_archive_columns
from curriculum_api.catalogue.infrastructure.lifecycle_runtime import curriculum_row_effectively_deleted
from curriculum_api.catalogue.infrastructure.lifecycle_runtime import request_wants_forced_programme_delete
from curriculum_api.catalogue.infrastructure.lifecycle_runtime import request_wants_permanent_programme_delete
from curriculum_api.catalogue.infrastructure.placement_runtime import curriculum_group_from_authoring_detail
from curriculum_api.catalogue.infrastructure.placement_runtime import fetch_cohort_row
from curriculum_api.catalogue.infrastructure.placement_runtime import fetch_group_row
from curriculum_api.catalogue.infrastructure.placement_runtime import serialize_group_authoring_detail
from curriculum_api.catalogue.infrastructure.placement_runtime import unique_group_id
from curriculum_api.catalogue.infrastructure.placement_runtime import with_group_coaches
from curriculum_api.catalogue.infrastructure.record_identity import unique_module_catalogue_id
from curriculum_api.catalogue.infrastructure.record_identity import unique_program_id
from curriculum_api.catalogue.infrastructure.revision_runtime import lock_record_row
from curriculum_api.catalogue.infrastructure.row_queries import programme_config_key_column
from curriculum_api.catalogue.infrastructure.row_queries import safe_authoring_module_rows
from curriculum_api.catalogue.infrastructure.runtime_config import logger
from curriculum_api.catalogue.infrastructure.structure_runtime import is_canonical_module_catalogue_id
from curriculum_api.catalogue.infrastructure.tutor_availability_composition import tutor_schedule_conflicts_created
from curriculum_api.reporting.domain.source_values import normalise_ksb_profile_source_value
from datetime import datetime
from django.db import transaction
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt


@csrf_exempt
def curriculum_programme_reorder(request):
    from curriculum_api.catalogue.api.programme_commands import curriculum_programme_reorder as implementation
    return implementation(
        request,
        JsonResponse=JsonResponse,
        clean_str=clean_str,
        datetime=datetime,
        ensure_program_config_archive_columns=ensure_program_config_archive_columns,
        get_program_config_rows=get_program_config_rows,
        has_column=has_column,
        invalidate_curriculum_cache=invalidate_curriculum_cache,
        json_body=json_body,
        json_error=json_error,
        log_curriculum_decision=log_curriculum_decision,
        programme_config_identity=programme_config_identity,
        programme_config_key_column=programme_config_key_column,
        quote_ident=quote_ident,
        transaction=transaction,
        unique=unique,
        update_rows=update_rows,
    )


@csrf_exempt
def curriculum_programme_restore(request, identifier):
    from curriculum_api.catalogue.api.programme_commands import curriculum_programme_restore as implementation
    return implementation(
        request, identifier,
        JsonResponse=JsonResponse,
        ensure_program_config_archive_columns=ensure_program_config_archive_columns,
        is_archived_program_config=is_archived_program_config,
        json_error=json_error,
        log_curriculum_decision=log_curriculum_decision,
        programme_config_by_identifier=programme_config_by_identifier,
        programme_config_identity=programme_config_identity,
        programme_response=programme_response,
        programme_status_is_archived=programme_status_is_archived,
        restore_programme_authoring_structure=restore_programme_authoring_structure,
        transaction=transaction,
    )


@csrf_exempt
def curriculum_programme_detail(request, identifier):
    from curriculum_api.catalogue.api.programme_commands import curriculum_programme_detail as implementation
    def propagate_programme_name_to_learners(*args, **kwargs):
        from curriculum_api.placement_rename import propagate_programme_name_to_learners as operation
        return operation(*args, **kwargs)
    return implementation(
        request, identifier,
        JsonResponse=JsonResponse,
        clean_str=clean_str,
        curriculum_name_only_patch=curriculum_name_only_patch,
        datetime=datetime,
        ensure_program_config_archive_columns=ensure_program_config_archive_columns,
        first_programme_response=first_programme_response,
        get_program_config_rows=get_program_config_rows,
        insert_row=insert_row,
        invalidate_curriculum_cache=invalidate_curriculum_cache,
        json_body=json_body,
        json_error=json_error,
        lock_record_row=lock_record_row,
        log_curriculum_decision=log_curriculum_decision,
        normalise_ksb_profile_source_value=normalise_ksb_profile_source_value,
        payload_required_otjh=payload_required_otjh,
        permanent_programme_delete_response=permanent_programme_delete_response,
        programme_config_by_identifier=programme_config_by_identifier,
        programme_config_id=programme_config_id,
        programme_config_identity=programme_config_identity,
        programme_config_key_column=programme_config_key_column,
        programme_conflict_record=programme_conflict_record,
        programme_record_revision=programme_record_revision,
        programme_response=programme_response,
        programme_status_from_payload=programme_status_from_payload,
        propagate_programme_name_to_learners=propagate_programme_name_to_learners,
        quote_ident=quote_ident,
        record_conflict_response=record_conflict_response,
        request_wants_forced_programme_delete=request_wants_forced_programme_delete,
        request_wants_permanent_programme_delete=request_wants_permanent_programme_delete,
        requested_expected_revision=requested_expected_revision,
        rows_for_programme=rows_for_programme,
        set_programme_modules_ksb_source=set_programme_modules_ksb_source,
        soft_delete_programme_authoring_structure=soft_delete_programme_authoring_structure,
        transaction=transaction,
        unique=unique,
        unique_program_id=unique_program_id,
        update_rows=update_rows,
    )


@csrf_exempt
def curriculum_programme_collection(request):
    from curriculum_api.catalogue.api.programme_commands import curriculum_programme_collection as implementation
    return implementation(
        request,
        JsonResponse=JsonResponse,
        clean_str=clean_str,
        curriculum_programmes=curriculum_programmes,
        datetime=datetime,
        ensure_program_config_archive_columns=ensure_program_config_archive_columns,
        first_programme_response=first_programme_response,
        get_program_config_rows=get_program_config_rows,
        insert_row=insert_row,
        invalidate_curriculum_cache=invalidate_curriculum_cache,
        is_archived_program_config=is_archived_program_config,
        json_body=json_body,
        json_error=json_error,
        normalise_ksb_profile_source_value=normalise_ksb_profile_source_value,
        payload_required_otjh=payload_required_otjh,
        preferred_program_config_by_name=preferred_program_config_by_name,
        programme_config_id=programme_config_id,
        programme_config_identity=programme_config_identity,
        programme_config_key_column=programme_config_key_column,
        programme_response=programme_response,
        programme_status_from_payload=programme_status_from_payload,
        programme_structure_type=programme_structure_type,
        quote_ident=quote_ident,
        require_fields=require_fields,
        unique_program_id=unique_program_id,
        update_rows=update_rows,
    )


def upsert_programme_for_tree(payload):
    from curriculum_api.catalogue.application.hierarchy_commands import upsert_programme_for_tree as implementation
    def propagate_programme_name_to_learners(*args, **kwargs):
        from curriculum_api.placement_rename import propagate_programme_name_to_learners as operation
        return operation(*args, **kwargs)
    return implementation(
        payload,
        clean_str=clean_str,
        datetime=datetime,
        ensure_program_config_archive_columns=ensure_program_config_archive_columns,
        get_program_config_rows=get_program_config_rows,
        insert_row=insert_row,
        normalise_ksb_profile_source_value=normalise_ksb_profile_source_value,
        parse_required_otjh=parse_required_otjh,
        payload_required_otjh=payload_required_otjh,
        preferred_program_config_by_name=preferred_program_config_by_name,
        programme_config_by_identifier=programme_config_by_identifier,
        programme_config_id=programme_config_id,
        programme_config_key_column=programme_config_key_column,
        programme_status_from_payload=programme_status_from_payload,
        propagate_programme_name_to_learners=propagate_programme_name_to_learners,
        quote_ident=quote_ident,
        require_fields=require_fields,
        unique_program_id=unique_program_id,
        update_rows=update_rows,
    )


def save_tree_group(group, cohort_row):
    from curriculum_api.catalogue.application.hierarchy_commands import save_tree_group as implementation
    return implementation(
        group, cohort_row,
        canonical_group_coaches=canonical_group_coaches,
        clean_str=clean_str,
        curriculum_group_from_authoring_detail=curriculum_group_from_authoring_detail,
        curriculum_row_effectively_deleted=curriculum_row_effectively_deleted,
        fetch_group_row=fetch_group_row,
        logger=logger,
        notify_staff_assignment_change=notify_staff_assignment_change,
        persist_group_authoring_detail=persist_group_authoring_detail,
        safe_authoring_module_rows=safe_authoring_module_rows,
        schedule_day_part=schedule_day_part,
        schedule_time_parts=schedule_time_parts,
        serialize_cohort_authoring_detail=serialize_cohort_authoring_detail,
        serialize_group_authoring_detail=serialize_group_authoring_detail,
        unique_group_id=unique_group_id,
        with_group_coaches=with_group_coaches,
    )


def save_tree_group_modules(group, cohort, modules, preserve_missing=False):
    from curriculum_api.catalogue.application.hierarchy_commands import save_tree_group_modules as implementation
    return implementation(
        group, cohort, modules, preserve_missing,
        TutorAssignmentDeliveryDayError=TutorAssignmentDeliveryDayError,
        TutorScheduleConflictError=TutorScheduleConflictError,
        attachment_session_count=attachment_session_count,
        attachment_week_structure=attachment_week_structure,
        clean_str=clean_str,
        contentful_catalogue_id_for_attachment=contentful_catalogue_id_for_attachment,
        is_canonical_module_catalogue_id=is_canonical_module_catalogue_id,
        locked_attachment_structure=locked_attachment_structure,
        module_attachment_authoring_payload=module_attachment_authoring_payload,
        module_calendar_end_date=module_calendar_end_date,
        module_cohort_date_error=module_cohort_date_error,
        module_schedule_assignment_changed=module_schedule_assignment_changed,
        module_schedule_view=module_schedule_view,
        notify_staff_assignment_change=notify_staff_assignment_change,
        parse_int=parse_int,
        safe_authoring_module_rows=safe_authoring_module_rows,
        save_module_authoring_structure=save_module_authoring_structure,
        schedule_day_part=schedule_day_part,
        tutor_assignment_delivery_day_error=tutor_assignment_delivery_day_error,
        tutor_schedule_conflicts_created=tutor_schedule_conflicts_created,
        unassign_authoring_modules_from_group=unassign_authoring_modules_from_group,
        unique_module_catalogue_id=unique_module_catalogue_id,
    )


@csrf_exempt
def curriculum_programme_tree_save(request):
    from curriculum_api.catalogue.api.programme_commands import curriculum_programme_tree_save as implementation
    return implementation(
        request,
        AUTHORING_MODULES_TABLE=AUTHORING_MODULES_TABLE,
        COHORT_AUTHORING_DETAILS_TABLE=COHORT_AUTHORING_DETAILS_TABLE,
        GROUPS_TABLE=GROUPS_TABLE,
        JsonResponse=JsonResponse,
        ModuleAuthoringValidationError=ModuleAuthoringValidationError,
        StaleModuleStructureWrite=StaleModuleStructureWrite,
        TutorAssignmentDeliveryDayError=TutorAssignmentDeliveryDayError,
        TutorScheduleConflictError=TutorScheduleConflictError,
        authoring_fetch_all=authoring_fetch_all,
        authoring_soft_delete=authoring_soft_delete,
        bool_payload=bool_payload,
        clean_str=clean_str,
        clean_tree_remove_ids=clean_tree_remove_ids,
        fetch_cohort_row=fetch_cohort_row,
        fetch_group_row=fetch_group_row,
        invalidate_curriculum_cache=invalidate_curriculum_cache,
        json_body=json_body,
        json_error=json_error,
        logger=logger,
        repair_curriculum_parent_links=repair_curriculum_parent_links,
        save_tree_cohort=save_tree_cohort,
        save_tree_group=save_tree_group,
        save_tree_group_modules=save_tree_group_modules,
        transaction=transaction,
        unassign_authoring_modules_from_group=unassign_authoring_modules_from_group,
        unique=unique,
        update_authoring_rows=update_authoring_rows,
        upsert_programme_for_tree=upsert_programme_for_tree,
        versioning=versioning,
    )


@csrf_exempt
def curriculum_programme_cohort_collection(request, programme_id):
    from curriculum_api.catalogue.api.programme_commands import curriculum_programme_cohort_collection as implementation
    return implementation(
        request, programme_id,
        build_curriculum_payload=build_curriculum_payload,
        create_curriculum_cohort=create_curriculum_cohort,
        curriculum_collection_response=curriculum_collection_response,
        find_programme=find_programme,
        get_cached_payload=get_cached_payload,
        json_body=json_body,
        json_error=json_error,
        matches_curriculum_identifier=matches_curriculum_identifier,
    )
