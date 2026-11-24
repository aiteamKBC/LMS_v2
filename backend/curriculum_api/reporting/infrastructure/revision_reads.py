"""Revision-store availability, ancestry and latest-revision SQL reads."""


def qualified(
    table, *, connection,
):
    if connection.vendor != 'postgresql':
        return f'"{table}"'
    return f'"curriculum"."{table}"'


def history_available(
    *, REVISIONS_TABLE, VERSIONS_TABLE, _AVAILABLE, connection,
):
    """True when both history tables exist. Cached; a miss is not cached.

    Probed with ``to_regclass``, which answers NULL for a missing relation
    instead of raising. Selecting from a table that is not there would raise,
    and in Postgres a raised statement aborts the whole surrounding transaction
    -- so the cheapest possible check would have been able to fail the very save
    it was asked to record.

    Not caching the negative matters: these tables are created by hand against
    Neon, and a process started before that SQL ran must begin recording once it
    has, without a restart.
    """
    if _AVAILABLE.get('ready'):
        return True
    try:
        with connection.cursor() as cursor:
            if connection.vendor == 'postgresql':
                cursor.execute(
                    'select to_regclass(%s) is not null and to_regclass(%s) is not null',
                    [f'curriculum.{REVISIONS_TABLE}', f'curriculum.{VERSIONS_TABLE}'],
                )
            else:
                cursor.execute(
                    "select count(*) = 2 from sqlite_master "
                    "where type = 'table' and name in (%s, %s)",
                    [REVISIONS_TABLE, VERSIONS_TABLE],
                )
            row = cursor.fetchone()
    except Exception:
        return False
    if not (row and row[0]):
        return False
    _AVAILABLE['ready'] = True
    return True


def reset_availability(
    *, _AVAILABLE,
):
    _AVAILABLE.pop('ready', None)
    _AVAILABLE.pop('metadata', None)


def resolve_ancestry(
    module_ids, *, clean, connection, logger, qualified,
):
    """Programme / cohort / group / module names for these modules, in one read.

    One query for every module touched by the flush, not one per row: a tree
    save buffers thousands of components and they nearly all sit under the same
    handful of modules.
    """
    ids = sorted({clean(value) for value in module_ids if clean(value)})
    if not ids:
        return {}
    placeholders = ', '.join(['%s'] * len(ids))
    # The module keeps ids; the names are its programme's / cohort's / group's own.
    query = (
        'select m.module_catalogue_id, m.title, m.programme_id, p.name as programme_name, '
        'm.cohort_id, c.cohort_name, m.group_id, g.group_name '
        f'from {qualified("modules")} m '
        f'left join {qualified("programmes")} p on p.programme_id = m.programme_id '
        f'left join {qualified("cohorts")} c on c.cohort_id = m.cohort_id '
        f'left join {qualified("groups")} g on g.group_id = m.group_id '
        f'where m.module_catalogue_id in ({placeholders})'
    )
    try:
        with connection.cursor() as cursor:
            cursor.execute(query, ids)
            columns = [column[0] for column in cursor.description]
            rows = [dict(zip(columns, values)) for values in cursor.fetchall()]
    except Exception:
        # Context is a nicety; the snapshot and the diff are the record. A module
        # that has just been hard-deleted is exactly the case that lands here.
        logger.debug('Could not resolve curriculum ancestry.', exc_info=True)
        return {}
    return {
        clean(row.get('module_catalogue_id')): {
            key: clean(row.get(key))
            for key in (
                'programme_id', 'programme_name', 'cohort_id', 'cohort_name',
                'group_id', 'group_name',
            )
            if clean(row.get(key))
        } | {'module_name': clean(row.get('title'))}
        for row in rows
    }


def latest_revisions(
    entity_type, entity_ids, *, REVISIONS_TABLE, as_dict, clean, connection, metadata_columns_available,
    qualified,
):
    """The newest revision per entity, in one read.

    ``distinct on`` keeps this a single index scan over
    ``record_revisions_entity_idx`` however many ids are asked for, which is
    what makes the bulk path viable — the tree save hands over every component
    in a module at once.
    """
    ids = [clean(value) for value in entity_ids if clean(value)]
    if not ids:
        return {}
    placeholders = ', '.join(['%s'] * len(ids))
    columns_sql = 'entity_id, id, revision_no, snapshot, version_label, content_status, action, actor_email, created_at, changed_fields'
    if metadata_columns_available():
        columns_sql += ', metadata'
    if connection.vendor == 'postgresql':
        query = (
            f'select distinct on (entity_id) {columns_sql} '
            f'from {qualified(REVISIONS_TABLE)} '
            f'where entity_type = %s and entity_id in ({placeholders}) '
            f'order by entity_id, revision_no desc'
        )
    else:
        # sqlite has no `distinct on`, and the correlated-subquery form cannot
        # alias a schema-qualified name. The row count here is bounded by the
        # revisions of the entities being saved, so the newest is picked below.
        query = (
            f'select {columns_sql} from {qualified(REVISIONS_TABLE)} '
            f'where entity_type = %s and entity_id in ({placeholders}) '
            f'order by entity_id, revision_no'
        )
    with connection.cursor() as cursor:
        cursor.execute(query, [entity_type, *ids])
        columns = [column[0] for column in cursor.description]
        rows = [dict(zip(columns, values)) for values in cursor.fetchall()]
    result = {}
    for row in rows:
        key = clean(row.get('entity_id'))
        existing = result.get(key)
        if existing and int(existing.get('revision_no') or 0) >= int(row.get('revision_no') or 0):
            continue
        row['snapshot'] = as_dict(row.get('snapshot'))
        result[key] = row
    return result


def metadata_columns_available(
    *, METADATA_COLUMNS, REVISIONS_TABLE, _AVAILABLE, connection,
):
    """Whether ``record_revisions`` has the Phase 2 metadata columns yet.

    Probed the same way the tables themselves are, and for the same reason: this
    runs inside somebody's save, so it has to answer without raising. Cached on
    success only -- the columns are added by hand against Neon, and a process
    started before that SQL ran must begin using them once it has, without a
    restart. ``reset_availability`` clears it.
    """
    if _AVAILABLE.get('metadata'):
        return True
    try:
        with connection.cursor() as cursor:
            if connection.vendor == 'postgresql':
                cursor.execute(
                    'select count(*) from information_schema.columns '
                    'where table_schema = %s and table_name = %s and column_name = any(%s)',
                    ['curriculum', REVISIONS_TABLE, list(METADATA_COLUMNS)],
                )
            else:
                cursor.execute(f'pragma table_info("{REVISIONS_TABLE}")')
                names = {row[1] for row in cursor.fetchall()}
                _AVAILABLE['metadata'] = set(METADATA_COLUMNS) <= names
                return _AVAILABLE['metadata']
            row = cursor.fetchone()
    except Exception:
        return False
    if not (row and int(row[0] or 0) == len(METADATA_COLUMNS)):
        return False
    _AVAILABLE['metadata'] = True
    return True


def module_publish_count(
    entity_id, *, VERSIONS_TABLE, connection, qualified,
):
    with connection.cursor() as cursor:
        cursor.execute(
            f'select count(*) from {qualified(VERSIONS_TABLE)} where entity_type = %s and entity_id = %s',
            ['module', entity_id],
        )
        row = cursor.fetchone()
    return int(row[0]) if row else 0
