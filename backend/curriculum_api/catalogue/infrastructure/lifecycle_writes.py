"""Schema-aware archive, restore and deletion adapters with existing revision and row-cache notifications.

Explicit capabilities are supplied at the existing views composition seam.
No legacy views, application settings or provider runtime is imported here.
"""


def delete_rows(
    table,
    where_sql,
    where_params,
    *,
    GROUPS_TABLE,
    execute_returning,
    group_coaches,
    note_live_rows,
    table_name,
    versioning,
    written_rows,
):
    if table == GROUPS_TABLE:
        # A group's coach links reference it (RESTRICT): they go with it.
        group_coaches.release_groups(where_sql, where_params)
    query = f'delete from {table_name(table)} where {where_sql} returning *'
    rows = written_rows(table, execute_returning(query, where_params))
    # Recorded from the rows the delete returned, which is the only moment the
    # content still exists. Querying the record afterwards finds nothing, and an
    # audit trail whose delete entry cannot say what was deleted is the one entry
    # that most needed to.
    versioning.record_deleted_rows(table, rows)
    note_live_rows(table, rows)
    return rows


def soft_delete_payload(
    table,
    *,
    via_parent='',
    deleted_by='system',
    extra=None,
    archive_state,
    clean_str,
    datetime,
):
    if archive_state.uses_status(table):
        # Normalised schema: status is the whole archive record. Who/why and the
        # parent it went with are written to history (see soft_delete_rows).
        return {**archive_state.archive_values(), **(extra or {})}
    payload = {
        'deleted_at': datetime.utcnow(),
        'deleted_by': clean_str(deleted_by) or 'system',
        # NULL, not '', when nothing above took this row down. Readers tell a
        # cascade from a standalone delete by this column, and an empty string
        # reads as "deleted via a parent" to any SQL using `IS NOT NULL` --
        # which kept individually-deleted content visible to assigned learners.
        'deleted_via_parent': clean_str(via_parent) or None,
        'updated_at': datetime.utcnow(),
        **(extra or {}),
    }
    return payload


def restore_soft_delete_payload(table, *, archive_state, datetime, has_column):
    if archive_state.uses_status(table):
        return archive_state.restore_values()
    payload = {'updated_at': datetime.utcnow()}
    if has_column(table, 'deleted_at'):
        payload['deleted_at'] = None
    if has_column(table, 'deleted_by'):
        payload['deleted_by'] = None
    if has_column(table, 'deleted_via_parent'):
        payload['deleted_via_parent'] = None
    return payload


def soft_delete_rows(
    table,
    where_sql,
    where_params=None,
    *,
    via_parent='',
    deleted_by='system',
    extra=None,
    archive_state,
    clean_str,
    column_names,
    has_column,
    log_curriculum_storage,
    quote_ident,
    soft_delete_payload,
    update_rows,
):
    payload = soft_delete_payload(table, via_parent=via_parent, deleted_by=deleted_by, extra=extra)
    if not any(column in column_names(table) for column in payload):
        return []
    active_checks = []
    if archive_state.uses_status(table):
        active_checks.append(archive_state.live_sql())
    if has_column(table, 'deleted_at'):
        active_checks.append(f'{quote_ident("deleted_at")} is null')
    if not active_checks:
        active_checks.append('1 = 1')
    guarded_where = f'({where_sql}) and (' + ' and '.join(active_checks) + ')'
    # `deleted_via_parent` is deliberately NULL for a standalone delete, and
    # filtered_payload drops None unless the column is allowed to be nulled --
    # without this the column would keep a stale value from an earlier cascade.
    # History records the reason and the parent this archive went with: the
    # normalised schema keeps neither on the row, and restore reads them back.
    with archive_state.archive_context(deleted_by, via_parent):
        rows = update_rows(table, guarded_where, where_params or [], payload,
                           allow_null_columns=['deleted_via_parent'])
    # Logged even when it matches nothing: a soft delete that hits zero rows is
    # almost always the interesting case (already archived, or wrong id).
    log_curriculum_storage(
        'soft_delete', table, rows=rows,
        entity_id=' '.join(clean_str(value) for value in (where_params or [])),
        parent_id=via_parent, reason=deleted_by,
    )
    # No record_rows here: this writes through update_rows, which already
    # recorded the revision. An archive is a revision like any other, and the
    # snapshot holds what the record contained at the moment it was withdrawn --
    # the whole reason to keep history of content that no longer appears.
    return rows


def restore_rows_via_parent(
    table,
    parent_id,
    bounds=None,
    *,
    RESTORE_NULLABLE_COLUMNS,
    archive_state,
    has_column,
    log_curriculum_storage,
    quote_ident,
    restore_soft_delete_payload,
    restore_status_rows_via_parent,
    update_rows,
):
    """Undo one soft-delete cascade, and only that one.

    Rows are matched on ``deleted_via_parent``, the marker
    ``soft_delete_programme_authoring_structure`` stamps on everything it takes
    down. A cohort archived on its own carries an empty marker, so restoring the
    programme leaves it archived rather than silently reviving it.

    ``bounds`` -- ``module_archive_event_bounds`` of the parent -- narrows the
    match to rows stamped in the same moment as the parent's own archive. Rows
    left stamped by an earlier archive of the same parent (one later undone by a
    save rather than a restore) are not part of this cascade and stay deleted.
    """
    if archive_state.uses_status(table):
        return restore_status_rows_via_parent(table, parent_id, bounds)
    if not has_column(table, 'deleted_via_parent'):
        return []
    payload = restore_soft_delete_payload(table)
    where_sql = f'{quote_ident("deleted_via_parent")} = %s'
    where_params = [parent_id]
    if bounds is not None and has_column(table, 'deleted_at'):
        where_sql += f' and {quote_ident("deleted_at")} between %s and %s'
        where_params += [bounds[0], bounds[1]]
    rows = update_rows(
        table,
        where_sql,
        where_params,
        payload,
        allow_null_columns=RESTORE_NULLABLE_COLUMNS,
    )
    log_curriculum_storage('restore', table, rows=rows, parent_id=parent_id)
    return rows


def restore_status_rows_via_parent(
    table,
    parent_id,
    bounds=None,
    *,
    LIFECYCLE_KEY_COLUMNS,
    archive_state,
    archived_rows_under,
    clean_str,
    log_curriculum_storage,
    quote_ident,
    update_rows,
):
    """``restore_rows_via_parent`` on the normalised schema: the rows history says went with the parent."""
    key = LIFECYCLE_KEY_COLUMNS[table]
    chosen = archive_state.archived_with(table, parent_id, archived_rows_under(table, parent_id), bounds, key_column=key)
    ids = [clean_str(row.get(key)) for row in chosen if clean_str(row.get(key))]
    rows = []
    for start in range(0, len(ids), 500):
        chunk = ids[start:start + 500]
        rows += update_rows(
            table, f'{quote_ident(key)} in ({", ".join(["%s"] * len(chunk))})', chunk, archive_state.restore_values(),
        )
    log_curriculum_storage('restore', table, rows=rows, parent_id=parent_id)
    return rows


def authoring_delete(
    table,
    where_sql='1 = 1',
    params=None,
    *,
    COHORT_AUTHORING_DETAILS_TABLE,
    GROUPS_TABLE,
    authoring_fetch_all,
    authoring_table_name,
    calendar_holidays,
    connection,
    ensure_module_authoring_tables,
    group_coaches,
    note_live_rows,
    rows_as_dicts,
    versioning,
    written_rows,
):
    """Hard-delete authoring rows, recording what they held before they went.

    ``returning *`` is asked for only when the table is one history covers, so
    the sweeps that clear rows nothing has ever pointed at do not pay to
    serialise them. On sqlite, which has no DELETE ... RETURNING, the rows are
    read back inside the same transaction first.
    """
    ensure_module_authoring_tables()
    if table == COHORT_AUTHORING_DETAILS_TABLE:
        # A cohort's holiday choices reference it (RESTRICT): they go with it.
        calendar_holidays.release_cohorts(where_sql, params)
    if table == GROUPS_TABLE:
        # A group's coach links reference it (RESTRICT): they go with it.
        group_coaches.release_groups(where_sql, params)
    versioned = table in versioning.VERSIONED_TABLES
    if not versioned:
        with connection.cursor() as cursor:
            cursor.execute(f'delete from {authoring_table_name(table)} where {where_sql}', params or [])
        return
    if connection.vendor == 'postgresql':
        with connection.cursor() as cursor:
            cursor.execute(
                f'delete from {authoring_table_name(table)} where {where_sql} returning *',
                params or [],
            )
            rows = written_rows(table, rows_as_dicts(cursor))
    else:
        rows = authoring_fetch_all(table, where_sql, params or [], ensure_tables=False)
        with connection.cursor() as cursor:
            cursor.execute(f'delete from {authoring_table_name(table)} where {where_sql}', params or [])
    versioning.record_deleted_rows(table, rows)
    note_live_rows(table, rows)


def update_authoring_delivery_rows(
    rows, status, *, TRAINING_MODULE_CATALOGUE_COLUMN, datetime, filtered_payload, quote_ident,
    table_exists, unique_row_values, update_rows,
):
    updates = []
    updated_at = datetime.utcnow()
    targets = [
        ('modules', 'module_catalogue_id', unique_row_values(rows, TRAINING_MODULE_CATALOGUE_COLUMN), {'status': status, 'updated_at': updated_at}),
        ('groups', 'group_id', unique_row_values(rows, 'group_id'), {'status': status, 'updated_at': updated_at}),
        ('cohorts', 'cohort_id', unique_row_values(rows, 'cohort_id'), {'status': status, 'updated_at': updated_at}),
    ]
    for table, key_column, ids, payload in targets:
        if not ids or not table_exists(table):
            continue
        placeholders = ', '.join(['%s'] * len(ids))
        values = filtered_payload(table, payload)
        if not values:
            continue
        updates.extend(update_rows(table, f'{quote_ident(key_column)} in ({placeholders})', ids, values))
    return updates
