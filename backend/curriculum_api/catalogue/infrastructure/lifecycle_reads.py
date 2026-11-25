"""SQL reads and schema-aware payload preparation for lifecycle guards.

Original queries, statement ordering and per-table error handling are preserved."""

from curriculum_api.catalogue.domain.programme_identity import programme_config_identity as _default_programme_config_identity
from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str


def programme_dependency_counts(
    identifier,
    config=None,
    *,
    AUTHORING_MODULES_TABLE,
    COHORT_AUTHORING_DETAILS_TABLE,
    FREE_PROGRAMME_COMPONENTS_TABLE,
    GROUPS_TABLE,
    clean_str=_default_clean_str,
    connection,
    fetch_all,
    has_column,
    logger,
    programme_config_identity=_default_programme_config_identity,
    quote_ident,
    schema_compat,
    table_exists,
    table_name,
):
    """Count the children that would be orphaned by hard-deleting a programme.

    curriculum.programmes has NO inbound foreign keys, so the database will
    happily delete a programme row and leave its cohorts/groups/modules
    dangling. This is the application-level guard that replaces the protection
    a FK would normally provide.
    """
    candidates = {clean_str(identifier), programme_config_identity(config)}
    candidates = {value for value in candidates if value}
    names = {
        clean_str((config or {}).get('name')),
        clean_str((config or {}).get('standard')),
    }
    names = {value for value in names if value}
    counts = {}
    if not candidates:
        return counts
    placeholders = ', '.join(['%s'] * len(candidates))
    params = list(candidates)
    for table in (
        COHORT_AUTHORING_DETAILS_TABLE,
        GROUPS_TABLE,
        AUTHORING_MODULES_TABLE,
        'week_templates',
        'quizzes',
        FREE_PROGRAMME_COMPONENTS_TABLE,
    ):
        try:
            if not table_exists(table) or not has_column(table, 'programme_id'):
                continue
            rows = fetch_all(
                f'select count(*) as total from {table_name(table)} '
                f'where {quote_ident("programme_id")} in ({placeholders})',
                params,
            )
            total = int((rows[0] or {}).get('total') or 0) if rows else 0
            if total:
                counts[table] = total
        except Exception:
            logger.debug('Could not count %s rows for programme %s.', table, identifier, exc_info=True)
    if connection.vendor == 'postgresql':
        try:
            learner_columns = schema_compat.columns_of('Learner', 'learners')
            with connection.cursor() as cursor:
                if 'programme_id' in learner_columns:
                    # Normalised schema: the learner names its programme by id
                    # (the programme name column was dropped).
                    cursor.execute(
                        f'select count(*) from "Learner"."learners" where programme_id in ({placeholders})',
                        params,
                    )
                elif names and 'programme' in learner_columns:
                    name_placeholders = ', '.join(['%s'] * len(names))
                    cursor.execute(
                        f'select count(*) from "Learner"."learners" where programme in ({name_placeholders})',
                        list(names),
                    )
                else:
                    cursor.execute('select 0')
                total = int(cursor.fetchone()[0] or 0)
                if total:
                    counts['learners'] = total
        except Exception:
            logger.debug('Could not count learners for programme %s.', identifier, exc_info=True)
    return counts


def archived_rows_under(
    table, parent_id, *, AUTHORING_COMPONENTS_TABLE, AUTHORING_KSB_MAPPINGS_TABLE,
    AUTHORING_MODULES_TABLE, LIFECYCLE_KEY_COLUMNS, archive_state, authoring_table_name, column_names,
    fetch_all, quote_ident,
):
    """Archived rows of ``table`` that sit anywhere under ``parent_id``.

    The parent may be a programme, cohort, module, week or component; every
    placement column the table has is tried, plus a programme's modules for
    module content and a component's own parents for KSB mappings. Only the
    candidates: ``archive_state.archived_with`` decides which of them went with
    the parent.
    """
    columns = column_names(table)
    key = LIFECYCLE_KEY_COLUMNS[table]
    modules = authoring_table_name(AUTHORING_MODULES_TABLE)
    components = authoring_table_name(AUTHORING_COMPONENTS_TABLE)
    clauses, params = [], []
    for column in ('programme_id', 'cohort_id', 'module_catalogue_id', 'week_id', 'component_id'):
        if column in columns:
            clauses.append(f'{quote_ident(column)} = %s')
            params.append(parent_id)
    if 'module_catalogue_id' in columns:
        clauses.append(f'module_catalogue_id in (select module_catalogue_id from {modules} where programme_id = %s)')
        params.append(parent_id)
    if table == AUTHORING_KSB_MAPPINGS_TABLE:
        clauses.append(
            f'component_id in (select id from {components} where module_catalogue_id = %s or week_id = %s '
            f'or module_catalogue_id in (select module_catalogue_id from {modules} where programme_id = %s))'
        )
        params += [parent_id, parent_id, parent_id]
    if not clauses:
        return []
    wanted = [key, 'status', 'created_at', 'updated_at'] + [
        column for column in ('programme_id', 'cohort_id', 'module_catalogue_id', 'week_id', 'component_id')
        if column in columns and column != key
    ]
    return fetch_all(
        f'select {", ".join(quote_ident(column) for column in dict.fromkeys(wanted))} '
        f'from {authoring_table_name(table)} where {archive_state.inactive_sql()} and ({" or ".join(clauses)})',
        params,
    )


def curriculum_where_any(
    clauses,
):
    """OR the non-empty clauses together, or return no SQL at all.

    An empty id list must never widen into ``where true``: on a delete that is
    the whole table. Callers therefore skip the statement entirely when this
    returns an empty ``where`` rather than falling back to a default predicate.
    """
    usable = [(sql, params) for sql, params in clauses if sql and params]
    if not usable:
        return '', []
    return (
        ' or '.join(sql for sql, _ in usable),
        [value for _, values in usable for value in values],
    )


def curriculum_ids_matching(
    table,
    column,
    clauses,
    *,
    clean_str=_default_clean_str,
    curriculum_where_any,
    fetch_all,
    quote_ident,
    table_exists,
    table_name,
):
    where_sql, params = curriculum_where_any(clauses)
    if not where_sql or not table_exists(table):
        return []
    rows = fetch_all(
        f'select distinct {quote_ident(column)} as value from {table_name(table)} where {where_sql}',
        params,
    )
    return [clean_str(row.get('value')) for row in rows if clean_str(row.get('value'))]


def orphan_programme_name_clause(table, programme_name, *, clean_str=_default_clean_str, has_column):
    """Rows that name this programme but carry no programme id at all.

    A child saved while its parent id had not resolved yet keeps only the
    denormalised ``programme_name``. Every id-based sweep - the archive cascade
    and the permanent delete alike - misses it, and ``build_programmes`` then
    rebuilds a card out of the leftover row: a discarded run that reads as if it
    had been saved. Only rows with an empty ``programme_id`` are matched, so a
    row belonging to a different programme of the same name is never touched.
    """
    name = clean_str(programme_name)
    if not name:
        return '', []
    try:
        if not has_column(table, 'programme_id') or not has_column(table, 'programme_name'):
            return '', []
    except Exception:
        return '', []
    return (
        "(coalesce(programme_id, '') = '' and lower(trim(programme_name)) = lower(trim(%s)))",
        [name],
    )


def programme_permanent_delete_blockers(
    child_ids, *, PROGRAMME_PERMANENT_DELETE_LEARNER_LINKS, clean_str, connection, logger, quote_ident,
):
    """Learner rows the database itself refuses to orphan.

    ``Learner.learner_training_plan_{modules,weeks,components}`` reference
    curriculum modules, weeks and components with ON DELETE RESTRICT. A learner's
    training plan is their delivery record, so content they hold is not something
    a programme delete may remove; it is reported and the delete is refused.
    """
    blockers = {}
    if connection.vendor != 'postgresql':
        return blockers
    for table, column, key in PROGRAMME_PERMANENT_DELETE_LEARNER_LINKS:
        values = [value for value in (child_ids.get(key) or []) if clean_str(value)]
        if not values:
            continue
        try:
            with connection.cursor() as cursor:
                cursor.execute('select to_regclass(%s)', [f'"Learner"."{table}"'])
                if not cursor.fetchone()[0]:
                    continue
                placeholders = ', '.join(['%s'] * len(values))
                cursor.execute(
                    f'select count(*) from "Learner".{quote_ident(table)} '
                    f'where {quote_ident(column)} in ({placeholders})',
                    values,
                )
                total = int(cursor.fetchone()[0] or 0)
        except Exception:
            # A count we cannot run is not a green light: the RESTRICT foreign key
            # still refuses the delete, and the caller turns that into the same 409.
            logger.warning('Could not count %s rows for a permanent programme delete.', table, exc_info=True)
            continue
        if total:
            blockers[table] = total
    return blockers


def refuse_if_programme_owns_content(
    plan, *, AUTHORING_COMPONENTS_TABLE, AUTHORING_WEEKS_TABLE, PROGRAMME_CONTENT_RETAINED_MESSAGE,
    ProgrammeContentRetained, curriculum_in_clause, curriculum_where_any, fetch_all, table_exists,
    table_name,
):
    """Stop a permanent delete, before anything is written, if content would be lost.

    Weeks and components are the reusable output of Curriculum Studio. Every week
    belongs to a module and every component to a week (NOT NULL, RESTRICT), so
    they cannot outlive the programme being deleted.
    """
    child = plan.get('childIds') or {}
    for table, ids in ((AUTHORING_WEEKS_TABLE, child.get('weekIds')),
                       (AUTHORING_COMPONENTS_TABLE, child.get('componentIds'))):
        where_sql, params = curriculum_where_any([curriculum_in_clause('id', ids or [])])
        if where_sql and table_exists(table) and fetch_all(
            f'select 1 from {table_name(table)} where {where_sql} limit 1', params,
        ):
            raise ProgrammeContentRetained(PROGRAMME_CONTENT_RETAINED_MESSAGE)


def programme_config_rows_remaining(
    candidates, *, curriculum_in_clause, fetch_all, programme_config_key_column, table_exists,
    table_name,
):
    """Programme rows still in the table for these ids, read straight from it.

    Deliberately not ``programme_config_by_identifier``: that reads the cached
    config rows and matches on name as a fallback, so it can answer for a row
    that is gone, or for a different programme that shares the name.
    """
    clause, params = curriculum_in_clause(programme_config_key_column(), candidates)
    if not clause or not table_exists('programmes'):
        return 0
    return len(fetch_all(f'select 1 from {table_name("programmes")} where {clause}', params))


def permanent_delete_reference_blockers(
    kind, identifier, *, PERMANENT_DELETE_REFERENCES, clean_str, connection, logger, quote_ident,
    schema_compat, transaction,
):
    """``{key: count}`` of retained records that reference this row. Read-only.

    Only references whose table and column exist are counted, so the legacy
    schema (no such keys) answers {} and keeps its existing behaviour. A count
    that cannot be run is skipped: the database still refuses the delete, and
    the caller turns that into its generic 409.
    """
    blockers = {}
    ident = clean_str(identifier)
    if not ident or connection.vendor != 'postgresql':
        return blockers
    for schema, table, column, key, subquery in PERMANENT_DELETE_REFERENCES.get(kind, ()):
        try:
            if column not in schema_compat.columns_of(schema, table):
                continue
            condition = f'{quote_ident(column)} in ({subquery})' if subquery else f'{quote_ident(column)} = %s'
            with transaction.atomic(), connection.cursor() as cursor:
                cursor.execute(
                    f'select count(*) from {quote_ident(schema)}.{quote_ident(table)} where {condition}', [ident],
                )
                total = int(cursor.fetchone()[0] or 0)
        except Exception:
            logger.warning('Could not count %s.%s rows before a permanent %s delete.', schema, table, kind,
                           exc_info=True)
            continue
        if total:
            blockers[key] = total
    return blockers


def archive_payload(
    table, existing_notes=None, *, append_notes_meta, archive_state, has_column, now_iso,
):
    payload = {}
    if has_column(table, 'status'):
        payload['status'] = archive_state.INACTIVE if archive_state.uses_status(table) else 'archived'
    if has_column(table, 'is_archived'):
        payload['is_archived'] = True
    if has_column(table, 'is_active'):
        payload['is_active'] = False
    notes_column = 'notes' if has_column(table, 'notes') else ('Notes' if has_column(table, 'Notes') else None)
    if notes_column:
        payload[notes_column] = append_notes_meta(existing_notes, {'archived': 'true', 'archived_at': now_iso()})
    return payload


def restore_payload(
    table, existing_notes=None, *, has_column, remove_notes_meta,
):
    payload = {}
    if has_column(table, 'status'):
        payload['status'] = 'active'
    if has_column(table, 'is_archived'):
        payload['is_archived'] = False
    if has_column(table, 'is_active'):
        payload['is_active'] = True
    notes_column = 'notes' if has_column(table, 'notes') else ('Notes' if has_column(table, 'Notes') else None)
    if notes_column:
        payload[notes_column] = remove_notes_meta(existing_notes, {'archived', 'archived_at'})
    return payload
