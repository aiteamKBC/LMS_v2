"""Concrete catalogue / infrastructure / authoring storage capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""
from curriculum_api import calendar_holidays
from curriculum_api import curriculum_names
from curriculum_api import group_coaches
from curriculum_api import ksb_mapping_placement
from curriculum_api import versioning
from curriculum_api import write_shape
from curriculum_api.catalogue.domain.read_contracts import SOFT_DELETE_COLUMNS
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.infrastructure.authoring_runtime import authoring_fetch_all
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import COHORT_AUTHORING_DETAILS_TABLE
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import GROUPS_TABLE
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import ensure_module_authoring_tables
from curriculum_api.catalogue.infrastructure.cache_composition import log_curriculum_storage
from curriculum_api.catalogue.infrastructure.course_storage_reads import with_course_storage
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_KSB_MAPPINGS_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_MODULES_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import CURRICULUM_SCHEMA
from curriculum_api.catalogue.infrastructure.database_reads import _TABLE_COLUMNS_CACHE
from curriculum_api.catalogue.infrastructure.database_reads import authoring_table_name
from curriculum_api.catalogue.infrastructure.database_reads import column_names
from curriculum_api.catalogue.infrastructure.database_reads import quote_ident
from curriculum_api.catalogue.infrastructure.database_reads import rows_as_dicts
from curriculum_api.catalogue.infrastructure.database_reads import table_name
from curriculum_api.catalogue.infrastructure.row_queries import execute_returning
from curriculum_api.catalogue.infrastructure.storage_context import native_only
from curriculum_api.catalogue.infrastructure.structure_runtime import note_previous_content_modules
from curriculum_api.catalogue.infrastructure.structure_runtime import written_rows
from curriculum_api.catalogue.infrastructure.write_composition import note_live_rows
from curriculum_api.meetings.domain.read_contracts import LIVE_SESSION_OCCURRENCES_TABLE
from datetime import datetime
from django.db import DatabaseError
from django.db import connection


def filtered_payload(table, payload, allow_null_columns=None):
    from curriculum_api.catalogue.infrastructure.row_persistence import filtered_payload as implementation
    return implementation(
        table, payload, allow_null_columns, column_names=column_names,
        curriculum_names=curriculum_names, write_shape=write_shape,
    )


def insert_row(table, payload):
    from curriculum_api.catalogue.infrastructure.row_persistence import insert_row as implementation
    return implementation(
        table, payload, CURRICULUM_SCHEMA=CURRICULUM_SCHEMA, DatabaseError=DatabaseError,
        _TABLE_COLUMNS_CACHE=_TABLE_COLUMNS_CACHE, execute_returning=execute_returning,
        filtered_payload=filtered_payload, note_live_rows=note_live_rows, quote_ident=quote_ident,
        table_name=table_name, versioning=versioning, written_rows=written_rows,
    )


def update_rows(table, where_sql, where_params, payload, allow_null_columns=None):
    from curriculum_api.catalogue.infrastructure.row_persistence import update_rows as implementation
    def load_free_course_columns():
        from curriculum_api.catalogue.infrastructure.free_course_contract import COLUMNS as operation
        return operation
    return implementation(
        table, where_sql, where_params, payload, allow_null_columns,
        execute_returning=execute_returning, filtered_payload=filtered_payload,
        load_free_course_columns=load_free_course_columns, native_only=native_only,
        note_live_rows=note_live_rows, note_previous_content_modules=note_previous_content_modules,
        quote_ident=quote_ident, table_name=table_name, update_authoring_rows=update_authoring_rows,
        versioning=versioning, written_rows=written_rows,
    )


@with_course_storage
def authoring_upsert(table, key_columns, payload, allow_null_columns=None):
    from curriculum_api.catalogue.infrastructure.authoring_writes import authoring_upsert as implementation
    def save_free_row(*args, **kwargs):
        from curriculum_api.catalogue.infrastructure.course_storage_writes import upsert as operation
        return operation(*args, **kwargs)
    return implementation(
        table, key_columns, payload, allow_null_columns,
        AUTHORING_MODULES_TABLE=AUTHORING_MODULES_TABLE,
        COHORT_AUTHORING_DETAILS_TABLE=COHORT_AUTHORING_DETAILS_TABLE,
        GROUPS_TABLE=GROUPS_TABLE,
        LIVE_SESSION_OCCURRENCES_TABLE=LIVE_SESSION_OCCURRENCES_TABLE,
        SOFT_DELETE_COLUMNS=SOFT_DELETE_COLUMNS,
        authoring_fetch_all=authoring_fetch_all,
        authoring_table_name=authoring_table_name,
        calendar_holidays=calendar_holidays,
        clean_str=clean_str,
        column_names=column_names,
        connection=connection,
        curriculum_names=curriculum_names,
        datetime=datetime,
        ensure_module_authoring_tables=ensure_module_authoring_tables,
        group_coaches=group_coaches,
        log_curriculum_storage=log_curriculum_storage,
        note_live_rows=note_live_rows,
        note_previous_content_modules=note_previous_content_modules,
        quote_ident=quote_ident,
        rows_as_dicts=rows_as_dicts,
        save_free_row=save_free_row,
        versioning=versioning,
        write_shape=write_shape,
        written_rows=written_rows,
    )


@with_course_storage
def authoring_bulk_upsert(table, key_columns, payloads, batch_size=100):
    from curriculum_api.catalogue.infrastructure.authoring_writes import authoring_bulk_upsert as implementation
    def save_free_row(*args, **kwargs):
        from curriculum_api.catalogue.infrastructure.course_storage_writes import upsert as operation
        return operation(*args, **kwargs)
    return implementation(
        table, key_columns, payloads, batch_size,
        AUTHORING_KSB_MAPPINGS_TABLE=AUTHORING_KSB_MAPPINGS_TABLE,
        SOFT_DELETE_COLUMNS=SOFT_DELETE_COLUMNS,
        authoring_table_name=authoring_table_name,
        column_names=column_names,
        connection=connection,
        curriculum_names=curriculum_names,
        datetime=datetime,
        ensure_module_authoring_tables=ensure_module_authoring_tables,
        ksb_mapping_placement=ksb_mapping_placement,
        log_curriculum_storage=log_curriculum_storage,
        note_live_rows=note_live_rows,
        note_previous_content_modules=note_previous_content_modules,
        quote_ident=quote_ident,
        rows_as_dicts=rows_as_dicts,
        save_free_row=save_free_row,
        versioning=versioning,
        write_shape=write_shape,
        written_rows=written_rows,
    )


def update_authoring_rows(table, where_sql, where_params, payload):
    from curriculum_api.catalogue.infrastructure.authoring_writes import update_authoring_rows as implementation
    def update_free_rows(*args, **kwargs):
        from curriculum_api.catalogue.infrastructure.course_storage_writes import update as operation
        return operation(*args, **kwargs)
    def load_free_course_columns():
        from curriculum_api.catalogue.infrastructure.free_course_contract import COLUMNS as operation
        return operation
    return implementation(
        table, where_sql, where_params, payload,
        COHORT_AUTHORING_DETAILS_TABLE=COHORT_AUTHORING_DETAILS_TABLE,
        GROUPS_TABLE=GROUPS_TABLE,
        authoring_fetch_all=authoring_fetch_all,
        authoring_table_name=authoring_table_name,
        calendar_holidays=calendar_holidays,
        clean_str=clean_str,
        column_names=column_names,
        connection=connection,
        curriculum_names=curriculum_names,
        ensure_module_authoring_tables=ensure_module_authoring_tables,
        group_coaches=group_coaches,
        load_free_course_columns=load_free_course_columns,
        log_curriculum_storage=log_curriculum_storage,
        native_only=native_only,
        note_live_rows=note_live_rows,
        note_previous_content_modules=note_previous_content_modules,
        quote_ident=quote_ident,
        rows_as_dicts=rows_as_dicts,
        update_free_rows=update_free_rows,
        versioning=versioning,
        write_shape=write_shape,
        written_rows=written_rows,
    )
