"""Concrete catalogue / infrastructure / row queries capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""
from curriculum_api.catalogue.domain.read_contracts import MODULE_INDEX_EXCLUDED_COLUMNS
from curriculum_api.catalogue.application.read_errors import CatalogueReadUnavailable
from curriculum_api.catalogue.domain.read_contracts import MODULE_INDEX_ORDER
from curriculum_api.catalogue.infrastructure import runtime_state as cache_state
from curriculum_api.catalogue.infrastructure.authoring_runtime import authoring_fetch_all
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import COHORT_AUTHORING_DETAILS_TABLE
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import GROUPS_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_COMPONENTS_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_MODULES_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_WEEKS_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import authoring_table_name
from curriculum_api.catalogue.infrastructure.database_reads import fetch_all
from curriculum_api.catalogue.infrastructure.database_reads import has_column
from curriculum_api.catalogue.infrastructure.runtime_config import COHORT_ROWS_ORDER
from curriculum_api.catalogue.infrastructure.runtime_config import GROUP_ROWS_ORDER
from curriculum_api.catalogue.infrastructure.runtime_config import logger
from django.db import connection
import json


def execute_returning(query, params=None):
    return fetch_all(query, params)


def programme_config_key_column():
    for column in ('programme_id', 'id', 'program_id'):
        try:
            if has_column('programmes', column):
                return column
        except Exception:
            continue
    return 'programme_id'


def module_index_read(*, ensure_tables=True):
    """module_index_rows()'s authoring_fetch_all() call, as ``(args, kwargs)`` for a prefetch."""
    return ((AUTHORING_MODULES_TABLE,), {
        'order_sql': MODULE_INDEX_ORDER, 'ensure_tables': ensure_tables,
        'exclude_columns': MODULE_INDEX_EXCLUDED_COLUMNS,
    })


def module_index_rows(*, ensure_tables=True):
    args, kwargs = module_index_read(ensure_tables=ensure_tables)
    return authoring_fetch_all(*args, **kwargs)


def safe_module_index_rows():
    """Compatibility name for the required module-index reader."""
    return get_authoring_module_rows()


def authoring_rows_by_id(table, id_column, ids, order_sql, *, ensure_tables=True):
    from curriculum_api.catalogue.infrastructure.authoring_reads import authoring_rows_by_id as read
    return read(
        table,
        id_column,
        ids,
        order_sql,
        ensure_tables=ensure_tables,
        authoring_fetch_all=authoring_fetch_all,
    )


def training_index_reads(*, ensure_tables=True, modules=True, groups=True, cohorts=True):
    """The module, group and cohort reads the training rows are built from, as
    ``(args, kwargs)`` calls for prefetch_authoring_reads()."""
    return [
        *([module_index_read(ensure_tables=ensure_tables)] if modules else []),
        *([((GROUPS_TABLE,), {'order_sql': GROUP_ROWS_ORDER, 'ensure_tables': ensure_tables})] if groups else []),
        *([((COHORT_AUTHORING_DETAILS_TABLE,), {'order_sql': COHORT_ROWS_ORDER, 'ensure_tables': ensure_tables})]
          if cohorts else []),
    ]


def get_authoring_module_rows():
    try:
        return module_index_rows()
    except Exception as exc:
        raise CatalogueReadUnavailable('Module catalogue is unavailable. Please retry.') from exc


def training_row_where_ids(rows):
    ids = [row.get('id') for row in rows if row.get('id') is not None]
    if not ids:
        return None, []
    return f'id in ({", ".join(["%s"] * len(ids))})', ids


def safe_authoring_module_rows():
    try:
        return authoring_fetch_all(AUTHORING_MODULES_TABLE)
    except Exception as exc:
        raise CatalogueReadUnavailable('Module catalogue is unavailable. Please retry.') from exc


def json_db_value(value):
    return json.dumps(value if value is not None else [])


def authoring_child_rows_for_modules(table, module_ids, *, columns=None, exclude_columns=None):
    from curriculum_api.catalogue.infrastructure.scope_reads import authoring_child_rows_for_modules as read
    return read(
        table,
        module_ids,
        columns=columns,
        exclude_columns=exclude_columns,
        _CURRICULUM_READ_SCOPE=cache_state._CURRICULUM_READ_SCOPE,
        authoring_fetch_all=authoring_fetch_all,
    )


def week_scope_module_ids(week_id):
    from curriculum_api.catalogue.infrastructure.scope_reads import week_scope_module_ids as read
    return read(
        week_id,
        AUTHORING_COMPONENTS_TABLE=AUTHORING_COMPONENTS_TABLE,
        AUTHORING_WEEKS_TABLE=AUTHORING_WEEKS_TABLE,
        authoring_table_name=authoring_table_name,
        connection=connection,
    )
