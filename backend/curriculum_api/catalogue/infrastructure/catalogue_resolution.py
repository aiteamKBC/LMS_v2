"""Concrete catalogue / infrastructure / catalogue resolution capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""
from curriculum_api import free_course_pricing
from curriculum_api.catalogue.application.scope_identity import dedupe_authoring_module_rows
from curriculum_api.catalogue.domain.archive_policy import active_mapping_rows
from curriculum_api.catalogue.domain.archive_policy import active_week_rows
from curriculum_api.catalogue.domain.archive_policy import programme_deleted_row
from curriculum_api.catalogue.domain.component_policy import component_builder_settings
from curriculum_api.catalogue.domain.content_values import active_component_rows
from curriculum_api.catalogue.domain.delivery_values import module_stored_week_count
from curriculum_api.catalogue.domain.programme_values import program_config_by_id
from curriculum_api.catalogue.domain.read_contracts import COMPONENT_HEAVY_COLUMNS
from curriculum_api.catalogue.domain.read_contracts import COMPONENT_KSB_SCOPE_COLUMNS
from curriculum_api.catalogue.domain.read_contracts import WEEK_INDEX_COLUMNS
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.infrastructure.authoring_columns import CATALOGUE_SUMMARY_COMPONENT_COLUMNS
from curriculum_api.catalogue.infrastructure.authoring_runtime import authoring_fetch_all
from curriculum_api.catalogue.infrastructure.authoring_runtime import prefetch_authoring_reads
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import GROUPS_TABLE
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import ensure_module_authoring_tables
from curriculum_api.catalogue.infrastructure.authoring_sql import live_authoring_rows_sql
from curriculum_api.catalogue.infrastructure.cache_access import scoped_curriculum_read
from curriculum_api.catalogue.infrastructure.catalogue_sources import get_program_config_rows
from curriculum_api.catalogue.infrastructure.catalogue_sources import get_training_rows
from curriculum_api.catalogue.infrastructure.content_runtime import authoring_component_counts_by_catalogue
from curriculum_api.catalogue.infrastructure.content_runtime import authoring_module_content_counts
from curriculum_api.catalogue.infrastructure.content_runtime import component_reflection_question
from curriculum_api.catalogue.infrastructure.course_storage_reads import with_course_storage
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_COMPONENTS_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_KSB_MAPPINGS_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_MODULES_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_WEEKS_TABLE
from curriculum_api.catalogue.infrastructure.hierarchy_composition import programme_config_by_identifier
from curriculum_api.catalogue.infrastructure.lifecycle_runtime import module_withdrawn_on_its_own
from curriculum_api.catalogue.infrastructure.placement_runtime import resolve_cohort_row
from curriculum_api.catalogue.infrastructure.placement_runtime import resolve_group_row
from curriculum_api.catalogue.infrastructure.row_queries import authoring_child_rows_for_modules
from curriculum_api.catalogue.infrastructure.row_queries import authoring_rows_by_id
from curriculum_api.catalogue.infrastructure.row_queries import module_index_rows
from curriculum_api.catalogue.infrastructure.row_queries import training_index_reads
from curriculum_api.catalogue.infrastructure.row_queries import week_scope_module_ids
from curriculum_api.catalogue.infrastructure.runtime_config import GROUP_ROWS_ORDER
from curriculum_api.catalogue.infrastructure.runtime_config import logger
from curriculum_api.catalogue.infrastructure.structure_runtime import module_delivery_week_count
from curriculum_api.catalogue.infrastructure.structure_runtime import training_row_by_id
from curriculum_api.catalogue.infrastructure.structure_runtime import training_row_module_catalogue_id
from curriculum_api.reporting.domain.source_values import normalise_ksb_profile_source_value
from curriculum_api.weekly_schedule import module_week_starts_on
from curriculum_api.weekly_schedule import module_weekly_schedule
from django.db import connection


def find_existing_authoring_catalogue_id_for_payload(payload):
    from curriculum_api.catalogue.application.attachment_preparation import find_existing_authoring_catalogue_id_for_payload as implementation
    return implementation(
        payload,
        AUTHORING_MODULES_TABLE=AUTHORING_MODULES_TABLE,
        authoring_component_counts_by_catalogue=authoring_component_counts_by_catalogue,
        authoring_fetch_all=authoring_fetch_all,
        ensure_module_authoring_tables=ensure_module_authoring_tables,
        logger=logger,
        module_withdrawn_on_its_own=module_withdrawn_on_its_own,
        resolve_authoring_catalogue_id=resolve_authoring_catalogue_id,
    )


@with_course_storage
def authoring_module_exists(module_catalogue_id):
    rows = authoring_fetch_all(AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s', [module_catalogue_id])
    return rows[0] if rows else None


def resolve_stored_module_catalogue_id(identifier):
    """Compatibility entry point; implementation lives in the catalogue boundary."""
    from curriculum_api.catalogue.application.resolution import resolve_stored_module_catalogue_id as query
    return query(
        identifier,
        authoring_module_exists=authoring_module_exists,
        resolve_authoring_catalogue_id=resolve_authoring_catalogue_id,
    )


def resolve_authoring_catalogue_id(identifier):
    """Compatibility entry point; implementation lives in the catalogue boundary."""
    from curriculum_api.catalogue.application.resolution import resolve_authoring_catalogue_id as query
    return query(
        identifier,
        authoring_catalogue_summaries=authoring_catalogue_summaries,
        get_program_config_rows=get_program_config_rows,
        program_config_by_id=program_config_by_id,
        training_row_by_id=training_row_by_id,
        training_row_module_catalogue_id=training_row_module_catalogue_id,
    )


def authoring_catalogue_summaries(include_programme_deleted=False, include_content=True, *, list_only=False):

    def grouped_catalogue_content_rows():
        from curriculum_api.catalogue_summary_reads import grouped_catalogue_content_rows as read
        return read()
    from curriculum_api.catalogue.application.authoring_summaries import authoring_catalogue_summaries as query
    return query(
        include_programme_deleted,
        include_content,
        list_only=list_only,
        AUTHORING_COMPONENTS_TABLE=AUTHORING_COMPONENTS_TABLE,
        AUTHORING_KSB_MAPPINGS_TABLE=AUTHORING_KSB_MAPPINGS_TABLE,
        AUTHORING_MODULES_TABLE=AUTHORING_MODULES_TABLE,
        AUTHORING_WEEKS_TABLE=AUTHORING_WEEKS_TABLE,
        CATALOGUE_SUMMARY_COMPONENT_COLUMNS=CATALOGUE_SUMMARY_COMPONENT_COLUMNS,
        GROUPS_TABLE=GROUPS_TABLE,
        GROUP_ROWS_ORDER=GROUP_ROWS_ORDER,
        WEEK_INDEX_COLUMNS=WEEK_INDEX_COLUMNS,
        active_component_rows=active_component_rows,
        active_mapping_rows=active_mapping_rows,
        active_week_rows=active_week_rows,
        authoring_fetch_all=authoring_fetch_all,
        authoring_module_content_counts=authoring_module_content_counts,
        authoring_rows_by_id=authoring_rows_by_id,
        component_builder_settings=component_builder_settings,
        component_reflection_question=component_reflection_question,
        database_vendor=lambda: connection.vendor,
        free_course_price_payload=lambda row, prices: free_course_pricing.payload(row, prices),
        grouped_catalogue_content_rows=grouped_catalogue_content_rows,
        live_authoring_rows_sql=live_authoring_rows_sql,
        logger=logger,
        lookup_free_course_prices=lambda rows: free_course_pricing.lookup(rows),
        module_delivery_week_count=module_delivery_week_count,
        module_stored_week_count=module_stored_week_count,
        module_week_starts_on=module_week_starts_on,
        module_weekly_schedule=module_weekly_schedule,
        normalise_ksb_profile_source_value=normalise_ksb_profile_source_value,
        prefetch_authoring_reads=prefetch_authoring_reads,
        programme_deleted_row=programme_deleted_row,
    )


@scoped_curriculum_read
def authoring_scope_module_rows(scope='', identifier=''):
    from curriculum_api.catalogue.application.scope_queries import authoring_scope_module_rows as read
    return read(
        scope,
        identifier,
        ensure_module_authoring_tables=ensure_module_authoring_tables,
        get_program_config_rows=get_program_config_rows,
        get_training_rows=get_training_rows,
        module_index_rows=module_index_rows,
        prefetch_authoring_reads=prefetch_authoring_reads,
        program_config_by_id=program_config_by_id,
        resolve_authoring_catalogue_id=resolve_authoring_catalogue_id,
        resolve_group_row=resolve_group_row,
        training_index_reads=training_index_reads,
        training_row_module_catalogue_id=training_row_module_catalogue_id,
    )


@scoped_curriculum_read
def authoring_scope_data(scope='', identifier='', *, stats_only=False, mapped_components_only=False):
    from curriculum_api.catalogue.application.scope_queries import authoring_scope_data as read
    from curriculum_api.catalogue.infrastructure.scope_reads import read_scope_children

    def children(module_ids, **options):
        from curriculum_api import ksb_stats_reads
        return read_scope_children(
            module_ids,
            **options,
            grouped_scope_rows=ksb_stats_reads.grouped_scope_rows,
            grouped_component_counts=ksb_stats_reads.grouped_component_counts,
            AUTHORING_COMPONENTS_TABLE=AUTHORING_COMPONENTS_TABLE,
            AUTHORING_KSB_MAPPINGS_TABLE=AUTHORING_KSB_MAPPINGS_TABLE,
            AUTHORING_WEEKS_TABLE=AUTHORING_WEEKS_TABLE,
            COMPONENT_KSB_SCOPE_COLUMNS=COMPONENT_KSB_SCOPE_COLUMNS,
            active_component_rows=active_component_rows,
            active_mapping_rows=active_mapping_rows,
            active_week_rows=active_week_rows,
            authoring_child_rows_for_modules=authoring_child_rows_for_modules,
            authoring_fetch_all=authoring_fetch_all,
            clean_str=clean_str,
            database_vendor=lambda: connection.vendor,
        )

    return read(
        scope,
        identifier,
        stats_only=stats_only,
        mapped_components_only=mapped_components_only,
        authoring_scope_module_rows=authoring_scope_module_rows,
        clean_str=clean_str,
        dedupe_authoring_module_rows=dedupe_authoring_module_rows,
        ensure_module_authoring_tables=ensure_module_authoring_tables,
        read_scope_children=children,
        week_scope_module_ids=week_scope_module_ids,
    )


def programme_identity_candidates(programme_id):
    from curriculum_api.catalogue.application.placement_lineage import programme_identity_candidates as query
    return query(
        programme_id,
        authoring_scope_module_rows=authoring_scope_module_rows,
        get_program_config_rows=get_program_config_rows,
    )


def scope_placement_lineage(scope, identifier):
    from curriculum_api.catalogue.application.placement_lineage import scope_placement_lineage as query
    return query(
        scope,
        identifier,
        AUTHORING_COMPONENTS_TABLE=AUTHORING_COMPONENTS_TABLE,
        AUTHORING_MODULES_TABLE=AUTHORING_MODULES_TABLE,
        AUTHORING_WEEKS_TABLE=AUTHORING_WEEKS_TABLE,
        COMPONENT_HEAVY_COLUMNS=COMPONENT_HEAVY_COLUMNS,
        authoring_fetch_all=authoring_fetch_all,
        programme_config_by_identifier=programme_config_by_identifier,
        resolve_authoring_catalogue_id=resolve_authoring_catalogue_id,
        resolve_cohort_row=resolve_cohort_row,
        resolve_group_row=resolve_group_row,
    )
