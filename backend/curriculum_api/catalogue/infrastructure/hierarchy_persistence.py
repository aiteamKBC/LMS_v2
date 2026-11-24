"""Concrete catalogue / infrastructure / hierarchy persistence capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""
from curriculum_api.catalogue.domain.archive_policy import active_week_rows
from curriculum_api.catalogue.domain.delivery_values import delivery_days_per_week
from curriculum_api.catalogue.domain.hierarchy_dates import module_calendar_end_date
from curriculum_api.catalogue.domain.read_contracts import DETACHED_PARENT_SENTINEL
from curriculum_api.catalogue.domain.read_contracts import WEEK_TEMPLATES_TABLE
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.domain.values import format_date
from curriculum_api.catalogue.domain.values import normalise
from curriculum_api.catalogue.domain.values import parse_int
from curriculum_api.catalogue.domain.values import unique
from curriculum_api.catalogue.infrastructure.authoring_runtime import authoring_fetch_all
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import COHORT_AUTHORING_DETAILS_TABLE
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import GROUPS_TABLE
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import ensure_module_authoring_tables
from curriculum_api.catalogue.infrastructure.authoring_storage import authoring_upsert
from curriculum_api.catalogue.infrastructure.authoring_storage import update_authoring_rows
from curriculum_api.catalogue.infrastructure.authoring_storage import update_rows
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_COMPONENTS_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_KSB_MAPPINGS_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_MODULES_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_WEEKS_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import authoring_table_name
from curriculum_api.catalogue.infrastructure.database_reads import curriculum_in_clause
from curriculum_api.catalogue.infrastructure.database_reads import has_column
from curriculum_api.catalogue.infrastructure.database_reads import table_exists
from curriculum_api.catalogue.infrastructure.database_reads import table_name
from curriculum_api.catalogue.infrastructure.hierarchy_composition import group_authoring_payload
from curriculum_api.catalogue.infrastructure.lifecycle_runtime import curriculum_row_effectively_deleted
from curriculum_api.catalogue.infrastructure.lifecycle_runtime import curriculum_where_any
from curriculum_api.catalogue.infrastructure.placement_runtime import fetch_cohort_row
from curriculum_api.catalogue.infrastructure.placement_runtime import fetch_group_row
from curriculum_api.catalogue.infrastructure.row_queries import safe_authoring_module_rows
from curriculum_api.catalogue.infrastructure.runtime_config import logger
from curriculum_api.catalogue.infrastructure.write_composition import authoring_delete
from curriculum_api.reporting.domain.source_values import normalise_ksb_profile_source_value
from datetime import datetime
from django.db import connection


def unhook_programme_reusables(plan, removed):
    from curriculum_api.catalogue.application.programme_deletion import unhook_programme_reusables as implementation
    return implementation(
        plan, removed,
        DETACHED_PARENT_SENTINEL=DETACHED_PARENT_SENTINEL,
        WEEK_TEMPLATES_TABLE=WEEK_TEMPLATES_TABLE,
        curriculum_in_clause=curriculum_in_clause,
        curriculum_where_any=curriculum_where_any,
        datetime=datetime,
        has_column=has_column,
        table_exists=table_exists,
        update_rows=update_rows,
    )


def set_programme_modules_ksb_source(programme_values, source_value):
    from curriculum_api.catalogue.infrastructure.content_source_writes import set_programme_modules_ksb_source as implementation
    def load_content_cache():
        from curriculum_api import content_cache as operation
        return operation
    return implementation(
        programme_values, source_value,
        AUTHORING_MODULES_TABLE=AUTHORING_MODULES_TABLE,
        authoring_fetch_all=authoring_fetch_all,
        authoring_table_name=authoring_table_name,
        clean_str=clean_str,
        connection=connection,
        datetime=datetime,
        ensure_module_authoring_tables=ensure_module_authoring_tables,
        load_content_cache=load_content_cache,
        normalise=normalise,
        normalise_ksb_profile_source_value=normalise_ksb_profile_source_value,
        table_name=table_name,
        unique=unique,
        update_authoring_rows=update_authoring_rows,
    )


def persist_group_authoring_detail(group, rows=None, module_rows=None, extra=None, *, raise_on_error=False):
    from curriculum_api.catalogue.infrastructure.hierarchy_writes import persist_group_authoring_detail as implementation
    return implementation(
        group, rows, module_rows, extra, raise_on_error=raise_on_error,
        GROUPS_TABLE=GROUPS_TABLE,
        authoring_upsert=authoring_upsert,
        group_authoring_payload=group_authoring_payload,
        logger=logger,
    )


def update_cohort_fields(cohort_id, fields, allow_null_columns=None):
    from curriculum_api.catalogue.infrastructure.hierarchy_writes import update_cohort_fields as implementation
    return implementation(
        cohort_id, fields, allow_null_columns,
        COHORT_AUTHORING_DETAILS_TABLE=COHORT_AUTHORING_DETAILS_TABLE,
        clean_str=clean_str,
        datetime=datetime,
        fetch_cohort_row=fetch_cohort_row,
        update_authoring_rows=update_authoring_rows,
    )


def update_group_fields(group_id, fields):
    from curriculum_api.catalogue.infrastructure.hierarchy_writes import update_group_fields as implementation
    return implementation(
        group_id, fields,
        GROUPS_TABLE=GROUPS_TABLE,
        clean_str=clean_str,
        datetime=datetime,
        fetch_group_row=fetch_group_row,
        update_authoring_rows=update_authoring_rows,
    )


def repair_curriculum_parent_links(programme_id='', *, allow_writes=True):
    from curriculum_api.catalogue.application.authoring_persistence import repair_curriculum_parent_links as implementation
    return implementation(
        programme_id, allow_writes=allow_writes,
        AUTHORING_COMPONENTS_TABLE=AUTHORING_COMPONENTS_TABLE,
        AUTHORING_KSB_MAPPINGS_TABLE=AUTHORING_KSB_MAPPINGS_TABLE,
        AUTHORING_MODULES_TABLE=AUTHORING_MODULES_TABLE,
        AUTHORING_WEEKS_TABLE=AUTHORING_WEEKS_TABLE,
        COHORT_AUTHORING_DETAILS_TABLE=COHORT_AUTHORING_DETAILS_TABLE,
        GROUPS_TABLE=GROUPS_TABLE,
        authoring_delete=authoring_delete,
        authoring_fetch_all=authoring_fetch_all,
        authoring_table_name=authoring_table_name,
        clean_str=clean_str,
        curriculum_row_effectively_deleted=curriculum_row_effectively_deleted,
        logger=logger,
        safe_authoring_module_rows=safe_authoring_module_rows,
        update_authoring_rows=update_authoring_rows,
        update_group_fields=update_group_fields,
    )


def unassign_authoring_modules_from_group(group_id, keep_catalogue_ids=None):
    from curriculum_api.catalogue.infrastructure.hierarchy_writes import unassign_authoring_modules_from_group as implementation
    return implementation(
        group_id, keep_catalogue_ids, AUTHORING_MODULES_TABLE=AUTHORING_MODULES_TABLE,
        authoring_fetch_all=authoring_fetch_all, clean_str=clean_str,
        update_authoring_rows=update_authoring_rows,
    )


def resync_group_module_delivery_counts(previous_rows, delivery_updates):
    from curriculum_api.catalogue.application.hierarchy_commands import resync_group_module_delivery_counts as implementation
    return implementation(
        previous_rows, delivery_updates,
        AUTHORING_MODULES_TABLE=AUTHORING_MODULES_TABLE,
        AUTHORING_WEEKS_TABLE=AUTHORING_WEEKS_TABLE,
        active_week_rows=active_week_rows,
        authoring_fetch_all=authoring_fetch_all,
        clean_str=clean_str,
        datetime=datetime,
        delivery_days_per_week=delivery_days_per_week,
        format_date=format_date,
        module_calendar_end_date=module_calendar_end_date,
        parse_int=parse_int,
        update_authoring_rows=update_authoring_rows,
    )
