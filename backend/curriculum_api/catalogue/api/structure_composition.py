"""Concrete catalogue / api / structure composition capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""
from curriculum_api import archive_state
from curriculum_api.catalogue.infrastructure import free_course_pricing as free_course_pricing
from curriculum_api.catalogue.domain.archive_policy import active_mapping_rows
from curriculum_api.catalogue.domain.archive_policy import active_week_rows
from curriculum_api.catalogue.domain.archive_policy import programme_deleted_row
from curriculum_api.catalogue.domain.component_policy import component_builder_settings
from curriculum_api.catalogue.domain.content_values import active_component_rows
from curriculum_api.catalogue.domain.delivery_values import delivery_status_for_training_row
from curriculum_api.catalogue.domain.delivery_values import module_stored_week_count
from curriculum_api.catalogue.infrastructure import placement_reads
from curriculum_api.catalogue.infrastructure.authoring_runtime import authoring_fetch_all
from curriculum_api.catalogue.infrastructure.authoring_runtime import prefetch_authoring_reads
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import GROUPS_TABLE
from curriculum_api.catalogue.infrastructure.calendar_runtime import module_delivery_row
from curriculum_api.catalogue.infrastructure.cohort_calendar_composition import cohort_selected_holidays_by_cohort
from curriculum_api.catalogue.infrastructure.component_composition import live_component_rows_paged
from curriculum_api.catalogue.infrastructure.content_runtime import component_reflection_question
from curriculum_api.catalogue.infrastructure.course_storage_reads import with_course_storage
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_ADVANCED_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_COMPLETION_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_COMPONENTS_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_KSB_MAPPINGS_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_MODULES_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_WEEKS_TABLE
from curriculum_api.catalogue.infrastructure.lifecycle_runtime import module_archive_event_bounds
from curriculum_api.catalogue.infrastructure.lifecycle_runtime import row_in_module_archive
from curriculum_api.catalogue.infrastructure.revision_runtime import structure_payload_with_revision
from curriculum_api.catalogue.infrastructure.row_queries import authoring_rows_by_id
from curriculum_api.catalogue.infrastructure.runtime_config import GROUP_ROWS_ORDER
from curriculum_api.catalogue.infrastructure.session_plan_persistence import apply_module_session_plan_to_weeks
from curriculum_api.catalogue.infrastructure.structure_runtime import mapping_response
from curriculum_api.catalogue.infrastructure.structure_runtime import module_authoring_quality_check
from curriculum_api.catalogue.infrastructure.structure_runtime import module_delivery_week_count
from curriculum_api.catalogue.infrastructure.structure_runtime import module_structure_source_rows
from curriculum_api.catalogue.infrastructure.structure_runtime import training_row_by_id
from curriculum_api.catalogue.infrastructure.structure_runtime import with_item_fingerprints
from curriculum_api.meetings.api.adapters import teams_delivery_metadata_from_live_session
from curriculum_api.meetings.api.adapters import teams_delivery_metadata_from_live_session_row
from curriculum_api.meetings.api.adapters import teams_delivery_metadata_from_weeks
from curriculum_api.meetings.domain.read_contracts import LIVE_SESSIONS_TABLE
from curriculum_api.meetings.infrastructure.calendar_runtime import apply_shared_teams_settings_to_weeks
from curriculum_api.meetings.infrastructure.tracking_runtime import ensure_live_session_tracking_tables
from curriculum_api.reporting.domain.source_values import normalise_ksb_profile_source_value
from curriculum_api.reporting.infrastructure.source_catalogue_runtime import mappings_with_inferred_sources
from curriculum_api.reporting.infrastructure.source_runtime import component_ksb_mapping_api_item
from curriculum_api.reporting.infrastructure.source_runtime import component_ksb_mappings_from_row
from curriculum_api.weekly_schedule import module_week_starts_on
from curriculum_api.weekly_schedule import module_weekly_schedule


@with_course_storage
def read_module_structure_with_revision(module_catalogue_id):
    from curriculum_api.catalogue.application.structure_revisions import read_module_structure_with_revision as query
    return query(
        module_catalogue_id,
        module_structure_source_rows=module_structure_source_rows,
        structure_payload_with_revision=structure_payload_with_revision,
        get_authoring_structure_payload=get_authoring_structure_payload,
        with_item_fingerprints=with_item_fingerprints,
    )


@with_course_storage
def get_authoring_structure_payload(module_catalogue_id, include_archived=False, *, source_rows=None):
    from curriculum_api.catalogue.application.structure_payloads import get_authoring_structure_payload as read
    return read(
        module_catalogue_id,
        include_archived,
        source_rows=source_rows,
        AUTHORING_ADVANCED_TABLE=AUTHORING_ADVANCED_TABLE,
        AUTHORING_COMPLETION_TABLE=AUTHORING_COMPLETION_TABLE,
        AUTHORING_COMPONENTS_TABLE=AUTHORING_COMPONENTS_TABLE,
        AUTHORING_KSB_MAPPINGS_TABLE=AUTHORING_KSB_MAPPINGS_TABLE,
        AUTHORING_MODULES_TABLE=AUTHORING_MODULES_TABLE,
        AUTHORING_WEEKS_TABLE=AUTHORING_WEEKS_TABLE,
        GROUPS_TABLE=GROUPS_TABLE,
        active_component_rows=active_component_rows,
        active_mapping_rows=active_mapping_rows,
        active_week_rows=active_week_rows,
        annotate_archive_state=lambda *args, **kwargs: archive_state.annotate(*args, **kwargs),
        apply_module_session_plan_to_weeks=apply_module_session_plan_to_weeks,
        apply_shared_teams_settings_to_weeks=apply_shared_teams_settings_to_weeks,
        attach_curriculum_names=lambda *args, **kwargs: placement_reads.attach(*args, **kwargs),
        authoring_fetch_all=authoring_fetch_all,
        component_builder_settings=component_builder_settings,
        component_ksb_mapping_api_item=component_ksb_mapping_api_item,
        component_ksb_mappings_from_row=component_ksb_mappings_from_row,
        component_reflection_question=component_reflection_question,
        delivery_status_for_training_row=delivery_status_for_training_row,
        free_course_price_payload=lambda *args, **kwargs: free_course_pricing.payload(*args, **kwargs),
        lookup_free_course_prices=lambda *args, **kwargs: free_course_pricing.lookup(*args, **kwargs),
        mapping_response=mapping_response,
        mappings_with_inferred_sources=mappings_with_inferred_sources,
        module_archive_event_bounds=module_archive_event_bounds,
        module_authoring_quality_check=module_authoring_quality_check,
        module_delivery_row=module_delivery_row,
        module_delivery_week_count=module_delivery_week_count,
        module_stored_week_count=module_stored_week_count,
        module_week_starts_on=module_week_starts_on,
        module_weekly_schedule=module_weekly_schedule,
        normalise_ksb_profile_source_value=normalise_ksb_profile_source_value,
        programme_deleted_row=programme_deleted_row,
        row_in_module_archive=row_in_module_archive,
        teams_delivery_metadata_from_live_session=teams_delivery_metadata_from_live_session,
        teams_delivery_metadata_from_weeks=teams_delivery_metadata_from_weeks,
        training_row_by_id=training_row_by_id,
    )


def get_authoring_structure_payloads(module_catalogue_ids, include_staff=True, include_quality=True, include_extra=True, component_columns=None, child_rows=None):

    def calendar_unavailable_type():
        from curriculum_api.catalogue.infrastructure.country_calendar_reads import CalendarUnavailable
        return CalendarUnavailable

    def display_cohort_holidays(cohort_ids):
        from curriculum_api.catalogue.infrastructure.calendar_display import display_cohort_holidays as read
        return read(cohort_ids)
    from curriculum_api.catalogue.application.structure_payloads import get_authoring_structure_payloads as read
    return read(
        module_catalogue_ids,
        include_staff,
        include_quality,
        include_extra,
        component_columns,
        child_rows,
        AUTHORING_ADVANCED_TABLE=AUTHORING_ADVANCED_TABLE,
        AUTHORING_COMPLETION_TABLE=AUTHORING_COMPLETION_TABLE,
        AUTHORING_COMPONENTS_TABLE=AUTHORING_COMPONENTS_TABLE,
        AUTHORING_KSB_MAPPINGS_TABLE=AUTHORING_KSB_MAPPINGS_TABLE,
        AUTHORING_MODULES_TABLE=AUTHORING_MODULES_TABLE,
        AUTHORING_WEEKS_TABLE=AUTHORING_WEEKS_TABLE,
        GROUPS_TABLE=GROUPS_TABLE,
        GROUP_ROWS_ORDER=GROUP_ROWS_ORDER,
        LIVE_SESSIONS_TABLE=LIVE_SESSIONS_TABLE,
        active_component_rows=active_component_rows,
        active_mapping_rows=active_mapping_rows,
        active_week_rows=active_week_rows,
        apply_module_session_plan_to_weeks=apply_module_session_plan_to_weeks,
        apply_shared_teams_settings_to_weeks=apply_shared_teams_settings_to_weeks,
        authoring_fetch_all=authoring_fetch_all,
        authoring_rows_by_id=authoring_rows_by_id,
        calendar_unavailable_type=calendar_unavailable_type,
        cohort_selected_holidays_by_cohort=cohort_selected_holidays_by_cohort,
        component_ksb_mapping_api_item=component_ksb_mapping_api_item,
        component_ksb_mappings_from_row=component_ksb_mappings_from_row,
        component_reflection_question=component_reflection_question,
        delivery_status_for_training_row=delivery_status_for_training_row,
        display_cohort_holidays=display_cohort_holidays,
        ensure_live_session_tracking_tables=ensure_live_session_tracking_tables,
        free_course_price_payload=lambda *args, **kwargs: free_course_pricing.payload(*args, **kwargs),
        live_component_rows_paged=live_component_rows_paged,
        lookup_free_course_prices=lambda *args, **kwargs: free_course_pricing.lookup(*args, **kwargs),
        mapping_response=mapping_response,
        mappings_with_inferred_sources=mappings_with_inferred_sources,
        module_authoring_quality_check=module_authoring_quality_check,
        module_delivery_row=module_delivery_row,
        module_delivery_week_count=module_delivery_week_count,
        module_stored_week_count=module_stored_week_count,
        module_week_starts_on=module_week_starts_on,
        module_weekly_schedule=module_weekly_schedule,
        normalise_ksb_profile_source_value=normalise_ksb_profile_source_value,
        prefetch_authoring_reads=prefetch_authoring_reads,
        programme_deleted_row=programme_deleted_row,
        teams_delivery_metadata_from_live_session_row=teams_delivery_metadata_from_live_session_row,
        teams_delivery_metadata_from_weeks=teams_delivery_metadata_from_weeks,
        training_row_by_id=training_row_by_id,
    )
