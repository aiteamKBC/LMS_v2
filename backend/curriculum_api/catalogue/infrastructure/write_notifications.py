"""Write notifications and retirement of content belonging to moved rows.

Dependencies are bound at the existing composition seam; no legacy views import.
"""


def note_live_rows(table, rows, *, curriculum_names, load_content_cache, logger, note_rows):
    """Tell Module Builder live sync which module/group these rows belong to.

    Called beside every history record in the write helpers below, from the
    rows the write itself returned, so it costs no query. See module_live.
    """
    # Names/ids derived for the normalised schema must reflect this write --
    # but only a write to a table they are read from can change them.
    curriculum_names.invalidate_for(table)
    try:
        note_rows(table, rows)
    except Exception:
        logger.debug('Unable to note a write for live sync.', exc_info=True)
    if str(table or '').split('.')[-1].strip('"') == 'modules':
        try:
            from curriculum_api.bunny_module_collections import queue_module
            for row in rows:
                queue_module(row)
        except Exception as failure:
            # The scheduled collection scanner recovers an interrupted save hook.
            logger.warning('Module live collection queue needs recovery (%s).', type(failure).__name__)
    # Learner content entries of these rows' modules (never raises; on any
    # doubt it retires all modules).
    content_cache = load_content_cache()
    content_cache.note_rows(table, rows)


def note_previous_content_modules(
    table, *, where_sql=None, where_params=None, key_columns=None, payloads=(),
    AUTHORING_MODULES_TABLE, connection, fetch_all, load_content_cache, logger, table_name,
    native_only,
):
    """Before a write that sets module_catalogue_id, retire the rows' CURRENT modules.

    The rows a write returns name only the module they now belong to; a row
    moved out of a module must retire that module's cached content too. Read
    with the write's own WHERE or key, so it costs one small query, and only
    for writes that can move a row.
    """
    content_cache = load_content_cache()
    bare = str(table or '').split('.')[-1].strip('"')
    if bare not in content_cache.CONTENT_TABLES or bare == AUTHORING_MODULES_TABLE:
        return
    if not any('module_catalogue_id' in (payload or {}) for payload in payloads):
        return
    if connection.vendor != 'postgresql':
        content_cache.retire_all()
        return
    read_source = table_name(table)
    if native_only():
        from curriculum_api.catalogue.infrastructure.course_storage_reads import native_read_table
        read_source = native_read_table(bare)
    try:
        if where_sql is not None:
            rows = fetch_all(f'select distinct module_catalogue_id from {read_source} where {where_sql}',
                             list(where_params or []))
        elif list(key_columns or []) == ['id']:
            ids = [payload.get('id') for payload in payloads if payload and payload.get('id') not in (None, '')]
            if not ids:
                return
            rows = fetch_all(f'select distinct module_catalogue_id from {read_source} where id = any(%s)',
                             [ids])
        else:
            content_cache.retire_all()
            return
        content_cache.note_modules(row['module_catalogue_id'] for row in rows)
    except Exception:
        logger.warning('Unable to read the modules a write moves rows from; retiring all content.',
                       exc_info=True)
        content_cache.retire_all()
