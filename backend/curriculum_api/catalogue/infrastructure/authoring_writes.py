"""Authoring row persistence: normalization, conflict updates, bulk writes and revision notifications.

Explicit capabilities preserve existing caller contracts during migration.
No views, settings or provider runtime is imported here.
"""


def authoring_upsert(
    table,
    key_columns,
    payload,
    allow_null_columns=None,
    *,
    AUTHORING_MODULES_TABLE,
    COHORT_AUTHORING_DETAILS_TABLE,
    GROUPS_TABLE,
    LIVE_SESSION_OCCURRENCES_TABLE,
    SOFT_DELETE_COLUMNS,
    authoring_fetch_all,
    authoring_table_name,
    calendar_holidays,
    clean_str,
    column_names,
    connection,
    curriculum_names,
    datetime,
    ensure_module_authoring_tables,
    group_coaches,
    log_curriculum_storage,
    note_live_rows,
    note_previous_content_modules,
    quote_ident,
    rows_as_dicts,
    save_free_row,
    versioning,
    write_shape,
    written_rows,
):
    """Insert-or-update one authoring row.

    ``None`` normally means "leave this column alone", which is what every
    caller that builds a partial payload relies on. ``allow_null_columns``
    opts specific columns out of that rule so a value can be cleared — mirroring
    the same argument on ``update_rows``.
    """
    ensure_module_authoring_tables()
    writable = column_names(table)
    payload, staff_nullable = curriculum_names.store_staff(table, payload, writable)
    payload, shaped_nullable = write_shape.normalise(table, payload, writable)
    nullable = set(SOFT_DELETE_COLUMNS) | set(allow_null_columns or ()) | shaped_nullable | staff_nullable
    values = {
        key: value
        for key, value in payload.items()
        if key in writable and (value is not None or key in nullable)
    }
    values['updated_at'] = datetime.utcnow()
    if 'created_at' not in values:
        values['created_at'] = datetime.utcnow()
    independent = save_free_row(table, values)
    if independent is not None:
        versioning.record_rows(table, [independent])
        note_live_rows(table, [independent])
        return independent
    columns = list(values.keys())
    placeholders = ', '.join(['%s'] * len(columns))
    update_columns = [column for column in columns if column not in set(key_columns) | {'created_at'}]
    if connection.vendor == 'postgresql' or table in (AUTHORING_MODULES_TABLE, LIVE_SESSION_OCCURRENCES_TABLE):
        # REPLACE deletes the old SQLite row, cascading away the module's
        # calendar or the occurrence's attendance. These identities must survive edits.
        conflict = ', '.join(quote_ident(column) for column in key_columns)
        assignments = ', '.join(f'{quote_ident(column)} = excluded.{quote_ident(column)}' for column in update_columns)
        query = (
            f'insert into {authoring_table_name(table)} ({", ".join(quote_ident(column) for column in columns)}) '
            f'values ({placeholders}) on conflict ({conflict}) do update set {assignments}'
            + (' returning *' if connection.vendor == 'postgresql' else '')
        )
    else:
        query = (
            f'insert or replace into {authoring_table_name(table)} ({", ".join(quote_ident(column) for column in columns)}) '
            f'values ({placeholders})'
        )
    key_value = ' '.join(clean_str(values.get(column)) for column in key_columns)
    note_previous_content_modules(table, key_columns=key_columns, payloads=[values])
    with connection.cursor() as cursor:
        cursor.execute(query, [values[column] for column in columns])
        if connection.vendor == 'postgresql':
            row = written_rows(table, rows_as_dicts(cursor))[0]
            if table == COHORT_AUTHORING_DETAILS_TABLE:
                # A cohort's holiday choices live in cohort_calendar_holidays.
                calendar_holidays.store_cohort_choices(payload, [row])
            if table == GROUPS_TABLE:
                # A group's coaches live in group_coaches.
                group_coaches.store(payload, [row])
            log_curriculum_storage('upsert', table, rows=1, entity_id=key_value)
            # The row the write returned is the snapshot, so history costs no
            # extra read of the record.
            versioning.record_rows(table, [row])
            note_live_rows(table, [row])
            return row
    where = ' and '.join(f'{quote_ident(column)} = %s' for column in key_columns)
    log_curriculum_storage('upsert', table, rows=1, entity_id=key_value)
    saved = authoring_fetch_all(table, where, [values[column] for column in key_columns])[0]
    versioning.record_rows(table, [saved])
    note_live_rows(table, [saved])
    return saved


def authoring_bulk_upsert(
    table,
    key_columns,
    payloads,
    batch_size=100,
    *,
    AUTHORING_KSB_MAPPINGS_TABLE,
    SOFT_DELETE_COLUMNS,
    authoring_table_name,
    column_names,
    connection,
    curriculum_names,
    datetime,
    ensure_module_authoring_tables,
    ksb_mapping_placement,
    log_curriculum_storage,
    note_live_rows,
    note_previous_content_modules,
    quote_ident,
    rows_as_dicts,
    save_free_row,
    versioning,
    write_shape,
    written_rows,
):
    ensure_module_authoring_tables()
    writable = column_names(table)
    translated = []
    for payload in payloads:
        if not payload:
            continue
        # The chosen tutor / coach is stored as its id (curriculum_names).
        payload, staff_nullable = curriculum_names.store_staff(table, payload, writable)
        payload, nullable = write_shape.normalise(table, payload, writable)
        translated.append((payload, nullable | staff_nullable))
    payloads = [
        {
            key: value
            for key, value in payload.items()
            if key in writable and (value is not None or key in SOFT_DELETE_COLUMNS or key in nullable)
        }
        for payload, nullable in translated
    ]
    payloads = [payload for payload in payloads if payload]
    if table == AUTHORING_KSB_MAPPINGS_TABLE and 'standard_ksb_id' in writable:
        # UNIQUE (component_id, standard_ksb_id): a re-added KSB reuses its row.
        payloads = ksb_mapping_placement.reuse_mapping_rows(payloads)
    note_previous_content_modules(table, key_columns=key_columns, payloads=payloads)
    if not payloads:
        return
    now = datetime.utcnow()
    ordinary, independent = [], []
    for payload in payloads:
        row = save_free_row(table, {'created_at': now, 'updated_at': now, **payload})
        if row is None:
            ordinary.append(payload)
        else:
            independent.append(row)
    if independent:
        versioning.record_rows(table, independent)
        note_live_rows(table, independent)
    payloads = ordinary
    if not payloads:
        return
    all_columns = []
    seen_columns = set()
    for payload in payloads:
        for column in payload.keys():
            if column not in seen_columns:
                all_columns.append(column)
                seen_columns.add(column)
    if 'updated_at' not in seen_columns:
        all_columns.append('updated_at')
        seen_columns.add('updated_at')
    if 'created_at' not in seen_columns:
        all_columns.append('created_at')
        seen_columns.add('created_at')
    update_columns = [column for column in all_columns if column not in set(key_columns) | {'created_at'}]
    quoted_columns = ', '.join(quote_ident(column) for column in all_columns)
    # One statement shape on both vendors. SQLite's `insert or replace` deleted
    # the old row and wrote a fresh `created_at`, so an edit could not be told
    # from a create; `on conflict ... do update` keeps the stored `created_at`
    # (it is never in `update_columns`), and SQLite has supported it and
    # `returning` since 3.24 / 3.35.
    conflict = ', '.join(quote_ident(column) for column in key_columns)
    assignments = ', '.join(f'{quote_ident(column)} = excluded.{quote_ident(column)}' for column in update_columns)
    row_placeholder = f'({", ".join(["%s"] * len(all_columns))})'
    prefix = f'insert into {authoring_table_name(table)} ({quoted_columns}) values '
    suffix = f' on conflict ({conflict}) do update set {assignments} returning *'
    saved = []
    with connection.cursor() as cursor:
        for start in range(0, len(payloads), batch_size):
            batch = payloads[start:start + batch_size]
            values = []
            for payload in batch:
                row = {key: value for key, value in payload.items()}
                row.setdefault('updated_at', now)
                row.setdefault('created_at', now)
                values.extend(row.get(column) for column in all_columns)
            placeholders = ', '.join([row_placeholder] * len(batch))
            cursor.execute(f'{prefix}{placeholders}{suffix}', values)
            saved.extend(written_rows(table, rows_as_dicts(cursor)))
    # Deliberately one line for the whole call, not one per row: a tree save
    # bulk-writes thousands of components and a per-row trace would bury
    # everything else in the request.
    log_curriculum_storage('bulk_upsert', table, rows=len(payloads))
    # The rows the statement returned are the snapshots, so history still costs
    # no extra read. They have to be the stored rows and not the payloads: only
    # the stored row carries the `created_at` / `updated_at` pair that tells a
    # record made by this save from one that predates history and is merely
    # being edited. The payloads carry neither, so every create read as "first
    # recorded". record_rows drops the rows whose content is unchanged, which
    # on this path is nearly all of them: a tree save rewrites every component
    # in the module whether or not the author touched it.
    versioning.record_rows(table, saved)
    note_live_rows(table, saved)


def update_authoring_rows(
    table,
    where_sql,
    where_params,
    payload,
    *,
    COHORT_AUTHORING_DETAILS_TABLE,
    GROUPS_TABLE,
    authoring_fetch_all,
    authoring_table_name,
    calendar_holidays,
    clean_str,
    column_names,
    connection,
    curriculum_names,
    ensure_module_authoring_tables,
    group_coaches,
    load_free_course_columns,
    log_curriculum_storage,
    native_only,
    note_live_rows,
    note_previous_content_modules,
    quote_ident,
    rows_as_dicts,
    update_free_rows,
    versioning,
    write_shape,
    written_rows,
):
    """Update rows in a ``curriculum`` schema authoring table and return them."""
    ensure_module_authoring_tables()
    real_columns = column_names(table)
    payload, _staff_nullable = curriculum_names.store_staff(table, payload, real_columns)
    payload, _nullable = write_shape.normalise(table, payload, real_columns)
    columns = [column for column in payload if column in real_columns]
    if not columns:
        rows = authoring_fetch_all(table, where_sql, where_params)
        if table == COHORT_AUTHORING_DETAILS_TABLE:
            calendar_holidays.store_cohort_choices(payload, rows)
        if table == GROUPS_TABLE:
            group_coaches.store(payload, rows)
        return rows
    assignments = ', '.join(f'{quote_ident(column)} = %s' for column in columns)
    params = [payload[column] for column in columns] + list(where_params)
    key_value = ' '.join(clean_str(value) for value in where_params)
    note_previous_content_modules(table, where_sql=where_sql, where_params=where_params,
                                  payloads=[{column: payload[column] for column in columns}])
    independent = update_free_rows(table, where_sql, where_params, {key: payload[key] for key in columns})
    if native_only():
        COLUMNS = load_free_course_columns()
        if table in COLUMNS:
            log_curriculum_storage('update', table, rows=independent, entity_id=key_value)
            versioning.record_rows(table, independent)
            note_live_rows(table, independent)
            return independent
    with connection.cursor() as cursor:
        if connection.vendor == 'postgresql':
            cursor.execute(
                f'update {authoring_table_name(table)} set {assignments} where {where_sql} returning *',
                params,
            )
            rows = written_rows(table, rows_as_dicts(cursor)) + independent
            if table == COHORT_AUTHORING_DETAILS_TABLE:
                calendar_holidays.store_cohort_choices(payload, rows)
            if table == GROUPS_TABLE:
                group_coaches.store(payload, rows)
            log_curriculum_storage('update', table, rows=rows, entity_id=key_value)
            versioning.record_rows(table, rows)
            note_live_rows(table, rows)
            return rows
        cursor.execute(
            f'update {authoring_table_name(table)} set {assignments} where {where_sql}',
            params,
        )
    rows = authoring_fetch_all(table, where_sql, where_params)
    log_curriculum_storage('update', table, rows=rows, entity_id=key_value)
    versioning.record_rows(table, rows)
    note_live_rows(table, rows)
    return rows
