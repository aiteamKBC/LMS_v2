"""Normalized calendar inputs and the existing bounded JSON settings projection."""


def read_inputs(*, schedule=False, module_ids=None, programme_id=None,
                authoring_fetch_all, modules_table, groups_table, cohorts_table,
                group_order, cohort_order, module_fields, excluded_module_columns):
    """Read normalized rows only; optional scopes use stored IDs, never titles."""
    if module_ids == [] or programme_id == '':
        return [], [], []
    clauses, params = [], []
    if module_ids is not None:
        clauses.append('module_catalogue_id in (' + ','.join(['%s'] * len(module_ids)) + ')')
        params.extend(module_ids)
    if programme_id is not None:
        clauses.append('programme_id = %s')
        params.append(programme_id)
    args = (' and '.join(clauses), params) if clauses else ()
    modules = authoring_fetch_all(modules_table, *args, ensure_tables=False,
        **({'order_sql': 'programme_id, title',
            'exclude_columns': [*excluded_module_columns, 'description', 'cover_image', 'cover_image_url']}
           if schedule else {'columns': module_fields}))

    def parents(table, key, order):
        if not clauses:
            return authoring_fetch_all(table, order_sql=order, ensure_tables=False)
        ids = list(dict.fromkeys(row.get(key) for row in modules if row.get(key)))
        if not ids:
            return []
        where = key + ' in (' + ','.join(['%s'] * len(ids)) + ')'
        return authoring_fetch_all(table, where, ids, order_sql=order, ensure_tables=False)

    return modules, parents(groups_table, 'group_id', group_order), parents(cohorts_table, 'cohort_id', cohort_order)

def live_rows(
    module_ids,
    *,
    AUTHORING_COMPONENTS_TABLE,
    AUTHORING_WEEKS_TABLE,
    CALENDAR_SETTINGS,
    COMPONENT_COLUMNS,
    LIVE_SESSION_TYPE_SQL,
    WEEK_INDEX_COLUMNS,
    authoring_fetch_all,
    connection,
    fetch_all,
    has_column,
    learning_read_table,
    quote_ident,
):
    if not module_ids:
        return [], []
    slots = ','.join(['%s'] * len(module_ids))
    where = f'module_catalogue_id in ({slots})'
    weeks = authoring_fetch_all(
        AUTHORING_WEEKS_TABLE, where, module_ids,
        'module_catalogue_id, display_order, week_number, id',
        ensure_tables=False, columns=WEEK_INDEX_COLUMNS,
    )
    columns = [column for column in COMPONENT_COLUMNS
               if has_column(AUTHORING_COMPONENTS_TABLE, column)]
    if connection.vendor == 'postgresql':
        # jsonb_each preserves a present JSON null (unlike ->> / strip_nulls),
        # so legacy fallback and explicit clearing retain their existing meaning.
        # The projection runs in SQL: large attendees/options/content settings
        # never cross the database connection just to draw a calendar.
        fields = ', '.join(quote_ident(column) for column in columns)
        settings = """coalesce((
            select jsonb_object_agg(setting.key, setting.value)
            from jsonb_each(case when jsonb_typeof(settings_json::jsonb) = 'object'
                then settings_json::jsonb else '{}'::jsonb end) setting
            where setting.key = ANY(%s)
        ), '{}'::jsonb) as settings_json"""
        components = fetch_all(f'''
            select {fields}, {settings}
            from {learning_read_table(AUTHORING_COMPONENTS_TABLE)}
            where {where} and {LIVE_SESSION_TYPE_SQL}
            order by module_catalogue_id, week_id, display_order, id
        ''', [list(CALENDAR_SETTINGS), *module_ids])
    else:
        components = authoring_fetch_all(
            AUTHORING_COMPONENTS_TABLE,
            f'{where} and {LIVE_SESSION_TYPE_SQL}', module_ids,
            'module_catalogue_id, week_id, display_order, id',
            ensure_tables=False, columns=[*columns, 'settings_json'],
        )
    return weeks, components
