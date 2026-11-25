"""Authoring SELECT projections and authoritative placement-name lookups.

SQL construction only; the compatibility adapter owns the existing schema guard."""

import re

from . import archive_sql as archive_state

from . import database_reads, ksb_read_store

PROGRAMME_NAME_DERIVED_TABLES = frozenset({'groups', 'cohorts', 'modules'})


PLACEMENT_NAME_DERIVED_COLUMNS = {
    'groups': (('cohort_name', 'cohorts', 'cohort_id', 'cohort_name'),),
    'modules': (('cohort_name', 'cohorts', 'cohort_id', 'cohort_name'),
                ('group_name', 'groups', 'group_id', 'group_name')),
}


def derived_programme_name_sql(table, *,
    PROGRAMME_NAME_DERIVED_TABLES=PROGRAMME_NAME_DERIVED_TABLES,
    authoring_table_name=lambda table: database_reads.authoring_table_name(table),
    has_column=lambda table, column: database_reads.has_column(table, column),
):
    """``<expr> AS programme_name`` when ``table`` no longer stores the name, else ''.

    Keeps every ``row['programme_name']`` reader and every bare
    ``order by programme_name`` working: Postgres resolves a bare ORDER BY name
    to this output column. Correlated on the table's own reference, so callers'
    where/order clauses are unchanged. A blank, unknown or duplicated programme
    id gives '' (the old column's default) rather than an arbitrary name. A
    database that still has the physical copy also reads the authoritative name.
    """
    if table not in PROGRAMME_NAME_DERIVED_TABLES or not has_column(table, 'programme_id'):
        return ''
    row = authoring_table_name(table)
    return (f"COALESCE((SELECT CASE WHEN count(*) = 1 THEN min(programme_name_source.name) END "
            f"FROM {authoring_table_name('programmes')} programme_name_source "
            f"WHERE programme_name_source.programme_id = {row}.programme_id "
            f"AND btrim(coalesce({row}.programme_id, '')) <> ''), '') AS programme_name")


def derived_placement_names_sql(table, *,
    PLACEMENT_NAME_DERIVED_COLUMNS=PLACEMENT_NAME_DERIVED_COLUMNS,
    authoring_table_name=lambda table: database_reads.authoring_table_name(table),
    derived_programme_name_sql=derived_programme_name_sql,
    has_column=lambda table, column: database_reads.has_column(table, column),
):
    """``{output: '<expr> AS output'}`` for every placement name ``table`` no longer stores.

    ``programme_name`` comes from derived_programme_name_sql(); cohort and
    group names are read the same way through their ids. Each is a scalar
    subquery correlated on the table's own reference, so no outer row is ever
    duplicated, and a blank, unknown or duplicated id gives '' (the removed
    column's default). Physical copies are replaced, never used as a fallback.
    Writers are unaffected: authoring_upsert()
    and update_authoring_rows() write only physical columns, so a derived key
    in a payload is dropped.
    """
    derived = {}
    programme = derived_programme_name_sql(table)
    if programme:
        derived['programme_name'] = programme
    row = authoring_table_name(table)
    for output, source, key, source_column in PLACEMENT_NAME_DERIVED_COLUMNS.get(table, ()):
        if not has_column(table, key):
            continue
        derived[output] = (
            f"COALESCE((SELECT CASE WHEN count(*) = 1 THEN min(placement_source.{source_column}) END "
            f"FROM {authoring_table_name(source)} placement_source "
            f"WHERE placement_source.{key} = {row}.{key} "
            f"AND btrim(coalesce({row}.{key}, '')) <> ''), '') AS {output}")
    return derived


def authoring_select_sql(table, where_sql='', order_sql='', *, columns=None, exclude_columns=None,
    AUTHORING_KSB_MAPPINGS_TABLE=database_reads.AUTHORING_KSB_MAPPINGS_TABLE,
    authoring_table_name=lambda table: database_reads.authoring_table_name(table),
    column_names=lambda table: database_reads.column_names(table),
    derived_placement_names_sql=derived_placement_names_sql,
    ksb_placement_fields=ksb_read_store.PLACEMENT_FIELDS,
    ksb_relation=ksb_read_store.relation,
    learning_read_table,
    quote_ident=lambda name: database_reads.quote_ident(name),
):
    """The statement authoring_fetch_all() runs; shared so a prefetch sends the same SQL."""
    available = set(column_names(table))
    relation = None
    if table == AUTHORING_KSB_MAPPINGS_TABLE:
        # A mapping's module and week are its component's, its code its
        # standard KSB's. The description is attached after the fetch
        # (complete_authoring_rows): it is the standard's text on every row.
        relation = ksb_relation(include_description=False)
        available |= {*ksb_placement_fields, 'ksb_code'}
    # Placement names by id -- a stale physical copy is never read. Only the
    # names the read uses (selected, or named by its WHERE / ORDER BY) are
    # derived: each is a lookup per row. In FROM, so WHERE and ORDER BY can use
    # them even when the caller does not select them.
    names = derived_placement_names_sql(table)
    stale_copies = set(names) & available
    available -= set(names)
    clauses = f'{where_sql} {order_sql}'
    derived = {
        key: expression for key, expression in names.items()
        if (key in columns if columns else key not in (exclude_columns or ()))
        or re.search(rf'\b{key}\b', clauses)
    }
    if derived or stale_copies:
        source_columns = [quote_ident(key) for key in sorted(available)]
        projection = ', '.join([*source_columns, *derived.values()])
        relation = f'(select {projection} from {authoring_table_name(table)}) as {quote_ident(table)}'
        available.update(derived)
    if columns:
        wanted = [column for column in columns if column in available]
        if (table == AUTHORING_KSB_MAPPINGS_TABLE and 'ksb_description' in columns
                and 'standard_ksb_id' in available and 'standard_ksb_id' not in wanted):
            # The description is looked up by this key.
            wanted.append('standard_ksb_id')
        select_list = ', '.join(quote_ident(column) for column in wanted) if wanted else '*'
    elif exclude_columns:
        # Everything but the named columns. Safer than an allow-list for a
        # caller that reads most of the row: a column added later is included
        # automatically instead of silently arriving as None.
        wanted = sorted(available - {column for column in exclude_columns})
        select_list = ', '.join(quote_ident(column) for column in wanted) if wanted else '*'
    else:
        select_list = '*'
    query = f'select {select_list} from {relation or learning_read_table(table)}'
    if where_sql:
        query += f' where {where_sql}'
    if order_sql:
        query += f' order by {order_sql}'
    return query


def live_authoring_rows_sql(table):
    """``(where_sql, params)`` keeping the rows the Python active_*_rows() filters keep.

    The archive state is ``status``, so this is exactly row_has_deleted_at()
    in SQL. Callers keep running the Python filter on what comes back (it also
    drops retired component types), which is what makes the two agree row for row.
    """
    if not archive_state.uses_status(table):
        return '', []
    return archive_state.live_sql(), []
