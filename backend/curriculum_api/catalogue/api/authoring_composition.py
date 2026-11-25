"""Concrete catalogue authoring composition bindings.

Owns HTTP/decorator and runtime capability composition. Application operations,
domain policies, SQL and transaction behavior remain in their existing owners.
Public signatures and response contracts are unchanged."""
from curriculum_api import archive_state
from curriculum_api.catalogue.infrastructure import free_course_pricing as free_course_pricing
from curriculum_api import ksb_mapping_placement
from curriculum_api.catalogue.api.cache_lifecycle import invalidate_curriculum_cache
from curriculum_api.catalogue.api.structure_composition import get_authoring_structure_payload
from curriculum_api.catalogue.api.structure_guard_composition import free_course_sale_values
from curriculum_api.catalogue.application.authoring_metadata import default_completion_payload
from curriculum_api.catalogue.domain.archive_policy import row_has_deleted_at
from curriculum_api.catalogue.domain.authoring_errors import ModuleAuthoringValidationError
from curriculum_api.catalogue.domain.component_policy import component_builder_settings
from curriculum_api.catalogue.domain.component_types import is_retired_component_type
from curriculum_api.catalogue.domain.component_types import normalise_component_type
from curriculum_api.catalogue.domain.content_validation import component_expected_otjh
from curriculum_api.catalogue.domain.content_validation import frontend_component_type
from curriculum_api.catalogue.domain.content_validation import partial_read_errors
from curriculum_api.catalogue.domain.content_validation import payload_reflection_question
from curriculum_api.catalogue.domain.content_validation import stored_component_type
from curriculum_api.catalogue.domain.content_validation import without_retired_components
from curriculum_api.catalogue.domain.content_values import authoring_comparable
from curriculum_api.catalogue.domain.content_values import authoring_row_differs
from curriculum_api.catalogue.domain.content_values import component_coach_validation
from curriculum_api.catalogue.domain.content_values import component_expected_otjh_minutes
from curriculum_api.catalogue.domain.content_values import otjh_hours_from_minutes
from curriculum_api.catalogue.domain.content_values import payload_coach_validation
from curriculum_api.catalogue.domain.delivery_values import delivery_days_per_week
from curriculum_api.catalogue.domain.delivery_values import module_stored_week_count
from curriculum_api.catalogue.domain.hierarchy_values import normalise_programme_status
from curriculum_api.catalogue.domain.hierarchy_values import programme_config_id
from curriculum_api.catalogue.domain.programme_identity import programme_config_identity
from curriculum_api.catalogue.domain.programme_values import programme_status_from_payload
from curriculum_api.catalogue.domain.programme_values import sanitised_programme_id
from curriculum_api.catalogue.domain.read_contracts import LEGACY_REFLECTION_QUESTION_SETTING
from curriculum_api.catalogue.domain.row_values import authoring_row_is_active
from curriculum_api.catalogue.domain.structure_changes import component_assurance_flag
from curriculum_api.catalogue.domain.values import as_json_value
from curriculum_api.catalogue.domain.values import bool_payload
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.domain.values import normalise
from curriculum_api.catalogue.domain.values import parse_date
from curriculum_api.catalogue.domain.values import parse_float
from curriculum_api.catalogue.domain.values import parse_int
from curriculum_api.catalogue.domain.values import parse_json_value
from curriculum_api.catalogue.domain.values import truthy
from curriculum_api.catalogue.infrastructure.authoring_columns import REFLECTION_QUESTION_COLUMN
from curriculum_api.catalogue.infrastructure.authoring_runtime import authoring_fetch_all
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import MODULE_TEAMS_SHARES_TABLE
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import ensure_module_authoring_tables
from curriculum_api.catalogue.infrastructure.authoring_storage import authoring_bulk_upsert
from curriculum_api.catalogue.infrastructure.authoring_storage import authoring_upsert
from curriculum_api.catalogue.infrastructure.authoring_storage import insert_row
from curriculum_api.catalogue.infrastructure.authoring_storage import update_rows
from curriculum_api.catalogue.infrastructure.catalogue_resolution import authoring_module_exists
from curriculum_api.catalogue.infrastructure.catalogue_sources import canonical_staff_assignment_name
from curriculum_api.catalogue.infrastructure.catalogue_sources import get_program_config_rows
from curriculum_api.catalogue.infrastructure.catalogue_sources import resolve_staff_assignment_email
from curriculum_api.catalogue.infrastructure.component_composition import authoring_mapping_payload
from curriculum_api.catalogue.infrastructure.component_composition import normalise_component_ksb_mappings
from curriculum_api.catalogue.infrastructure.content_runtime import component_builder_response
from curriculum_api.catalogue.infrastructure.content_validation_runtime import component_context_for_payload
from curriculum_api.catalogue.infrastructure.content_validation_runtime import validate_module_authoring_payload
from curriculum_api.catalogue.infrastructure.course_storage_reads import with_course_storage
from curriculum_api.catalogue.infrastructure.cover_image_storage import stored_module_cover_image
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_ADVANCED_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_COMPLETION_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_COMPONENTS_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_KSB_MAPPINGS_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_MODULES_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_WEEKS_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import has_column
from curriculum_api.catalogue.infrastructure.database_reads import quote_ident
from curriculum_api.catalogue.infrastructure.hierarchy_composition import module_recovered_by_move_to_live
from curriculum_api.catalogue.infrastructure.hierarchy_composition import persistable_programme_id
from curriculum_api.catalogue.infrastructure.hierarchy_composition import programme_archived_for_authoring
from curriculum_api.catalogue.infrastructure.hierarchy_persistence import persist_group_authoring_detail
from curriculum_api.catalogue.infrastructure.hierarchy_persistence import repair_curriculum_parent_links
from curriculum_api.catalogue.infrastructure.lifecycle_persistence import archive_module_child_quizzes
from curriculum_api.catalogue.infrastructure.lifecycle_persistence import authoring_soft_delete
from curriculum_api.catalogue.infrastructure.lifecycle_persistence import ensure_program_config_archive_columns
from curriculum_api.catalogue.infrastructure.lifecycle_persistence import write_changed_authoring_rows
from curriculum_api.catalogue.infrastructure.lifecycle_runtime import module_withdrawn_on_its_own
from curriculum_api.catalogue.infrastructure.placement_runtime import fetch_cohort_row
from curriculum_api.catalogue.infrastructure.placement_runtime import fetch_group_row
from curriculum_api.catalogue.infrastructure.record_identity import canonical_authoring_id
from curriculum_api.catalogue.infrastructure.record_identity import unique_module_catalogue_id
from curriculum_api.catalogue.infrastructure.record_identity import unique_program_id
from curriculum_api.catalogue.infrastructure.row_queries import json_db_value
from curriculum_api.catalogue.infrastructure.row_queries import programme_config_key_column
from curriculum_api.catalogue.infrastructure.structure_runtime import module_authoring_quality_check
from curriculum_api.catalogue.infrastructure.write_composition import delete_rows
from curriculum_api.learner_ksb_sync import sync_progress_ksbs
from curriculum_api.meetings.api.adapters import live_session_row_to_component_settings
from curriculum_api.meetings.api.module_link_composition import attach_teams_meeting_to_module_weeks
from curriculum_api.meetings.domain.read_contracts import LIVE_SESSIONS_TABLE
from curriculum_api.meetings.domain.read_contracts import LIVE_SESSION_OCCURRENCES_TABLE
from curriculum_api.meetings.infrastructure.calendar_runtime import preserve_additional_meeting_settings
from curriculum_api.meetings.infrastructure.calendar_runtime import strip_shared_teams_delivery_settings
from curriculum_api.meetings.infrastructure.session_persistence import link_live_session_series_to_module
from curriculum_api.meetings.infrastructure.session_runtime import module_live_sessions_affected
from curriculum_api.meetings.infrastructure.session_runtime import module_structure_live_session_counts
from curriculum_api.reporting.domain.source_values import normalise_ksb_profile_source_value
from curriculum_api.reporting.infrastructure.source_runtime import component_ksb_mappings_from_row
from curriculum_api.teams_weekly_calendar import stored_calendar_series
from curriculum_api.weekly_schedule import first_weekly_session_day
from curriculum_api.weekly_schedule import merged_week_starts_on
from curriculum_api.weekly_schedule import merged_weekly_schedule
from datetime import datetime
from django.db import transaction
import json


def ensure_programme_config_for_authoring(programme_name, programme_id=None, status=''):
    from curriculum_api.catalogue.application.programme_configuration import ensure_programme_config_for_authoring as implementation
    return implementation(
        programme_name, programme_id, status, clean_str=clean_str, datetime=datetime,
        ensure_program_config_archive_columns=ensure_program_config_archive_columns,
        get_program_config_rows=get_program_config_rows, insert_row=insert_row,
        invalidate_curriculum_cache=invalidate_curriculum_cache, normalise=normalise,
        normalise_programme_status=normalise_programme_status,
        programme_config_id=programme_config_id,
        programme_config_identity=programme_config_identity,
        programme_config_key_column=programme_config_key_column,
        programme_status_from_payload=programme_status_from_payload, quote_ident=quote_ident,
        sanitised_programme_id=sanitised_programme_id, unique_program_id=unique_program_id,
        update_rows=update_rows,
    )


def save_component_builder_payload(payload, component_id=None):
    from curriculum_api.catalogue.application.component_authoring import save_component_builder_payload as implementation
    return implementation(
        payload, component_id,
        AUTHORING_COMPONENTS_TABLE=AUTHORING_COMPONENTS_TABLE,
        AUTHORING_KSB_MAPPINGS_TABLE=AUTHORING_KSB_MAPPINGS_TABLE,
        AUTHORING_MODULES_TABLE=AUTHORING_MODULES_TABLE,
        AUTHORING_WEEKS_TABLE=AUTHORING_WEEKS_TABLE,
        LEGACY_REFLECTION_QUESTION_SETTING=LEGACY_REFLECTION_QUESTION_SETTING,
        ModuleAuthoringValidationError=ModuleAuthoringValidationError,
        REFLECTION_QUESTION_COLUMN=REFLECTION_QUESTION_COLUMN,
        archive_state=archive_state,
        authoring_bulk_upsert=authoring_bulk_upsert,
        authoring_fetch_all=authoring_fetch_all,
        authoring_soft_delete=authoring_soft_delete,
        authoring_upsert=authoring_upsert,
        bool_payload=bool_payload,
        canonical_authoring_id=canonical_authoring_id,
        clean_str=clean_str,
        component_builder_response=component_builder_response,
        component_builder_settings=component_builder_settings,
        component_coach_validation=component_coach_validation,
        component_context_for_payload=component_context_for_payload,
        component_ksb_mappings_from_row=component_ksb_mappings_from_row,
        invalidate_curriculum_cache=invalidate_curriculum_cache,
        is_retired_component_type=is_retired_component_type,
        json_db_value=json_db_value,
        normalise_component_ksb_mappings=normalise_component_ksb_mappings,
        parse_float=parse_float,
        parse_int=parse_int,
        partial_read_errors=partial_read_errors,
        payload_coach_validation=payload_coach_validation,
        payload_reflection_question=payload_reflection_question,
        stored_component_type=stored_component_type,
        transaction=transaction,
    )


MODULE_ARCHIVED_SAVE_REFUSED = (
    'This module is archived, so this save was not applied. Restore it from View archive to edit it again.'
)


@with_course_storage
def save_module_authoring_structure(module_catalogue_id, payload, *, repair_links=True, write_changed_only=False, light=False, stored_rows=None, stored_structure=None, build_result=True, _legacy_live_ids=None):
    from curriculum_api.catalogue.application.module_authoring import save_module_authoring_structure as implementation
    def refresh_totals(*args, **kwargs):
        from curriculum_api.catalogue.infrastructure.course_storage_writes import refresh_totals as operation
        return operation(*args, **kwargs)
    def free_course_errors(*args, **kwargs):
        from curriculum_api.catalogue.application.free_course_policy import free_course_errors as operation
        from curriculum_api.catalogue.infrastructure.free_course_policy_reads import retained_live_component_ids
        return operation(*args, retained_live_component_ids=retained_live_component_ids, **kwargs)
    def retained_live_component_ids(*args, **kwargs):
        from curriculum_api.catalogue.infrastructure.free_course_policy_reads import retained_live_component_ids as operation
        return operation(*args, **kwargs)
    def policy_write(*args, **kwargs):
        from curriculum_api.catalogue.infrastructure.delivery_calendar_runtime import policy_write as operation
        return operation(*args, **kwargs)
    def manual_link_settings(*args, **kwargs):
        from curriculum_api.teams_external_calendar import manual_link_settings as operation
        return operation(*args, **kwargs)
    return implementation(
        module_catalogue_id, payload, repair_links=repair_links, write_changed_only=write_changed_only, light=light, stored_rows=stored_rows, stored_structure=stored_structure, build_result=build_result, _legacy_live_ids=_legacy_live_ids,
        AUTHORING_ADVANCED_TABLE=AUTHORING_ADVANCED_TABLE,
        AUTHORING_COMPLETION_TABLE=AUTHORING_COMPLETION_TABLE,
        AUTHORING_COMPONENTS_TABLE=AUTHORING_COMPONENTS_TABLE,
        AUTHORING_KSB_MAPPINGS_TABLE=AUTHORING_KSB_MAPPINGS_TABLE,
        AUTHORING_MODULES_TABLE=AUTHORING_MODULES_TABLE,
        AUTHORING_WEEKS_TABLE=AUTHORING_WEEKS_TABLE,
        LEGACY_REFLECTION_QUESTION_SETTING=LEGACY_REFLECTION_QUESTION_SETTING,
        LIVE_SESSIONS_TABLE=LIVE_SESSIONS_TABLE,
        LIVE_SESSION_OCCURRENCES_TABLE=LIVE_SESSION_OCCURRENCES_TABLE,
        MODULE_ARCHIVED_SAVE_REFUSED=MODULE_ARCHIVED_SAVE_REFUSED,
        MODULE_TEAMS_SHARES_TABLE=MODULE_TEAMS_SHARES_TABLE,
        ModuleAuthoringValidationError=ModuleAuthoringValidationError,
        REFLECTION_QUESTION_COLUMN=REFLECTION_QUESTION_COLUMN,
        archive_state=archive_state,
        as_json_value=as_json_value,
        attach_teams_meeting_to_module_weeks=attach_teams_meeting_to_module_weeks,
        authoring_bulk_upsert=authoring_bulk_upsert,
        authoring_comparable=authoring_comparable,
        authoring_fetch_all=authoring_fetch_all,
        authoring_mapping_payload=authoring_mapping_payload,
        authoring_module_exists=authoring_module_exists,
        authoring_row_differs=authoring_row_differs,
        authoring_row_is_active=authoring_row_is_active,
        authoring_soft_delete=authoring_soft_delete,
        authoring_upsert=authoring_upsert,
        bool_payload=bool_payload,
        canonical_authoring_id=canonical_authoring_id,
        canonical_staff_assignment_name=canonical_staff_assignment_name,
        clean_str=clean_str,
        component_assurance_flag=component_assurance_flag,
        component_builder_settings=component_builder_settings,
        component_expected_otjh=component_expected_otjh,
        component_expected_otjh_minutes=component_expected_otjh_minutes,
        datetime=datetime,
        default_completion_payload=default_completion_payload,
        delete_rows=delete_rows,
        delivery_days_per_week=delivery_days_per_week,
        ensure_module_authoring_tables=ensure_module_authoring_tables,
        ensure_programme_config_for_authoring=ensure_programme_config_for_authoring,
        fetch_cohort_row=fetch_cohort_row,
        fetch_group_row=fetch_group_row,
        first_weekly_session_day=first_weekly_session_day,
        free_course_errors=free_course_errors,
        free_course_pricing=free_course_pricing,
        free_course_sale_values=free_course_sale_values,
        frontend_component_type=frontend_component_type,
        get_authoring_structure_payload=get_authoring_structure_payload,
        get_program_config_rows=get_program_config_rows,
        has_column=has_column,
        invalidate_curriculum_cache=invalidate_curriculum_cache,
        json=json,
        json_db_value=json_db_value,
        ksb_mapping_placement=ksb_mapping_placement,
        link_live_session_series_to_module=link_live_session_series_to_module,
        live_session_row_to_component_settings=live_session_row_to_component_settings,
        manual_link_settings=manual_link_settings,
        merged_week_starts_on=merged_week_starts_on,
        merged_weekly_schedule=merged_weekly_schedule,
        module_authoring_quality_check=module_authoring_quality_check,
        module_live_sessions_affected=module_live_sessions_affected,
        module_recovered_by_move_to_live=module_recovered_by_move_to_live,
        module_stored_week_count=module_stored_week_count,
        module_structure_live_session_counts=module_structure_live_session_counts,
        module_withdrawn_on_its_own=module_withdrawn_on_its_own,
        normalise_component_ksb_mappings=normalise_component_ksb_mappings,
        normalise_component_type=normalise_component_type,
        normalise_ksb_profile_source_value=normalise_ksb_profile_source_value,
        otjh_hours_from_minutes=otjh_hours_from_minutes,
        parse_date=parse_date,
        parse_int=parse_int,
        parse_json_value=parse_json_value,
        payload_reflection_question=payload_reflection_question,
        persist_group_authoring_detail=persist_group_authoring_detail,
        persistable_programme_id=persistable_programme_id,
        policy_write=policy_write,
        preserve_additional_meeting_settings=preserve_additional_meeting_settings,
        programme_archived_for_authoring=programme_archived_for_authoring,
        programme_config_identity=programme_config_identity,
        refresh_totals=refresh_totals,
        repair_curriculum_parent_links=repair_curriculum_parent_links,
        resolve_staff_assignment_email=resolve_staff_assignment_email,
        retained_live_component_ids=retained_live_component_ids,
        row_has_deleted_at=row_has_deleted_at,
        stored_calendar_series=stored_calendar_series,
        stored_module_cover_image=stored_module_cover_image,
        strip_shared_teams_delivery_settings=strip_shared_teams_delivery_settings,
        sync_progress_ksbs=sync_progress_ksbs,
        transaction=transaction,
        truthy=truthy,
        unique_module_catalogue_id=unique_module_catalogue_id,
        validate_module_authoring_payload=validate_module_authoring_payload,
        without_retired_components=without_retired_components,
        write_changed_authoring_rows=write_changed_authoring_rows,
    )


@with_course_storage
def delete_module_authoring_structure(module_catalogue_id):
    from curriculum_api.catalogue.application.module_lifecycle import delete_module_authoring_structure as implementation
    return implementation(
        module_catalogue_id,
        AUTHORING_ADVANCED_TABLE=AUTHORING_ADVANCED_TABLE,
        AUTHORING_COMPLETION_TABLE=AUTHORING_COMPLETION_TABLE,
        AUTHORING_COMPONENTS_TABLE=AUTHORING_COMPONENTS_TABLE,
        AUTHORING_KSB_MAPPINGS_TABLE=AUTHORING_KSB_MAPPINGS_TABLE,
        AUTHORING_MODULES_TABLE=AUTHORING_MODULES_TABLE,
        AUTHORING_WEEKS_TABLE=AUTHORING_WEEKS_TABLE,
        archive_module_child_quizzes=archive_module_child_quizzes,
        authoring_fetch_all=authoring_fetch_all,
        authoring_soft_delete=authoring_soft_delete,
        clean_str=clean_str,
        ensure_module_authoring_tables=ensure_module_authoring_tables,
        invalidate_curriculum_cache=invalidate_curriculum_cache,
        ksb_mapping_placement=ksb_mapping_placement,
        transaction=transaction,
    )
