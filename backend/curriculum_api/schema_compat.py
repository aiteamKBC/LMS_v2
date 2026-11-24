"""Bridge between the curriculum code and the normalised curriculum schema.

The cleaned database branch (``NEW_ENDPOINT_URL``) normalised ``curriculum``:

* soft-delete stamps (``deleted_at``, ``deleted_by``, ``deleted_via_parent``,
  ``is_programme_deleted``, ``is_archived``, ``is_active``) collapsed into one
  ``status`` column -- ``active`` / ``inactive`` (cohorts also ``planned``);
* copied names and id lists (``programme_name``, ``cohort_name``,
  ``group_name``, ``tutor_name``/``tutor_email``, ``coach_name``,
  ``module_ids``, ``group_ids``, ``assigned_*_ids`` ...) were dropped in favour
  of keys: ``modules.tutor_id -> tutors``, ``group_coaches -> groups, coaches`` (a group may have several);
* ``ksb_mappings`` keeps ``component_id`` + ``ksb_id`` and points at
  ``standard_ksbs`` (``standard_ksb_id``) for the code and description; its
  module and week come from the component, and ``components.ksb_mappings``
  (the JSON copy) is gone;
* cohort holiday choices live in ``cohort_calendar_holidays``.

Agreed behaviour (2026-11-07): archive/delete == ``status = 'inactive'``,
restore == ``'active'``. Who/when and "archived along with its parent" are no
longer recorded, so a restore cannot tell a cascade from a standalone archive.

Everything here is conditional on the table's actual columns: on a database
that still has the legacy columns nothing is projected or translated, so the
old schema keeps behaving exactly as before.

What the curriculum now does natively, and so is no longer here:
``curriculum_names`` (names, child lists and a cohort's holiday choices put on
rows by key; the chosen tutor/coach written as its id), ``calendar_holidays``
(the holiday calendar, the GOV.UK mirror and cohort choices) and
``ksb_mapping_placement`` (mappings scoped and read through their component).
Placement labels are also projected by FK for SQL filtering and ordering.
Writes are shaped natively too (``write_shape``: status values, blank keys,
the standard KSB a mapping carries). What remains: the lifecycle columns
derived from ``status``, the KSB mapping / component read shapes, and
``adapt_sql`` -- which hand-written statements still need, chiefly the Learner
team's code curriculum calls.
"""
from __future__ import annotations

import re
import threading
import time
from datetime import datetime, timezone

from django.db import connection

# Compatibility exports: schema-shape values and pure rules have one owner.
from .catalogue.infrastructure.schema_contracts import (
    LIFECYCLE_TABLES,
    LEGACY_LIFECYCLE_COLUMNS,
    INACTIVE,
    ACTIVE,
    INACTIVE_STATUSES,
    _EPOCH,
    DERIVED_COLUMNS,
    RELATION_TABLES,
    uses_status_lifecycle,
    is_normalised,
    inactive_condition,
    active_condition,
    status_is_inactive,
    LEGACY_LIFECYCLE_BY_TABLE,
    _lifecycle_select,
    _LINKED_FREE_WEEK_FIELDS,
    _linked_free_week_shape,
    PYTHON_DERIVED_COLUMNS,
    _lifecycle_fields,
    _wanted,
)

class UnsupportedOnNormalisedSchema(ValueError):
    """A legacy-only operation was asked of the normalised schema."""


def _qualified(table):
    from .catalogue.infrastructure.schema_relations import _qualified as read
    return read(
        table, connection=connection,
    )


def _internal(table):
    from .catalogue.infrastructure.schema_relations import _internal as read
    return read(
        table, connection=connection,
    )


# --- read relation ------------------------------------------------------------
# For reads, a normalised table is selected through a derived relation that
# carries the legacy columns as SQL expressions, aliased with the table's own
# name. Every caller's where/order/column list that names a legacy column then
# keeps working unchanged. Writes never use it (a derived table is not
# updatable); the curriculum writes the real table natively (write_shape).

def legacy_read_columns(table, columns):
    from .catalogue.infrastructure.schema_relations import legacy_read_columns as read
    return read(
        table, columns, DERIVED_COLUMNS=DERIVED_COLUMNS, RELATION_TABLES=RELATION_TABLES,
        _LINKED_FREE_WEEK_FIELDS=_LINKED_FREE_WEEK_FIELDS, _lifecycle_select=_lifecycle_select,
        _linked_free_week_shape=_linked_free_week_shape, connection=connection, is_normalised=is_normalised,
    )


_COLUMNS_CACHE = {}


def columns_of(schema, table):
    def read_curriculum_columns(table):
        from .catalogue.infrastructure.database_reads import column_names
        return column_names(table)
    from .catalogue.infrastructure.schema_relations import columns_of as read
    return read(
        schema, table, _COLUMNS_CACHE=_COLUMNS_CACHE, connection=connection,
        read_curriculum_columns=read_curriculum_columns,
    )


def relation_sql(table):
    from .catalogue.infrastructure.schema_relations import relation_sql as read
    return read(
        table, _qualified=_qualified, columns_of=columns_of, read_relation=read_relation,
    )


_TABLE_REF = re.compile(
    r'(?P<kw>\b(?:from|join)\s+)(?P<ref>(?:"curriculum"|curriculum)\s*\.\s*(?:"(?P<qt>[a-z_]+)"|(?P<t>[a-z_]+)\b))',
    re.IGNORECASE,
)
_LOCKING = re.compile(r'\bfor\s+(?:no\s+key\s+)?(?:update|share)\b', re.IGNORECASE)
_ADAPTED = {}


def adapt_sql(sql):
    from .catalogue.infrastructure.sql_compatibility import adapt_sql as read
    return read(
        sql, RELATION_TABLES=RELATION_TABLES, _ADAPTED=_ADAPTED, _CLAUSE_WORDS=_CLAUSE_WORDS, _LOCKING=_LOCKING,
        _NEXT_WORD=_NEXT_WORD, _TABLE_REF=_TABLE_REF, columns_of=columns_of, connection=connection,
        legacy_read_columns=legacy_read_columns, re=re, read_relation=read_relation,
    )


_NEXT_WORD = re.compile(r'\s*(?:as\s+)?("?[A-Za-z_][A-Za-z0-9_]*"?)?')
_CLAUSE_WORDS = {
    'where', 'join', 'left', 'right', 'inner', 'full', 'cross', 'natural', 'on', 'using', 'order', 'group',
    'limit', 'offset', 'union', 'intersect', 'except', 'having', 'window', 'fetch', 'for', 'returning', 'set',
}


def _sql_adapter(execute, sql, params, many, context):
    return execute(adapt_sql(sql), params, many, context)


class adapted_reads:
    """``with adapted_reads(): ...`` -- ``adapt_sql`` for work outside a request
    (background workers, management commands) on ``default`` and ``enrolment``."""

    def __enter__(self):
        from contextlib import ExitStack
        self._stack = ExitStack()
        try:
            from django.db import connections
            databases = connections.databases
        except Exception:
            return self  # no real connection handler (e.g. a test double): no-op
        if not isinstance(databases, dict):
            return self
        for alias in ('default', 'enrolment'):
            if alias in databases:
                self._stack.enter_context(connections[alias].execute_wrapper(_sql_adapter))
        return self

    def __exit__(self, *exc):
        return self._stack.__exit__(*exc)


class CurriculumSchemaCompatMiddleware:
    """Route hand-written reads of ``/curriculum_api/`` requests through ``adapt_sql``.

    Temporary, for the Learner team's code called inside a curriculum request
    (see ``adapt_sql``).

    Scoped to curriculum requests and to the two aliases curriculum reads
    (``default``, ``enrolment``). A no-op on the legacy schema, where no table
    is normalised and ``adapt_sql`` returns every statement unchanged.
    """

    PREFIX = '/curriculum_api/'

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if not request.path_info.startswith(self.PREFIX):
            return self.get_response(request)
        from contextlib import ExitStack
        from django.db import connections
        with ExitStack() as stack:
            for alias in ('default', 'enrolment'):
                if alias in connections.databases:
                    stack.enter_context(connections[alias].execute_wrapper(_sql_adapter))
            return self.get_response(request)


# Legacy columns a curriculum read can leave out of its SQL because
# project_rows() supplies them after the fetch. ``ksb_description`` is the
# standard KSB's text, repeated on every mapping row -- 2.5 MB of the 6 MB a
# programme's mapping read moved -- for 235 distinct rows.
# Only authoring_select_sql defers; hand-written SQL (relation_sql/adapt_sql,
# the Learner team's reads) still gets the column from the relation.


def read_relation(table, columns, alias=True, defer=()):
    from .catalogue.infrastructure.schema_relations import read_relation as read
    return read(
        table, columns, alias, defer, DERIVED_COLUMNS=DERIVED_COLUMNS, RELATION_TABLES=RELATION_TABLES,
        _LINKED_FREE_WEEK_FIELDS=_LINKED_FREE_WEEK_FIELDS, _internal=_internal,
        _lifecycle_select=_lifecycle_select, _linked_free_week_shape=_linked_free_week_shape,
        connection=connection, is_normalised=is_normalised,
    )


def invalidate():
    from . import curriculum_names
    curriculum_names.invalidate()


# --- read projection ----------------------------------------------------------


def project_rows(table, rows, columns, *, requested=None, excluded=None):
    from .catalogue.infrastructure.schema_projection import project_rows as read
    return read(
        table, rows, columns, requested=requested, excluded=excluded, DERIVED_COLUMNS=DERIVED_COLUMNS,
        RELATION_TABLES=RELATION_TABLES, _lifecycle_fields=_lifecycle_fields,
        _project_components=_project_components, _project_ksb_mappings=_project_ksb_mappings, _wanted=_wanted,
        is_normalised=is_normalised, uses_status_lifecycle=uses_status_lifecycle,
    )


def _chunks(values, size=2000):
    values = list(values)
    for start in range(0, len(values), size):
        yield values[start:start + size]


# standard_ksbs ids -> (code, description), as last read. Reference data:
# changed only by a manual Skills England import, which the curriculum cache
# already lets lag by up to 60 s (views.coverage_entry), so this lags no more.
STANDARD_TEXTS_TTL_SECONDS = 60
_STANDARD_TEXTS = {'read_at': 0.0, 'rows': {}}
_STANDARD_TEXTS_LOCK = threading.Lock()


def standard_ksb_texts(standard_ids):
    from .catalogue.infrastructure.schema_projection import standard_ksb_texts as read
    return read(
        standard_ids, STANDARD_TEXTS_TTL_SECONDS=STANDARD_TEXTS_TTL_SECONDS, _STANDARD_TEXTS=_STANDARD_TEXTS,
        _STANDARD_TEXTS_LOCK=_STANDARD_TEXTS_LOCK, _chunks=_chunks, _internal=_internal, connection=connection,
        time=time,
    )


def reset_standard_ksb_texts():
    with _STANDARD_TEXTS_LOCK:
        _STANDARD_TEXTS.update(read_at=0.0, rows={})


def _project_ksb_mappings(rows, derived):
    from .catalogue.infrastructure.schema_projection import _project_ksb_mappings as read
    return read(
        rows, derived, _chunks=_chunks, _internal=_internal, connection=connection,
        standard_ksb_texts=standard_ksb_texts,
    )


def component_mapping_items(component_ids):
    from .catalogue.infrastructure.schema_projection import component_mapping_items as read
    return read(
        component_ids, _chunks=_chunks, _internal=_internal, active_condition=active_condition,
        connection=connection,
    )


def _project_components(rows, derived):
    from .catalogue.infrastructure.schema_projection import _project_components as read
    return read(
        rows, derived, component_mapping_items=component_mapping_items,
    )
