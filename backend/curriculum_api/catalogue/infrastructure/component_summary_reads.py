"""Component and normalized KSB summary queries, with unchanged grouping.

PostgreSQL projections and portable reads use explicit read capabilities."""
from collections import defaultdict


def component_summary_source_rows(catalogue_ids, *,
    AUTHORING_COMPONENTS_TABLE,
    COMPONENT_SUMMARY_COLUMNS,
    active_component_rows,
    archive_live_sql,
    authoring_fetch_all,
    column_names,
    component_is_published,
    database_vendor,
    fetch_all,
    learning_read_table,
    quote_ident,
):
    """The live component rows of ``catalogue_ids``, reduced to what the summary reads.

    The same rows component_builder_rows() returns -- the Postgres-side filter
    of live_component_rows_paged(), then active_component_rows() -- without
    the authored content, the KSB mappings, or any column the summary never
    looks at. Each row stands for ``_count`` components (1 unless grouped)
    and says how many of them are published in ``_published``.

    On Postgres identical rows are grouped by the database, so the largest
    programme's ~17k components arrive as roughly one row per week instead of
    one per component: the statement itself runs in ~0.2 s there, and shipping
    every row to the application was most of a multi-second read. Two things
    stay per component on purpose: ``expected_otjh`` is grouped on its stored
    value and converted to minutes here, so the rounding is the browser's
    double arithmetic and never Postgres numeric's; and a settings document
    stored as a JSON string (not an object) is read row by row and parsed by
    component_builder_settings(), exactly as the full read parses it.
    """
    columns = column_names(AUTHORING_COMPONENTS_TABLE)
    placeholders = ', '.join(['%s'] * len(catalogue_ids))
    clauses = [f'module_catalogue_id in ({placeholders})']
    if database_vendor() != 'postgresql' or 'settings_json' not in columns:
        wanted = [column for column in COMPONENT_SUMMARY_COLUMNS if column in columns]
        rows = authoring_fetch_all(
            AUTHORING_COMPONENTS_TABLE, clauses[0], list(catalogue_ids),
            columns=[*wanted, 'settings_json'] if 'settings_json' in columns else wanted,
        )
        return [
            {**row, '_count': 1, '_published': component_is_published(row)}
            for row in active_component_rows(rows)
        ]
    clauses.append(archive_live_sql())
    where = ' and '.join(f'({clause})' for clause in clauses)
    table = learning_read_table(AUTHORING_COMPONENTS_TABLE)
    settings = quote_ident('settings_json')
    # Every column active_component_rows() and the bucket key read; a column
    # this table does not carry is selected as null, as a row without it reads.
    key_columns = [
        'module_catalogue_id', 'week_id', 'type', 'status', 'expected_otjh',
    ]
    key_select = ', '.join(
        f'{quote_ident(column)} as {quote_ident(column)}' if column in columns else f'null as {quote_ident(column)}'
        for column in key_columns
    )
    group_by = ', '.join(str(index) for index in range(1, len(key_columns) + 2))
    published = f"coalesce(({settings} ->> 'componentBuilderStatus') = 'published', false)"
    rows = fetch_all(
        f'select {key_select}, {published} as {quote_ident("_published_flag")},'
        f' count(*) as {quote_ident("_count")},'
        f' min(display_order) as {quote_ident("display_order")},'
        f' (array_agg(title order by display_order, title))[1] as {quote_ident("title")}'
        f' from {table} where {where}'
        f" and ({settings} is null or jsonb_typeof({settings}) = 'object')"
        f' group by {group_by}',
        list(catalogue_ids),
    )
    grouped = []
    for row in rows:
        count = int(row.pop('_count') or 0)
        flag = bool(row.pop('_published_flag'))
        grouped.append({**row, '_count': count, '_published': count if flag else 0})
    wanted = [column for column in COMPONENT_SUMMARY_COLUMNS if column in columns]
    loose = fetch_all(
        f'select {", ".join(quote_ident(column) for column in wanted)}, {settings}'
        f' from {table} where {where}'
        f" and {settings} is not null and jsonb_typeof({settings}) <> 'object'",
        list(catalogue_ids),
    )
    loose = [{**row, '_count': 1, '_published': component_is_published(row)} for row in loose]
    return active_component_rows(grouped + loose)


def component_summary_ksb_codes(catalogue_ids, *,
    AUTHORING_COMPONENTS_TABLE,
    AUTHORING_KSB_MAPPINGS_TABLE,
    active_component_rows,
    archive_live_sql,
    authoring_table_name,
    coverage_normalise_code,
    database_vendor,
    fetch_all,
    quote_ident,
    table_exists,
):
    """``{(module_catalogue_id, week_id): {code, ...}}``: the KSB codes the full read maps there.

    The same mappings component_builder_rows() puts on its components, counted
    by code rather than shipped one per component: live mappings
    (active_mapping_rows), with a code, on live components that
    active_component_rows() keeps, codes normalised as coverage_normalise_code
    does. The programme Modules tab counts a module's distinct KSBs from this.

    None off Postgres or without the standard KSB table; the summary then
    leaves ``ksbCodes`` out and the page falls back to the full component read.
    """
    if database_vendor() != 'postgresql' or not catalogue_ids or not table_exists('standard_ksbs'):
        return None
    # A mapping's code is its standard KSB's; both rows are filtered by status.
    code_sql = 'standard.ksb_code'
    join_sql = f' join {authoring_table_name("standard_ksbs")} as standard on standard.id = mapping.standard_ksb_id'
    clauses = [
        f'component.module_catalogue_id in ({", ".join(["%s"] * len(catalogue_ids))})',
        archive_live_sql('component'),
        archive_live_sql('mapping'),
        f"coalesce({code_sql}, '') <> ''",
    ]
    # What active_component_rows() reads beyond the archive state the SQL filtered.
    key_columns = ['module_catalogue_id', 'week_id', 'type']
    key_select = ', '.join(f'component.{quote_ident(column)} as {quote_ident(column)}' for column in key_columns)
    group_by = ', '.join(str(index) for index in range(1, len(key_columns) + 1))
    rows = fetch_all(
        f'select {key_select}, array_agg(distinct {code_sql}) as {quote_ident("_codes")}'
        f' from {authoring_table_name(AUTHORING_COMPONENTS_TABLE)} as component'
        f' join {authoring_table_name(AUTHORING_KSB_MAPPINGS_TABLE)} as mapping on mapping.component_id = component.id'
        f'{join_sql}'
        f' where {" and ".join(f"({clause})" for clause in clauses)}'
        f' group by {group_by}',
        list(catalogue_ids),
    )
    codes = defaultdict(set)
    for row in active_component_rows(rows):
        key = (str(row.get('module_catalogue_id') or ''), str(row.get('week_id') or ''))
        codes[key].update(code for code in (coverage_normalise_code(value) for value in (row.get('_codes') or [])) if code)
    return codes
