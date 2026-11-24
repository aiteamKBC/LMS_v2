"""Paged component reads and content projection with unchanged SQL and ordering.

The outer adapter retains cache scope and existing schema checks. Cursor and
archive predicates are supplied explicitly; no global Django connection.
"""

from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str


def live_component_rows_paged(
    module_ids=None,
    order_sql='display_order, id',
    *,
    _live_component_rows_paged,
    clean_str=_default_clean_str,
):
    """Every column of the live component rows of ``module_ids`` (all when None), in pages.

    Returns the same rows, in the same order, that
    ``active_component_rows(authoring_fetch_all(components, 'module_catalogue_id in (...)', ids, order_sql))``
    would -- callers still apply that filter -- by two changes to how they are
    fetched:

    * Soft-deleted rows are left out by the query (Postgres only). They are a
      third of the table and the Python filter drops them anyway: a non-null
      ``deleted_at`` timestamp is always truthy and ``is not true`` is exactly
      truthy() on a boolean, so the SQL drops a subset of what
      active_component_rows() drops, never more. sqlite (tests) can hold an
      empty-string ``deleted_at`` that the Python filter treats as live, so the
      filter is not applied there.
    * The read is paged with LIMIT/OFFSET over the caller's ``order_sql``. The
      order must be total -- ``id`` is the primary key and ends the default --
      so the pages concatenate into exactly the single statement's order, in the
      database's own collation, which Python could not reproduce by re-sorting.

    The ids are de-duplicated and sorted before the memoised read, so the
    structure reader and the component-builder reader of one detail build share
    one fetch whatever order each holds its ids in; the row order comes from
    ``order_sql`` alone.
    """
    ids = None if module_ids is None else tuple(sorted({clean_str(value) for value in module_ids if clean_str(value)}))
    if ids is not None and not ids:
        return []
    return _live_component_rows_paged(ids, order_sql)


def _live_component_rows_paged(module_ids, order_sql, *,
    AUTHORING_COMPONENTS_TABLE,
    COMPONENT_FULL_READ_PAGE_ROWS,
    archive_live_sql,
    authoring_fetch_all,
    database_vendor,
):
    clauses = []
    params = []
    if module_ids is not None:
        clauses.append(f'module_catalogue_id in ({", ".join(["%s"] * len(module_ids))})')
        params = list(module_ids)
    if database_vendor() == 'postgresql':
        clauses.append(archive_live_sql())
    where = ' and '.join(f'({clause})' for clause in clauses)
    rows = []
    seen_ids = set()
    offset = 0
    while True:
        page = authoring_fetch_all(
            AUTHORING_COMPONENTS_TABLE, where, params,
            f'{order_sql} limit {COMPONENT_FULL_READ_PAGE_ROWS} offset {offset}',
        )
        for row in page:
            # A row inserted between two pages shifts the offset by one and can
            # repeat the previous page's last row; never return it twice.
            row_id = str(row.get('id'))
            if row_id in seen_ids:
                continue
            seen_ids.add(row_id)
            rows.append(row)
        if len(page) < COMPONENT_FULL_READ_PAGE_ROWS:
            return rows
        offset += COMPONENT_FULL_READ_PAGE_ROWS


def live_component_rows_without_content(
    module_ids,
    keep_keys=None,
    exclude_columns=(),
    *,
    AUTHORING_COMPONENTS_TABLE,
    COMPONENT_CONTENT_SETTING_KEYS,
    COMPONENT_DB_OMITTED_KEYS_COLUMN,
    COMPONENT_FULL_READ_PAGE_ROWS,
    archive_live_sql,
    clean_str=_default_clean_str,
    column_names,
    database_vendor,
    ensure_module_authoring_tables,
    learning_read_table,
    open_cursor,
    quote_ident,
    rows_as_dicts,
):
    """``live_component_rows_paged(module_ids)`` with the authored long text
    (COMPONENT_CONTENT_SETTING_KEYS) stripped from ``settings_json`` by Postgres.

    ``omit=content`` used to drop that text in Python, after the database had
    already shipped it: ~24 MB of the components table's 39 MB is settings_json,
    nearly all of it these keys, and the largest programme holds ~17k of the
    table's ~18k rows. Stripping in the query keeps it on the database side.

    Each row also carries COMPONENT_DB_OMITTED_KEYS_COLUMN: the stripped keys
    whose value was not empty, in COMPONENT_CONTENT_SETTING_KEYS order -- what
    component_rows_without_content() would have named.

    Returns None where this read does not apply (not Postgres, no module ids,
    no settings_json column); the caller then takes the full read.

    With ``keep_keys`` a row's settings are only those keys (empty values
    included) and COMPONENT_DB_OMITTED_KEYS_COLUMN is empty -- except on a
    live session, which loses only its non-empty content keys, named in that
    column as before: its settings feed meeting_settings() and the Teams
    readers whole.

    ``exclude_columns`` names whole columns the caller never reads (matched
    case-insensitively); they are not selected, so they never cross the wire.
    """
    ids = tuple(sorted({clean_str(value) for value in (module_ids or []) if clean_str(value)}))
    if not ids or database_vendor() != 'postgresql':
        return None
    ensure_module_authoring_tables()
    columns = column_names(AUTHORING_COMPONENTS_TABLE)
    if 'settings_json' not in columns:
        return None
    keys = list(COMPONENT_CONTENT_SETTING_KEYS)
    settings = f'component.{quote_ident("settings_json")}::jsonb'
    omitted = f'omitted.{quote_ident(COMPONENT_DB_OMITTED_KEYS_COLUMN)}'
    excluded = {str(column).lower() for column in (exclude_columns or ())}
    select_list = ', '.join(
        f'component.{quote_ident(column)}' for column in sorted(columns - {'settings_json'})
        if column.lower() not in excluded or column.lower() == 'id'
    )
    select_params = []
    if keep_keys:
        live = "replace(coalesce(component.type::text, ''), '_', '-') = 'live-session'"
        # Any other row ships only the kept keys, empty ones included (the page
        # tests some for presence). Stripping just the non-empty rest, as this
        # read did, still sent every empty key and the names of the removed ones
        # for ~20k rows -- most of the read's ~40 s -- for Python to discard.
        kept = (
            f"(select coalesce(jsonb_object_agg(entry.key, entry.value), '{{}}'::jsonb)"
            f' from jsonb_each({settings}) as entry where entry.key = any(%s::text[]))'
        )
        select_list += (
            f", case when {settings} is null or jsonb_typeof({settings}) <> 'object' then {settings}"
            f' when {live} then {settings} - {omitted} else {kept} end'
            f' as {quote_ident("settings_json")}, {omitted}'
        )
        select_params = [list(keep_keys)]
        # A live session loses only its non-empty content keys, named as before.
        key_filter = f' where {live} and entry.key = any(%s::text[])'
        key_order = ' order by entry.key'
        key_params = [keys]
    else:
        # Only non-empty values go, as in component_rows_without_content(): an
        # empty one stays in settings and is not named as omitted.
        select_list += (
            f", case when jsonb_typeof({settings}) = 'object' then {settings} - {omitted} else {settings} end"
            f' as {quote_ident("settings_json")}, {omitted}'
        )
        key_filter = ' where entry.key = any(%s::text[])'
        key_order = ' order by array_position(%s::text[], entry.key)'
        key_params = [keys, keys]
    omitted_keys = (
        f"select case when jsonb_typeof({settings}) = 'object' then array("
        f'select entry.key from jsonb_each({settings}) as entry'
        f'{key_filter}'
        f""" and entry.value not in ('null'::jsonb, '""'::jsonb, '[]'::jsonb, '{{}}'::jsonb)"""
        f'{key_order}'
        f') else array[]::text[] end as {quote_ident(COMPONENT_DB_OMITTED_KEYS_COLUMN)}'
    )
    # Same filter as _live_component_rows_paged: live rows of these modules only.
    clauses = [f'component.module_catalogue_id in ({", ".join(["%s"] * len(ids))})']
    clauses.append(archive_live_sql('component'))
    where = ' and '.join(f'({clause})' for clause in clauses)
    table = f'{learning_read_table(AUTHORING_COMPONENTS_TABLE)} as component'
    # The order first, from the ids alone, then the rows in id batches. Paging
    # the row query with LIMIT/OFFSET made Postgres sort -- and so strip --
    # every row ahead of the offset again on each page: ~21 s for the largest
    # programme against ~10 s for the same rows read once each.
    with open_cursor() as cursor:
        cursor.execute(f'select component.id from {table} where {where} order by component.display_order, component.id', list(ids))
        ordered_ids = [row[0] for row in cursor.fetchall()]
    rows_by_id = {}
    for start in range(0, len(ordered_ids), COMPONENT_FULL_READ_PAGE_ROWS):
        batch = ordered_ids[start:start + COMPONENT_FULL_READ_PAGE_ROWS]
        with open_cursor() as cursor:
            cursor.execute(
                f'select {select_list} from {table} cross join lateral ({omitted_keys}) as omitted'
                f' where ({where}) and component.id in ({", ".join(["%s"] * len(batch))})',
                [*select_params, *key_params, *ids, *batch],
            )
            for row in rows_as_dicts(cursor):
                rows_by_id[row.get('id')] = row
    # A row archived between the two reads is simply absent; one added is not
    # in the order and waits for the next read, as it would on a later page.
    return [rows_by_id[row_id] for row_id in ordered_ids if row_id in rows_by_id]
