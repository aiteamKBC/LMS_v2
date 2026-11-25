"""Concrete catalogue SQL/schema reads and their shared process caches.

No API imports or schema provisioning. Existing callers can still import the
same functions/cache objects from views while read adapters use this owner.
"""
from collections import defaultdict
from functools import partial
import logging
import threading
import time

from django.db import connection

from curriculum_api import schema_gate
from curriculum_api.catalogue.domain.values import clean_str
from .storage_context import native_only
from .cache_runtime import scoped_curriculum_read as _scoped_read, _scope_memo_key

scoped_curriculum_read = partial(_scoped_read, _scope_memo_key=_scope_memo_key, native_only=native_only)

logger = logging.getLogger('curriculum_api.views')

CURRICULUM_SCHEMA = 'curriculum'
_TABLE_COLUMNS_CACHE = {}
_TABLE_COLUMNS_LISTED = False
_TABLE_EXISTS_CACHE = {}
LEARNER_SCHEMA_COLUMNS_TTL_SECONDS = 300
_LEARNER_TABLES_PRESENT = set()
_LEARNER_RELATIONS_PRESENT = set()
_LEARNER_SCHEMA_COLUMNS = {}
_LEARNER_SCHEMA_LOCK = threading.Lock()
AUTHORING_MODULES_TABLE = 'modules'
AUTHORING_WEEKS_TABLE = 'weeks'
AUTHORING_COMPONENTS_TABLE = 'components'
AUTHORING_KSB_MAPPINGS_TABLE = 'ksb_mappings'
AUTHORING_COMPLETION_TABLE = 'module_completion_criteria'
AUTHORING_ADVANCED_TABLE = 'module_details'


def rows_as_dicts(cursor):
    columns = [col[0] for col in cursor.description]
    return [dict(zip(columns, row)) for row in cursor.fetchall()]


def fetch_all(query, params=None):
    with connection.cursor() as cursor:
        cursor.execute(query, params or [])
        return rows_as_dicts(cursor)


def quote_ident(value):
    return '"' + str(value).replace('"', '""') + '"'


def table_name(table):
    # PostgreSQL uses the dedicated ``curriculum`` schema; sqlite (tests) keeps
    # the tables in the default schema, so drop the schema qualifier there to
    # stay consistent with authoring_table_name().
    if connection.vendor != 'postgresql':
        return quote_ident(table)
    return f'{quote_ident(CURRICULUM_SCHEMA)}.{quote_ident(table)}'


def column_names(table):
    def free_course_columns():
        from curriculum_api.catalogue.infrastructure.free_course_contract import COLUMNS
        return COLUMNS
    def mark_columns_listed():
        global _TABLE_COLUMNS_LISTED
        _TABLE_COLUMNS_LISTED = True
    from .schema_reads import column_names as read
    return read(
        table, CURRICULUM_SCHEMA=CURRICULUM_SCHEMA, _TABLE_COLUMNS_CACHE=_TABLE_COLUMNS_CACHE,
        columns_listed=lambda: _TABLE_COLUMNS_LISTED, connection=connection, defaultdict=defaultdict,
        fetch_all=fetch_all, free_course_columns=free_course_columns, mark_columns_listed=mark_columns_listed,
        native_only=native_only, quote_ident=quote_ident,
    )


def has_column(table, column):
    return column in column_names(table)


def table_exists(table):
    from .schema_reads import table_exists as query
    return query(
        table, CURRICULUM_SCHEMA=CURRICULUM_SCHEMA, _TABLE_EXISTS_CACHE=_TABLE_EXISTS_CACHE, logger=logger,
        schema_gate=schema_gate,
    )


def authoring_table_name(table):
    if connection.vendor == 'postgresql':
        return table_name(table)
    return quote_ident(table)


def reset_learner_schema_cache():
    with _LEARNER_SCHEMA_LOCK:
        _LEARNER_TABLES_PRESENT.clear()
        _LEARNER_RELATIONS_PRESENT.clear()
        _LEARNER_SCHEMA_COLUMNS.clear()


@scoped_curriculum_read
def learner_schema_table_exists(table):
    from .schema_reads import learner_schema_table_exists as query
    return query(
        table, _LEARNER_SCHEMA_LOCK=_LEARNER_SCHEMA_LOCK, _LEARNER_TABLES_PRESENT=_LEARNER_TABLES_PRESENT,
        connection=connection,
    )


def learner_relation_exists(table):
    from .schema_reads import learner_relation_exists as query
    return query(
        table, _LEARNER_RELATIONS_PRESENT=_LEARNER_RELATIONS_PRESENT,
        _LEARNER_SCHEMA_LOCK=_LEARNER_SCHEMA_LOCK, connection=connection,
    )


@scoped_curriculum_read
def learner_schema_columns(table):
    from .schema_reads import learner_schema_columns as query
    return query(
        table, LEARNER_SCHEMA_COLUMNS_TTL_SECONDS=LEARNER_SCHEMA_COLUMNS_TTL_SECONDS,
        _LEARNER_SCHEMA_COLUMNS=_LEARNER_SCHEMA_COLUMNS, _LEARNER_SCHEMA_LOCK=_LEARNER_SCHEMA_LOCK,
        connection=connection, time=time,
    )


def curriculum_in_clause(column, values):
    """``column in (...)`` for a list of ids, or an empty clause when there are none."""
    values = [value for value in (values or []) if clean_str(value)]
    if not values:
        return '', []
    placeholders = ', '.join(['%s'] * len(values))
    return f'{quote_ident(column)} in ({placeholders})', values

