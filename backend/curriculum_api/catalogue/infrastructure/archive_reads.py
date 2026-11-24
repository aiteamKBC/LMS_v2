"""Infrastructure archive reads. Explicit read capabilities preserve legacy contracts."""


def archived_authoring_rows(
    table, *, LIFECYCLE_KEY_COLUMNS, archive_state, authoring_fetch_all, curriculum_row_is_archived,
    format_created_at,
):
    """Every archived row in one authoring table, most recent archive first.

    Sorted on the *formatted* stamp rather than the column itself: ``deleted_at``
    comes back tz-aware from Postgres and naive from sqlite, and comparing the
    two kinds raises. ISO text orders identically either way.
    """
    rows = [dict(row) for row in authoring_fetch_all(table) if curriculum_row_is_archived(row)]
    if archive_state.uses_status(table):
        # When, why and with which parent: history's record of the archive.
        archive_state.annotate(table, rows, key_column=LIFECYCLE_KEY_COLUMNS[table])
    rows.sort(key=lambda row: format_created_at(row.get('deleted_at')), reverse=True)
    return rows


def archived_module_rows(
    *, AUTHORING_MODULES_TABLE, archive_state, curriculum_row_effectively_deleted, format_created_at,
    safe_authoring_module_rows,
):
    """Every archived module row, most recent archive first.

    ``curriculum_row_effectively_deleted`` rather than the cohort/group
    ``curriculum_row_is_archived``: a module's ``status`` is authoring state
    ('draft', 'published'), and a legacy row carrying status 'archived' is still
    listed by the catalogue. Reading that as archived here would put one module
    in both lists at once.
    """
    rows = [dict(row) for row in safe_authoring_module_rows() if curriculum_row_effectively_deleted(row)]
    archive_state.annotate(AUTHORING_MODULES_TABLE, rows, key_column='module_catalogue_id')
    rows.sort(key=lambda row: format_created_at(row.get('deleted_at')), reverse=True)
    return rows


def archived_module_component_counts(
    module_catalogue_ids=None, *, AUTHORING_COMPONENTS_TABLE, authoring_fetch_all, authoring_table_name,
    clean_str, connection, defaultdict, ensure_module_authoring_tables, logger,
):
    """Component rows per module, counted by the database.

    ``module_catalogue_ids`` limits the count to those modules -- the archived
    ones are all the archive asks about -- and on Postgres the counting is a
    ``group by`` rather than shipping one row per component (~18k) to be
    counted here. A module absent from the result has no component rows.

    ``columns`` is not an optimisation here so much as the difference between an
    answer and a timeout: curriculum.components is the largest table in the
    schema and most of its bytes are ``settings_json``, which a count never looks
    at. Every row is counted, deleted or not -- an archived module's components
    are all soft-deleted with it, and the question this answers is how much
    authoring is sitting inside.
    """
    counts = defaultdict(int)
    ids = None if module_catalogue_ids is None else sorted({
        clean_str(value) for value in module_catalogue_ids if clean_str(value)
    })
    if ids is not None and not ids:
        return counts
    try:
        if connection.vendor == 'postgresql':
            ensure_module_authoring_tables()
            where = f' where module_catalogue_id in ({", ".join(["%s"] * len(ids))})' if ids else ''
            with connection.cursor() as cursor:
                cursor.execute(
                    f'select module_catalogue_id, count(*)'
                    f' from {authoring_table_name(AUTHORING_COMPONENTS_TABLE)}{where}'
                    ' group by module_catalogue_id',
                    ids or [],
                )
                for module_id, total in cursor.fetchall():
                    key = clean_str(module_id)
                    if key:
                        counts[key] += int(total)
            return counts
        rows = authoring_fetch_all(AUTHORING_COMPONENTS_TABLE, columns=['module_catalogue_id'])
    except (Exception, AssertionError):
        logger.debug('Unable to count components for the module archive.', exc_info=True)
        return counts
    for row in rows:
        key = clean_str(row.get('module_catalogue_id'))
        if key:
            counts[key] += 1
    return counts
