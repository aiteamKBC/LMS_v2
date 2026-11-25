"""Concrete catalogue / infrastructure / free course persistence capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""
from curriculum_api.catalogue.domain.read_contracts import FREE_PROGRAMME_COMPONENTS_TABLE
from curriculum_api.catalogue.infrastructure.authoring_runtime import CURRICULUM_BATCHED_READS
from curriculum_api.catalogue.infrastructure.authoring_storage import authoring_upsert
from curriculum_api.catalogue.infrastructure.cache_access import scoped_curriculum_read
from curriculum_api.catalogue.infrastructure.course_schema_runtime import FREE_PROGRAMME_MODULES_TABLE
from curriculum_api.catalogue.infrastructure.course_schema_runtime import ensure_free_programme_tables
from curriculum_api.catalogue.infrastructure.database_reads import quote_ident
from curriculum_api.catalogue.infrastructure.database_reads import rows_as_dicts
from curriculum_api.catalogue.infrastructure.record_identity import unique_timestamp_prefixed_id
from curriculum_api.catalogue.infrastructure.free_course_writer_mode import LEGACY
from curriculum_api.catalogue.infrastructure.free_course_writer_mode import require_mode
from django.db import DatabaseError
from django.db import connection
import re


@scoped_curriculum_read
def free_programme_fetch_all(table, where_sql='', params=None, order_sql='', columns=None):
    from curriculum_api.catalogue.infrastructure.free_course_reads import free_programme_fetch_all as implementation
    return implementation(
        table, where_sql, params, order_sql, columns, connection=connection,
        free_programme_select_sql=free_programme_select_sql, rows_as_dicts=rows_as_dicts,
    )


def free_programme_select_sql(table, where_sql='', order_sql='', columns=None):
    from curriculum_api.catalogue.infrastructure.free_course_reads import free_programme_select_sql as implementation
    def free_read_table(*args, **kwargs):
        from curriculum_api.catalogue.infrastructure.course_storage_reads import free_read_table as capability
        return capability(*args, **kwargs)
    return implementation(
        table, where_sql, order_sql, columns, ensure_free_programme_tables=ensure_free_programme_tables,
        free_read_table=free_read_table, quote_ident=quote_ident,
    )


def free_programme_fetch_many(reads):
    from curriculum_api.catalogue.infrastructure.free_course_reads import free_programme_fetch_many as implementation
    return implementation(
        reads, CURRICULUM_BATCHED_READS=CURRICULUM_BATCHED_READS, DatabaseError=DatabaseError,
        connection=connection, free_programme_fetch_all=free_programme_fetch_all,
        free_programme_select_sql=free_programme_select_sql, rows_as_dicts=rows_as_dicts,
    )


def free_programme_upsert(table, key_columns, payload):
    require_mode(LEGACY)
    ensure_free_programme_tables()
    return authoring_upsert(table, key_columns, payload)


def free_programme_module_id(programme_id, module, index):
    from curriculum_api.catalogue.application.content_preparation import free_programme_module_id as implementation
    return implementation(
        programme_id,
        module,
        index,
        FREE_PROGRAMME_MODULES_TABLE=FREE_PROGRAMME_MODULES_TABLE,
        free_programme_fetch_all=free_programme_fetch_all,
        re=re,
        unique_timestamp_prefixed_id=unique_timestamp_prefixed_id,
    )


def free_programme_owned_ids(programme_id):
    from curriculum_api.catalogue.application.content_preparation import free_programme_owned_ids as implementation
    return implementation(
        programme_id,
        FREE_PROGRAMME_COMPONENTS_TABLE=FREE_PROGRAMME_COMPONENTS_TABLE,
        FREE_PROGRAMME_MODULES_TABLE=FREE_PROGRAMME_MODULES_TABLE,
        free_programme_fetch_all=free_programme_fetch_all,
    )
