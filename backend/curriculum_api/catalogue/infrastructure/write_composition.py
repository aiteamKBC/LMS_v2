"""Concrete catalogue / infrastructure / write composition capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""
from curriculum_api import calendar_holidays
from curriculum_api import curriculum_names
from curriculum_api import group_coaches
from curriculum_api import versioning
from curriculum_api.catalogue.infrastructure.authoring_runtime import authoring_fetch_all
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import COHORT_AUTHORING_DETAILS_TABLE
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import GROUPS_TABLE
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import ensure_module_authoring_tables
from curriculum_api.catalogue.infrastructure.course_schema_runtime import ensure_free_programme_tables
from curriculum_api.catalogue.infrastructure.database_reads import authoring_table_name
from curriculum_api.catalogue.infrastructure.database_reads import rows_as_dicts
from curriculum_api.catalogue.infrastructure.database_reads import table_name
from curriculum_api.catalogue.infrastructure.row_queries import execute_returning
from curriculum_api.catalogue.infrastructure.runtime_config import logger
from curriculum_api.catalogue.infrastructure.structure_runtime import written_rows
from curriculum_api.catalogue.infrastructure.free_course_writer_mode import LEGACY
from curriculum_api.catalogue.infrastructure.free_course_writer_mode import require_mode
from django.db import connection


def note_live_rows(table, rows):
    from curriculum_api.catalogue.infrastructure.write_notifications import note_live_rows as implementation
    def load_content_cache():
        from curriculum_api import content_cache as operation
        return operation
    def note_rows(*args, **kwargs):
        from curriculum_api.catalogue.infrastructure.module_epochs import note_rows as operation
        return operation(*args, **kwargs)
    return implementation(
        table, rows, curriculum_names=curriculum_names, load_content_cache=load_content_cache,
        logger=logger, note_rows=note_rows,
    )


def delete_rows(table, where_sql, where_params):
    from curriculum_api.catalogue.infrastructure.lifecycle_writes import delete_rows as implementation
    return implementation(
        table, where_sql, where_params,
        GROUPS_TABLE=GROUPS_TABLE,
        execute_returning=execute_returning,
        group_coaches=group_coaches,
        note_live_rows=note_live_rows,
        table_name=table_name,
        versioning=versioning,
        written_rows=written_rows,
    )


def authoring_delete(table, where_sql='1 = 1', params=None):
    from curriculum_api.catalogue.infrastructure.lifecycle_writes import authoring_delete as implementation
    return implementation(
        table, where_sql, params,
        COHORT_AUTHORING_DETAILS_TABLE=COHORT_AUTHORING_DETAILS_TABLE,
        GROUPS_TABLE=GROUPS_TABLE,
        authoring_fetch_all=authoring_fetch_all,
        authoring_table_name=authoring_table_name,
        calendar_holidays=calendar_holidays,
        connection=connection,
        ensure_module_authoring_tables=ensure_module_authoring_tables,
        group_coaches=group_coaches,
        note_live_rows=note_live_rows,
        rows_as_dicts=rows_as_dicts,
        versioning=versioning,
        written_rows=written_rows,
    )


def free_programme_delete(table, where_sql, params=None):
    require_mode(LEGACY)
    ensure_free_programme_tables()
    with connection.cursor() as cursor:
        cursor.execute(f'delete from {authoring_table_name(table)} where {where_sql}', params or [])
