"""Canonical read access for the separated Free Course curriculum.

Free Course ownership exists only in these relations::

    free_courses -> free_course_weeks -> free_programme_components

The optional ``legacy_copied_from_week_id`` is provenance.  It is never used
to join to, or infer ownership from, the normal ``curriculum.weeks`` table.
This module is deliberately read-only; Phase A must not alter authoring or
quiz-link writers.
"""
from __future__ import annotations

from django.db import connection

from . import schema_gate


FREE_COURSES_TABLE = "free_courses"
FREE_COURSE_WEEKS_TABLE = "free_course_weeks"
FREE_COMPONENTS_TABLE = "free_programme_components"

COURSE_COLUMNS = (
    "id", "course_name", "description", "display_order", "component_count",
    "total_otjh", "created_at", "updated_at", "cover_image_url", "week_count",
    "course_type", "is_for_sale", "price", "currency",
)
WEEK_COLUMNS = (
    "id", "course_id", "display_order", "component_count", "total_otjh",
    "created_at", "updated_at", "week_number", "title", "summary",
    "learning_outcomes", "status", "holiday_note_enabled", "holiday_note",
    "legacy_copied_from_week_id",
)
COMPONENT_COLUMNS = (
    "id", "free_module_id", "programme_id", "type", "title", "description",
    "expected_otjh", "points", "reflection_required",
    "workplace_evidence_required", "tutor_validation_required", "display_order",
    "settings_json", "created_at", "updated_at",
)

TABLE_COLUMNS = {
    FREE_COURSES_TABLE: COURSE_COLUMNS,
    FREE_COURSE_WEEKS_TABLE: WEEK_COLUMNS,
    FREE_COMPONENTS_TABLE: COMPONENT_COLUMNS,
}


def _quote_ident(value):
    return '"' + str(value).replace('"', '""') + '"'


def _table_name(table):
    if connection.vendor == "postgresql":
        return f'{_quote_ident(schema_gate.CURRICULUM_SCHEMA)}.{_quote_ident(table)}'
    return _quote_ident(table)


def _rows(cursor):
    columns = [item[0] for item in cursor.description or ()]
    return [dict(zip(columns, row)) for row in cursor.fetchall()]


def _select(table, *, columns=None, clauses=(), params=(), order_by=()):
    """Select real columns from one canonical Free Course table.

    ``clauses`` and ``order_by`` are fixed internal fragments supplied only by
    the narrow selectors below.  Callers provide values separately in
    ``params``; no request value becomes SQL text.
    """
    if table not in TABLE_COLUMNS:
        raise ValueError(f"Unsupported Free Course table: {table}")
    available = set(TABLE_COLUMNS[table])
    selected = tuple(columns or TABLE_COLUMNS[table])
    unknown = [column for column in selected if column not in available]
    if unknown:
        raise ValueError(
            f"Unsupported columns for {table}: {', '.join(sorted(unknown))}"
        )

    schema_gate.require_tables(table)
    sql = (
        f"select {', '.join(_quote_ident(column) for column in selected)} "
        f"from {_table_name(table)}"
    )
    if clauses:
        sql += " where " + " and ".join(clauses)
    if order_by:
        sql += " order by " + ", ".join(_quote_ident(column) for column in order_by)
    with connection.cursor() as cursor:
        cursor.execute(sql, list(params))
        return _rows(cursor)


def _in_filter(column, values):
    values = list(dict.fromkeys(str(value) for value in values if value is not None and str(value)))
    if not values:
        return None, []
    placeholders = ", ".join(["%s"] * len(values))
    return f"{_quote_ident(column)} in ({placeholders})", values


def courses(*, course_ids=None, columns=None):
    clauses, params = [], []
    if course_ids is not None:
        clause, params = _in_filter("id", course_ids)
        if clause is None:
            return []
        clauses.append(clause)
    return _select(
        FREE_COURSES_TABLE,
        columns=columns,
        clauses=clauses,
        params=params,
        order_by=("display_order", "course_name", "id"),
    )


def weeks(*, course_ids=None, week_ids=None, columns=None):
    clauses, params = [], []
    for column, values in (("course_id", course_ids), ("id", week_ids)):
        if values is None:
            continue
        clause, values = _in_filter(column, values)
        if clause is None:
            return []
        clauses.append(clause)
        params.extend(values)
    return _select(
        FREE_COURSE_WEEKS_TABLE,
        columns=columns,
        clauses=clauses,
        params=params,
        order_by=("display_order", "week_number", "id"),
    )


def components(*, week_ids=None, programme_id=None, columns=None):
    clauses, params = [], []
    if week_ids is not None:
        clause, values = _in_filter("free_module_id", week_ids)
        if clause is None:
            return []
        clauses.append(clause)
        params.extend(values)
    if programme_id is not None:
        clauses.append(f"{_quote_ident('programme_id')} = %s")
        params.append(str(programme_id))
    return _select(
        FREE_COMPONENTS_TABLE,
        columns=columns,
        clauses=clauses,
        params=params,
        order_by=("display_order", "title", "id"),
    )


def week_api_identity(row):
    """Add canonical identity and explicit legacy compatibility fields."""
    canonical = str((row or {}).get("id") or "").strip()
    provenance = str((row or {}).get("legacy_copied_from_week_id") or "").strip()
    return {
        "freeCourseWeekId": canonical,
        # Backward compatibility only: this retains the old source-week role;
        # it is never the canonical Free Course week identity.
        "weekId": provenance,
        "legacyCopiedFromWeekId": provenance or None,
    }
