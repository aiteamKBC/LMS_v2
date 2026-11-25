"""Shared catalogue row shaping, SQL persistence and history ordering.

Dependencies are bound at the existing composition seam; no legacy views import.
"""


def filtered_payload(table, payload, allow_null_columns=None, *, column_names, curriculum_names, write_shape):
    allow_null_columns = set(allow_null_columns or [])
    columns = column_names(table)
    # The chosen tutor / coach is stored as its id (curriculum_names).
    payload, staff_nullable = curriculum_names.store_staff(table, payload, columns)
    # Status values, blank keys and a mapping's standard KSB, as the table stores them.
    payload, shaped_nullable = write_shape.normalise(table, payload, columns)
    allow_null_columns |= shaped_nullable | staff_nullable
    return {
        key: value
        for key, value in payload.items()
        if key in columns and (value is not None or key in allow_null_columns)
    }


def written_rows(table, rows, *, curriculum_names):
    """Rows a write returned, carrying the names a read gives them.

    The tables keep ids only; history snapshots and the callers that show the
    saved record read the module's programme / cohort / group / tutor names off
    the row, so they are put on it here exactly as authoring_fetch_all does.
    """
    return curriculum_names.attach(table, rows)


def insert_row(
    table, payload, *, CURRICULUM_SCHEMA, DatabaseError, _TABLE_COLUMNS_CACHE, execute_returning,
    filtered_payload, note_live_rows, quote_ident, table_name, versioning, written_rows,
):
    values = filtered_payload(table, payload)
    if not values:
        raise ValueError(f'No writable columns found for {table}.')
    columns = list(values.keys())
    placeholders = ', '.join(['%s'] * len(columns))
    query = (
        f'insert into {table_name(table)} '
        f'({", ".join(quote_ident(column) for column in columns)}) '
        f'values ({placeholders}) returning *'
    )
    try:
        row = written_rows(table, execute_returning(query, [values[column] for column in columns]))[0]
        # The created row is its own snapshot, so recording the create costs no
        # extra read. Without this a programme, a holiday or a week template
        # entered history only at its first EDIT, and "who created this?" -- the
        # first question anyone asks of an audit trail -- had no answer at all.
        versioning.record_rows(table, [row])
        note_live_rows(table, [row])
        return row
    except DatabaseError as exc:
        if 'no column named' not in str(exc).lower():
            raise
        _TABLE_COLUMNS_CACHE.pop(table, None)
        _TABLE_COLUMNS_CACHE.pop(f'{CURRICULUM_SCHEMA}.{table}', None)
        values = filtered_payload(table, payload)
        if not values:
            raise
        columns = list(values.keys())
        placeholders = ', '.join(['%s'] * len(columns))
        query = (
            f'insert into {table_name(table)} '
            f'({", ".join(quote_ident(column) for column in columns)}) '
            f'values ({placeholders}) returning *'
        )
        row = written_rows(table, execute_returning(query, [values[column] for column in columns]))[0]
        versioning.record_rows(table, [row])
        note_live_rows(table, [row])
        return row


def update_rows(
    table, where_sql, where_params, payload, allow_null_columns=None, *, execute_returning,
    filtered_payload, load_free_course_columns, native_only, note_live_rows,
    note_previous_content_modules, quote_ident, table_name, update_authoring_rows, versioning,
    written_rows,
):
    values = filtered_payload(table, payload, allow_null_columns=allow_null_columns)
    if not values:
        raise ValueError(f'No writable columns found for {table}.')
    if native_only():
        COLUMNS = load_free_course_columns()
        if table in COLUMNS:
            return update_authoring_rows(table, where_sql, where_params, values)
    assignments = ', '.join(f'{quote_ident(column)} = %s' for column in values)
    query = f'update {table_name(table)} set {assignments} where {where_sql} returning *'
    note_previous_content_modules(table, where_sql=where_sql, where_params=where_params, payloads=[values])
    rows = written_rows(table, execute_returning(query, [*values.values(), *where_params]))
    versioning.record_rows(table, rows)
    note_live_rows(table, rows)
    return rows
