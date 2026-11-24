"""Concrete catalogue read composition: source, guard, completion, batching and transport.

Existing request-local memo keys, native routing and schema-check timing are shared
by all callers. No API imports, service locator or alternative read implementation.
"""
import os
from . import placement_reads as curriculum_names
from .database_reads import (
    connection, scoped_curriculum_read, quote_ident, rows_as_dicts, authoring_table_name,
    AUTHORING_COMPONENTS_TABLE, AUTHORING_KSB_MAPPINGS_TABLE,
)
from .authoring_schema_runtime import ensure_module_authoring_tables
from .authoring_columns import REFLECTION_QUESTION_COLUMN

@scoped_curriculum_read
def authoring_fetch_all(table, where_sql='', params=None, order_sql='', *, ensure_tables=True, columns=None, exclude_columns=None):
    from .authoring_reads import authoring_fetch_all as read
    return read(
        table, where_sql, params, order_sql, ensure_tables=ensure_tables, columns=columns, exclude_columns=exclude_columns,
        authoring_select_sql=authoring_select_sql,
        complete_authoring_rows=complete_authoring_rows,
    )


def complete_authoring_rows(table, rows, columns=None, exclude_columns=None):
    from .authoring_reads import complete_authoring_rows as read
    return read(
        table, rows, columns, exclude_columns,
        AUTHORING_COMPONENTS_TABLE=AUTHORING_COMPONENTS_TABLE,
        AUTHORING_KSB_MAPPINGS_TABLE=AUTHORING_KSB_MAPPINGS_TABLE,
        attach_curriculum_names=curriculum_names.attach,
    )


def authoring_select_sql(table, where_sql='', order_sql='', *, ensure_tables=True, columns=None, exclude_columns=None):
    if ensure_tables:
        ensure_module_authoring_tables()
    from .authoring_sql import authoring_select_sql as read
    return read(
        table, where_sql, order_sql, columns=columns, exclude_columns=exclude_columns,
        learning_read_table=learning_read_table,
    )


def learning_read_table(table):
    from .learning_read_routes import read_table
    return read_table(table)


CURRICULUM_BATCHED_READS = os.environ.get('CURRICULUM_BATCHED_READS', 'true').lower() not in {'false', '0', 'no'}


def prefetch_authoring_reads(calls):
    from .authoring_reads import prefetch_authoring_reads as read
    return read(
        calls,
        CURRICULUM_BATCHED_READS=CURRICULUM_BATCHED_READS,
        authoring_fetch_all=authoring_fetch_all,
        authoring_select_sql=authoring_select_sql,
        complete_authoring_rows=complete_authoring_rows,
    )


def _read_source(table):
    from .ksb_read_store import read_source

    source = learning_read_table(table)
    # Preserve native/free-course routing. Only a physical normalized mapping
    # table needs its existing component/standard projection; it has no stored
    # module/week/code/description columns of its own.
    if table == AUTHORING_KSB_MAPPINGS_TABLE and source == authoring_table_name(table):
        return read_source(table)
    return source


def compact_authoring_rows(table, where_sql, params, order_sql, *, columns=None, reuse_unchanged=False):
    from .ksb_read_store import read_columns
    from .authoring_transport import compact_authoring_rows as read

    if connection.vendor != 'postgresql':
        return authoring_fetch_all(table, where_sql, params, order_sql, columns=columns)
    ensure_module_authoring_tables()
    return read(
        table, where_sql, params, order_sql, columns=columns, reuse_unchanged=reuse_unchanged,
        available=read_columns(table), connection=connection,
        authoring_fetch_all=authoring_fetch_all, read_source=_read_source,
        quote_ident=quote_ident, rows_as_dicts=rows_as_dicts,
        reflection_question_column=REFLECTION_QUESTION_COLUMN,
    )


def _compact_rows(table, where_sql, params, order_sql, selected, *, fingerprint_sql=None):
    from .authoring_transport import _compact_rows as read

    return read(
        table, where_sql, params, order_sql, selected, fingerprint_sql=fingerprint_sql,
        connection=connection, authoring_fetch_all=authoring_fetch_all,
        read_source=_read_source, quote_ident=quote_ident, rows_as_dicts=rows_as_dicts,
        reflection_question_column=REFLECTION_QUESTION_COLUMN,
    )
