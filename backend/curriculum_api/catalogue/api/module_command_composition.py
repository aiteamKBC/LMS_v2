"""Concrete catalogue module command composition bindings.

Owns HTTP/decorator and runtime capability composition. Application operations,
domain policies, SQL and transaction behavior remain in their existing owners.
Public signatures and response contracts are unchanged."""
from curriculum_api import archive_state
from curriculum_api import ksb_mapping_placement
from curriculum_api.catalogue.api.adapters import curriculum_collection_response
from curriculum_api.catalogue.api.adapters import permanent_delete_reference_refusal
from curriculum_api.catalogue.api.adapters import request_bypasses_curriculum_cache
from curriculum_api.catalogue.api.adapters import requested_expected_revision
from curriculum_api.catalogue.api.adapters import tutor_assignment_delivery_day_error
from curriculum_api.catalogue.api.adapters import tutor_conflict_error
from curriculum_api.catalogue.api.authoring_composition import delete_module_authoring_structure
from curriculum_api.catalogue.api.authoring_composition import save_module_authoring_structure
from curriculum_api.catalogue.api.authoring_errors import StaleModuleStructureWrite
from curriculum_api.catalogue.api.authoring_errors import TutorAssignmentDeliveryDayError
from curriculum_api.catalogue.api.authoring_errors import TutorScheduleConflictError
from curriculum_api.catalogue.api.cache_lifecycle import invalidate_curriculum_cache
from curriculum_api.catalogue.api.catalogue_endpoints import curriculum_modules
from curriculum_api.catalogue.api.catalogue_endpoints import get_cached_payload
from curriculum_api.catalogue.api.module_assembly_composition import attachment_week_structure
from curriculum_api.catalogue.api.module_assembly_composition import contentful_catalogue_id_for_attachment
from curriculum_api.catalogue.api.module_assembly_composition import module_attachment_authoring_payload
from curriculum_api.catalogue.api.query_adapters import archived_programme_module_edit_error
from curriculum_api.catalogue.api.responses import json_body
from curriculum_api.catalogue.api.responses import json_error
from curriculum_api.catalogue.api.responses import module_merge_conflict_response
from curriculum_api.catalogue.api.responses import record_conflict_response
from curriculum_api.catalogue.api.revision_adapters import refuse_stale_module_write
from curriculum_api.catalogue.api.staffing_composition import notify_staff_assignment_change
from curriculum_api.catalogue.api.structure_composition import get_authoring_structure_payload
from curriculum_api.catalogue.api.structure_composition import read_module_structure_with_revision
from curriculum_api.catalogue.api.structure_guard_composition import free_course_sale_values
from curriculum_api.catalogue.api.structure_guard_composition import locked_attachment_structure
from curriculum_api.catalogue.api.structure_guard_composition import merge_partial_module_structure
from curriculum_api.catalogue.application.authoring_metadata import default_completion_payload
from curriculum_api.catalogue.application.module_projection import curriculum_module_from_authoring_payload
from curriculum_api.catalogue.domain.attachment_content import first_clean_payload_value
from curriculum_api.catalogue.domain.attachment_content import identity_values_match_context
from curriculum_api.catalogue.domain.attachment_content import module_cohort_date_error
from curriculum_api.catalogue.domain.attachment_content import resize_authoring_week_structure_preserving_content
from curriculum_api.catalogue.domain.authoring_errors import CoverImageError
from curriculum_api.catalogue.domain.authoring_errors import ModuleAuthoringValidationError
from curriculum_api.catalogue.domain.authoring_errors import ModuleStructureDeltaConflict
from curriculum_api.catalogue.domain.delivery_pattern import schedule_day_part
from curriculum_api.catalogue.domain.delivery_values import attachment_session_count
from curriculum_api.catalogue.domain.hierarchy_dates import module_calendar_end_date
from curriculum_api.catalogue.domain.hierarchy_values import matches_curriculum_identifier
from curriculum_api.catalogue.domain.module_selection import module_belongs_to_group
from curriculum_api.catalogue.domain.read_contracts import RESTORE_NULLABLE_COLUMNS
from curriculum_api.catalogue.domain.row_values import curriculum_name_only_patch
from curriculum_api.catalogue.domain.row_values import link_training_row_to_catalogue
from curriculum_api.catalogue.domain.row_values import require_fields
from curriculum_api.catalogue.domain.tutor_conflicts import module_schedule_assignment_changed
from curriculum_api.catalogue.domain.tutor_conflicts import tutor_conflict_override_requested
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.domain.values import normalise
from curriculum_api.catalogue.domain.values import parse_int
from curriculum_api.catalogue.domain.values import truthy
from curriculum_api.catalogue.infrastructure.authoring_runtime import authoring_fetch_all
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import ensure_module_authoring_tables
from curriculum_api.catalogue.infrastructure.authoring_storage import update_authoring_rows
from curriculum_api.catalogue.infrastructure.authoring_storage import update_rows
from curriculum_api.catalogue.infrastructure.cache_access import cached_curriculum_value
from curriculum_api.catalogue.infrastructure.cache_composition import log_curriculum_decision
from curriculum_api.catalogue.infrastructure.cache_runtime import curriculum_read_scope
from curriculum_api.catalogue.infrastructure.calendar_runtime import module_schedule_view
from curriculum_api.catalogue.infrastructure.catalogue_resolution import authoring_module_exists
from curriculum_api.catalogue.infrastructure.catalogue_resolution import find_existing_authoring_catalogue_id_for_payload
from curriculum_api.catalogue.infrastructure.catalogue_resolution import resolve_stored_module_catalogue_id
from curriculum_api.catalogue.infrastructure.cohort_calendar_composition import module_parent_cohort
from curriculum_api.catalogue.infrastructure.cohort_calendar_composition import serialize_cohort_authoring_detail
from curriculum_api.catalogue.infrastructure.course_storage_reads import with_course_storage
from curriculum_api.catalogue.infrastructure.cover_image_storage import stored_module_cover_image
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_ADVANCED_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_COMPLETION_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_COMPONENTS_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_KSB_MAPPINGS_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_MODULES_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_WEEKS_TABLE
from curriculum_api.catalogue.infrastructure.hierarchy_persistence import repair_curriculum_parent_links
from curriculum_api.catalogue.infrastructure.hierarchy_persistence import unassign_authoring_modules_from_group
from curriculum_api.catalogue.infrastructure.lifecycle_persistence import archived_parent_programme
from curriculum_api.catalogue.infrastructure.lifecycle_persistence import authoring_soft_delete
from curriculum_api.catalogue.infrastructure.lifecycle_persistence import restore_rows_via_parent
from curriculum_api.catalogue.infrastructure.lifecycle_runtime import curriculum_row_effectively_deleted
from curriculum_api.catalogue.infrastructure.lifecycle_runtime import module_archive_event_bounds
from curriculum_api.catalogue.infrastructure.lifecycle_runtime import module_withdrawn_on_its_own
from curriculum_api.catalogue.infrastructure.lifecycle_runtime import request_wants_permanent_delete
from curriculum_api.catalogue.infrastructure.lifecycle_runtime import restore_soft_delete_payload
from curriculum_api.catalogue.infrastructure.lifecycle_runtime import soft_deleted_structure_ids
from curriculum_api.catalogue.infrastructure.placement_runtime import curriculum_cohort_from_authoring_detail
from curriculum_api.catalogue.infrastructure.placement_runtime import curriculum_group_from_authoring_detail
from curriculum_api.catalogue.infrastructure.placement_runtime import resolve_cohort_row
from curriculum_api.catalogue.infrastructure.placement_runtime import resolve_group_row
from curriculum_api.catalogue.infrastructure.placement_runtime import serialize_group_authoring_detail
from curriculum_api.catalogue.infrastructure.record_identity import unique_module_catalogue_id
from curriculum_api.catalogue.infrastructure.revision_runtime import lock_module_structure_row
from curriculum_api.catalogue.infrastructure.revision_runtime import module_structure_revision
from curriculum_api.catalogue.infrastructure.revision_runtime import stamp_revision_after_write
from curriculum_api.catalogue.infrastructure.revision_runtime import structure_payload_with_revision
from curriculum_api.catalogue.infrastructure.row_queries import safe_authoring_module_rows
from curriculum_api.catalogue.infrastructure.runtime_config import logger
from curriculum_api.catalogue.infrastructure.structure_runtime import is_canonical_module_catalogue_id
from curriculum_api.catalogue.infrastructure.structure_runtime import module_authoring_quality_check
from curriculum_api.catalogue.infrastructure.structure_runtime import module_structure_source_rows
from curriculum_api.catalogue.infrastructure.structure_runtime import with_item_fingerprints
from curriculum_api.catalogue.infrastructure.tutor_availability_composition import tutor_schedule_conflicts_created
from curriculum_api.catalogue.infrastructure.write_composition import delete_rows
from curriculum_api.catalogue.infrastructure.write_composition import note_live_rows
from curriculum_api.course_pricing import API_FIELDS as COURSE_PRICING_FIELDS
from curriculum_api.course_pricing import pricing_values
from curriculum_api.meetings.api.adapters import module_teams_calendar_block_response
from curriculum_api.meetings.infrastructure.tracking_queries import stale_teams_calendar_modules
from curriculum_api.reporting.domain.source_values import normalise_ksb_profile_source_value
from curriculum_api.weekly_schedule import merged_week_starts_on
from curriculum_api.weekly_schedule import merged_weekly_schedule
from curriculum_api.weekly_schedule import module_week_starts_on
from curriculum_api.weekly_schedule import module_weekly_schedule
from datetime import datetime
from django.db import DatabaseError
from django.db import IntegrityError
from django.db import connection
from django.db import transaction
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from login.permissions import require_role
from curriculum_api.catalogue.domain.values import parse_date


@csrf_exempt
@with_course_storage
def curriculum_module_collection(request):
    from curriculum_api.catalogue.api.module_commands import curriculum_module_collection as implementation
    def creation_unavailable_response(*args, **kwargs):
        from curriculum_api.learning_storage import creation_unavailable_response as operation
        return operation(*args, **kwargs)
    def is_free_course_payload(*args, **kwargs):
        from curriculum_api.learning_storage import is_free_course_payload as operation
        return operation(*args, **kwargs)
    return implementation(
        request,
        COURSE_PRICING_FIELDS=COURSE_PRICING_FIELDS,
        JsonResponse=JsonResponse,
        ModuleAuthoringValidationError=ModuleAuthoringValidationError,
        authoring_module_exists=authoring_module_exists,
        clean_str=clean_str,
        creation_unavailable_response=creation_unavailable_response,
        curriculum_modules=curriculum_modules,
        default_completion_payload=default_completion_payload,
        find_existing_authoring_catalogue_id_for_payload=find_existing_authoring_catalogue_id_for_payload,
        first_clean_payload_value=first_clean_payload_value,
        get_authoring_structure_payload=get_authoring_structure_payload,
        identity_values_match_context=identity_values_match_context,
        is_free_course_payload=is_free_course_payload,
        json_body=json_body,
        json_error=json_error,
        log_curriculum_decision=log_curriculum_decision,
        module_week_starts_on=module_week_starts_on,
        module_weekly_schedule=module_weekly_schedule,
        module_withdrawn_on_its_own=module_withdrawn_on_its_own,
        normalise=normalise,
        normalise_ksb_profile_source_value=normalise_ksb_profile_source_value,
        require_fields=require_fields,
        safe_authoring_module_rows=safe_authoring_module_rows,
        save_module_authoring_structure=save_module_authoring_structure,
        stamp_revision_after_write=stamp_revision_after_write,
        truthy=truthy,
        unique_module_catalogue_id=unique_module_catalogue_id,
        with_item_fingerprints=with_item_fingerprints,
    )


@csrf_exempt
@with_course_storage
def curriculum_module_structure(request, module_catalogue_id):
    from curriculum_api.catalogue.api.module_structure import curriculum_module_structure as implementation
    def collaboration_enabled(*args, **kwargs):
        from curriculum_api.module_collaboration import enabled as operation
        return operation(*args, **kwargs)
    def check_structure_save(*args, **kwargs):
        from curriculum_api.module_collaboration import check_structure_save as operation
        return operation(*args, **kwargs)
    def announce_saved(*args, **kwargs):
        from curriculum_api.module_collaboration import announce_saved as operation
        return operation(*args, **kwargs)
    def creation_unavailable_response(*args, **kwargs):
        from curriculum_api.learning_storage import creation_unavailable_response as operation
        return operation(*args, **kwargs)
    def module_merge_bindings():
        from curriculum_api.module_merge import ModuleMergeConflicts, ModuleMergeUnavailable, candidate_new_ids, merge_partial_save, restore_conflicts
        return ModuleMergeConflicts, ModuleMergeUnavailable, candidate_new_ids, merge_partial_save, restore_conflicts
    return implementation(
        request, module_catalogue_id,
        JsonResponse=JsonResponse,
        ModuleAuthoringValidationError=ModuleAuthoringValidationError,
        ModuleStructureDeltaConflict=ModuleStructureDeltaConflict,
        announce_saved=announce_saved,
        archived_programme_module_edit_error=archived_programme_module_edit_error,
        authoring_module_exists=authoring_module_exists,
        cached_curriculum_value=cached_curriculum_value,
        check_structure_save=check_structure_save,
        clean_str=clean_str,
        collaboration_enabled=collaboration_enabled,
        creation_unavailable_response=creation_unavailable_response,
        curriculum_read_scope=curriculum_read_scope,
        get_authoring_structure_payload=get_authoring_structure_payload,
        is_canonical_module_catalogue_id=is_canonical_module_catalogue_id,
        json_body=json_body,
        json_error=json_error,
        link_training_row_to_catalogue=link_training_row_to_catalogue,
        lock_module_structure_row=lock_module_structure_row,
        logger=logger,
        merge_partial_module_structure=merge_partial_module_structure,
        module_merge_bindings=module_merge_bindings,
        module_merge_conflict_response=module_merge_conflict_response,
        module_structure_revision=module_structure_revision,
        module_structure_source_rows=module_structure_source_rows,
        module_week_starts_on=module_week_starts_on,
        module_weekly_schedule=module_weekly_schedule,
        read_module_structure_with_revision=read_module_structure_with_revision,
        request_bypasses_curriculum_cache=request_bypasses_curriculum_cache,
        resolve_stored_module_catalogue_id=resolve_stored_module_catalogue_id,
        save_module_authoring_structure=save_module_authoring_structure,
        soft_deleted_structure_ids=soft_deleted_structure_ids,
        stamp_revision_after_write=stamp_revision_after_write,
        structure_payload_with_revision=structure_payload_with_revision,
        transaction=transaction,
        with_item_fingerprints=with_item_fingerprints,
    )


@csrf_exempt
def curriculum_module_settings(request, module_catalogue_id):
    from curriculum_api.catalogue.api.content_commands import curriculum_module_settings as implementation
    return implementation(
        request, module_catalogue_id,
        CoverImageError=CoverImageError,
        JsonResponse=JsonResponse,
        authoring_module_exists=authoring_module_exists,
        clean_str=clean_str,
        get_authoring_structure_payload=get_authoring_structure_payload,
        json_body=json_body,
        json_error=json_error,
        logger=logger,
        module_structure_revision=module_structure_revision,
        refuse_stale_module_write=refuse_stale_module_write,
        resolve_stored_module_catalogue_id=resolve_stored_module_catalogue_id,
        save_module_authoring_structure=save_module_authoring_structure,
        transaction=transaction,
    )


@csrf_exempt
@with_course_storage
def curriculum_module_component_detail(request, module_catalogue_id, component_id):
    from curriculum_api.catalogue.api.lifecycle_commands import curriculum_module_component_detail as implementation
    def check_removal(*args, **kwargs):
        from curriculum_api.module_collaboration import check_removal as operation
        return operation(*args, **kwargs)
    return implementation(
        request, module_catalogue_id, component_id,
        AUTHORING_COMPONENTS_TABLE=AUTHORING_COMPONENTS_TABLE,
        AUTHORING_KSB_MAPPINGS_TABLE=AUTHORING_KSB_MAPPINGS_TABLE,
        JsonResponse=JsonResponse,
        authoring_soft_delete=authoring_soft_delete,
        check_removal=check_removal,
        clean_str=clean_str,
        ensure_module_authoring_tables=ensure_module_authoring_tables,
        invalidate_curriculum_cache=invalidate_curriculum_cache,
        json_body=json_body,
        json_error=json_error,
        ksb_mapping_placement=ksb_mapping_placement,
        refuse_stale_module_write=refuse_stale_module_write,
        transaction=transaction,
    )


@csrf_exempt
@with_course_storage
def curriculum_module_week_detail(request, module_catalogue_id, week_id):
    from curriculum_api.catalogue.api.lifecycle_commands import curriculum_module_week_detail as implementation
    def check_removal(*args, **kwargs):
        from curriculum_api.module_collaboration import check_removal as operation
        return operation(*args, **kwargs)
    return implementation(
        request, module_catalogue_id, week_id,
        AUTHORING_COMPONENTS_TABLE=AUTHORING_COMPONENTS_TABLE,
        AUTHORING_KSB_MAPPINGS_TABLE=AUTHORING_KSB_MAPPINGS_TABLE,
        AUTHORING_WEEKS_TABLE=AUTHORING_WEEKS_TABLE,
        JsonResponse=JsonResponse,
        authoring_fetch_all=authoring_fetch_all,
        authoring_soft_delete=authoring_soft_delete,
        check_removal=check_removal,
        clean_str=clean_str,
        invalidate_curriculum_cache=invalidate_curriculum_cache,
        json_body=json_body,
        json_error=json_error,
        ksb_mapping_placement=ksb_mapping_placement,
        log_curriculum_decision=log_curriculum_decision,
        refuse_stale_module_write=refuse_stale_module_write,
        transaction=transaction,
    )


@require_role('admin', 'staff')
def _update_module_cover(request, identifier, payload):
    from curriculum_api.catalogue.api.module_commands import _update_module_cover as implementation
    def _builder_cover_url(*args, **kwargs):
        from learner_api.student_activity import _builder_cover_url as operation
        return operation(*args, **kwargs)
    return implementation(
        request, identifier, payload,
        AUTHORING_MODULES_TABLE=AUTHORING_MODULES_TABLE,
        CoverImageError=CoverImageError,
        DatabaseError=DatabaseError,
        JsonResponse=JsonResponse,
        _builder_cover_url=_builder_cover_url,
        archive_state=archive_state,
        connection=connection,
        invalidate_curriculum_cache=invalidate_curriculum_cache,
        json_error=json_error,
        note_live_rows=note_live_rows,
        stored_module_cover_image=stored_module_cover_image,
    )


@csrf_exempt
@with_course_storage
def curriculum_module_detail(request, identifier):
    from curriculum_api.catalogue.api.module_commands import curriculum_module_detail as implementation
    def check_structure_save(*args, **kwargs):
        from curriculum_api.module_collaboration import check_structure_save as operation
        return operation(*args, **kwargs)
    def announce_saved(*args, **kwargs):
        from curriculum_api.module_collaboration import announce_saved as operation
        return operation(*args, **kwargs)
    def collaboration_enabled(*args, **kwargs):
        from curriculum_api.module_collaboration import enabled as operation
        return operation(*args, **kwargs)
    def check_removal(*args, **kwargs):
        from curriculum_api.module_collaboration import check_removal as operation
        return operation(*args, **kwargs)
    def free_course_errors(*args, **kwargs):
        from curriculum_api.free_course_policy import free_course_errors as operation
        return operation(*args, **kwargs)
    return implementation(
        request, identifier,
        AUTHORING_MODULES_TABLE=AUTHORING_MODULES_TABLE,
        COURSE_PRICING_FIELDS=COURSE_PRICING_FIELDS,
        JsonResponse=JsonResponse,
        ModuleAuthoringValidationError=ModuleAuthoringValidationError,
        _update_module_cover=_update_module_cover,
        announce_saved=announce_saved,
        archived_programme_module_edit_error=archived_programme_module_edit_error,
        authoring_module_exists=authoring_module_exists,
        check_removal=check_removal,
        check_structure_save=check_structure_save,
        clean_str=clean_str,
        collaboration_enabled=collaboration_enabled,
        curriculum_module_from_authoring_payload=curriculum_module_from_authoring_payload,
        curriculum_name_only_patch=curriculum_name_only_patch,
        datetime=datetime,
        default_completion_payload=default_completion_payload,
        delete_module_authoring_structure=delete_module_authoring_structure,
        free_course_errors=free_course_errors,
        free_course_sale_values=free_course_sale_values,
        get_authoring_structure_payload=get_authoring_structure_payload,
        invalidate_curriculum_cache=invalidate_curriculum_cache,
        json_body=json_body,
        json_error=json_error,
        lock_module_structure_row=lock_module_structure_row,
        log_curriculum_decision=log_curriculum_decision,
        merged_week_starts_on=merged_week_starts_on,
        merged_weekly_schedule=merged_weekly_schedule,
        module_authoring_quality_check=module_authoring_quality_check,
        module_cohort_date_error=module_cohort_date_error,
        module_parent_cohort=module_parent_cohort,
        module_schedule_assignment_changed=module_schedule_assignment_changed,
        module_schedule_view=module_schedule_view,
        module_structure_revision=module_structure_revision,
        module_teams_calendar_block_response=module_teams_calendar_block_response,
        module_week_starts_on=module_week_starts_on,
        module_weekly_schedule=module_weekly_schedule,
        normalise_ksb_profile_source_value=normalise_ksb_profile_source_value,
        notify_staff_assignment_change=notify_staff_assignment_change,
        parse_int=parse_int,
        permanent_module_delete_response=permanent_module_delete_response,
        pricing_values=pricing_values,
        record_conflict_response=record_conflict_response,
        repair_curriculum_parent_links=repair_curriculum_parent_links,
        request_wants_permanent_delete=request_wants_permanent_delete,
        requested_expected_revision=requested_expected_revision,
        resize_authoring_week_structure_preserving_content=resize_authoring_week_structure_preserving_content,
        resolve_stored_module_catalogue_id=resolve_stored_module_catalogue_id,
        save_module_authoring_structure=save_module_authoring_structure,
        stale_teams_calendar_modules=stale_teams_calendar_modules,
        transaction=transaction,
        tutor_assignment_delivery_day_error=tutor_assignment_delivery_day_error,
        tutor_conflict_error=tutor_conflict_error,
        tutor_conflict_override_requested=tutor_conflict_override_requested,
        tutor_schedule_conflicts_created=tutor_schedule_conflicts_created,
        update_authoring_rows=update_authoring_rows,
        parse_date=parse_date,
    )


MODULE_CHILD_AUTHORING_TABLES = (
    AUTHORING_KSB_MAPPINGS_TABLE,
    AUTHORING_COMPONENTS_TABLE,
    AUTHORING_WEEKS_TABLE,
    AUTHORING_COMPLETION_TABLE,
    AUTHORING_ADVANCED_TABLE,
)


ARCHIVE_MODULE_QUIZ_NOTE = (
    'Quizzes archived with it stay in the Quiz Archive - restore them from the Quiz Workspace.'
)


@csrf_exempt
@with_course_storage
def curriculum_module_restore(request, identifier):
    from curriculum_api.catalogue.api.lifecycle_commands import curriculum_module_restore as implementation
    return implementation(
        request, identifier,
        ARCHIVE_MODULE_QUIZ_NOTE=ARCHIVE_MODULE_QUIZ_NOTE,
        AUTHORING_COMPONENTS_TABLE=AUTHORING_COMPONENTS_TABLE,
        AUTHORING_MODULES_TABLE=AUTHORING_MODULES_TABLE,
        AUTHORING_WEEKS_TABLE=AUTHORING_WEEKS_TABLE,
        JsonResponse=JsonResponse,
        MODULE_CHILD_AUTHORING_TABLES=MODULE_CHILD_AUTHORING_TABLES,
        RESTORE_NULLABLE_COLUMNS=RESTORE_NULLABLE_COLUMNS,
        archived_parent_programme=archived_parent_programme,
        authoring_module_exists=authoring_module_exists,
        clean_str=clean_str,
        curriculum_row_effectively_deleted=curriculum_row_effectively_deleted,
        invalidate_curriculum_cache=invalidate_curriculum_cache,
        json_error=json_error,
        log_curriculum_decision=log_curriculum_decision,
        module_archive_event_bounds=module_archive_event_bounds,
        resolve_stored_module_catalogue_id=resolve_stored_module_catalogue_id,
        restore_rows_via_parent=restore_rows_via_parent,
        restore_soft_delete_payload=restore_soft_delete_payload,
        transaction=transaction,
        update_rows=update_rows,
    )


def permanent_module_delete_response(module_row):
    from curriculum_api.catalogue.api.lifecycle_commands import permanent_module_delete_response as implementation
    return implementation(
        module_row,
        AUTHORING_KSB_MAPPINGS_TABLE=AUTHORING_KSB_MAPPINGS_TABLE,
        AUTHORING_MODULES_TABLE=AUTHORING_MODULES_TABLE,
        DatabaseError=DatabaseError,
        IntegrityError=IntegrityError,
        JsonResponse=JsonResponse,
        MODULE_CHILD_AUTHORING_TABLES=MODULE_CHILD_AUTHORING_TABLES,
        clean_str=clean_str,
        curriculum_row_effectively_deleted=curriculum_row_effectively_deleted,
        delete_rows=delete_rows,
        invalidate_curriculum_cache=invalidate_curriculum_cache,
        json_error=json_error,
        ksb_mapping_placement=ksb_mapping_placement,
        log_curriculum_decision=log_curriculum_decision,
        logger=logger,
        module_teams_calendar_block_response=module_teams_calendar_block_response,
        permanent_delete_reference_refusal=permanent_delete_reference_refusal,
        transaction=transaction,
    )


@csrf_exempt
def curriculum_group_modules(request, identifier):
    from curriculum_api.catalogue.api.group_commands import curriculum_group_modules as implementation
    return implementation(
        request, identifier,
        JsonResponse=JsonResponse,
        ModuleAuthoringValidationError=ModuleAuthoringValidationError,
        StaleModuleStructureWrite=StaleModuleStructureWrite,
        TutorAssignmentDeliveryDayError=TutorAssignmentDeliveryDayError,
        TutorScheduleConflictError=TutorScheduleConflictError,
        attachment_session_count=attachment_session_count,
        attachment_week_structure=attachment_week_structure,
        clean_str=clean_str,
        contentful_catalogue_id_for_attachment=contentful_catalogue_id_for_attachment,
        curriculum_cohort_from_authoring_detail=curriculum_cohort_from_authoring_detail,
        curriculum_collection_response=curriculum_collection_response,
        curriculum_group_from_authoring_detail=curriculum_group_from_authoring_detail,
        get_cached_payload=get_cached_payload,
        invalidate_curriculum_cache=invalidate_curriculum_cache,
        is_canonical_module_catalogue_id=is_canonical_module_catalogue_id,
        json_body=json_body,
        json_error=json_error,
        locked_attachment_structure=locked_attachment_structure,
        matches_curriculum_identifier=matches_curriculum_identifier,
        module_attachment_authoring_payload=module_attachment_authoring_payload,
        module_belongs_to_group=module_belongs_to_group,
        module_calendar_end_date=module_calendar_end_date,
        module_cohort_date_error=module_cohort_date_error,
        module_schedule_assignment_changed=module_schedule_assignment_changed,
        module_schedule_view=module_schedule_view,
        module_week_starts_on=module_week_starts_on,
        module_weekly_schedule=module_weekly_schedule,
        normalise=normalise,
        notify_staff_assignment_change=notify_staff_assignment_change,
        parse_int=parse_int,
        repair_curriculum_parent_links=repair_curriculum_parent_links,
        resolve_cohort_row=resolve_cohort_row,
        resolve_group_row=resolve_group_row,
        safe_authoring_module_rows=safe_authoring_module_rows,
        save_module_authoring_structure=save_module_authoring_structure,
        schedule_day_part=schedule_day_part,
        serialize_cohort_authoring_detail=serialize_cohort_authoring_detail,
        serialize_group_authoring_detail=serialize_group_authoring_detail,
        transaction=transaction,
        tutor_assignment_delivery_day_error=tutor_assignment_delivery_day_error,
        tutor_conflict_override_requested=tutor_conflict_override_requested,
        tutor_schedule_conflicts_created=tutor_schedule_conflicts_created,
        unassign_authoring_modules_from_group=unassign_authoring_modules_from_group,
        unique_module_catalogue_id=unique_module_catalogue_id,
    )
